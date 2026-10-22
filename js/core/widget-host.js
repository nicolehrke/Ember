// Hängt Widgets in ihren Bereich ein, ruft render()/refresh() auf
// und fängt Fehler ab, damit ein kaputtes Widget nie die Seite bricht.
//
// Widget-Schnittstelle (siehe README):
//   id, title, icon?, refreshInterval? (ms)
//   placement? – 'grid' (Kachel, Standard), 'hero' (großer Kopfbereich links),
//                'header' (kompakt oben rechts, ohne Kachel) oder
//                'drawer' (Kachel in einer Seitenleiste, geöffnet über einen Button oben)
//   size?      – nur für 'grid': 'normal' | 'wide'
//   render(container, ctx)   – baut das Widget auf (einmalig bzw. nach Fehler)
//   refresh?(container, ctx) – aktualisiert Daten; fehlt es, wird render() erneut aufgerufen
import { scope } from './storage.js';
import { h } from './dom.js';

export function mountWidget(slots, widget) {
  const placement = widget.placement ?? 'grid';
  const compact = placement === 'hero' || placement === 'header';
  const body = h('div', { class: 'widget-body' });
  let root;
  let actions = null;
  let status = null;
  let badge = null;
  let toggleBadge = null;

  if (compact) {
    root = h('div', { class: `slot-widget slot-widget--${placement}`, 'data-widget': widget.id }, body);
  } else {
    actions = h('div', { class: 'card-actions' });
    status = h('p', { class: 'card-status', hidden: true });
    badge = h('span', { class: 'card-badge', hidden: true });
    const close = placement === 'drawer'
      ? h('button', { class: 'icon-btn icon-btn--sm drawer-close', type: 'button', 'aria-label': `${widget.title} schließen`, title: 'Schließen (Esc)' }, '×')
      : null;
    root = h('article', { class: `card card--${widget.size ?? 'normal'}`, 'data-widget': widget.id },
      h('header', { class: 'card-header' },
        h('h2', { class: 'card-title' }, [widget.icon, widget.title].filter(Boolean).join(' ')),
        badge,
        actions,
        close),
      body,
      status);
    if (placement === 'drawer') toggleBadge = mountDrawer(slots, widget, root, close);
  }
  if (placement !== 'drawer') (slots[placement] ?? slots.grid).append(root);

  let failed = false;
  let running = false;
  let pending = null;
  let lastRun = 0;
  // Intervalle und Abonnements, die beim Neuaufbau beendet werden.
  let cleanups = [];

  const store = scope(widget.id);
  const ctx = {
    root,
    // Synchronisierte Daten des Widgets.
    store: {
      ...store,
      subscribe(key, fn) {
        const off = store.subscribe(key, fn);
        cleanups.push(off);
        return off;
      },
    },
    // Nur auf diesem Gerät (Caches u. Ä.), wird nie synchronisiert.
    cache: scope(`local/cache/${widget.id}`),
    // Kleiner Button oben rechts in der Kachel (nur bei placement 'grid').
    addAction(label, onClick, title = label) {
      if (!actions) throw new Error(`addAction() gibt es nur für Kachel-Widgets (${widget.id}).`);
      const button = h('button', { class: 'chip', type: 'button', title, 'aria-label': title, onclick: onClick }, label);
      actions.append(button);
      return button;
    },
    // Aufräumen beim Neuaufbau, z. B. für Abos auf Schlüssel anderer Widgets.
    onCleanup(fn) {
      cleanups.push(fn);
    },
    every(ms, fn) {
      const id = setInterval(fn, ms);
      cleanups.push(() => clearInterval(id));
      return id;
    },
    // Fußzeile der Kachel; bei kompakten Widgets als Tooltip.
    // Kleiner Status neben dem Kacheltitel (z. B. laufender Timer); leer = ausgeblendet.
    setBadge(text) {
      if (!badge) return;
      for (const el of [badge, toggleBadge].filter(Boolean)) {
        if (el.textContent !== (text ?? '')) el.textContent = text ?? '';
        el.hidden = !text;
      }
    },
    setStatus(text) {
      if (status) {
        status.textContent = text ?? '';
        status.hidden = !text;
      } else {
        root.title = text ?? '';
      }
    },
    refresh: () => run(failed || !widget.refresh ? 'render' : 'refresh'),
  };

  async function run(kind) {
    // Läuft schon etwas, wird die Anfrage danach nachgeholt (render hat Vorrang).
    if (running) {
      pending = pending === 'render' ? 'render' : kind;
      return;
    }
    running = true;
    root.classList.add('is-loading');
    try {
      if (kind === 'render') {
        cleanups.forEach(fn => fn());
        cleanups = [];
        actions?.replaceChildren();
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
      showError(body, err, ctx.refresh, compact ? widget.title : null);
    } finally {
      lastRun = Date.now();
      running = false;
      root.classList.remove('is-loading');
      if (pending) {
        const next = failed ? 'render' : pending;
        pending = null;
        run(next);
      }
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

// Seitenleiste von rechts plus Button in der Kopfleiste; gibt das Status-Feld des Buttons zurück.
function mountDrawer(slots, widget, card, close) {
  const toggleBadge = h('span', { class: 'drawer-toggle-badge', hidden: true });
  const toggle = h('button', { class: 'drawer-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': `drawer-${widget.id}` },
    h('span', {}, widget.title), toggleBadge);
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const panel = h('div', { class: 'drawer-panel', role: 'dialog', 'aria-label': widget.title, tabindex: -1 }, card);
  const drawer = h('aside', { class: 'drawer', id: `drawer-${widget.id}`, inert: true }, backdrop, panel);
  slots.header.append(toggle);
  (slots.drawer ?? document.body).append(drawer);

  const setOpen = open => {
    drawer.classList.toggle('is-open', open);
    drawer.inert = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('drawer-open', open);
    if (open) panel.focus({ preventScroll: true });
    else if (drawer.contains(document.activeElement)) toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
  close.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false);
  });
  return toggleBadge;
}

function showError(body, err, retry, compactTitle) {
  const offline = !navigator.onLine;
  const message = err?.message ?? String(err);

  if (compactTitle) {
    body.replaceChildren(
      h('button', { class: 'chip widget-error-chip', type: 'button', title: `${message} – zum erneuten Versuch klicken`, onclick: retry },
        `${offline ? 'Offline' : '⚠︎'} · ${compactTitle}`));
    return;
  }

  body.replaceChildren(
    h('div', { class: 'widget-error', role: 'alert' },
      h('p', { class: 'widget-error-title' }, offline ? 'Offline' : 'Das hat nicht geklappt'),
      h('p', { class: 'muted' }, message),
      h('button', { class: 'chip', type: 'button', onclick: retry }, '↻ Erneut versuchen')));
}
