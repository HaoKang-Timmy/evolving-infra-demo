(() => {
  'use strict';
  const root=document.getElementById('shift-demo');if(!root)return;
  const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const splits=window.WORKLOAD_SPLIT_DATA;
  const at=(arm,t)=>{let current=splits[arm][0];for(const r of splits[arm])if(r[0]<=t)current=r;return current;};
  for(const arm of ['dynamo','ours'])for(let i=0;i<9;i++){const node=document.createElement('span');node.className='shift-node';node.setAttribute('aria-hidden','true');$('shift-nodes-'+arm).append(node);}
  const workloads=[[288,0],[144,72],[0,144]],tabs=Array.from(root.querySelectorAll('[data-shift-phase]'));
  const timeline=root.querySelector('.shift-phases');
  let time=0,playing=!reduced.matches,visible=false,last=null,hold=0,previous='';
  function render(){
    const phase=Math.min(2,Math.floor(time/60)),counts=workloads[phase],ours=at('ours',time),dyn=at('dynamo',time),p=ours[1];
    timeline.style.setProperty('--shift-progress',String(time/180));
    const key=[phase,...ours,...dyn].join(':');if(key===previous)return;previous=key;
    tabs.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===phase)));
    $('shift-putnam').textContent=String(counts[0]);$('shift-osworld').textContent=String(counts[1]);
    $('shift-putnam').parentElement.classList.toggle('is-empty',!counts[0]);$('shift-osworld').parentElement.classList.toggle('is-empty',!counts[1]);
    for(const [arm,row] of [['dynamo',dyn],['ours',ours]]){
      const prefill=row[1],decode=row[2],restarting=9-prefill-decode;
      $('shift-split-'+arm).textContent=prefill+'P · '+decode+'D';
      $('shift-status-'+arm).textContent=restarting?restarting+' restarting':'9 serving';
      const host=$('shift-nodes-'+arm);
      host.setAttribute('aria-label',(arm==='ours'?'Evolving Infra':'Dynamo')+': '+prefill+' prefill, '+decode+' decode, '+restarting+' restarting nodes');
      [...host.children].forEach((node,i)=>{const state=i<prefill?'p':i<prefill+decode?'d':'restarting';node.className='shift-node is-'+state;node.textContent=state==='p'?'P':state==='d'?'D':'↻';});
    }
    const text=['Decode-heavy Putnam favors more decode capacity.','Computer-use agents join the workload, increasing prefill demand.','All agents now run prefill-heavy OSWorld. Compare the two allocations.'][phase];
    $('shift-caption').textContent=text;
  }
  function setPlaying(value){playing=value;last=null;$('shift-play').textContent=value?'Pause':'Play';$('shift-play').setAttribute('aria-pressed',String(value));}
  $('shift-play').addEventListener('click',()=>{if(time>=180){time=0;hold=0;}setPlaying(!playing);render();});
  tabs.forEach((b,i)=>b.addEventListener('click',()=>{time=i*60;hold=0;last=null;render();}));
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=null;},{threshold:.15}).observe(root);
  document.addEventListener('visibilitychange',()=>{last=null;});
  function tick(now){if(playing&&visible&&!document.hidden){if(last!==null){const dt=(now-last)/1000;if(time>=180){hold+=dt;if(hold>2){time=0;hold=0;}}else time=Math.min(180,time+dt*10);}last=now;render();}requestAnimationFrame(tick);}
  window.workloadReplay={seek(t){setPlaying(false);time=Math.max(0,Math.min(180,t));render();},state(){return {time,playing};}};
  setPlaying(playing);render();requestAnimationFrame(tick);
})();
