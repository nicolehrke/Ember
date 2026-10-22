// Countdown-Timer für das Lernzeit-Widget (Hilfsmodul, kein eigenes Widget).
// Mehrere Timer gleichzeitig (höchstens MAX), gerechnet wird nur mit Zeitstempeln:
// Ein laufender Timer speichert sein Ende, ein pausierter die Restzeit. So stimmt
// die Anzeige auch nach Neuladen und in gedrosselten Hintergrund-Tabs.
//
// Daten: 'local/timers' – nur dieses Gerät, kein Sync und kein Export (ein Timer
// klingelt ohnehin nur in dem Tab, in dem Ember gerade offen ist).
//   [{ id, name, duration, study, subjectId,
//      end?            läuft bis
//      left?           Restzeit, wenn pausiert oder noch nicht gestartet
//      start?          erster Start (für den Lernzeit-Eintrag)
//      pausedTotal?    Summe der Pausen (für den Lernzeit-Eintrag)
//      doneAt?         abgelaufen um
//      missed?         lief ab, als Ember zu war bzw. schlief }]
// „Als Lernzeit zählen“ legt beim Ablaufen oder Zurücksetzen denselben Eintrag
// an wie der freie Timer (mit fester id, damit nichts doppelt gezählt wird).
import { h } from '../core/dom.js';
import { load, save, subscribe } from '../core/storage.js';
import { ring, dismiss, isRinging } from '../core/ringer.js';
import { countdown } from './pomodoro.js';

const KEY = 'local/timers';
export const MAX = 5;
const QUICK = [5, 10, 15, 30];
const MIN_SESSION = 60 * 1000;
// Wie bei Pomodoro: längere Lücken (Seite zu, iPad eingefroren) gelten als „nicht da“.
const ALIVE_GRACE = 3 * 60 * 1000;

const pad = n => String(n).padStart(2, '0');
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const isRunning = t => Boolean(t.end && !t.doneAt);
const rest = (t, now = Date.now()) => (isRunning(t) ? Math.max(0, t.end - now) : t.left ?? t.duration);
const label = t => t.name || `Timer ${countdown(t.duration)}`;

export function createTimers({ getSubjectId, saveSession, onChange }) {
  let timers = [];
  let lastTick = null; // letzter Tick dieser Seite – null direkt nach dem Laden

  // ---------- Elemente ----------
  const hours = h('input', { type: 'number', min: 0, max: 23, step: 1, inputmode: 'numeric', placeholder: '0', 'aria-label': 'Stunden' });
  const minutes = h('input', { type: 'number', min: 0, max: 59, step: 1, inputmode: 'numeric', placeholder: '0', 'aria-label': 'Minuten' });
  const seconds = h('input', { type: 'number', min: 0, max: 59, step: 1, inputmode: 'numeric', placeholder: '0', 'aria-label': 'Sekunden' });
  const name = h('input', { type: 'text', maxlength: 40, placeholder: 'Name (optional)', 'aria-label': 'Name des Timers' });
  const study = h('input', { type: 'checkbox' });
  const error = h('p', { class: 'settings-error' });
  const quick = h('div', { class: 'timer-quick' }, QUICK.map(min => h('button', {
    class: 'chip', type: 'button', onclick: () => add(min * 60000),
  }, `${min} min`)));
  const form = h('form', { class: 'timer-form' },
    h('div', { class: 'timer-hms' },
      h('label', {}, hours, 'h'), h('label', {}, minutes, 'm'), h('label', {}, seconds, 's'),
      h('button', { class: 'chip chip--accent', type: 'submit' }, 'Start')),
    quick,
    h('div', { class: 'timer-hms' }, name, h('label', { class: 'pomo-check timer-study' }, study, 'als Lernzeit')),
    error);
  const list = h('ul', { class: 'timer-list' });
  const element = h('div', { class: 'timers' }, list, form);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const ms = ((Number(hours.value) || 0) * 3600 + (Number(minutes.value) || 0) * 60 + (Number(seconds.value) || 0)) * 1000;
    if (ms <= 0) return void (error.textContent = 'Bitte eine Dauer angeben.');
    if (ms > 24 * 3600 * 1000) return void (error.textContent = 'Höchstens 24 Stunden.');
    add(ms);
  });

  // ---------- Speichern ----------
  const persist = async next => {
    timers = next;
    draw();
    onChange();
    await save(KEY, timers);
  };
  const update = (id, patch) => persist(timers.map(t => (t.id === id ? { ...t, ...patch } : t)));

  async function add(duration) {
    if (timers.length >= MAX) return;
    error.textContent = '';
    const now = Date.now();
    const timer = { id: uid(), name: name.value.trim(), duration, study: study.checked, subjectId: getSubjectId(), start: now, end: now + duration, pausedTotal: 0 };
    hours.value = minutes.value = seconds.value = name.value = '';
    await persist([...timers, timer]);
  }

  // Lernzeit-Eintrag für die bisher gelaufene Zeit (ohne Pausen)
  const countStudy = async (t, end) => {
    if (!t.study || !t.start) return;
    const session = { id: `timer-${t.start}`, subjectId: t.subjectId ?? '', start: t.start, end, pause: t.pausedTotal ?? 0 };
    if (session.end - session.start - session.pause >= MIN_SESSION) await saveSession(session);
  };

  const pause = t => update(t.id, { end: null, left: rest(t), pausedAt: Date.now() });
  const resume = t => {
    const now = Date.now();
    return update(t.id, { end: now + t.left, left: null, pausedAt: null, pausedTotal: (t.pausedTotal ?? 0) + (t.pausedAt ? now - t.pausedAt : 0) });
  };
  const restart = t => {
    const now = Date.now();
    return update(t.id, { end: now + t.duration, left: null, start: now, pausedAt: null, pausedTotal: 0, doneAt: null, missed: false });
  };
  // Zurücksetzen: zurück auf die volle Dauer, nicht gestartet
  const reset = async t => {
    if (!t.doneAt) await countStudy(t, t.pausedAt ?? Date.now());
    dismiss(`timer-${t.id}`);
    return update(t.id, { end: null, left: t.duration, start: null, pausedAt: null, pausedTotal: 0, doneAt: null, missed: false });
  };
  const removeTimer = async t => {
    if (!t.doneAt && t.start) await countStudy(t, t.pausedAt ?? Date.now());
    dismiss(`timer-${t.id}`);
    await persist(timers.filter(x => x.id !== t.id));
  };
  const startIdle = t => {
    const now = Date.now();
    return update(t.id, { end: now + t.left, left: null, start: now, pausedAt: null, pausedTotal: 0 });
  };

  // ---------- Ablauf ----------
  async function finish(t, missed) {
    await countStudy(t, t.end);
    await update(t.id, { doneAt: t.end, missed });
    if (missed) return;
    ring({
      id: `timer-${t.id}`,
      title: label(t),
      text: `Timer abgelaufen um ${hhmm(t.end)}`,
      actions: [
        { label: 'Stopp', primary: true },
        { label: '+1 Minute', onClick: () => update(t.id, { doneAt: null, missed: false, start: null, end: Date.now() + 60000 }) },
      ],
    });
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const alive = lastTick !== null;
      lastTick = now;
      for (const t of timers.filter(x => isRunning(x) && x.end <= now)) {
        await finish(t, !alive || now - t.end > ALIVE_GRACE);
      }
      drawTimes();
    } finally {
      ticking = false;
    }
  }

  // ---------- Anzeige ----------
  const rows = new Map(); // id → Zeit-Element, damit der Sekundentakt nicht alles neu baut

  function draw() {
    rows.clear();
    const full = timers.length >= MAX;
    for (const el of form.querySelectorAll('input, button')) el.disabled = full;
    error.textContent = full ? `Höchstens ${MAX} Timer gleichzeitig – erst einen entfernen.` : error.textContent;

    list.replaceChildren(...timers.map(t => {
      const time = h('span', { class: 'timer-time' });
      rows.set(t.id, time);
      const btn = (text, onclick, accent) => h('button', { class: `chip${accent ? ' chip--accent' : ''}`, type: 'button', onclick }, text);
      let actions;
      if (t.doneAt) actions = [btn('Neu starten', () => restart(t), true)];
      else if (isRunning(t)) actions = [btn('Pause', () => pause(t), true), btn('Zurücksetzen', () => reset(t))];
      else if (t.pausedAt) actions = [btn('Fortsetzen', () => resume(t), true), btn('Zurücksetzen', () => reset(t))];
      else actions = [btn('Start', () => startIdle(t), true)];
      return h('li', { class: `timer-row${t.doneAt ? ' is-done' : ''}${t.pausedAt ? ' is-paused' : ''}` },
        h('div', { class: 'timer-info' },
          h('span', { class: 'timer-name' }, label(t), t.study ? h('span', { class: 'timer-tag', title: 'Zählt als Lernzeit' }, '📚') : null),
          time),
        h('div', { class: 'timer-actions' }, ...actions,
          h('button', { class: 'icon-btn icon-btn--xs', type: 'button', title: 'Timer entfernen', 'aria-label': `${label(t)} entfernen`, onclick: () => removeTimer(t) }, '×')));
    }));
    drawTimes();
  }

  function drawTimes() {
    for (const t of timers) {
      const el = rows.get(t.id);
      if (!el) continue;
      if (t.doneAt) el.textContent = t.missed ? `abgelaufen um ${hhmm(t.doneAt)}` : `fertig um ${hhmm(t.doneAt)}`;
      else el.textContent = `${countdown(rest(t))}${t.pausedAt ? ' pausiert' : ''}`;
    }
  }

  // Nächster laufender Timer für Kachelkopf und Tab-Titel, null wenn keiner läuft.
  const next = () => {
    const soonest = timers.filter(isRunning).sort((a, b) => a.end - b.end)[0];
    if (soonest) return { ms: soonest.end - Date.now(), badge: `⏱ ${countdown(rest(soonest))}`, title: `⏱ ${countdown(rest(soonest))} ${label(soonest)}`, name: label(soonest) };
    const missed = timers.find(t => t.missed && !isRinging(`timer-${t.id}`));
    return missed ? { ms: Infinity, badge: '⚠︎ Timer abgelaufen', title: `⚠︎ ${label(missed)} abgelaufen um ${hhmm(missed.doneAt)}` } : null;
  };

  async function init() {
    const stored = await load(KEY, []);
    timers = Array.isArray(stored) ? stored.filter(t => t && t.id && t.duration > 0) : [];
    // Andere Tabs desselben Geräts
    subscribe(KEY, v => { timers = Array.isArray(v) ? v : []; draw(); onChange(); });
    draw();
  }

  // Hintergrund-Tabs werden gedrosselt – beim Zurückkehren sofort prüfen.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  return { element, init, tick, next, hasRunning: () => timers.some(isRunning) };
}
