(() => {
  'use strict';
  const source=window.SESSION_REPLAY_DATA,run=window.STORY_RUN_DATA;
  const $=id=>document.getElementById(id),qs=new URLSearchParams(location.search);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(qs.has('film'))document.body.classList.add('export');
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const fmt=s=>{const n=Math.max(0,Math.floor(s));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  const money=(v,d=2)=>'$'+v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  const price=r=>((r[3]-r[4])*run.ratesPerMillion.input+r[4]*run.ratesPerMillion.cachedInput+r[6]*run.ratesPerMillion.output)/1e6;
  const rows={},stats={},sides={};
  // Remove only gaps with no in-flight request. Every request keeps its own
  // measured TTFT and decode duration; overlapping requests remain overlapping.
  for(const arm of ['dyn','ours']){
    let busyEnd=0,removed=0;
    rows[arm]=source[arm].map(r=>{removed+=Math.max(0,r[0]-busyEnd);busyEnd=Math.max(busyEnd,r[2]);return [r[0]-removed,r[1]-removed,r[2]-removed,...r.slice(3)];});
    const prompt=source[arm].reduce((s,r)=>s+r[3],0),cached=source[arm].reduce((s,r)=>s+r[4],0);
    stats[arm]={hit:cached/prompt,ttft:source[arm].reduce((s,r)=>s+r[1]-r[0],0),cost:source[arm].reduce((s,r)=>s+price(r),0),modelEnd:Math.max(...rows[arm].map(r=>r[2])),omitted:removed};
    const root=$('story-'+arm),host=root.querySelector('[data-messages]');
    const nodes=rows[arm].map((r,i)=>{
      const box=document.createElement('div');box.className='message';
      const head=document.createElement('div');head.className='message-head';head.textContent='● Assistant';
      const small=document.createElement('small');small.textContent='model call '+(i+1);head.append(small);
      const pre=document.createElement('pre');box.append(head,pre);host.append(box);
      return {box,pre,text:window.storyTranscript(i,r[6]),shown:-1};
    });
    sides[arm]={root,nodes,scroll:root.querySelector('[data-scroll]'),status:root.querySelector('[data-status]'),state:root.querySelector('[data-state]'),call:root.querySelector('[data-call]'),finish:root.querySelector('[data-finish]'),progress:root.querySelector('[data-progress]'),bar:root.querySelector('[data-progress-bar]'),hit:root.querySelector('[data-hit]'),cost:root.querySelector('[data-cost]'),elapsed:root.querySelector('[data-elapsed]')};
  }
  const modelEnd=Math.max(stats.dyn.modelEnd,stats.ours.modelEnd);
  const points=[...new Set([0,...Object.values(rows).flatMap(rs=>rs.flatMap(r=>[r[1],r[2]]))])].sort((a,b)=>a-b);
  const segments=[];let modelVideo=0;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],middle=(a+b)/2;
    const streaming=Object.values(rows).some(rs=>rs.some(r=>r[1]<=middle&&middle<r[2]));
    const rate=streaming?8:120,duration=(b-a)/rate;
    segments.push({a,b,rate,start:modelVideo,end:modelVideo+duration});modelVideo+=duration;
  }
  const INTRO=.8,SESSION_END=INTRO+modelVideo+.7,RUN_DURATION=12,END_HOLD=3.5,TOTAL=SESSION_END+RUN_DURATION+END_HOLD;
  let time=clamp(Number(qs.get('t'))||0,0,TOTAL),playing=!qs.has('t')&&!reduced.matches,last=null,currentPhase='';
  function modelAt(video){
    const v=Math.max(0,video-INTRO);
    if(v>=modelVideo)return {time:modelEnd,rate:1};
    const seg=segments.find(s=>v<s.end)||segments[segments.length-1];
    return {time:seg.a+(v-seg.start)*seg.rate,rate:seg.rate};
  }
  function renderArm(arm,t){
    const side=sides[arm];let done=0,active=null,decoding=false,prompt=0,cached=0,output=0,charge=0;
    rows[arm].forEach((r,i)=>{
      const node=side.nodes[i],started=t+1e-8>=r[0],finished=t+1e-8>=r[2];
      const fraction=finished?1:t<r[1]?0:clamp((t-r[1])/Math.max(1e-8,r[2]-r[1]),0,1);
      node.box.hidden=!started;node.box.classList.toggle('streaming',started&&!finished&&t>=r[1]);
      const length=Math.floor(fraction*node.text.length);
      if(length!==node.shown){node.pre.textContent=node.text.slice(0,length);node.shown=length;}
      if(finished){done++;prompt+=r[3];cached+=r[4];output+=r[6];charge+=price(r);}
      if(started&&!finished){active={row:r,index:i};if(t>=r[1])decoding=true;}
    });
    const finished=done===rows[arm].length,phase=finished?'done':decoding?'decode':'wait';
    side.status.dataset.phase=phase;
    side.state.textContent=finished?'All model calls returned':decoding?'Decoding':'Waiting for first token (TTFT) · '+fmt(active?t-active.row[0]:0);
    side.call.textContent=active?'Call '+(active.index+1):'';
    side.finish.textContent=finished?'FINISHED '+fmt(stats[arm].modelEnd):'';
    side.elapsed.textContent=fmt(Math.min(t,stats[arm].modelEnd));
    side.hit.textContent=prompt?(cached/prompt*100).toFixed(1)+'%':'—';
    side.cost.textContent=prompt+output?money(charge/(prompt+output)*1e6,3):'—';
    side.progress.innerHTML=done+' <small>/ 25</small>';side.bar.style.width=(done/25*100)+'%';
    side.scroll.scrollTop=side.scroll.scrollHeight-side.scroll.clientHeight;
  }
  function sample(arm,t){
    const series=run.series[arm],index=Math.min(series.length-1,Math.floor(t/run.sampleSeconds));
    const a=series[index],b=series[Math.min(index+1,series.length-1)],f=clamp((t-a[0])/run.sampleSeconds,0,1);
    const revenue=a[1]+(b[1]-a[1])*f,calls=a[3]+(b[3]-a[3])*f;
    const prompt=a[5]+(b[5]-a[5])*f,cached=a[6]+(b[6]-a[6])*f,output=a[7]+(b[7]-a[7])*f;
    return {revenue,calls,hit:a[5]>0?cached/prompt:null,cost:a[5]>0?revenue/(prompt+output)*1e6:null};
  }
  const plots={};
  function makePlot(id,min,max,ticks,format){
    const svg=$(id),x=t=>52+(t/3600)*560,y=v=>218-(v-min)/(max-min)*200;
    let markup='';
    for(const v of ticks)markup+='<line class="plot-grid" x1="52" x2="612" y1="'+y(v)+'" y2="'+y(v)+'"/><text class="plot-axis" text-anchor="end" x="42" y="'+(y(v)+4)+'">'+format(v)+'</text>';
    for(const m of [0,15,30,45,60])markup+='<text class="plot-axis" text-anchor="middle" x="'+x(m*60)+'" y="239">'+m+'</text>';
    markup+='<text class="plot-axis" text-anchor="middle" x="332" y="260">Time after warmup (min)</text><line class="plot-cursor" y1="18" y2="218"/>';
    for(const arm of ['dyn','ours'])markup+='<path class="plot-line plot-'+arm+'" data-line="'+arm+'"/><circle class="plot-dot" data-dot="'+arm+'" r="4" fill="'+(arm==='ours'?'#c92336':'#b8c2cc')+'"/>';
    svg.innerHTML=markup;
    return {svg,x,y,lines:Object.fromEntries(['dyn','ours'].map(a=>[a,svg.querySelector('[data-line="'+a+'"]')])),dots:Object.fromEntries(['dyn','ours'].map(a=>[a,svg.querySelector('[data-dot="'+a+'"]')]))};
  }
  plots.revenue=makePlot('revenue-chart',0,1200,[0,400,800,1200],v=>'$'+v.toLocaleString('en-US'));
  plots.hit=makePlot('hit-chart',.9,1,[.9,.95,1],v=>Math.round(v*100)+'%');
  function drawPlot(key,t,values){
    const plot=plots[key],column=key==='revenue'?1:2;
    for(const arm of ['dyn','ours']){
      const points=run.series[arm].filter(r=>r[0]<=t&&r[column]!==null).map(r=>[r[0],r[column]]);
      const current=values[arm][key];if(current!==null)points.push([t,current]);
      plot.lines[arm].setAttribute('d',points.map((p,i)=>(i?'L':'M')+plot.x(p[0]).toFixed(2)+' '+plot.y(p[1]).toFixed(2)).join(' '));
      plot.dots[arm].style.display=current===null?'none':'';
      if(current!==null){plot.dots[arm].setAttribute('cx',plot.x(t));plot.dots[arm].setAttribute('cy',plot.y(current));}
    }
    const cursor=plot.svg.querySelector('.plot-cursor');cursor.setAttribute('x1',plot.x(t));cursor.setAttribute('x2',plot.x(t));
  }
  function renderRun(t){
    const values={dyn:sample('dyn',t),ours:sample('ours',t)};
    for(const arm of ['dyn','ours']){
      const r=values[arm];$('run-'+arm+'-calls').textContent=Math.floor(r.calls+1e-8).toLocaleString('en-US');
      $('run-'+arm+'-cost').textContent=r.cost===null?'—':money(r.cost,3);
      $('revenue-'+arm).textContent=money(r.revenue);
      $('hit-'+arm).textContent=r.hit===null?'—':(r.hit*100).toFixed(1)+'%';
    }
    drawPlot('revenue',t,values);drawPlot('hit',t,values);$('run-clock').textContent=fmt(t);
    const lower=(1-run.totals.ours.userCostPerMillionTokens/run.totals.dyn.userCostPerMillionTokens)*100;
    $('run-takeaway').innerHTML=t>=3600?'At 60 min: <b>2.36× revenue</b> with <b>'+lower.toFixed(1)+'% lower user cost / 1M tokens.</b>':'Higher cache reuse lowers input-token charges. More completed calls bring more revenue.';
  }
  function render(){
    const phase=time<SESSION_END?'session':'run';
    if(phase!==currentPhase){
      currentPhase=phase;$('session-scene').hidden=phase!=='session';$('run-scene').hidden=phase!=='run';
      $('film').dataset.scene=phase;
      $('eyebrow').textContent='CLAUDE CODE WORKLOAD';
      $('title').textContent=phase==='session'?'Serve the same Claude Code session':'Revenue and cache reuse across all 126 agents';
      $('setup').textContent=phase==='session'?'Same 25 model calls · 15,028 output tokens · GLM-5.2 · 126 agents at once on 36 GB300 GPUs':'Claude Code traces · GLM-5.2 · full measurement hour after warmup · 36 GB300 GPUs per system';
      $('film-note').textContent=phase==='session'?'Tool-call time omitted; illustrative terminal text. Metrics accumulate over completed calls; cost / 1M includes input + output, at demo token prices.':'Full-hour curves use original wall time. Cache hit is token weighted; cost / 1M includes input + output, at demo token prices.';
      document.querySelectorAll('[data-chapter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.chapter===phase)));
      resize();
    }
    if(phase==='session'){
      const m=modelAt(time);renderArm('dyn',m.time);renderArm('ours',m.time);
      $('model-rate').textContent=m.time>=modelEnd?'End':m.rate+'×';
    }else renderRun(clamp((time-SESSION_END)/RUN_DURATION*3600,0,3600));
    $('seek').value=String(time);$('video-clock').textContent=fmt(time);
  }
  function resize(){
    const mobile=innerWidth<=760,scale=$('film-wrap').clientWidth/1440;
    $('film').style.transform=mobile?'none':'scale('+scale+')';
    $('film-wrap').style.height=mobile?'auto':810*scale+'px';
  }
  new ResizeObserver(resize).observe($('film-wrap'));addEventListener('resize',resize);
  function setPlaying(value){playing=value;last=null;$('play').textContent=value?'Pause':'Play';$('play').setAttribute('aria-pressed',String(value));}
  function seek(value){setPlaying(false);time=clamp(Number(value)||0,0,TOTAL);render();}
  $('play').addEventListener('click',()=>{if(time>=TOTAL)time=0;setPlaying(!playing);render();});
  $('replay').addEventListener('click',()=>{time=0;setPlaying(true);render();});
  $('seek').addEventListener('input',e=>seek(e.target.value));
  document.querySelectorAll('[data-chapter]').forEach(b=>b.addEventListener('click',()=>{seek(b.dataset.chapter==='run'?SESSION_END:0);setPlaying(!reduced.matches);}));
  addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','BUTTON','SUMMARY'].includes(document.activeElement.tagName)){e.preventDefault();setPlaying(!playing);}});
  document.addEventListener('visibilitychange',()=>{last=null;});
  function tick(now){if(playing&&!document.hidden){if(last!==null){time+=(now-last)/1000;if(time>TOTAL)time%=TOTAL;}last=now;render();}requestAnimationFrame(tick);}
  $('seek').max=String(TOTAL);$('video-duration').textContent=fmt(TOTAL);
  window.storyDemo={seek,play(){setPlaying(true);},restart(){time=0;setPlaying(true);render();},modelRows(arm){return rows[arm];},state(){return {time,playing,phase:currentPhase,total:TOTAL,sessionEnd:SESSION_END,modelEnd,modelVideo,stats};}};
  window.renderAt=seek;
  resize();render();setPlaying(playing);requestAnimationFrame(tick);
})();
