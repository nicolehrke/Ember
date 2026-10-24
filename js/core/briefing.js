// Briefing-Satz neben der Uhr – regelbasiert, ohne KI.
//
// Widgets melden Kennzahlen mit setFact(key, wert) (null = nichts zu melden):
//   timetable { current?: { title, end }, next?: { title, start } }
//   mensa     { dish, until? }          Gericht heute, „geöffnet bis …“
//   study     { today, week }           gelernte Zeit in ms
//   exams     { name, text }            nächste Klausur, z. B. „in 12 Tagen“
//   shopping  { open }                  offene Einträge
//   todos     { due, overdue }          heute fällig bzw. überfällig
//   weather   { kind, max, min, rain, wind }  nur bei relevanter Lage: kind 'rain' | 'frost' | 'hot' | 'wind'
//   rezept    { title }                 Rezeptvorschlag des Tages (wie in der Mensa-Kachel)
// Pro Tageszeit gibt es mehrere Vorlagen; gewählt wird beim Phasenwechsel und beim Laden,
// nie dieselbe wie zuletzt. Ändert sich ein Fakt spürbar (Termin, Aufgaben, Wetterlage, Vorschlag),
// darf eine Vorlage, die ihn nutzt, den Satz sofort ersetzen; ohne Anlass wechselt er alle 30–45 min.
// Läuft Pomodoro oder ein Timer, zeigt setFocus() den Fokus-Satz und schaltet <html data-mode="fokus">.
import { load, save } from './storage.js';
import { h } from './dom.js';
import { currentPhase, onPhase } from './theme.js';

const LAST_KEY = 'local/briefing';
const facts = {};
let focus = null;
let target = null;
let chosen = null; // { phase, id }
let last = null;
let upgradeUntil = 0;
let shownId = null;
let shownKey = '';
let rotateTimer = null;
const changed = new Set(); // Fakten mit spürbarer Änderung seit dem letzten Zeichnen
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const pad = n => String(n).padStart(2, '0');
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });

function dur(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// „um 10:30“, „morgen um 10:30“, „am Freitag um 10:30“
function when(t) {
  const days = Math.round((dayStart(t) - dayStart(Date.now())) / 86400000);
  if (days === 0) return `um ${hhmm(t)}`;
  if (days === 1) return `morgen um ${hhmm(t)}`;
  return `am ${weekdayFmt.format(t)} um ${hhmm(t)}`;
}
const isToday = t => dayStart(t) === dayStart(Date.now());
const hl = text => ({ hl: text });

// Bausteine, die mehrere Vorlagen nutzen (leer, wenn die Daten fehlen)
const studied = f => (f.study?.today >= 60000 ? [' Du hast heute ', hl(dur(f.study.today)), ' gelernt.'] : []);
const examHint = f => (f.exams ? [' ', hl(f.exams.name), ` ${f.exams.text}.`] : []);
const listHint = f => (f.shopping?.open ? [' Auf der Einkaufsliste: ', hl(count(f.shopping.open, 'Eintrag', 'Einträge')), '.'] : []);
const todoHint = f => (f.todos?.due
  ? [' ', hl(count(f.todos.due, 'Aufgabe', 'Aufgaben')), f.todos.overdue ? ` offen, ${f.todos.overdue} davon überfällig.` : ' für heute.']
  : []);

const weatherHint = f => {
  const w = f.weather;
  switch (w?.kind) {
    case 'rain': return ['Heute ', hl('Regen'), ', nimm einen Schirm mit.'];
    case 'frost': return ['Heute ', hl('Frost'), ` (${w.min} °C), zieh dich warm an.`];
    case 'hot': return ['Heute bis ', hl(`${w.max} °C`), ', trink genug.'];
    case 'wind': return ['Heute windig, Wind bis ', hl(`${w.wind} km/h`), '.'];
    default: return null;
  }
};
const cookHint = f => (f.rezept ? ['Heute selbst kochen? ', hl(f.rezept.title)] : null);

// Vorlagen je Phase (0 Morgen, 1 Tag, 2 Nachmittag, 3 Abend, 4 Nacht).
// Jede gibt Satzteile zurück oder null, wenn ihr die Daten fehlen.
const TEMPLATES = [
  [
    ['m-next', f => (f.timetable?.next && isToday(f.timetable.next.start)
      ? ['Heute als Nächstes ', hl(`${f.timetable.next.title} ${when(f.timetable.next.start)}`), '.', ...todoHint(f)] : null)],
    ['m-wx', f => { const w = weatherHint(f); return w && [...w, ...todoHint(f)]; }],
    ['m-todo', f => (f.todos?.due ? ['Guten Start.', ...todoHint(f), ...examHint(f)] : null)],
    ['m-exam', f => (f.exams ? ['Ein neuer Tag.', ...examHint(f), ...listHint(f)] : null)],
    ['m-b', f => ['Guten Morgen. Ein Schritt nach dem anderen.', ...todoHint(f)]],
  ],
  [
    ['d-mensa', f => (f.mensa ? ['In der Mensa gibt es ', hl(f.mensa.dish), f.mensa.until ? `, ${f.mensa.until}.` : '.', ...studied(f)] : null)],
    ['d-wx', f => { const w = weatherHint(f); return w && [...w, ...studied(f)]; }],
    ['d-cook', f => { const c = cookHint(f); return c && [...c, ...studied(f)]; }],
    ['d-now', f => (f.timetable?.current
      ? ['Gerade läuft ', hl(f.timetable.current.title), `, noch bis ${hhmm(f.timetable.current.end)}.`, ...studied(f)] : null)],
    ['d-next', f => (f.timetable?.next && isToday(f.timetable.next.start)
      ? ['Als Nächstes ', hl(`${f.timetable.next.title} ${when(f.timetable.next.start)}`), '.', ...todoHint(f)] : null)],
    ['d-a', f => (f.study?.week ? ['Diese Woche stehen bei dir ', hl(dur(f.study.week)), ' Lernzeit.', ...examHint(f)] : null)],
    ['d-b', f => ['Mitten im Tag. Zeit für eine konzentrierte Runde?', ...studied(f)]],
    ['d-c', f => ['Gut unterwegs.', ...todoHint(f), ...listHint(f)]],
  ],
  [
    ['a-pomo', f => (f.study?.week ? ['Noch eine Runde Pomodoro? Diese Woche stehen bei dir ', hl(dur(f.study.week)), '.'] : null)],
    ['a-wx', f => { const w = weatherHint(f); return w && [...w, ...listHint(f)]; }],
    ['a-cook', f => { const c = cookHint(f); return c && [...c, ...listHint(f)]; }],
    ['a-exam', f => (f.exams ? ['Ein guter Nachmittag zum Wiederholen:', ...examHint(f)] : null)],
    ['a-list', f => (f.shopping?.open ? ['Auf dem Heimweg einkaufen?', ...listHint(f)] : null)],
    ['a-a', f => ['Der Nachmittag gehört dir.', ...studied(f), ...todoHint(f)]],
  ],
  [
    ['e-day', f => (f.study?.today >= 60000
      ? ['Das war ein guter Tag mit ', hl(dur(f.study.today)), ' Lernzeit.', ...(f.timetable?.next ? [' Weiter geht es ', hl(`${when(f.timetable.next.start)} mit ${f.timetable.next.title}`), '.'] : [])] : null)],
    ['e-next', f => (f.timetable?.next
      ? ['Für morgen vormerken: ', hl(`${f.timetable.next.title} ${when(f.timetable.next.start)}`), '.', ...todoHint(f)] : null)],
    ['e-cook', f => { const c = cookHint(f); return c && [...c, ...listHint(f)]; }],
    ['e-todo', f => (f.todos?.due
      ? ['Noch offen für heute: ', hl(count(f.todos.due, 'Aufgabe', 'Aufgaben')), f.todos.overdue ? `, ${f.todos.overdue} davon überfällig.` : '.', ' Oder es darf bis morgen warten.'] : null)],
    ['e-a', f => ['Der Abend ist da. Zeit, den Tag abzuschließen.', ...listHint(f)]],
  ],
  [
    ['n-next', f => (f.timetable?.next
      ? ['Zeit für Ruhe. ', when(f.timetable.next.start).replace(/^./, c => c.toUpperCase()), ' geht es mit ', hl(f.timetable.next.title), ' weiter.'] : null)],
    ['n-week', f => (f.study?.week ? ['Gute Nacht. Diese Woche hast du ', hl(dur(f.study.week)), ' gelernt.'] : null)],
    ['n-a', () => ['Zeit für Ruhe. Morgen ist auch noch ein Tag.']],
    ['n-b', () => ['Spät geworden. Schlaf gut.']],
  ],
];

// Fakten, bei denen eine Änderung spürbar ist (Lernzeit tickt dagegen laufend und zählt nicht).
const SIGNATURE = {
  timetable: v => [v?.current?.title, v?.next?.title, v?.next?.start],
  todos: v => [v?.due, v?.overdue],
  weather: v => v?.kind,
  rezept: v => v?.title,
  exams: v => v?.name,
  shopping: v => v?.open,
  mensa: v => v?.dish,
};
const signature = (key, value) => JSON.stringify(SIGNATURE[key]?.(value) ?? null);

// Welche Fakten eine Vorlage nutzt, ermittelt ein Probelauf mit mitschreibenden Fakten.
const usedKeys = fn => {
  const used = new Set();
  fn(new Proxy(facts, { get: (obj, key) => { used.add(key); return obj[key]; } }));
  return used;
};

function render(parts, id) {
  if (!target) return;
  const nodes = parts.filter(p => p != null && p !== '').map(p => (typeof p === 'string' ? p : h('span', { class: 'hl' }, p.hl)));
  const key = JSON.stringify(parts);
  if (key === shownKey) return;
  shownKey = key;
  const swap = id !== shownId && shownId != null && !reducedMotion.matches && target.firstChild && target.animate;
  shownId = id;
  target.getAnimations?.().forEach(a => a.cancel());
  if (!swap) {
    target.replaceChildren(...nodes);
    return;
  }
  // Ruhiger Wechsel: kurz ausblenden, Text tauschen, wieder einblenden.
  target.animate({ opacity: [1, 0] }, { duration: 180, easing: 'ease-out' }).finished.then(() => {
    target.replaceChildren(...nodes);
    target.animate({ opacity: [0, 1] }, { duration: 320, easing: 'ease-in' });
  }, () => {});
}

const GENERIC = /-[abc]$/;
const find = (index, id) => TEMPLATES[index].find(([tid]) => tid === id);

function choose(index, options) {
  // Datenreiche Vorlagen haben Vorrang vor den allgemeinen; die zuletzt gezeigte nur, wenn nichts anderes bleibt.
  const fresh = options.filter(([id]) => id !== last);
  const pool = fresh.length ? fresh : options;
  const specific = pool.filter(([id]) => !GENERIC.test(id));
  const list = specific.length ? specific : pool;
  const [id] = list[Math.floor(Math.random() * list.length)] ?? TEMPLATES[index].at(-1);
  chosen = { phase: index, id };
  last = id;
  save(LAST_KEY, id);
}

const pick = index => choose(index, TEMPLATES[index].filter(([, fn]) => fn(facts)));

function draw() {
  if (focus) {
    render(['Fokus', ...(focus.subject ? [' auf ', hl(focus.subject)] : []), focus.detail ? `, ${focus.detail}.` : '.', ' Alles andere wartet.'], 'focus');
    changed.clear();
    return;
  }
  const index = currentPhase()?.index ?? 1;
  const loading = Date.now() < upgradeUntil;
  // Gewählte Vorlage behalten, solange Phase und Daten passen; sonst eine andere wählen.
  let template = chosen?.phase === index && find(index, chosen.id);
  // Kurz nach Laden/Phasenwechsel weichen allgemeine Sätze, sobald Daten für eine konkrete Vorlage da sind.
  const generic = template && loading && GENERIC.test(template[0]) && TEMPLATES[index].some(([id, fn]) => !GENERIC.test(id) && fn(facts));
  // Spürbar geänderter Fakt: eine andere Vorlage, die ihn nutzt, darf den Satz sofort ersetzen.
  let upgrade = null;
  if (template && !loading && changed.size) {
    upgrade = TEMPLATES[index].filter(([id, fn]) => id !== template[0] && !GENERIC.test(id) && fn(facts)
      && [...changed].some(k => usedKeys(fn).has(k)));
  }
  changed.clear();
  if (upgrade?.length) choose(index, upgrade);
  else if (!template || generic || !template[1](facts)) pick(index);
  template = find(index, chosen.id);
  render(template[1](facts), template[0]);
}

// Ohne Anlass wechselt der Satz alle 30–45 Minuten (nicht während Fokus, nie dieselbe Vorlage).
function rotate() {
  clearTimeout(rotateTimer);
  rotateTimer = setTimeout(rotate, (30 + Math.random() * 15) * 60000);
  if (focus || !chosen) return;
  const index = currentPhase()?.index ?? 1;
  const others = TEMPLATES[index].filter(([id, fn]) => id !== chosen.id && fn(facts));
  if (others.length) { choose(index, others); draw(); }
}

// Schwankende Werte (laufende Lernzeit) lösen höchstens alle paar Sekunden ein Neuzeichnen aus;
// spürbare Änderungen werden etwas länger gesammelt, damit mehrere auf einmal nur einen Wechsel auslösen.
let timer = null;
let timerDelay = 0;
function schedule(delay) {
  if (timer && delay <= timerDelay) return;
  clearTimeout(timer);
  timerDelay = delay;
  timer = setTimeout(() => { timer = null; draw(); }, delay);
}

export function setFact(key, value) {
  if (JSON.stringify(facts[key] ?? null) === JSON.stringify(value ?? null)) return;
  const before = signature(key, facts[key]);
  if (value == null) delete facts[key];
  else facts[key] = value;
  const significant = before !== signature(key, value);
  if (significant) changed.add(key);
  schedule(significant ? 1500 : 300);
}

// info: { subject?, detail? } während Pomodoro/Timer laufen, sonst null.
export function setFocus(info) {
  const next = info ? JSON.stringify(info) : null;
  if (next === (focus ? JSON.stringify(focus) : null)) return;
  focus = info;
  document.documentElement.dataset.mode = info ? 'fokus' : 'ruhe';
  draw();
}

export async function initBriefing(element) {
  target = element;
  last = await load(LAST_KEY, null);
  document.documentElement.dataset.mode = 'ruhe';
  upgradeUntil = Date.now() + 20000;
  onPhase(() => { chosen = null; upgradeUntil = Date.now() + 20000; draw(); });
  rotateTimer = setTimeout(rotate, (30 + Math.random() * 15) * 60000);
  // Kurz warten, bis die Widgets ihre ersten Kennzahlen gemeldet haben.
  setTimeout(draw, 1200);
}
