// Wecker für das Lernzeit-Widget (Hilfsmodul, kein eigenes Widget).
//
// Uhrzeiten gelten immer in Europe/Berlin (Wanduhr) – auch über die Zeitumstellung.
// Jeder Wecker wird wahlweise nur auf diesem Gerät oder für alle Geräte gespeichert:
//   'local/alarms'      { [id]: Wecker }   nur dieses Gerät
//   ctx.store 'alarms'  { [id]: Wecker }   wird synchronisiert (gelöschte als { deleted: true })
//   Wecker: { id, time: 'HH:MM', name, days: [1–7, Mo=1] (leer = einmalig), enabled, global, updatedAt }
// Was dieses Gerät mit einem Wecker vorhat, steht nur lokal in 'local/alarmState':
//   { [id]: { next, version, snoozeUntil?, missedAt? } }
// next ist der geplante Zeitpunkt. Stellt Ember beim Prüfen fest, dass er verstrichen ist,
// während Ember nicht offen war (oder schlief), gibt es statt Klingeln einmal einen Hinweis.
// Kein Export: globale Wecker liegen ohnehin im Sync, und der Plan ist geräteabhängig.
import { h, confirmButton } from '../core/dom.js';
import { load, save, subscribe } from '../core/storage.js';
import { zonedToUtc } from '../core/ical.js';
import { ring, dismiss } from '../core/ringer.js';
import { getAlertSettings } from '../core/alerts.js';

const TZ = 'Europe/Berlin';
const LOCAL_KEY = 'local/alarms';
const STATE_KEY = 'local/alarmState';
const ALIVE_GRACE = 3 * 60 * 1000;
const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short' });
const hhmm = t => timeFmt.format(t);

// Kalendertag in Berlin
function berlinDay(t) {
  const p = Object.fromEntries(partsFmt.formatToParts(t).map(x => [x.type, Number(x.value)]));
  return { y: p.year, mo: p.month, d: p.day };
}

// Nächster Zeitpunkt nach `after`, an dem der Wecker klingeln soll (null, wenn keiner).
export function nextOccurrence(alarm, after) {
  const [hours, minutes] = alarm.time.split(':').map(Number);
  const { y, mo, d } = berlinDay(after);
  for (let k = 0; k <= 8; k++) {
    const day = new Date(Date.UTC(y, mo - 1, d + k));
    const iso = day.getUTCDay() || 7;
    if (alarm.days?.length && !alarm.days.includes(iso)) continue;
    const t = zonedToUtc({ y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), h: hours, mi: minutes }, TZ);
    if (t > after) return t;
  }
  return null;
}

function daysLabel(days) {
  if (!days?.length) return 'Einmalig';
  const set = [...days].sort((a, b) => a - b);
  const key = set.join('');
  if (key === '1234567') return 'Täglich';
  if (key === '12345') return 'Mo–Fr';
  if (key === '67') return 'Wochenende';
  return set.map(d => DAY_NAMES[d - 1]).join(', ');
}

function untilLabel(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `in ${min} min`;
  const hours = Math.floor(min / 60);
  return hours < 24 ? `in ${hours} h ${min % 60} min` : `in ${Math.round(hours / 24)} Tagen`;
}

export function createAlarms({ ctx, onChange }) {
  let local = {};
  let global = {};
  let state = {};
  let editing = null; // id oder 'new'
  let lastTick = null;

  const element = h('div', { class: 'alarms' });
  const all = () => [...Object.values(global).filter(a => !a.deleted), ...Object.values(local)]
    .sort((a, b) => a.time.localeCompare(b.time));

  // ---------- Speichern ----------
  const saveState = async next => {
    state = next;
    await save(STATE_KEY, state);
  };
  const putAlarm = async alarm => {
    const record = { ...alarm, updatedAt: Date.now() };
    if (record.global) {
      global = { ...global, [record.id]: record };
      if (local[record.id]) { const { [record.id]: _, ...rest } = local; local = rest; await save(LOCAL_KEY, local); }
      await ctx.store.save('alarms', global);
    } else {
      local = { ...local, [record.id]: record };
      if (global[record.id]) { global = { ...global, [record.id]: { id: record.id, deleted: true, updatedAt: Date.now() } }; await ctx.store.save('alarms', global); }
      await save(LOCAL_KEY, local);
    }
    return record;
  };
  const removeAlarm = async alarm => {
    dismiss(`alarm-${alarm.id}`);
    if (alarm.global) {
      global = { ...global, [alarm.id]: { id: alarm.id, deleted: true, updatedAt: Date.now() } };
      await ctx.store.save('alarms', global);
    } else {
      const { [alarm.id]: _, ...rest } = local;
      local = rest;
      await save(LOCAL_KEY, local);
    }
    const { [alarm.id]: __, ...restState } = state;
    await saveState(restState);
    changed();
  };

  // Ein offenes Formular nicht durch Sync oder Ticks wegwischen
  const changed = () => { if (!editing) draw(); onChange(); };

  // Plan für einen Wecker neu berechnen (neu, bearbeitet, auf anderem Gerät geändert)
  const plan = (alarm, now = Date.now()) => ({ next: nextOccurrence(alarm, now), version: alarm.updatedAt });
  const due = s => s?.snoozeUntil ?? s?.next ?? null;

  // ---------- Ablauf ----------
  async function fired(alarm, at, missed) {
    const s = state[alarm.id] ?? {};
    const once = !alarm.days?.length;
    const nextPlan = once ? { next: null, version: alarm.updatedAt } : plan(alarm, Math.max(Date.now(), at));
    await saveState({ ...state, [alarm.id]: { ...nextPlan, missedAt: missed ? at : s.missedAt ?? null } });
    // Einmalige Wecker sind danach aus (ändert updatedAt → Plan wird nicht erneut berechnet, da aus)
    if (once && alarm.enabled) await putAlarm({ ...alarm, enabled: false });
    if (!missed) {
      const snooze = getAlertSettings().snooze ?? 5;
      ring({
        id: `alarm-${alarm.id}`,
        title: alarm.name || 'Wecker',
        text: `Wecker ${hhmm(at)}`,
        actions: [
          { label: 'Stopp', primary: true },
          { label: `Schlummern (${snooze} min)`, onClick: () => snoozeAlarm(alarm.id, snooze) },
        ],
      });
    }
    changed();
  }

  async function snoozeAlarm(id, minutes) {
    await saveState({ ...state, [id]: { ...(state[id] ?? {}), snoozeUntil: Date.now() + minutes * 60000 } });
    changed();
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const alive = lastTick !== null;
      lastTick = now;
      let dirty = false;
      const nextState = { ...state };
      for (const alarm of all()) {
        const s = state[alarm.id];
        if (!alarm.enabled) {
          // Geschlummert wird auch bei einmaligen (dann schon ausgeschalteten) Weckern
          if (s?.next) { nextState[alarm.id] = { ...s, next: null }; dirty = true; }
          continue;
        }
        if (!s || s.version !== alarm.updatedAt || (!s.next && !s.snoozeUntil)) {
          nextState[alarm.id] = { ...plan(alarm, now), missedAt: s?.missedAt ?? null };
          dirty = true;
        }
      }
      if (dirty) await saveState(nextState);
      for (const alarm of all().filter(a => a.enabled || state[a.id]?.snoozeUntil)) {
        const s = state[alarm.id];
        const at = due(s);
        if (!at || at > now) continue;
        if (s.snoozeUntil) await saveState({ ...state, [alarm.id]: { ...s, snoozeUntil: null } });
        await fired(alarm, at, !alive || now - at > ALIVE_GRACE);
      }
      if (dirty) changed();
    } finally {
      ticking = false;
    }
  }

  // ---------- Anzeige ----------
  function form(alarm) {
    const time = h('input', { type: 'time', value: alarm.time ?? '07:00', required: true, 'aria-label': 'Uhrzeit' });
    const name = h('input', { type: 'text', value: alarm.name ?? '', maxlength: 40, placeholder: 'Name (optional)', 'aria-label': 'Name des Weckers' });
    let days = new Set(alarm.days ?? []);
    const dayButtons = DAY_NAMES.map((label, i) => {
      const b = h('button', { class: 'alarm-day', type: 'button', 'aria-pressed': String(days.has(i + 1)) }, label);
      b.addEventListener('click', () => {
        if (days.has(i + 1)) days.delete(i + 1); else days.add(i + 1);
        b.setAttribute('aria-pressed', String(days.has(i + 1)));
        hint.textContent = days.size ? daysLabel([...days]) : 'Einmalig – kein Tag gewählt';
      });
      return b;
    });
    const hint = h('span', { class: 'muted small' }, days.size ? daysLabel([...days]) : 'Einmalig – kein Tag gewählt');
    const scopeLocal = h('input', { type: 'radio', name: `scope-${alarm.id ?? 'new'}`, checked: !alarm.global });
    const scopeGlobal = h('input', { type: 'radio', name: `scope-${alarm.id ?? 'new'}`, checked: Boolean(alarm.global) });
    const el = h('form', { class: 'alarm-form' },
      h('div', { class: 'timer-hms' }, time, name),
      h('div', { class: 'alarm-days', role: 'group', 'aria-label': 'Wiederholen an' }, dayButtons),
      hint,
      h('div', { class: 'timer-hms' },
        h('label', { class: 'pomo-check' }, scopeLocal, 'Nur dieses Gerät'),
        h('label', { class: 'pomo-check' }, scopeGlobal, 'Alle Geräte (Sync)')),
      h('div', { class: 'timer-hms' },
        h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern'),
        h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; draw(); } }, 'Abbrechen')));
    el.addEventListener('submit', async event => {
      event.preventDefault();
      if (!/^\d{2}:\d{2}$/.test(time.value)) return;
      await putAlarm({ id: alarm.id ?? uid(), time: time.value, name: name.value.trim(), days: [...days].sort(), enabled: true, global: scopeGlobal.checked });
      editing = null;
      await tick();
      changed();
    });
    return el;
  }

  function draw() {
    const now = Date.now();
    const alarms = all();
    const missed = alarms.filter(a => state[a.id]?.missedAt);
    const rows = alarms.map(a => {
      if (editing === a.id) return h('li', {}, form(a));
      const s = state[a.id];
      const toggle = h('input', { type: 'checkbox', class: 'alarm-toggle', checked: Boolean(a.enabled), 'aria-label': `${a.name || a.time} ${a.enabled ? 'ausschalten' : 'einschalten'}` });
      toggle.addEventListener('change', async () => {
        if (!toggle.checked) {
          dismiss(`alarm-${a.id}`);
          await saveState({ ...state, [a.id]: { ...(state[a.id] ?? {}), snoozeUntil: null } });
        }
        await putAlarm({ ...a, enabled: toggle.checked });
        await tick();
        changed();
      });
      const when = s?.snoozeUntil ? `schlummert bis ${hhmm(s.snoozeUntil)}`
        : !a.enabled ? 'aus'
        : s?.next ? `${dayFmt.format(s.next)} · ${untilLabel(s.next - now)}` : '';
      return h('li', { class: `timer-row alarm-row${a.enabled ? '' : ' is-off'}` },
        h('label', { class: 'alarm-switch' }, toggle),
        h('div', { class: 'timer-info' },
          h('span', { class: 'alarm-time' }, a.time),
          h('span', { class: 'timer-name' }, [a.name, daysLabel(a.days), when].filter(Boolean).join(' · '))),
        h('div', { class: 'timer-actions' },
          h('span', { class: 'alarm-scope', title: a.global ? 'Auf allen Geräten (Sync)' : 'Nur auf diesem Gerät' }, a.global ? '🌐' : '📱'),
          s?.snoozeUntil ? h('button', { class: 'chip', type: 'button', onclick: async () => { await saveState({ ...state, [a.id]: { ...s, snoozeUntil: null } }); changed(); } }, 'Stopp') : null,
          h('button', { class: 'icon-btn icon-btn--xs', type: 'button', title: 'Bearbeiten', 'aria-label': `Wecker ${a.time} bearbeiten`, onclick: () => { editing = a.id; draw(); } }, '✎'),
          confirmButton({ class: 'icon-btn icon-btn--xs', title: 'Löschen', 'aria-label': `Wecker ${a.time} löschen` }, '×', 'Löschen?', () => removeAlarm(a))));
    });

    element.replaceChildren(...[
      h('p', { class: 'muted small alarm-note' }, 'Wecker klingeln nur, solange Ember in einem Tab geöffnet ist – auf dem iPad im Vordergrund und mit eingeschaltetem Bildschirm.'),
      ...missed.map(a => h('div', { class: 'alarm-missed', role: 'status' },
        h('span', {}, `Wecker ${a.name ? `„${a.name}“` : a.time} wurde um ${hhmm(state[a.id].missedAt)} verpasst.`),
        h('button', { class: 'chip', type: 'button', onclick: async () => { await saveState({ ...state, [a.id]: { ...state[a.id], missedAt: null } }); changed(); } }, 'OK'))),
      rows.length ? h('ul', { class: 'timer-list' }, rows) : editing !== 'new' && h('p', { class: 'muted' }, 'Noch kein Wecker.'),
      editing === 'new' ? form({}) : h('button', { class: 'chip', type: 'button', onclick: () => { editing = 'new'; draw(); } }, '+ Wecker'),
    ].filter(Boolean));
  }

  // Nächster Wecker für Kachelkopf und Tab-Titel
  const next = () => {
    const missed = all().find(a => state[a.id]?.missedAt);
    if (missed) return { ms: Infinity, badge: '⚠︎ Wecker verpasst', title: `⚠︎ Wecker ${missed.name || missed.time} verpasst` };
    const soonest = all().filter(a => (a.enabled || state[a.id]?.snoozeUntil) && due(state[a.id])).sort((a, b) => due(state[a.id]) - due(state[b.id]))[0];
    if (!soonest) return null;
    const at = due(state[soonest.id]);
    const icon = state[soonest.id].snoozeUntil ? '💤' : '⏰';
    // Nicht heute? Dann mit Wochentag, z. B. „⏰ Fr 07:00“
    const today = berlinDay(Date.now());
    const day = berlinDay(at);
    const when = day.d === today.d && day.mo === today.mo ? hhmm(at) : `${dayFmt.format(at)} ${hhmm(at)}`;
    return { ms: at - Date.now(), badge: `${icon} ${when}`, title: `${icon} ${when}${soonest.name ? ` ${soonest.name}` : ''}` };
  };

  async function init() {
    const l = await load(LOCAL_KEY, {});
    const s = await load(STATE_KEY, {});
    const g = await ctx.store.load('alarms', {});
    local = l && typeof l === 'object' ? l : {};
    state = s && typeof s === 'object' ? s : {};
    global = g && typeof g === 'object' ? g : {};
    // Andere Tabs bzw. Geräte (Sync)
    subscribe(LOCAL_KEY, v => { local = v ?? {}; changed(); });
    subscribe(STATE_KEY, v => { state = v ?? {}; changed(); });
    ctx.store.subscribe('alarms', v => { global = v ?? {}; changed(); });
    draw();
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  // Klingelt in den nächsten Stunden ein Wecker? (für „Bildschirm anlassen“)
  const soonWithin = ms => { const n = next(); return Boolean(n && n.ms !== Infinity && n.ms <= ms); };

  // Neu zeichnen, außer während ein Formular offen ist
  const refresh = () => { if (!editing) draw(); };

  return { element, init, tick, next, soonWithin, refresh };
}
