/* Shared board/map primitives. No framework and no persistent DOM snapshots. */
(() => {
  // iOS standalone windows can disagree with fixed inset/dvh after resuming.
  // Follow the visible viewport, but never resize the page around pinch zoom.
  function syncViewport() {
    if (document.documentElement.dataset.surface !== "app") return;
    const viewport = globalThis.visualViewport;
    if (viewport && viewport.scale !== 1) return;
    const height = viewport?.height || globalThis.innerHeight;
    if (!height) return;
    const style = document.documentElement.style;
    style.setProperty("--app-viewport-height", `${height}px`);
    style.setProperty("--app-viewport-top", `${viewport?.offsetTop || 0}px`);
  }
  globalThis.addEventListener?.("resize", syncViewport);
  globalThis.addEventListener?.("pageshow", syncViewport);
  globalThis.visualViewport?.addEventListener("resize", syncViewport);
  globalThis.visualViewport?.addEventListener("scroll", syncViewport);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncViewport(); });
  syncViewport();
  const memory = new Map();
  const storage = {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    removeItem(key) {
      memory.set(key, null);
      try {
        localStorage.removeItem(key);
      } catch {}
    },
    json(key, fallback = null) {
      try {
        return JSON.parse(this.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
  };
  const pending = new Map();
  function request(url, options = {}) {
    if (pending.has(url)) return pending.get(url);
    const job = boundedRequest(url, options).finally(() => pending.delete(url));
    pending.set(url, job);
    return job;
  }
  async function boundedRequest(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      // Consume the body under the same deadline as the headers.
      const body = await response.text();
      const saved = response.headers?.get("X-Ferry-Saved") === "1";
      return {
        ok: response.ok,
        status: response.status,
        saved,
        json: async () => {
          const value = JSON.parse(body);
          return saved && value && !Array.isArray(value)
            ? { ...value, stale: true }
            : value;
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
  function reconcile(parent, incoming) {
    const focused = document.activeElement;
    const scroll = parent.scrollTop;
    reconcileNodes(parent, incoming);
    if (focused?.isConnected && document.activeElement !== focused)
      focused.focus({ preventScroll: true });
    if (parent.scrollTop !== scroll) parent.scrollTop = scroll;
  }
  function reconcileNodes(parent, incoming) {
    const old = [...parent.childNodes];
    const key = (node) =>
      node.nodeType === 1 ? node.getAttribute("data-key") : null;
    const keyed = new Map(old.filter(key).map((node) => [key(node), node]));
    const retained = new Set();
    let cursor = parent.firstChild;
    for (const next of [...incoming]) {
      const id = key(next);
      let node = id ? keyed.get(id) : cursor;
      if (
        !node ||
        retained.has(node) ||
        key(node) !== id ||
        node.nodeType !== next.nodeType ||
        node.nodeName !== next.nodeName
      )
        node = next;
      if (node !== next) {
        if (node.nodeType === 3) {
          if (node.data !== next.data) node.data = next.data;
        } else if (node.nodeType === 1) {
          for (const attr of [...node.attributes])
            if (!next.hasAttribute(attr.name)) node.removeAttribute(attr.name);
          for (const attr of [...next.attributes])
            if (node.getAttribute(attr.name) !== attr.value)
              node.setAttribute(attr.name, attr.value);
          reconcileNodes(node, next.childNodes);
        }
      }
      if (node !== cursor) parent.insertBefore(node, cursor);
      retained.add(node);
      cursor = node.nextSibling;
    }
    for (const node of old) if (!retained.has(node)) node.remove();
  }
  function html(parent, markup) {
    if (parent._markup === markup) return;
    const template = document.createElement("template");
    template.innerHTML = markup;
    reconcile(parent, template.content.childNodes);
    parent._markup = markup;
  }
  function poll(task, delay) {
    let busy = false;
    const run = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        await task();
      } catch {
      } finally {
        busy = false;
      }
    };
    let timer;
    const restart = () => {
      clearInterval(timer);
      if (!document.hidden) {
        void run();
        timer = setInterval(run, delay);
      }
    };
    document.addEventListener("visibilitychange", restart);
    restart();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", restart);
    };
  }
  const panels = new Map();
  const modalStack = [];
  function refreshInert() {
    const active = modalStack.at(-1);
    const screen = document.querySelector("#screen");
    if (!screen) return;
    for (const child of screen.children)
      child.inert = Boolean(
        active && child !== active && !child.contains(active),
      );
  }
  function panel(menu, open, modal = true) {
    let state = panels.get(menu);
    if (!state) {
      state = {};
      panels.set(menu, state);
    }
    const generation = (state.generation = (state.generation || 0) + 1);
    const wasOpen = state.open;
    const moving = state.animation;
    state.animation = null;
    moving?.cancel();
    state.open = open;
    const index = modalStack.indexOf(menu);
    if (index >= 0) modalStack.splice(index, 1);
    if (open && modal) modalStack.push(menu);
    refreshInert();
    if (open && !wasOpen) state.opener = document.activeElement;
    const surface =
      menu.querySelector('[role="dialog"], .landing-menu-panel') || menu;
    if (modal) {
      surface.setAttribute("role", "dialog");
      surface.setAttribute("aria-modal", "true");
    } else {
      surface.removeAttribute("aria-modal");
      if (surface.classList.contains("landing-menu-panel"))
        surface.removeAttribute("role");
    }
    menu.inert = !open;
    if (open) menu.hidden = false;
    if (open === wasOpen || (!open && menu.hidden)) return;
    const finish = () => {
      if (state.generation !== generation) return;
      menu.hidden = !open;
      state.animation = null;
    };
    if (
      !modal ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !surface.animate
    )
      finish();
    else {
      const from = { opacity: 0, transform: "translateY(16px)" };
      const to = { opacity: 1, transform: "translateY(0)" };
      const animation = surface.animate(open ? [from, to] : [to, from], {
        duration: 240,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
      state.animation = animation;
      animation.onfinish = finish;
    }
    if (!open && state.opener?.isConnected)
      state.opener.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (event) => {
    const active = modalStack.at(-1);
    if (!active || event.key !== "Tab") return;
    const focusable = [
      ...active.querySelectorAll(
        'button:not([disabled]), a[href], input, [tabindex="0"]',
      ),
    ].filter((node) => !node.hidden && !node.closest("[hidden]"));
    if (!focusable.length) return;
    const first = focusable[0],
      last = focusable.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !active.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !active.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  });
  function contentTransition(node) {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.getAnimations?.().forEach((animation) => animation.cancel());
      node.animate?.([{ opacity: 0.65 }, { opacity: 1 }], { duration: 180 });
    }
  }
  const cards = new WeakMap();
  function reveal(node, open) {
    let state = cards.get(node);
    if (!state) {
      state = { open: !node.hidden };
      cards.set(node, state);
    }
    if (state.open === open) return;
    state.animation?.cancel();
    state.open = open;
    node.inert = !open;
    if (open) node.hidden = false;
    if (
      !node.animate ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      node.hidden = !open;
      return;
    }
    const from = { opacity: 0, transform: "translateY(12px)" },
      to = { opacity: 1, transform: "translateY(0)" };
    const animation = node.animate(open ? [from, to] : [to, from], {
      duration: 180,
      easing: "ease-out",
    });
    state.animation = animation;
    animation.onfinish = () => {
      if (state.animation === animation) node.hidden = !open;
    };
  }
  globalThis.MobileRuntime = {
    syncViewport,
    storage,
    request,
    reconcile,
    html,
    poll,
    panel,
    contentTransition,
    reveal,
  };
})();
