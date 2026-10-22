// Reihenfolge der Kacheln: jederzeit am Kachelkopf verschiebbar, ohne Anordnen-Modus.
//
//   Maus      Kopf greifen und ziehen; das Ziehen beginnt erst nach 6 px Bewegung.
//   Touch     langer Druck (300 ms) auf den Kopf, danach ziehen; kurzes Wischen scrollt normal.
//   Tastatur  Griff-Button fokussieren, Leertaste greift, Pfeiltasten verschieben um eine
//             Position, Leertaste setzt ab, Esc bricht ab. Eine aria-live-Region sagt die Position an.
// Während des Ziehens folgt die Kachel dem Zeiger (transform), ein Platzhalter hält ihren Platz,
// die anderen rücken animiert nach (FLIP, nur transform). Im Fokus-Modus ist Verschieben aus.
//
// Gespeichert wird die Liste der Kachel-IDs unter 'layout.order' (synchronisiert, letzter Schreiber
// gewinnt). Fehlende IDs werden hinten angehängt, unbekannte ignoriert; geschlossene Kacheln
// behalten ihren Platz in der Liste.
import { load, save, remove, subscribe } from './storage.js';
import { h } from './dom.js';
import { resetSizes } from './widget-host.js';

const KEY = 'layout.order';
const DRAG_DISTANCE = 6;
const LONG_PRESS = 300;
const TOUCH_SLOP = 10;   // so viel darf der Finger beim langen Druck wandern
const EDGE = 70;         // Abstand zum Fensterrand, ab dem automatisch gescrollt wird
const MOVE_MS = 200;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let grid = null;
let defaultOrder = [];
let live = null;
let pending = null;   // Zeiger gedrückt, Ziehen noch nicht begonnen
let drag = null;      // laufendes Ziehen mit Zeiger
let grabbed = null;   // per Tastatur gegriffen: { card, before }
let moving = false;   // Kachel wird per Tastatur umgehängt (Fokus kurz weg)
const animating = new Set();

const cards = () => [...grid.querySelectorAll(':scope > .card')];
const visible = () => cards().filter(c => !c.hidden && !c.classList.contains('is-dragging'));
const currentOrder = () => cards().map(c => c.dataset.widget);
const nameOf = card => card.querySelector('.card-title')?.textContent ?? 'Kachel';
const inFocus = () => document.documentElement.dataset.mode === 'fokus';
const announce = text => { if (live) live.textContent = text; };
const positionText = card => {
  const list = visible();
  return `${nameOf(card)}, Position ${list.indexOf(card) + 1} von ${list.length}`;
};

// Umhängen mit Nachrücken: alte Positionen merken, ändern, Differenz per transform zurückspielen.
function flip(mutate) {
  const items = [...grid.children].filter(el => !el.hidden && !el.classList.contains('is-dragging'));
  const before = new Map(items.map(el => [el, el.getBoundingClientRect()]));
  mutate();
  if (reducedMotion.matches) return;
  for (const [el, old] of before) {
    if (!el.isConnected) continue;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (!dx && !dy) continue;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    animating.add(el);
    el.getBoundingClientRect(); // Startlage festschreiben
    el.style.transition = `transform ${MOVE_MS}ms ease`;
    el.style.transform = '';
    const done = () => {
      el.style.transition = '';
      animating.delete(el);
    };
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, MOVE_MS + 50);
  }
}

function applyOrder(order, { animate = true } = {}) {
  const byId = new Map(cards().map(c => [c.dataset.widget, c]));
  const known = (Array.isArray(order) ? order : []).filter(id => byId.has(id));
  const ids = [...new Set([...known, ...defaultOrder.filter(id => !known.includes(id))])];
  if (ids.join() === currentOrder().join()) return;
  const focused = document.activeElement;
  const mutate = () => { for (const id of ids) grid.append(byId.get(id)); };
  if (animate) flip(mutate);
  else mutate();
  if (focused && focused !== document.activeElement) focused.focus({ preventScroll: true });
}

const saveOrder = () => save(KEY, currentOrder());

// ---------- Ziehen mit Zeiger (Maus, Touch, Stift) ----------
function onPointerDown(event) {
  const header = event.target.closest('.card-header');
  if (!header || event.button > 0 || drag || grabbed || inFocus()) return;
  // Bedienelemente im Kopf (außer dem Griff) und der Kachelinhalt lösen kein Ziehen aus.
  if (event.target.closest('button:not(.drag-handle), a, input, select, textarea, label, summary')) return;
  const card = header.closest('.card');
  if (!card || card.parentElement !== grid) return;
  const touch = event.pointerType !== 'mouse';
  pending = { card, pointerId: event.pointerId, x: event.clientX, y: event.clientY, touch, timer: null };
  if (touch) {
    pending.timer = setTimeout(() => {
      if (!pending) return;
      navigator.vibrate?.(12);
      begin(pending, pending.x, pending.y);
    }, LONG_PRESS);
  }
}

function onPointerMove(event) {
  if (pending && event.pointerId === pending.pointerId) {
    const dist = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (pending.touch) {
      // Vor Ablauf des langen Drucks bewegt: das ist Scrollen, kein Ziehen.
      if (dist > TOUCH_SLOP) cancelPending();
      else { pending.lastX = event.clientX; pending.lastY = event.clientY; }
    } else if (dist >= DRAG_DISTANCE) {
      begin(pending, event.clientX, event.clientY);
    }
    return;
  }
  if (drag && event.pointerId === drag.pointerId) {
    event.preventDefault();
    drag.x = event.clientX;
    drag.y = event.clientY;
    follow();
    reposition();
  }
}

function onPointerUp(event) {
  if (pending && event.pointerId === pending.pointerId) cancelPending();
  if (drag && event.pointerId === drag.pointerId) drop(false);
}

function cancelPending() {
  clearTimeout(pending?.timer);
  pending = null;
}

function begin(start, x, y) {
  const { card, pointerId } = start;
  cancelPending();
  if (inFocus()) return;
  const rect = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  const placeholder = h('div', { class: 'card-placeholder', 'aria-hidden': 'true' });
  placeholder.style.gridColumnEnd = style.gridColumnEnd;
  placeholder.style.gridRowEnd = style.gridRowEnd;
  placeholder.style.height = `${rect.height}px`;
  const startIndex = [...grid.children].indexOf(card);

  drag = { card, pointerId, placeholder, rect, startX: start.x, startY: start.y, x, y, startIndex, frame: 0, initial: currentOrder().join() };
  flip(() => {
    card.before(placeholder);
    Object.assign(card.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    card.classList.add('is-dragging');
  });
  document.body.classList.add('is-card-dragging');
  follow();
  announce(`${nameOf(card)} gegriffen`);
  drag.frame = requestAnimationFrame(autoScroll);
}

function follow() {
  const { card, x, y, startX, startY } = drag;
  card.style.transform = `translate(${x - startX}px, ${y - startY}px) scale(1.02)`;
}

// Platzhalter vor oder hinter die Kachel unter dem Zeiger setzen.
function reposition() {
  const target = document.elementFromPoint(drag.x, drag.y)?.closest('.card');
  if (!target || target === drag.card || target.parentElement !== grid || animating.has(target)) return;
  const children = [...grid.children];
  const after = children.indexOf(drag.placeholder) < children.indexOf(target);
  flip(() => (after ? target.after(drag.placeholder) : target.before(drag.placeholder)));
}

// Am oberen und unteren Fensterrand weiterscrollen, solange gezogen wird.
function autoScroll() {
  if (!drag) return;
  let step = 0;
  if (drag.y < EDGE) step = -Math.ceil(((EDGE - drag.y) / EDGE) * 16);
  else if (drag.y > window.innerHeight - EDGE) step = Math.ceil(((drag.y - (window.innerHeight - EDGE)) / EDGE) * 16);
  if (step) {
    window.scrollBy(0, step);
    reposition();
  }
  drag.frame = requestAnimationFrame(autoScroll);
}

function drop(cancel) {
  const { card, placeholder, rect, startIndex, frame, initial } = drag;
  cancelAnimationFrame(frame);
  drag = null;
  if (cancel) {
    // Platzhalter zurück an den Ausgangsplatz
    flip(() => {
      const others = [...grid.children].filter(el => el !== card && el !== placeholder);
      grid.insertBefore(placeholder, others[startIndex] ?? null);
    });
  }
  const target = placeholder.getBoundingClientRect();
  const finish = () => {
    placeholder.replaceWith(card);
    card.classList.remove('is-dragging', 'is-settling');
    for (const prop of ['left', 'top', 'width', 'height', 'transform', 'transition']) card.style[prop] = '';
    document.body.classList.remove('is-card-dragging');
    const order = currentOrder();
    if (!cancel && order.join() !== initial) saveOrder();
    announce(cancel ? `Abgebrochen. ${positionText(card)}` : `Abgesetzt. ${positionText(card)}`);
  };
  if (reducedMotion.matches) return finish();
  // In den Platzhalter einrasten
  card.classList.add('is-settling');
  card.style.transition = `transform ${MOVE_MS}ms ease`;
  card.style.transform = `translate(${target.left - rect.left}px, ${target.top - rect.top}px)`;
  let done = false;
  const once = () => { if (!done) { done = true; finish(); } };
  card.addEventListener('transitionend', once, { once: true });
  setTimeout(once, MOVE_MS + 60);
}

// Seite scrollt nicht, solange nach dem langen Druck gezogen wird.
function onTouchMove(event) {
  if (drag) event.preventDefault();
}

// ---------- Tastatur ----------
function onHandleClick(event) {
  const handle = event.target.closest('.drag-handle');
  // Nur Tastatur-Klicks (Leertaste/Enter) greifen; Maus und Touch ziehen stattdessen.
  if (!handle || event.detail !== 0) return;
  const card = handle.closest('.card');
  if (grabbed?.card === card) return release(false);
  if (grabbed || inFocus()) return;
  grabbed = { card, before: currentOrder() };
  card.classList.add('is-grabbed');
  announce(`${positionText(card)} gegriffen. Pfeiltasten verschieben, Leertaste setzt ab, Esc bricht ab.`);
}

function onHandleKey(event) {
  if (!grabbed || !event.target.closest('.drag-handle')) return;
  const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    return release(true);
  }
  if (!step) return;
  event.preventDefault();
  const { card } = grabbed;
  const list = visible();
  const index = list.indexOf(card);
  const next = list[index + step];
  if (!next) return announce(`${positionText(card)} – ${step < 0 ? 'schon ganz vorn' : 'schon ganz hinten'}`);
  const handle = card.querySelector('.drag-handle');
  moving = true;
  flip(() => (step < 0 ? next.before(card) : next.after(card)));
  handle.focus({ preventScroll: true });
  moving = false;
  card.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  announce(positionText(card));
}

function release(cancel) {
  const { card, before } = grabbed;
  grabbed = null;
  card.classList.remove('is-grabbed');
  if (cancel) {
    moving = true;
    applyOrder(before);
    card.querySelector('.drag-handle')?.focus({ preventScroll: true });
    moving = false;
    announce(`Abgebrochen. ${positionText(card)}`);
    return;
  }
  if (currentOrder().join() !== before.join()) saveOrder();
  announce(`Abgesetzt. ${positionText(card)}`);
}

// Fokus verlässt den gegriffenen Griff (Tab, Klick daneben): an der aktuellen Stelle absetzen.
function onFocusOut(event) {
  if (!grabbed || moving || !event.target.closest('.drag-handle')) return;
  release(false);
}

// ---------- Start, Zurücksetzen ----------
export async function initLayout(gridElement) {
  grid = gridElement;
  grid.classList.add('is-sortable');
  defaultOrder = currentOrder();
  live = h('p', { class: 'sr-only', 'aria-live': 'assertive', role: 'status' });
  document.body.append(live);

  applyOrder(await load(KEY, null), { animate: false });
  // Reihenfolge von anderen Geräten (Sync) oder Tabs – nicht mitten im Verschieben
  subscribe(KEY, value => { if (!drag && !grabbed) applyOrder(value); });

  grid.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', event => {
    if (pending && event.pointerId === pending.pointerId) cancelPending();
    if (drag && event.pointerId === drag.pointerId) drop(false);
  });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('keydown', event => { if (drag && event.key === 'Escape') drop(true); });
  grid.addEventListener('click', onHandleClick);
  grid.addEventListener('keydown', onHandleKey);
  grid.addEventListener('focusout', onFocusOut);
}

// Standardreihenfolge und Standardgrößen wiederherstellen.
export async function resetLayout() {
  if (!grid) return;
  await remove(KEY);
  applyOrder(defaultOrder);
  await resetSizes();
}
