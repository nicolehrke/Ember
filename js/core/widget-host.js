// Hängt Widgets in ihren Bereich ein, ruft render()/refresh() auf
// und fängt Fehler ab, damit ein kaputtes Widget nie die Seite bricht.
//
// Widget-Schnittstelle (siehe README):
//   id, title, icon?, refreshInterval? (ms)
//   placement? – 'grid' (Kachel, Standard), 'hero' (großer Kopfbereich links)
//                oder 'header' (kompakt oben rechts, ohne Kachel)
//   size?      – nur für 'grid': 'normal' | 'wide'
//   render(container, ctx)   – baut das Widget auf (einmalig bzw. nach Fehler)
//   refresh?(container, ctx) – aktualisiert Daten; fehlt es, wird render() erneut aufgerufen
import { scope } from './storage.js';
import { h } from './dom.js';

export function mountWidget(slots, widget) {
  const placement = widget.placement ?? 'grid';
  const compact = placement !== 'grid';
  const body = h('div', { class: 'widget-body' });
  let root;
  let actions = null;
  let status = null;
  let badge = null;

  if (compact) {
    root = h('div', { class: `slot-widget slot-widget--${placement}`, 'data-widget': widget.id }, body);
  } else {
    actions = h('div', { class: 'card-actions' });
    status = h('p', { class: 'card-status', hidden: true });
    badge = h('span', { class: 'card-badge', hidden: true });
    root = h('article', { class: `card card--${widget.size ?? 'normal'}`, 'data-widget': widget.id },
      h('header', { class: 'card-header' },
        h('h2', { class: 'card-title' }, [widget.icon, widget.title].filter(Boolean).join(' ')),
        badge,
        actions),
      body,
      status);
  }
  (slots[placement] ?? slots.grid).append(root);

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
      if (badge.textContent !== (text ?? '')) badge.textContent = text ?? '';
      badge.hidden = !text;
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
