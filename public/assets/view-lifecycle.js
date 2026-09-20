// Poll registrations survive tab switches; their timers do not. Keep the busy flag across
// activations so a slow request cannot be duplicated by switching away and back.
export function createViewLifecycle() {
  const jobs = [];
  let active = false;
  let disposed = false;
  function poll(task, delay) {
    let busy = false;
    const job = { stop: null, start() {
      job.stop = MobileRuntime.poll(async () => {
        if (!active || busy || disposed) return;
        busy = true;
        try { await task(); } finally { busy = false; }
      }, delay);
    } };
    jobs.push(job);
    if (active) job.start();
  }
  function deactivate() {
    active = false;
    for (const job of jobs) { job.stop?.(); job.stop = null; }
  }
  return {
    poll,
    get active() { return active; },
    activate() {
      if (active || disposed) return;
      active = true;
      for (const job of jobs) job.start();
    },
    deactivate,
    dispose() { deactivate(); disposed = true; jobs.length = 0; }
  };
}
