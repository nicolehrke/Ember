// Design: Stil (Glut, Glas, Papier, Jarvis), Hell/Dunkel und Tageszeit-Akzente.
//
// Auf <html> sitzen data-style und data-theme ('dark' | 'light'); das Stylesheet
// css/styles/<stil>.css und die Schriften des Stils werden nur geladen, wenn er aktiv ist.
// Die Wahl liegt unter 'design' = { style, mode: 'system' | 'light' | 'dark' } und wird
// synchronisiert. Akzentfarben (--ui, --glow-rgb, --k, --breath) folgen minütlich der Uhrzeit.
import { load, save, remove, subscribe } from './storage.js';
import { h } from './dom.js';
import { popover } from './popover.js';
import { icon } from './icons.js';
import { STYLES, DEFAULT_STYLE, sample, phaseOf, breathFor } from '../theme/palettes.js';

const KEY = 'design';
const MODES = { system: 'System', light: 'Hell', dark: 'Dunkel' };
const root = document.documentElement;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

let design = { style: DEFAULT_STYLE, mode: 'system' };
let phase = null;
const phaseListeners = new Set();
let drawMenu;

const valid = d => ({
  style: STYLES[d?.style] ? d.style : DEFAULT_STYLE,
  mode: MODES[d?.mode] ? d.mode : 'system',
});

// Stile mit nur einem Modus erzwingen ihn; sonst gilt die Wahl bzw. das System.
export function resolvedTheme(d = design) {
  const { modes } = STYLES[d.style];
  if (modes.length === 1) return modes[0];
  if (d.mode === 'system') return systemDark.matches ? 'dark' : 'light';
  return d.mode;
}

// Stylesheet/Schriften tauschen: neues Element erst laden, dann das alte entfernen (kein Aufblitzen).
// Pro Platz lädt immer nur ein Link; ein schneller zweiter Wechsel verwirft den noch ladenden,
// damit nie zwei Stile gleichzeitig gelten. Gibt ein Promise zurück, das nach dem Laden erfüllt ist.
function swapLink(id, href) {
  for (const stale of document.querySelectorAll(`link[data-pending="${id}"]`)) stale.remove();
  const current = document.getElementById(id);
  if (!href) return Promise.resolve(void current?.remove());
  if (current?.getAttribute('href') === href) return Promise.resolve();
  return new Promise(resolve => {
    const link = h('link', { rel: 'stylesheet', href, 'data-pending': id });
    const done = () => {
      if (link.isConnected) {
        document.getElementById(id)?.remove();
        link.removeAttribute('data-pending');
        link.id = id;
      }
      resolve();
    };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    (current ?? document.getElementById('style-css') ?? document.head.lastElementChild).after(link);
  });
}

function applyDesign() {
  const style = design.style;
  root.dataset.style = style;
  root.dataset.theme = resolvedTheme();
  swapLink('style-css', `css/styles/${style}.css`).then(() => {
    if (design.style !== style) return; // inzwischen erneut gewechselt
    // Erst jetzt zeigen (Start) und das Raster mit den Abständen des Stils neu rechnen
    root.classList.add('is-styled');
    document.dispatchEvent(new Event('ember:style'));
  });
  swapLink('style-fonts', `https://fonts.googleapis.com/css2?${STYLES[style].fonts}&display=swap`);
  applyAccent();
  drawMenu();
}

function applyAccent() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const s = sample(design.style, hour);
  root.style.setProperty('--ui', `rgb(${s.ui.join(' ')})`);
  root.style.setProperty('--glow-rgb', s.glow.join(' '));
  root.style.setProperty('--k', s.k.toFixed(3));
  root.style.setProperty('--breath', `${breathFor(hour)}s`);
  const next = phaseOf(design.style, hour);
  root.dataset.phase = String(next.index);
  if (next.index !== phase?.index || next.name !== phase?.name) {
    phase = next;
    for (const fn of phaseListeners) fn(phase);
  }
}

// Aktuelle Tageszeit-Phase { index 0–4, name } und Abo auf Wechsel.
export const currentPhase = () => phase;
export function onPhase(fn) {
  phaseListeners.add(fn);
  return () => phaseListeners.delete(fn);
}

async function setDesign(next) {
  design = valid({ ...design, ...next });
  applyDesign();
  await save(KEY, design);
}

// Stil-Auswahl (vier Stile mit Farbvorschau) und Hell/Dunkel als wiederverwendbarer Baustein –
// im Paletten-Menü oben und im Einstellungs-Bereich „Darstellung“. Alle Instanzen zeigen denselben Stand.
const menus = new Set();
drawMenu = () => { for (const draw of menus) draw(); };

export function themeControls() {
  const list = h('div', { class: 'theme-styles', role: 'group', 'aria-label': 'Stil' });
  const modeSwitch = h('div', { class: 'segmented theme-modes', role: 'group', 'aria-label': 'Hell oder dunkel' });
  const hint = h('p', { class: 'muted small theme-hint' });

  // Buttons nur einmal bauen, danach nur Zustand setzen (Tastaturfokus bleibt erhalten).
  const styleButtons = Object.entries(STYLES).map(([id, s]) => {
    const info = h('span', { class: 'muted small' });
    const button = h('button', { class: 'theme-style', type: 'button', onclick: () => setDesign({ style: id }) },
      h('span', { class: 'theme-swatch', 'aria-hidden': 'true' }, ...s.swatch.map(c => h('span', { style: `background:${c}` }))),
      h('span', { class: 'theme-style-text' }, h('span', { class: 'theme-style-name' }, s.label), info));
    return { id, s, button, info };
  });
  list.append(...styleButtons.map(b => b.button));
  const modeButtons = Object.entries(MODES).map(([id, label]) => ({
    id, button: h('button', { class: 'segment', type: 'button', onclick: () => setDesign({ mode: id }) }, label),
  }));
  modeSwitch.append(...modeButtons.map(b => b.button));

  menus.add(() => {
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    for (const { id, s, button, info } of styleButtons) {
      button.setAttribute('aria-pressed', String(design.style === id));
      info.textContent = `${s.modes.length === 2 ? 'Hell & dunkel' : s.modes[0] === 'dark' ? 'Nur dunkel' : 'Nur hell'} · jetzt ${phaseOf(id, hour).name}`;
    }
    const fixed = STYLES[design.style].modes.length === 1;
    for (const { id, button } of modeButtons) {
      button.disabled = fixed;
      button.setAttribute('aria-pressed', String(fixed ? id === resolvedTheme() : design.mode === id));
    }
    hint.textContent = fixed
      ? `${STYLES[design.style].label} gibt es nur ${resolvedTheme() === 'dark' ? 'dunkel' : 'hell'} – der Schalter gilt für Glut.`
      : '';
  });
  drawMenu();
  return h('div', { class: 'theme-controls' },
    h('h3', { class: 'settings-label' }, 'Stil'), list,
    h('h3', { class: 'settings-label theme-subtitle' }, 'Hell / Dunkel'), modeSwitch, hint);
}

// Palettensymbol oben als Schnellzugriff
function mountMenu(slot) {
  const button = h('button', { class: 'icon-btn theme-btn', type: 'button', title: 'Stil', 'aria-label': 'Stil und Hell/Dunkel', 'aria-controls': 'theme-panel' }, icon('palette'));
  const panel = h('div', { class: 'popover theme-panel', id: 'theme-panel', hidden: true }, themeControls());
  slot.append(button, panel);
  popover(button, panel, slot);
}

export async function initTheme(slot) {
  let stored = await load(KEY, null);
  // Früher: nur Hell/Dunkel unter 'local/theme' (nicht synchronisiert) – einmalig übernehmen.
  const legacy = await load('local/theme', null);
  if (!stored && legacy) {
    stored = { style: DEFAULT_STYLE, mode: legacy };
    await save(KEY, valid(stored));
  }
  if (legacy) await remove('local/theme');
  design = valid(stored);
  mountMenu(slot);
  applyDesign();

  // Wahl von anderen Geräten (Sync) oder Tabs, Systemwechsel Hell/Dunkel
  // Nur echte Änderungen (andere Geräte/Tabs) – die eigene Speicherung hat den Stil schon gesetzt
  subscribe(KEY, v => {
    const next = valid(v);
    if (next.style === design.style && next.mode === design.mode) return;
    design = next;
    applyDesign();
  });
  systemDark.addEventListener('change', applyDesign);

  // Minütlich, pünktlich zur vollen Minute; nach Ruhezustand sofort
  const tick = () => { applyAccent(); drawMenu(); };
  setTimeout(() => { tick(); setInterval(tick, 60 * 1000); }, 60 * 1000 - (Date.now() % 60000) + 50);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
