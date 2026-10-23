// Kachel-Raster als Masonry: Jede Kachel hat ihre natürliche Höhe, freie Stellen füllen die anderen.
//
// Spalten: ab 1200 px 4, ab 900 px 3, ab 560 px 2, darunter 1. Breite je Kachel aus ihrer Größe
// (S = 1 Spalte, M und L = 2), höchstens so viele Spalten, wie es gibt. Die Kacheln werden in
// DOM-Reihenfolge (= gespeicherte Reihenfolge) nacheinander platziert, jeweils an der Stelle mit der
// niedrigsten freien Oberkante, die für ihre Breite passt (bei Gleichstand links). Position per
// transform, Containerhöhe = höchste Spalte. Neu berechnet bei Fenstergröße, Öffnen/Schließen,
// Größenwechsel, Inhaltsänderung (ResizeObserver), Fokus-Modus und geladenen Schriften – gebündelt
// pro Frame. Abstände kommen aus --gap (bzw. --gap-x / --gap-y), über Stile weiß das Modul nichts.
//
// Verschieben jederzeit am Kachelkopf, ohne Anordnen-Modus:
//   Maus      Kopf greifen und ziehen; das Ziehen beginnt erst nach 6 px Bewegung.
//   Touch     langer Druck (300 ms) auf den Kopf, danach ziehen; kurzes Wischen scrollt normal.
//   Tastatur  Griff-Button fokussieren, Leertaste greift, Pfeiltasten verschieben um eine
//             Position, Leertaste setzt ab, Esc bricht ab. Eine aria-live-Region sagt die Position an.
// Beim Ziehen hält ein Platzhalter (Größe der Kachel) ihren Platz und wird sofort ins Masonry
// eingerechnet; Ziel ist die Kachel, über der der Zeiger mindestens 12 px innen steht (Hysterese),
// unter allen Kacheln das Ende. Im Fokus-Modus ist Verschieben aus.
//
// Reihenfolge: Liste der Kachel-IDs unter 'layout.order' (synchronisiert, letzter Schreiber gewinnt).
// Fehlende IDs werden hinten angehängt, unbekannte ignoriert; geschlossene Kacheln behalten ihren Platz.
import { load, save, remove, subscribe } from './storage.js';
import { h } from './dom.js';
import { resetSizes } from './widget-host.js';

const KEY = 'layout.order';
const SPANS = { s: 1, m: 2, l: 2 };
const DRAG_DISTANCE = 6;
const LONG_PRESS = 300;
const TOUCH_SLOP = 10;   // so viel darf der Finger beim langen Druck wandern
const HYSTERESIS = 12;   // so weit muss der Zeiger in der Zielkachel stehen
const EDGE = 70;         // Abstand zum Fensterrand, ab dem automatisch gescrollt wird
const SETTLE_MS = 200;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let grid = null;
let defaultOrder = [];
let frame = 0;
let ready = false;
const placed = new Map(); // Element → { x, y, w, h } aus der letzten Berechnung
let live = null;
let pending = null;   // Zeiger gedrückt, Ziehen noch nicht begonnen
let drag = null;      // laufendes Ziehen mit Zeiger
let grabbed = null;   // per Tastatur gegriffen: { card, before }
let moving = false;   // Kachel wird per Tastatur umgehängt (Fokus kurz weg)

const cards = () => [...grid.querySelectorAll(':scope > .card')];
const currentOrder = () => cards().map(c => c.dataset.widget);
const visibleCards = () => cards().filter(c => !c.hidden && !c.classList.contains('is-dragging'));
const nameOf = card => card.querySelector('.card-title')?.textContent ?? 'Kachel';
const inFocus = () => document.documentElement.dataset.mode === 'fokus';
const announce = text => { if (live) live.textContent = text; };
const positionText = card => {
  const list = visibleCards();
  return `${nameOf(card)}, Position ${list.indexOf(card) + 1} von ${list.length}`;
};
const saveOrder = () => save(KEY, currentOrder());

export const columnCount = () => {
  const w = window.innerWidth;
  return w >= 1200 ? 4 : w >= 900 ? 3 : w >= 560 ? 2 : 1;
};

function gaps() {
  const style = getComputedStyle(grid);
  const read = name => parseFloat(style.getPropertyValue(name));
  const gap = read('--gap') || 0;
  return { x: read('--gap-x') || gap, y: read('--gap-y') || gap };
}

// Sichtbare Kacheln (und ein Platzhalter beim Ziehen) in Platzierungs-Reihenfolge.
function layoutItems(focus) {
  const list = [...grid.children].filter(el => el.classList.contains('card-placeholder')
    || (el.classList.contains('card') && !el.hidden && !el.classList.contains('is-dragging')));
  // Fokus: Lernzeit volle Breite vorn, die anderen dahinter in ihrer Reihenfolge
  const study = focus && list.find(el => el.dataset.widget === 'study');
  return study ? [study, ...list.filter(el => el !== study)] : list;
}

// Position ohne Gleiten setzen (neu sichtbare Kacheln, erste Berechnung)
function jump(el, transform) {
  el.style.transition = 'none';
  el.style.transform = transform;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; }));
}

function layout() {
  frame = 0;
  if (!grid) return;
  const cols = columnCount();
  const gap = gaps();
  const colWidth = (grid.clientWidth - gap.x * (cols - 1)) / cols;
  const focus = document.documentElement.dataset.mode === 'fokus';
  const list = layoutItems(focus);
  const spanOf = el => (focus && el.dataset.widget === 'study' ? cols : Math.min(cols, SPANS[el.dataset.size] ?? 1));

  // Erst alle Breiten setzen, dann alle Höhen lesen (ein einziger Layout-Durchlauf)
  const widths = list.map(el => {
    const span = spanOf(el);
    const width = span * colWidth + (span - 1) * gap.x;
    const px = `${width}px`;
    if (el.style.width !== px) el.style.width = px;
    return width;
  });
  const heights = list.map(el => el.offsetHeight);

  const tops = new Array(cols).fill(0);
  const seen = new Set();
  list.forEach((el, i) => {
    const span = spanOf(el);
    let column = 0;
    let top = Infinity;
    for (let c = 0; c + span <= cols; c++) {
      const candidate = Math.max(...tops.slice(c, c + span));
      if (candidate < top - 0.5) { top = candidate; column = c; }
    }
    const x = column * (colWidth + gap.x);
    for (let c = column; c < column + span; c++) tops[c] = top + heights[i] + gap.y;
    const transform = `translate(${x}px, ${top}px)`;
    if (el.style.transform !== transform) {
      if (!ready || !placed.has(el)) jump(el, transform);
      else el.style.transform = transform;
    }
    placed.set(el, { x, y: top, w: widths[i], h: heights[i] });
    seen.add(el);
  });
  for (const el of placed.keys()) if (!seen.has(el)) placed.delete(el);
  grid.style.height = `${Math.max(0, Math.max(...tops) - gap.y)}px`;
}

// Sofort neu rechnen (Vorschau beim Ziehen), einen geplanten Frame dabei überspringen
function layoutNow() {
  if (frame) cancelAnimationFrame(frame);
  layout();
}

export function scheduleLayout() {
  if (grid && !frame) frame = requestAnimationFrame(layout);
}

// Letzte berechnete Position eines Elements im Raster (für das Ziehen)
export const placement = el => placed.get(el);

function applyOrder(order) {
  const byId = new Map(cards().map(c => [c.dataset.widget, c]));
  const known = (Array.isArray(order) ? order : []).filter(id => byId.has(id));
  const ids = [...new Set([...known, ...defaultOrder.filter(id => !known.includes(id))])];
  if (ids.join() === currentOrder().join()) return;
  const focused = document.activeElement;
  for (const id of ids) grid.append(byId.get(id));
  if (focused && focused !== document.activeElement) focused.focus({ preventScroll: true });
}

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
    // Touch: vor Ablauf des langen Drucks bewegt = Scrollen, kein Ziehen
    if (pending.touch) { if (dist > TOUCH_SLOP) cancelPending(); }
    else if (dist >= DRAG_DISTANCE) begin(pending, event.clientX, event.clientY);
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
  // Platzhalter in Größe der Kachel; das Masonry rechnet ihn sofort mit ein
  const placeholder = h('div', { class: 'card-placeholder', 'aria-hidden': 'true', 'data-size': card.dataset.size });
  placeholder.style.height = `${rect.height}px`;
  const startIndex = [...grid.children].indexOf(card);
  drag = { card, pointerId, placeholder, rect, startX: start.x, startY: start.y, x, y, startIndex, frame: 0, initial: currentOrder().join() };

  card.before(placeholder);
  Object.assign(card.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  card.classList.add('is-dragging');
  document.body.classList.add('is-card-dragging');
  follow();
  layoutNow();
  announce(`${nameOf(card)} gegriffen`);
  drag.frame = requestAnimationFrame(autoScroll);
}

function follow() {
  const { card, x, y, startX, startY } = drag;
  card.style.transform = `translate(${x - startX}px, ${y - startY}px) scale(1.02)`;
}

// Zielkachel aus den berechneten Positionen (nicht aus laufenden Animationen) bestimmen.
function reposition() {
  const box = grid.getBoundingClientRect();
  const px = drag.x - box.left;
  const py = drag.y - box.top;
  const { placeholder } = drag;
  let target = null;
  let bottom = 0;
  for (const [el, p] of placed) {
    if (el === placeholder) continue;
    bottom = Math.max(bottom, p.y + p.h);
    if (px >= p.x + HYSTERESIS && px <= p.x + p.w - HYSTERESIS && py >= p.y + HYSTERESIS && py <= p.y + p.h - HYSTERESIS) target = el;
  }
  if (target) {
    const children = [...grid.children];
    const after = children.indexOf(placeholder) < children.indexOf(target);
    if (after ? target.nextElementSibling === placeholder : target.previousElementSibling === placeholder) return;
    if (after) target.after(placeholder);
    else target.before(placeholder);
  } else if (py > bottom + HYSTERESIS) {
    // Unter allen Kacheln: ans Ende
    const last = visibleCards().at(-1);
    if (!last || last.nextElementSibling === placeholder) return;
    last.after(placeholder);
  } else {
    return;
  }
  layoutNow();
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
    const others = [...grid.children].filter(el => el !== card && el !== placeholder);
    grid.insertBefore(placeholder, others[startIndex] ?? null);
    layoutNow();
  }
  const finish = () => {
    placeholder.replaceWith(card);
    card.classList.remove('is-dragging');
    for (const prop of ['left', 'top', 'height', 'transform', 'transition']) card.style[prop] = '';
    document.body.classList.remove('is-card-dragging');
    layoutNow(); // die Kachel springt ohne Gleiten auf den Platz des Platzhalters
    if (!cancel && currentOrder().join() !== initial) saveOrder();
    announce(`${cancel ? 'Abgebrochen' : 'Abgesetzt'}. ${positionText(card)}`);
  };
  if (reducedMotion.matches) return finish();
  // In den Platzhalter einrasten
  const box = grid.getBoundingClientRect();
  const p = placed.get(placeholder) ?? { x: rect.left - box.left, y: rect.top - box.top };
  card.style.transition = `transform ${SETTLE_MS}ms ease`;
  card.style.transform = `translate(${box.left + p.x - rect.left}px, ${box.top + p.y - rect.top}px)`;
  let done = false;
  const once = () => { if (!done) { done = true; finish(); } };
  card.addEventListener('transitionend', once, { once: true });
  setTimeout(once, SETTLE_MS + 60);
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
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    return release(true);
  }
  const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const { card } = grabbed;
  const list = visibleCards();
  const next = list[list.indexOf(card) + step];
  if (!next) return announce(`${positionText(card)} – ${step < 0 ? 'schon ganz vorn' : 'schon ganz hinten'}`);
  const handle = card.querySelector('.drag-handle');
  moving = true;
  if (step < 0) next.before(card);
  else next.after(card);
  handle.focus({ preventScroll: true });
  moving = false;
  layoutNow();
  requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' }));
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
  grid.classList.add('is-masonry');
  defaultOrder = currentOrder();
  applyOrder(await load(KEY, null));
  // Reihenfolge von anderen Geräten (Sync) oder Tabs – nicht mitten im Verschieben
  subscribe(KEY, value => { if (!drag && !grabbed) applyOrder(value); });

  grid.classList.add('is-sortable');
  live = h('p', { class: 'sr-only', 'aria-live': 'assertive', role: 'status' });
  document.body.append(live);
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

  // Neu berechnen bei Inhalt, Öffnen/Schließen, Größe, Fenster, Fokus-Modus, Schriften
  const resize = new ResizeObserver(scheduleLayout);
  for (const card of cards()) resize.observe(card);
  new MutationObserver(scheduleLayout).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-size'] });
  new MutationObserver(scheduleLayout).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-style'] });
  window.addEventListener('resize', scheduleLayout);
  document.addEventListener('ember:style', scheduleLayout); // Stil-Datei geladen (andere Abstände)
  document.fonts?.addEventListener?.('loadingdone', scheduleLayout);

  // Erst zeigen, wenn die Positionen stehen: Schriften abwarten (höchstens 600 ms)
  layout();
  await Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 600))]);
  layout();
  ready = true;
  grid.classList.add('is-ready');
}

// Standardreihenfolge und Standardgrößen wiederherstellen.
export async function resetLayout() {
  if (!grid || drag || grabbed) return;
  await remove(KEY);
  applyOrder(defaultOrder);
  await resetSizes();
}
