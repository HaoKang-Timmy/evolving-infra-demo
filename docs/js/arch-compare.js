(() => {
  'use strict';
  const root=document.querySelector('.arch-compare');
  if(!root)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const left=root.querySelector('.is-existing .is-changing'), right=root.querySelector('.is-ours .is-changing');
  const cache=root.querySelector('[data-arch-cache]'), play=root.querySelector('[data-arch-play]');
  let time=reduced.matches?8:0,playing=!reduced.matches,visible=false,last=null,phase=-1;
  function render(){
    const next=time<2?0:time<2.8?1:time<6.8?2:3;
    if(next===phase)return;
    phase=next;root.dataset.phase=String(phase);
    left.classList.toggle('is-offline',phase===1||phase===2);
    left.classList.toggle('is-d',phase===3);
    right.classList.toggle('is-d',phase>=2);
    left.querySelector('b').textContent=phase===0?'P':phase===3?'D':'↻';
    right.querySelector('b').textContent=phase<2?'P':'D';
    cache.classList.toggle('is-lost',phase>0);
    root.querySelector('[data-arch-existing]').textContent=['Serving prefill · KV cached','Restarting · local KV lost','Restarting · node unavailable','Serving decode · local cache empty'][phase];
    root.querySelector('[data-arch-ours]').textContent=['Serving prefill · KV cached','Switching phase · KV retained','Serving decode · KV retained','Serving decode · KV retained'][phase];
    root.querySelector('[data-arch-event]').textContent=phase===0?'Demand shifts: reallocate one prefill node to decode.':'Same phase change. Different cost.';
  }
  function setPlaying(value){playing=value;last=null;play.textContent=value?'Pause':'Play';play.setAttribute('aria-pressed',String(value));}
  play.addEventListener('click',()=>setPlaying(!playing));
  root.querySelector('[data-arch-replay]').addEventListener('click',()=>{time=0;render();setPlaying(true);});
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=null;},{threshold:.15}).observe(root);
  document.addEventListener('visibilitychange',()=>{last=null;});
  function tick(now){if(playing&&visible&&!document.hidden){if(last!==null){time+=(now-last)/1000;if(time>=10)time%=10;}last=now;render();}requestAnimationFrame(tick);}
  window.archDemo={seek(t){setPlaying(false);time=Math.max(0,Math.min(9.99,t));render();},state(){return {time,phase,playing};}};
  setPlaying(playing);render();requestAnimationFrame(tick);
})();
