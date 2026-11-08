(() => {
  'use strict';
  const data = {
    cc: { label: 'Claude Code', model: 'GLM-5.2', loads: [90,108,126], finding: 'On Claude Code, Evolving Infra lowers both mean request latency and P95 time to first token at all three tested loads.' },
    putnam: { label: 'Putnam', model: 'GLM-5.2', loads: [224,256,288], finding: 'On Putnam, mean request latency improves at every tested load. P95 TTFT is higher at 224 and 288 agents: the planner favors decode throughput on this decode-heavy workload.' },
    osworld: { label: 'OSWorld', model: 'Kimi K2.6', loads: [128,144,160], finding: 'On OSWorld, Evolving Infra lowers both mean request latency and P95 time to first token at all three tested loads.' }
  };
  const root = document.getElementById('evidence');
  if (!root) return;
  const buttons = Array.from(root.querySelectorAll('[data-workload]'));
  buttons.forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.workload;
    const item = data[key];
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    document.getElementById('workload-model').textContent = `${item.model} · ${item.loads[0]}, ${item.loads[1]}, and ${item.loads[2]} concurrent agents`;
    for (const metric of ['e2e','ttft']) {
      const img = document.getElementById(`${metric}-plot`);
      img.src = `fig/eval-single-${key}-${metric}.svg`;
      img.alt = `${item.label}: ${metric === 'e2e' ? 'mean end-to-end request latency' : 'P95 time to first token'} at ${item.loads.join(', ')} concurrent agents`;
    }
    document.querySelector('.concurrency-label').textContent = `${item.loads.join(' / ')} concurrent agents, left to right`;
    document.getElementById('workload-finding').textContent = item.finding;
  }));
})();
