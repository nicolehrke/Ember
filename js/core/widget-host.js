// Hängt Widgets in ihren Bereich ein, ruft render()/refresh() auf
// und fängt Fehler ab, damit ein kaputtes Widget nie die Seite bricht.
//
// Widget-Schnittstelle (siehe README):
//   id, title, icon?, refreshInterval? (ms)
//   placement?   – 'grid' (Kachel, Standard), 'hero' (großer Kopfbereich links)
//                  oder 'header' (kompakt oben rechts, ohne Kachel)
//   size?        – nur für 'grid': 'normal' | 'wide'
//   dock?        – nur für 'grid': { icon, label } – Button in der Dock-Leiste öffnet/schließt
//                  die Kachel; geschlossene Kacheln laufen unsichtbar weiter (z. B. Timer)
//   defaultOpen? – mit dock: ohne gespeicherten Zustand geöffnet? Der Zustand wird pro
//                  Gerät in 'local/open' gespeichert (nicht synchronisiert).
//   render(container, ctx)   – baut das Widget auf (einmalig bzw. nach Fehler)
//   refresh?(container, ctx) – aktualisiert Daten; fehlt es, wird render() erneut aufgerufen
import { scope, load, save } from './storage.js';
import { h } from './dom.js';

export function mountWidget(slots, widget) {
  const placement = widget.placement ?? 'grid';
  const compact = placement === 'hero' || placement === 'header';
  const body = h('div', { class: 'widget-body' });
  let root;
  let actions = null;
  let status = null;
  let badge = null;
  let dock = null; // { button, badge } bei Widgets mit dock

  if (compact) {
    root = h('div', { class: `slot-widget slot-widget--${placement}`, 'data-widget': widget.id }, body);
  } else {
    actions = h('div', { class: 'card-actions' });
    status = h('p', { class: 'card-status', hidden: true });
    // Dock-Widgets zeigen ihren Status am Dock-Button, nicht zusätzlich im Kachelkopf.
    badge = widget.dock ? null : h('span', { class: 'card-badge', hidden: true });
    const close = widget.dock
      ? h('button', { class: 'icon-btn icon-btn--sm card-close', type: 'button', 'aria-label': `${widget.title} schließen`, title: 'Schließen' }, '×')
      : null;
    root = h('article', { class: `card card--${widget.size ?? 'normal'}`, id: `card-${widget.id}`, 'data-widget': widget.id },
      h('header', { class: 'card-header' },
        h('h2', { class: 'card-title' }, [widget.icon, widget.title].filter(Boolean).join(' ')),
        badge,
        actions,
        close),
      body,
      status);
    if (widget.dock) dock = mountDockButton(slots, widget, root, close);
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
    // Kleiner Status neben dem Kacheltitel (z. B. laufender Timer); leer = ausgeblendet.
    // Bei Dock-Widgets erscheint er stattdessen am Dock-Button – auch bei geschlossener Kachel;
    // highlight hebt den Button farbig hervor, title ist sein Tooltip.
    setBadge(text, { highlight = false, title = null } = {}) {
      for (const el of [badge, dock?.badge].filter(Boolean)) {
        if (el.textContent !== (text ?? '')) el.textContent = text ?? '';
        el.hidden = !text;
      }
      if (dock) {
        dock.button.classList.toggle('is-highlight', highlight);
        dock.button.title = title ?? widget.dock.label;
        dock.button.setAttribute('aria-label', text ? `${widget.dock.label}: ${text}` : widget.dock.label);
      }
    },
    // Fußzeile der Kachel; bei kompakten Widgets als Tooltip.
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

// ---------- Dock ----------
// Welche Dock-Kacheln offen sind, gilt pro Gerät (Mac und iPad dürfen sich unterscheiden).
const OPEN_KEY = 'local/open';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let openStatePromise = null;
const openState = () => (openStatePromise ??= load(OPEN_KEY, {}));

// Leerer Zustand im Hauptbereich, wenn keine Kachel sichtbar ist.
function updateEmpty(slots) {
  if (slots.empty) slots.empty.hidden = Boolean(slots.grid.querySelector('.card:not([hidden])'));
}

// Button in der Dock-Leiste; gibt { button, badge } zurück.
function mountDockButton(slots, widget, card, close) {
  const dockBadge = h('span', { class: 'dock-badge', hidden: true });
  const button = h('button', {
    class: 'dock-btn', type: 'button', 'aria-pressed': 'false', 'aria-controls': card.id,
    'aria-label': widget.dock.label, title: widget.dock.label,
  },
  h('span', { class: 'dock-icon', 'aria-hidden': 'true' }, widget.dock.icon),
  h('span', { class: 'dock-label' }, widget.dock.label),
  dockBadge);
  slots.dock.append(button);

  const setOpen = (open, { animate = true, persist = true } = {}) => {
    button.setAttribute('aria-pressed', String(open));
    card.classList.remove('is-entering', 'is-leaving');
    const motion = animate && !reducedMotion.matches;

    if (open) {
      card.hidden = false;
      if (motion) {
        card.classList.add('is-entering');
        card.addEventListener('animationend', () => card.classList.remove('is-entering'), { once: true });
      }
      if (animate) card.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' });
    } else if (motion && !card.hidden) {
      card.classList.add('is-leaving');
      // Nach der Animation verstecken – spätestens nach 250 ms, falls das Ende-Signal
      // ausbleibt (z. B. gedrosselter Hintergrund-Tab).
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        card.classList.remove('is-leaving');
        // Wurde währenddessen wieder geöffnet, nicht verstecken.
        if (button.getAttribute('aria-pressed') === 'false') card.hidden = true;
        updateEmpty(slots);
      };
      card.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 250);
    } else {
      card.hidden = true;
    }
    updateEmpty(slots);

    if (persist) {
      openState().then(state => {
        state[widget.id] = open;
        save(OPEN_KEY, state);
      });
    }
  };

  // Startzustand: gespeichert, sonst defaultOpen
  card.hidden = !widget.defaultOpen;
  openState().then(state => {
    const open = typeof state[widget.id] === 'boolean' ? state[widget.id] : Boolean(widget.defaultOpen);
    setOpen(open, { animate: false, persist: false });
  });

  button.addEventListener('click', () => setOpen(button.getAttribute('aria-pressed') !== 'true'));
  close.addEventListener('click', () => {
    setOpen(false);
    button.focus();
  });
  return { button, badge: dockBadge };
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
