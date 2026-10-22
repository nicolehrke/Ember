// Aufklapp-Panel unter einem Button: schließt bei Klick daneben und mit Esc.
// Gibt { setOpen, destroy } zurück; das Panel meldet 'popover-close' beim Schließen.

export function popover(toggle, panel, root) {
  const controller = new AbortController();
  const { signal } = controller;

  const setOpen = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (!open) panel.dispatchEvent(new Event('popover-close'));
  };

  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => setOpen(panel.hidden), { signal });
  document.addEventListener('click', event => {
    if (!panel.hidden && !event.composedPath().includes(root)) setOpen(false);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  }, { signal });

  return { setOpen, destroy: () => controller.abort() };
}
