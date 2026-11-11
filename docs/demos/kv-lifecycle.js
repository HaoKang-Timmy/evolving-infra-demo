(() => {
  'use strict';
  const $=id=>document.getElementById(id), reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const scenes=[
    {name:'compaction',docs:['Conversation history','Compacted context'],decision:'When space is needed, evict replaced history before reusable KV.',stages:[
      ['A conversation grows.','In use','Next request','Keep the context in use.','Retain','Retain','The agent still uses its conversation history.','An active branch may reuse this KV.'],
      ['The next request is compacted.','Replaced','In use','The old history is no longer needed.','Evict first','Retain','A shorter context replaces the earlier history.','No active branch in this example needs the replaced history.'],
      ['Continue from the compacted context.','Replaced','In use','Prioritize the replaced history.','Evict first','Retain','Subsequent requests continue from the compacted context.','Keep reusable KV; reclaim the old history when space is needed.']
    ]},
    {name:'subagent',docs:['Parent context','Subagent context'],decision:'When a subagent finishes, prioritize its unreferenced KV for eviction.',stages:[
      ['A subagent is working.','Waiting for subagent','Working','Both branches are active.','Retain','Retain','The parent waits while the subagent runs.','Both contexts may still be reused.'],
      ['The subagent returns its result.','Resuming','Finished','Keep the parent’s reusable KV.','Retain','Evict first','The parent continues; the subagent has finished.','In this example, no active branch needs the subagent’s context.'],
      ['The parent continues.','In use','Finished','Prioritize the finished branch.','Retain','Evict first','The next parent request reuses its existing context.','The finished subagent’s unreferenced KV is evicted first when space is needed.']
    ]},
    {name:'tool',docs:['Agent context','Tool call'],decision:'A tool wait does not make the branch inactive. Keep its reusable KV.',stages:[
      ['The agent calls a tool.','Active branch','Running','Keep this branch’s KV.','Retain','','The model pauses while the tool runs.','This context is still needed for the next request.'],
      ['The tool is still running.','Active branch','Running','Waiting does not mean unused.','Retain','','No tokens are being decoded during this tool wait.','Prioritize unreferenced KV for eviction before this reusable context.'],
      ['The tool returns.','Resuming','Result ready','Reuse KV for the next request.','Reuse','','The next request includes the tool result.','The existing context can be reused instead of recomputed.']
    ]}
  ];
  let time=reduced.matches?5:0,playing=!reduced.matches,visible=false,last=null,lastFrame='';
  const tabs=Array.from(document.querySelectorAll('[data-scene]'));
  function render(){
    const index=Math.min(2,Math.floor(time/8)),local=time-index*8,stage=local<2.2?0:local<4.8?1:2,key=index+':'+stage;
    if(key===lastFrame)return;lastFrame=key;
    const scene=scenes[index],row=scene.stages[stage];
    $('scene').dataset.scene=scene.name;$('scene').dataset.stage=String(stage);
    tabs.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
    ['doc-one','cache-one'].forEach(id=>$(id).textContent=scene.docs[0]);
    ['doc-two','cache-two'].forEach(id=>$(id).textContent=scene.docs[1]);
    ['context-title','doc-one-state','doc-two-state','cache-title','cache-one-state','cache-two-state','context-caption','cache-caption'].forEach((id,i)=>$(id).textContent=row[i]);
    $('decision').textContent=scene.decision;
    ['entry-one','entry-two'].forEach((id,i)=>{$(id).classList.toggle('evict',row[4+i]==='Evict first');$(id).classList.toggle('keep',row[4+i]!=='Evict first');});
  }
  function setPlaying(v){playing=v;last=null;$('play').textContent=v?'Pause':'Play';$('play').setAttribute('aria-pressed',String(v));}
  tabs.forEach((b,i)=>b.addEventListener('click',()=>{time=i*8;last=null;render();}));
  $('play').addEventListener('click',()=>setPlaying(!playing));
  new IntersectionObserver(es=>{visible=es[0].isIntersecting;last=null;},{threshold:.15}).observe($('demo'));
  document.addEventListener('visibilitychange',()=>{last=null;});
  function tick(now){if(playing&&visible&&!document.hidden){if(last!==null)time=(time+(now-last)/1000)%24;last=now;render();}requestAnimationFrame(tick);}
  function height(){if(parent!==window)parent.postMessage({type:'demo-height',height:Math.ceil(document.body.getBoundingClientRect().height)},location.origin);}
  new ResizeObserver(height).observe(document.body);
  window.kvDemo={seek(scene,stage){setPlaying(false);time=Math.max(0,Math.min(2,scene))*8+[0,3,6][Math.max(0,Math.min(2,stage))];render();},state(){return {time,playing};}};
  setPlaying(playing);render();height();requestAnimationFrame(tick);
})();
