// Klingel-Anzeige für Timer und Wecker: Overlay mit Name und großen Buttons,
// Ton in Dauerschleife bis zum Beenden, blinkender Tab-Titel, Benachrichtigung.
// Klingeln mehrere Dinge gleichzeitig, werden sie nacheinander angezeigt.
import { h } from './dom.js';
import { playLoop, showNotification } from './alerts.js';
import { setTitlePart } from './title.js';

const queue = []; // { id, title, text, actions: [{ label, primary?, onClick }] }
const listeners = new Set();
let overlay = null;
let stopSound = null;
let blinkTimer = null;

// Optionale Verbindung zur Musik (wird in main.js gesetzt): pausiert beim Klingeln,
// danach wieder weiter, falls sie vorher lief.
let music = null;
let pausedMusic = false;
export function setMusicHook(hook) { music = hook; }

export const isRinging = id => (id ? queue.some(r => r.id === id) : queue.length > 0);
export function onRinging(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => { for (const fn of listeners) fn(queue.length > 0); };

export function ring({ id, title, text = '', actions }) {
  if (isRinging(id)) return;
  queue.push({ id, title, text, actions });
  if (queue.length === 1) start();
  draw();
  showNotification(title, text, 'ring');
  changed();
}

export function dismiss(id) {
  const index = queue.findIndex(r => r.id === id);
  if (index === -1) return;
  queue.splice(index, 1);
  if (!queue.length) stop();
  else draw();
  changed();
}

async function start() {
  stopSound = playLoop();
  let on = false;
  blinkTimer = setInterval(() => {
    on = !on;
    setTitlePart('ring', `${on ? '🔔' : '⏰'} ${queue[0]?.title ?? ''}`);
  }, 900);
  try {
    if (music?.isPlaying()) {
      await music.pause();
      pausedMusic = true;
    }
  } catch { /* Musik nicht erreichbar – Klingeln geht trotzdem */ }
}

async function stop() {
  stopSound?.();
  stopSound = null;
  clearInterval(blinkTimer);
  setTitlePart('ring', null);
  if (overlay) overlay.hidden = true;
  if (pausedMusic) {
    pausedMusic = false;
    try { await music?.resume(); } catch { /* egal */ }
  }
}

function draw() {
  const current = queue[0];
  if (!current) return;
  if (!overlay) {
    overlay = h('div', { class: 'ring-overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'ring-title', hidden: true });
    document.body.append(overlay);
  }
  const buttons = current.actions.map(a => h('button', {
    class: `ring-btn${a.primary ? ' ring-btn--primary' : ''}`,
    type: 'button',
    onclick: async () => {
      dismiss(current.id);
      await a.onClick?.();
    },
  }, a.label));
  overlay.replaceChildren(h('div', { class: 'ring-box' },
    h('div', { class: 'ring-icon', 'aria-hidden': 'true' }, '⏰'),
    h('h2', { class: 'ring-title', id: 'ring-title' }, current.title),
    current.text && h('p', { class: 'ring-text' }, current.text),
    h('div', { class: 'ring-actions' }, buttons),
    queue.length > 1 && h('p', { class: 'ring-more' }, `+ ${queue.length - 1} weitere`)));
  overlay.hidden = false;
  buttons.find((_, i) => current.actions[i].primary)?.focus();
}
