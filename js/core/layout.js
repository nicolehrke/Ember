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
// Reihenfolge: Liste der Kachel-IDs unter 'layout.order' (synchronisiert, letzter Schreiber gewinnt).
// Fehlende IDs werden hinten angehängt, unbekannte ignoriert; geschlossene Kacheln behalten ihren Platz.
import { load, remove, subscribe } from './storage.js';
import { resetSizes } from './widget-host.js';

const KEY = 'layout.order';
const SPANS = { s: 1, m: 2, l: 2 };

let grid = null;
let defaultOrder = [];
let frame = 0;
let ready = false;
const placed = new Map(); // Element → { x, y, w, h } aus der letzten Berechnung

const cards = () => [...grid.querySelectorAll(':scope > .card')];
const currentOrder = () => cards().map(c => c.dataset.widget);

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

export async function initLayout(gridElement) {
  grid = gridElement;
  grid.classList.add('is-masonry');
  defaultOrder = currentOrder();
  applyOrder(await load(KEY, null));
  subscribe(KEY, value => applyOrder(value));

  // Neu berechnen bei Inhalt, Öffnen/Schließen, Größe, Fenster, Fokus-Modus, Schriften
  const resize = new ResizeObserver(scheduleLayout);
  for (const card of cards()) resize.observe(card);
  new MutationObserver(scheduleLayout).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-size'] });
  new MutationObserver(scheduleLayout).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-style'] });
  window.addEventListener('resize', scheduleLayout);
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
  if (!grid) return;
  await remove(KEY);
  applyOrder(defaultOrder);
  await resetSizes();
}
