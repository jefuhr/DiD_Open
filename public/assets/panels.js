export function bindSheet(setOpen, { menu, trigger, close, scrim, canClose = () => true }) {
  trigger?.addEventListener("click", () => setOpen(trigger.getAttribute("aria-expanded") !== "true"));
  close.addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));
  return { menu, setOpen, canClose };
}

export function setSheetOpen({ menu, trigger, close, panel, focusTarget }, open) {
  panel(menu, open);
  trigger.setAttribute("aria-expanded", String(open));
  if (open) (focusTarget?.() || close)?.focus();
  else trigger.focus();
}
