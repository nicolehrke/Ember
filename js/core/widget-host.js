// Baut für jedes Widget eine Kachel, ruft render()/refresh() auf
// und fängt Fehler ab, damit ein kaputtes Widget nie die Seite bricht.
//
// Widget-Schnittstelle (siehe README):
//   id, title, icon?, size? ('normal' | 'wide'), refreshInterval? (ms)
//   render(container, ctx)   – baut das Widget auf (einmalig bzw. nach Fehler)
//   refresh?(container, ctx) – aktualisiert Daten; fehlt es, wird render() erneut aufgerufen
import { scope } from './storage.js';
import { h } from './dom.js';

export function mountWidget(grid, widget) {
  const actions = h('div', { class: 'card-actions' });
  const body = h('div', { class: 'card-body' });
  const status = h('p', { class: 'card-status', hidden: true });
  const card = h('article', { class: `card card--${widget.size ?? 'normal'}`, 'data-widget': widget.id },
    h('header', { class: 'card-header' },
      h('h2', { class: 'card-title' }, [widget.icon, widget.title].filter(Boolean).join(' ')),
      actions),
    body,
    status);
  grid.append(card);

  let failed = false;
  let running = false;
  let lastRun = 0;

  const ctx = {
    card,
    store: scope(widget.id),
    // Kleiner Button oben rechts in der Kachel.
    addAction(label, onClick, title = label) {
      const button = h('button', { class: 'chip', type: 'button', title, 'aria-label': title, onclick: onClick }, label);
      actions.append(button);
      return button;
    },
    every(ms, fn) {
      return setInterval(fn, ms);
    },
    setStatus(text) {
      status.textContent = text ?? '';
      status.hidden = !text;
    },
    refresh: () => run(failed || !widget.refresh ? 'render' : 'refresh'),
  };

  async function run(kind) {
    if (running) return;
    running = true;
    card.classList.add('is-loading');
    try {
      if (kind === 'render') {
        actions.replaceChildren();
        body.replaceChildren();
        ctx.setStatus('');
        await widget.render(body, ctx);
      } else {
        await widget.refresh(body, ctx);
      }
      failed = false;
    } catch (err) {
      failed = true;
      console.error(`[widget:${widget.id}]`, err);
      showError(body, err, ctx.refresh);
    } finally {
      lastRun = Date.now();
      running = false;
      card.classList.remove('is-loading');
    }
  }

  run('render');

  if (widget.refreshInterval) {
    setInterval(ctx.refresh, widget.refreshInterval);
    window.addEventListener('online', ctx.refresh);
    // Nach Ruhezustand (z. B. iPad zugeklappt) sofort aktualisieren, wenn fällig.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastRun > widget.refreshInterval) ctx.refresh();
    });
  }
}

function showError(body, err, retry) {
  const offline = !navigator.onLine;
  body.replaceChildren(
    h('div', { class: 'widget-error', role: 'alert' },
      h('p', { class: 'widget-error-title' }, offline ? '📡 Offline' : '⚠️ Das hat nicht geklappt'),
      h('p', { class: 'muted' }, err?.message ?? String(err)),
      h('button', { class: 'chip', type: 'button', onclick: retry }, '↻ Erneut versuchen')));
}
