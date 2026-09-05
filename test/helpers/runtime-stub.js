// Schedule/cartography unit tests use minimal nodes. The real shared runtime is exercised
// against a standards DOM in mobile-runtime.test.js, including identity and animation races.
export function runtimeStub(context) {
  const storage = context.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  storage.json = (key, fallback = null) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const frames = [];
  context.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  const flush = () => { while (frames.length) frames.shift()(); };
  context.MobileRuntime = {
    storage, request: (...args) => context.fetch(...args),
    html: (node, value) => { node.innerHTML = value; },
    reconcile: (parent, nodes) => { parent.textContent = ''; parent.append(...nodes); },
    reveal: (node, open) => { node.hidden = !open; },
    panel: (node, open) => { node.hidden = !open; }, contentTransition() {},
    poll: (task, delay) => { context.setInterval(task, delay); return task(); }
  };
  return flush;
}
