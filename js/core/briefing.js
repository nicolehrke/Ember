// Briefing-Satz neben der Uhr – regelbasiert, ohne KI.
//
// Widgets melden Kennzahlen mit setFact(key, wert) (null = nichts zu melden):
//   timetable { current?: { title, end }, next?: { title, start } }
//   mensa     { dish, until? }          Gericht heute, „geöffnet bis …“
//   study     { today, week }           gelernte Zeit in ms
//   exams     { name, text }            nächste Klausur, z. B. „in 12 Tagen“
//   shopping  { open }                  offene Einträge
//   todos     { due, overdue }          heute fällig bzw. überfällig
// Pro Tageszeit gibt es mehrere Vorlagen; gewählt wird beim Phasenwechsel und beim Laden,
// nie dieselbe wie zuletzt. Läuft Pomodoro oder ein Timer, zeigt setFocus() den Fokus-Satz
// und schaltet <html data-mode="fokus">.
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

// Vorlagen je Phase (0 Morgen, 1 Tag, 2 Nachmittag, 3 Abend, 4 Nacht).
// Jede gibt Satzteile zurück oder null, wenn ihr die Daten fehlen.
const TEMPLATES = [
  [
    ['m-next', f => (f.timetable?.next && isToday(f.timetable.next.start)
      ? ['Heute als Nächstes ', hl(`${f.timetable.next.title} ${when(f.timetable.next.start)}`), '.', ...todoHint(f)] : null)],
    ['m-todo', f => (f.todos?.due ? ['Guten Start.', ...todoHint(f), ...examHint(f)] : null)],
    ['m-exam', f => (f.exams ? ['Ein neuer Tag.', ...examHint(f), ...listHint(f)] : null)],
    ['m-a', f => ['Ein ruhiger Morgen. Was steht heute an?', ...listHint(f)]],
    ['m-b', f => ['Guten Morgen. Ein Schritt nach dem anderen.', ...todoHint(f)]],
  ],
  [
    ['d-mensa', f => (f.mensa ? ['In der Mensa gibt es ', hl(f.mensa.dish), f.mensa.until ? `, ${f.mensa.until}.` : '.', ...studied(f)] : null)],
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
    ['a-exam', f => (f.exams ? ['Ein guter Nachmittag zum Wiederholen:', ...examHint(f)] : null)],
    ['a-list', f => (f.shopping?.open ? ['Auf dem Heimweg einkaufen?', ...listHint(f)] : null)],
    ['a-a', f => ['Der Nachmittag gehört dir.', ...studied(f), ...todoHint(f)]],
    ['a-b', f => ['Kurz durchatmen, dann weiter.', ...listHint(f)]],
  ],
  [
    ['e-day', f => (f.study?.today >= 60000
      ? ['Das war ein guter Tag mit ', hl(dur(f.study.today)), ' Lernzeit.', ...(f.timetable?.next ? [' Weiter geht es ', hl(`${when(f.timetable.next.start)} mit ${f.timetable.next.title}`), '.'] : [])] : null)],
    ['e-next', f => (f.timetable?.next
      ? ['Für morgen vormerken: ', hl(`${f.timetable.next.title} ${when(f.timetable.next.start)}`), '.', ...todoHint(f)] : null)],
    ['e-todo', f => (f.todos?.due
      ? ['Noch offen für heute: ', hl(count(f.todos.due, 'Aufgabe', 'Aufgaben')), f.todos.overdue ? `, ${f.todos.overdue} davon überfällig.` : '.', ' Oder es darf bis morgen warten.'] : null)],
    ['e-a', f => ['Der Abend ist da. Zeit, den Tag abzuschließen.', ...listHint(f)]],
    ['e-b', f => ['Feierabend in Sicht.', ...examHint(f)]],
  ],
  [
    ['n-next', f => (f.timetable?.next
      ? ['Zeit für Ruhe. ', when(f.timetable.next.start).replace(/^./, c => c.toUpperCase()), ' geht es mit ', hl(f.timetable.next.title), ' weiter.'] : null)],
    ['n-week', f => (f.study?.week ? ['Gute Nacht. Diese Woche hast du ', hl(dur(f.study.week)), ' gelernt.'] : null)],
    ['n-a', () => ['Zeit für Ruhe. Morgen ist auch noch ein Tag.']],
    ['n-b', () => ['Spät geworden. Schlaf gut.']],
  ],
];

function render(parts) {
  if (!target) return;
  const nodes = parts.filter(p => p != null && p !== '').map(p => (typeof p === 'string' ? p : h('span', { class: 'hl' }, p.hl)));
  target.replaceChildren(...nodes);
}

const GENERIC = /-[abc]$/;

function pick(index) {
  // Vorlagen mit Daten haben Vorrang vor den allgemeinen.
  const usable = TEMPLATES[index].filter(([id, fn]) => id !== last && fn(facts));
  const specific = usable.filter(([id]) => !GENERIC.test(id));
  const options = specific.length ? specific : usable;
  const [id] = options[Math.floor(Math.random() * options.length)] ?? TEMPLATES[index].at(-1);
  chosen = { phase: index, id };
  last = id;
  save(LAST_KEY, id);
}

function draw() {
  if (focus) {
    render(['Fokus', ...(focus.subject ? [' auf ', hl(focus.subject)] : []), focus.detail ? `, ${focus.detail}.` : '.', ' Alles andere wartet.']);
    return;
  }
  const index = currentPhase()?.index ?? 1;
  // Gewählte Vorlage behalten, solange Phase und Daten passen; sonst eine andere wählen.
  let template = chosen?.phase === index && TEMPLATES[index].find(([id]) => id === chosen.id);
  // Kurz nach Laden/Phasenwechsel weichen allgemeine Sätze, sobald Daten für eine konkrete Vorlage da sind.
  const generic = template && Date.now() < upgradeUntil && GENERIC.test(template[0]) && TEMPLATES[index].some(([id, fn]) => !GENERIC.test(id) && fn(facts));
  if (!template || generic || !template[1](facts)) {
    pick(index);
    template = TEMPLATES[index].find(([id]) => id === chosen.id);
  }
  render(template[1](facts));
}

// Schwankende Werte (laufende Lernzeit) lösen höchstens alle paar Sekunden ein Neuzeichnen aus.
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; draw(); }, 300);
}

export function setFact(key, value) {
  if (JSON.stringify(facts[key] ?? null) === JSON.stringify(value ?? null)) return;
  if (value == null) delete facts[key];
  else facts[key] = value;
  schedule();
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
  // Kurz warten, bis die Widgets ihre ersten Kennzahlen gemeldet haben.
  setTimeout(draw, 1200);
}
