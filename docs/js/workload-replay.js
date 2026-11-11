(() => {
  'use strict';
  const root=document.getElementById('shift-demo');if(!root)return;
  const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  // Digitized from the paper's shifting-workload figure; also used by compute-allocation.html.
  // Each row is [minutes after warmup, Evolving Infra prefill node count].
  const splits=[[0,3],[80.7,4],[85.9,5],[91,6],[139.3,8]];
  const workloads=[[288,0],[144,72],[0,144]],tabs=Array.from(root.querySelectorAll('[data-shift-phase]'));
  let time=0,playing=!reduced.matches,visible=false,last=null,hold=0,previous='';
  function render(){
    const phase=Math.min(2,Math.floor(time/60)),counts=workloads[phase];let p=3;
    for(const row of splits)if(time>=row[0])p=row[1];
    $('shift-time').textContent=Math.floor(time)+' min';$('shift-seek').value=String(time);
    const key=phase+':'+p;if(key===previous)return;previous=key;
    tabs.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===phase)));
    $('shift-putnam').textContent=String(counts[0]);$('shift-osworld').textContent=String(counts[1]);
    $('shift-putnam').parentElement.classList.toggle('is-empty',!counts[0]);$('shift-osworld').parentElement.classList.toggle('is-empty',!counts[1]);
    $('shift-split').textContent=p+'P · '+(9-p)+'D';$('shift-p').style.width=(p/9*100)+'%';
    const text=phase===0?'Decode-heavy math agents: six of the nine nodes serve decode.':phase===1?(p===3?'Computer-use agents join. The split initially remains at 3P · 6D.':p===6?'The mixed workload now uses six prefill nodes and three decode nodes.':'The planner moves more nodes to prefill as the workload changes.'):(p<8?'The workload becomes entirely computer-use agents. The allocation continues to adapt.':'Prefill-heavy computer-use agents: eight nodes now serve prefill.');
    $('shift-caption').textContent=text;
  }
  function setPlaying(value){playing=value;last=null;$('shift-play').textContent=value?'Pause':'Play';$('shift-play').setAttribute('aria-pressed',String(value));}
  $('shift-play').addEventListener('click',()=>{if(time>=180){time=0;hold=0;}setPlaying(!playing);render();});
  $('shift-seek').addEventListener('input',e=>{time=Number(e.target.value);hold=0;setPlaying(false);render();});
  tabs.forEach((b,i)=>b.addEventListener('click',()=>{time=i*60;hold=0;last=null;render();}));
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=null;},{threshold:.15}).observe(root);
  document.addEventListener('visibilitychange',()=>{last=null;});
  function tick(now){if(playing&&visible&&!document.hidden){if(last!==null){const dt=(now-last)/1000;if(time>=180){hold+=dt;if(hold>2){time=0;hold=0;}}else time=Math.min(180,time+dt*10);}last=now;render();}requestAnimationFrame(tick);}
  window.workloadReplay={seek(t){setPlaying(false);time=Math.max(0,Math.min(180,t));render();},state(){return {time,playing};}};
  setPlaying(playing);render();requestAnimationFrame(tick);
})();
