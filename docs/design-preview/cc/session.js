(() => {
  'use strict';
  const data=window.SESSION_REPLAY_DATA, qs=new URLSearchParams(location.search);
  if(qs.has('embed')) document.body.classList.add('embed');
  const fmt=s=>{s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const names=['Read the task','Inspect the search flow','Trace filter changes','Locate the page state','Inspect the request builder','Check the update path','Review the API contract','Inspect callers','Check existing coverage','Read the pagination test','Plan the change','Update filter handling','Add the regression test','Review the test cases','Check empty results','Check retained filters','Review page navigation','Check request parameters','Inspect the diff','Review edge cases','Run the regression checks','Review the output','Check the final changes','Summarize the change','Complete the session'];
  // This text is an illustration, shared byte-for-byte by both sides. Only its
  // reveal fraction and the request boundaries are driven by recorded timing.
  function transcript(i,tokens){
    if(i===24)return 'Updated filter changes to reset pagination. Added regression coverage for resetting the page and preserving filters during page navigation.\n\nThe change is ready for review.';
    if(tokens<90)return i<12?'I will inspect the current search state.':'I will check this case before continuing.';
    const target=Math.max(80,Math.min(14000,tokens*3.8));
    const fields=['status','tag','owner','label','project','priority','query','sort'];
    const intro=i<4?'I will trace the search request and its page state. The page should reset when the filters change.\n\n':i<12?'The filter update and page navigation need separate state transitions.\n\nsrc/search/query.ts\n\n':i<17?'I will add regression coverage for filter changes and page navigation.\n\ntests/search.test.ts\n\ndescribe("search pagination", () => {\n':i<22?'Reviewing the pagination change and its regression cases.\n\n':'The page reset and filter-preservation paths are covered. Reviewing the remaining cases before handing this back.\n\n';
    const blocks=[];let length=intro.length,k=0;
    while(length<target){
      const field=fields[k%fields.length],page=k+2;
      let block;
      if(i>=12&&i<17){
        block='  it("resets page '+page+' after changing '+field+'", () => {\n    const previous = { page: '+page+', filters: { '+field+': "before" } };\n    const next = updateFilters(previous, { '+field+': "after" });\n\n    expect(next.page).toBe(1);\n    expect(next.filters.'+field+').toBe("after");\n    expect(previous.page).toBe('+page+');\n  });\n\n';
        if(k%3===2)block+='  it("preserves '+field+' while moving to the next page", () => {\n    const state = { page: 1, filters: { '+field+': "selected" } };\n    const next = nextPage(state);\n    expect(next.page).toBe(2);\n    expect(next.filters).toEqual(state.filters);\n  });\n\n';
      }else if(i<12){
        block='  // '+(k+1)+'. Update '+field+' independently of page navigation.\n  function set'+field[0].toUpperCase()+field.slice(1)+'(state, value) {\n    return {\n      ...state,\n      filters: { ...state.filters, '+field+': value },\n      page: 1,\n    };\n  }\n\n';
      }else{
        block='  '+(k+1)+'. Changing '+field+' resets the page index.\n     Moving between pages preserves the selected '+field+'.\n     The original state stays unchanged.\n\n';
      }
      blocks.push(block);length+=block.length;k++;
    }
    // Whole sentences and complete snippets keep the illustration readable.
    return intro+blocks.join('')+(i>=12&&i<17?'});\n':'');
  }
  let mode=qs.get('mode')==='reply'?'reply':'session',t=Number(qs.get('t'))||0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let playing=!qs.has('t')&&!reduced.matches,last=null,hold=0;
  const sides={};
  const allText=data.dyn.map((r,i)=>transcript(i,r[6]));
  for(const arm of ['dyn','ours']){
    const root=document.getElementById(arm);
    sides[arm]={root,scroller:root.querySelector('[data-scroll]'),host:root.querySelector('[data-messages]'),status:root.querySelector('[data-status]'),state:root.querySelector('[data-state]'),finish:root.querySelector('[data-finish]'),progress:root.querySelector('[data-progress]'),bar:root.querySelector('[data-bar]'),label:root.querySelector('[data-progress-label]'),rows:[],nodes:[]};
  }
  let end=0,speed=45;
  function configure(){
    t=0;hold=0;last=null;speed=mode==='reply'?1:45;
    document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    for(const arm of ['dyn','ours']){
      const side=sides[arm];
      side.rows=mode==='session'?data[arm].map((r,i)=>({row:r,index:i})): [{row:data[arm][data.detailCall].map((v,i)=>i<3?v-data[arm][data.detailCall][0]:v),index:data.detailCall}];
      side.host.replaceChildren();side.nodes=[];
      for(const {row,index} of side.rows){
        const box=document.createElement('div');box.className='message';
        const head=document.createElement('div');head.className='message-head';head.textContent='● '+names[index];
        const meta=document.createElement('small');meta.textContent='model call '+(index+1);head.append(' ',meta);
        const pre=document.createElement('pre');box.append(head,pre);
        const tool=document.createElement('div');tool.className='tool';tool.textContent='› Tool call';
        side.host.append(box,tool);side.nodes.push({box,pre,tool,text:allText[index],shown:-1});
      }
      side.label.textContent=mode==='reply'?'OUTPUT TOKENS':'MODEL CALLS COMPLETED';
    }
    end=Math.max(...Object.values(sides).map(s=>Math.max(...s.rows.map(x=>x.row[2]))));
    document.getElementById('seek').max=String(end);
    document.getElementById('duration').textContent=elapsed(end);
    document.getElementById('rate').textContent=speed+'×';
    document.getElementById('scope').textContent=mode==='reply'?'Model call 13 of 25 · same 1,148 output tokens · actual speed':'Same 25 model calls. Same 15,028 output tokens.';
    document.querySelectorAll('.prompt').forEach(p=>p.hidden=mode==='reply');
    render();
  }
  function renderSide(arm){
    const s=sides[arm];let done=0,hasWait=false,hasDecode=false,output=0;
    s.rows.forEach(({row:r},i)=>{
      const n=s.nodes[i],started=t>=r[0],finished=t>=r[2];
      const f=t<r[1]?0:finished?1:clamp((t-r[1])/Math.max(.000001,r[2]-r[1]),0,1);
      n.box.hidden=!started;
      n.box.classList.toggle('streaming',started&&!finished&&t>=r[1]);
      const count=Math.floor(f*n.text.length);
      if(count!==n.shown){n.pre.textContent=n.text.slice(0,count);n.shown=count;}
      if(finished)done++;
      if(started&&!finished){if(t<r[1])hasWait=true;else hasDecode=true;}
      output+=Math.floor(f*r[6]);
      const next=s.rows[i+1]?.row;
      n.tool.hidden=mode==='reply'||!finished||!next||next[0]<=r[2];
      n.tool.classList.toggle('active',finished&&next&&t<next[0]);
      if(!n.tool.hidden)n.tool.textContent=t>=next[0]?'› Tool call completed':'› Tool call';
    });
    const finished=done===s.rows.length;
    const phase=finished?'done':hasDecode?'decode':hasWait?'wait':'tool';
    s.status.dataset.phase=phase;
    s.state.textContent=phase==='done'?(mode==='reply'?'Response complete':'Session complete'):phase==='decode'?'Decoding':phase==='wait'?'Waiting for first token (TTFT)':'Tool call';
    s.finish.textContent=finished?'Finished · '+elapsed(Math.max(...s.rows.map(x=>x.row[2]))):'';
    const denominator=mode==='reply'?s.rows[0].row[6]:s.rows.length;
    const numerator=mode==='reply'?output:done;
    s.progress.innerHTML=(mode==='reply'&&numerator>0&&!finished?'~':'')+numerator.toLocaleString()+' <small>/ '+denominator.toLocaleString()+'</small>';
    s.bar.style.width=(100*numerator/denominator)+'%';
    s.scroller.scrollTop=s.scroller.scrollHeight-s.scroller.clientHeight;
    return finished;
  }
  function elapsed(value){const tenths=Math.round(value*10);return mode==='reply'?fmt(Math.floor(tenths/10))+'.'+tenths%10:fmt(value);}
  function render(){
    const d=renderSide('dyn'),o=renderSide('ours');
    document.getElementById('clock').textContent=elapsed(t);
    document.getElementById('seek').value=String(t);
    const take=document.getElementById('takeaway');
    take.textContent=mode==='reply'?(o&&!d?'Evolving Infra has returned the reply. Dynamo is still serving the same request.':d?'The same reply length, with the recorded TTFT and decode duration on each side.':'Both requests start together. Watch the first token, then the stream.'):
      d?'This matched session finishes 2.86× sooner on Evolving Infra.':o?'Evolving Infra has finished all 25 calls. Dynamo is still working through the same session.':'Watch the same session move through its model calls and tool calls.';
  }
  const play=document.getElementById('play');
  function setPlaying(v){playing=v;last=null;play.textContent=v?'Pause':'Play';play.setAttribute('aria-pressed',String(v));}
  play.addEventListener('click',()=>{if(t>=end)t=0;setPlaying(!playing);render();});
  document.getElementById('restart').addEventListener('click',()=>{t=0;hold=0;setPlaying(true);render();});
  document.getElementById('seek').addEventListener('input',e=>{setPlaying(false);t=Number(e.target.value);render();});
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;configure();setPlaying(!reduced.matches);}));
  addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','BUTTON','SUMMARY'].includes(document.activeElement.tagName)){e.preventDefault();setPlaying(!playing);}});
  document.addEventListener('visibilitychange',()=>{last=null;});
  function tick(now){
    if(playing&&!document.hidden){
      if(last!==null){const dt=Math.min(.15,(now-last)/1000);if(t>=end){hold+=dt;if(hold>4){t=0;hold=0;}}else t=Math.min(end,t+dt*speed);}
      last=now;render();
    }
    requestAnimationFrame(tick);
  }
  const sums=arm=>({wait:data[arm].reduce((a,r)=>a+r[1]-r[0],0),decode:data[arm].reduce((a,r)=>a+r[2]-r[1],0),end:Math.max(...data[arm].map(r=>r[2]))});
  const ds=sums('dyn'),os=sums('ours');
  document.getElementById('measurements').innerHTML=[['Model calls',25,25],['Output tokens','15,028','15,028'],['Session elapsed',fmt(ds.end),fmt(os.end)],['Sum of per-request TTFT',fmt(ds.wait),fmt(os.wait)],['Sum of decode durations',ds.decode.toFixed(1)+' s',os.decode.toFixed(1)+' s']].map(r=>'<tr>'+r.map((x,i)=>'<'+(i?'td':'th')+'>'+x+'</'+(i?'td':'th')+'>').join('')+'</tr>').join('');
  const initial=t;configure();t=clamp(initial,0,end);render();setPlaying(playing);
  window.sessionDemo={seek(x){setPlaying(false);t=clamp(Number(x)||0,0,end);render();},setMode(x){mode=x==='reply'?'reply':'session';configure();setPlaying(false);},state(){return {mode,time:t,end,speed,playing};}};
  requestAnimationFrame(tick);
})();
