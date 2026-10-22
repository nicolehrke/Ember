// Widget „Klausuren“: Countdown bis zu den nächsten Klausuren mit der bisher
// gelernten Zeit pro Fach (aus dem Lernzeit-Widget).
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   list: { [id]: { id, subjectId, date: 'YYYY-MM-DD', time: 'HH:MM' | '', location, note, updatedAt, deleted? } }
// Fächer kommen aus der gemeinsamen Liste 'study.subjects' (Lernzeit-Widget).
// Datumsrechnung nach Europe/Berlin: Tage zählen als Kalendertage; Stunden
// werden in Wanduhrzeit gerechnet, damit die Zeitumstellung nichts verschiebt.
import { h, confirmButton } from '../core/dom.js';
import { load, save, subscribe } from '../core/storage.js';
import { COLORS } from './study.js';

const SUBJECTS_KEY = 'study.subjects';
const SESSIONS_KEY = 'study.sessions';
const DAY = 86400000;
const HOUR = 3600000;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- Datum und Zeit in Europe/Berlin ----------
const berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
function berlinNow(t = Date.now()) {
  const p = Object.fromEntries(berlinParts.formatToParts(t).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
// Wanduhrzeit als „naive“ UTC-Zahl – Differenzen sind so frei von Zeitumstellungen.
const wall = (date, time = '00:00') => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
const calendarDays = (from, to) => Math.round((wall(to) - wall(from)) / DAY);
const addDays = (date, n) => new Date(wall(date) + n * DAY).toISOString().slice(0, 10);

const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pad = n => String(n).padStart(2, '0');
function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}:${pad(min % 60)} h`;
}

// Zustand und Countdown-Text einer Klausur relativ zu jetzt.
export function countdownFor(exam, t = Date.now()) {
  const now = berlinNow(t);
  const days = calendarDays(now.date, exam.date);
  if (days < 0 || (days === 0 && exam.time && exam.time <= now.time)) {
    const ago = -days;
    return { past: true, days, text: ago === 0 ? 'heute' : ago === 1 ? 'gestern' : `vor ${ago} Tagen` };
  }
  if (days >= 7) return { past: false, days, text: `in ${days} Tagen` };
  if (!exam.time) return { past: false, days, text: days === 0 ? 'heute' : days === 1 ? 'morgen' : `in ${days} Tagen` };

  // Unter einer Woche mit Uhrzeit: Tage und Stunden in Wanduhrzeit
  const diff = wall(exam.date, exam.time) - wall(now.date, now.time);
  const d = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const minutes = Math.floor((diff % HOUR) / 60000);
  let text;
  if (d > 0) text = `in ${plural(d, 'Tag', 'Tagen')}, ${hours} Std`;
  else if (hours > 0) text = `in ${hours} Std ${minutes} min`;
  else text = `in ${plural(minutes, 'Minute', 'Minuten')}`;
  return { past: false, days, text };
}

export default {
  id: 'exams',
  title: 'Klausuren',

  async render(container, ctx) {
    let exams = await ctx.store.load('list', {});
    let subjects = await load(SUBJECTS_KEY, {});
    let sessions = await load(SESSIONS_KEY, {});
    let editing = null; // id der bearbeiteten Klausur oder 'new'
    let pastOpen = false; // Bereich „Vergangen“ bleibt beim Neuzeichnen auf/zu

    const listEl = h('div', { class: 'exam-list' });
    const formSlot = h('div', { class: 'exam-form-slot' });
    container.append(formSlot, listEl);
    ctx.addAction('+ Klausur', () => { editing = editing === 'new' ? null : 'new'; draw(); }, 'Klausur hinzufügen');

    const activeSubjects = () => Object.values(subjects).filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const subjectOf = id => subjects[id] ?? { name: 'Unbekanntes Fach', color: '#a3a097' };

    // Lernzeit pro Fach: gesamt und in den letzten 7 Kalendertagen (inkl. heute)
    const studied = subjectId => {
      const from = wall(addDays(berlinNow().date, -6));
      let total = 0;
      let week = 0;
      for (const s of Object.values(sessions)) {
        if (s.deleted || s.subjectId !== subjectId) continue;
        const ms = s.end - s.start - (s.pause ?? 0);
        total += ms;
        const day = berlinNow(s.start).date;
        if (wall(day) >= from) week += ms;
      }
      return { total, week };
    };

    const putExam = async exam => {
      exams = { ...exams, [exam.id]: { ...exam, updatedAt: Date.now() } };
      await ctx.store.save('list', exams);
    };

    // ---------- Formular ----------
    const examForm = exam => {
      const subject = h('select', { class: 'select', 'aria-label': 'Fach', required: true },
        h('option', { value: '' }, 'Fach wählen …'),
        ...activeSubjects().map(s => h('option', { value: s.id }, s.name)),
        h('option', { value: '__new' }, '+ Neues Fach …'));
      subject.value = exam.subjectId && subjects[exam.subjectId] && !subjects[exam.subjectId].deleted ? exam.subjectId : '';
      const newSubject = h('input', { type: 'text', placeholder: 'Name des neuen Fachs', 'aria-label': 'Name des neuen Fachs', maxlength: 40, hidden: true });
      subject.addEventListener('change', () => {
        newSubject.hidden = subject.value !== '__new';
        if (!newSubject.hidden) newSubject.focus();
      });
      const today = berlinNow().date;
      const date = h('input', { type: 'date', value: exam.date ?? '', min: today, required: true, 'aria-label': 'Datum' });
      const time = h('input', { type: 'time', value: exam.time ?? '', 'aria-label': 'Uhrzeit (optional)' });
      const location = h('input', { type: 'text', value: exam.location ?? '', placeholder: 'Ort (optional)', 'aria-label': 'Ort', maxlength: 80 });
      const note = h('input', { type: 'text', value: exam.note ?? '', placeholder: 'Notiz (optional)', 'aria-label': 'Notiz', maxlength: 200 });
      const error = h('p', { class: 'settings-error' });
      const submit = h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern');
      let pastConfirmed = false;
      // Eine Änderung am Datum hebt die Bestätigung für ein vergangenes Datum wieder auf.
      date.addEventListener('input', () => { pastConfirmed = false; submit.textContent = 'Speichern'; error.textContent = ''; });

      const form = h('form', { class: 'study-form exam-form', novalidate: true },
        h('div', { class: 'study-form-row' }, subject, newSubject),
        h('div', { class: 'study-form-row' }, date, time),
        h('div', { class: 'study-form-row' }, location),
        h('div', { class: 'study-form-row' }, note),
        error,
        h('div', { class: 'study-form-row' }, submit,
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; draw(); } }, 'Abbrechen')));

      form.addEventListener('submit', async event => {
        event.preventDefault();
        let subjectId = subject.value;
        if (subjectId === '__new' && !newSubject.value.trim()) return void (error.textContent = 'Bitte einen Namen für das neue Fach eingeben.');
        if (!subjectId) return void (error.textContent = 'Bitte ein Fach wählen.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return void (error.textContent = 'Bitte ein Datum wählen.');
        // Vergangenes Datum nur nach ausdrücklicher Bestätigung
        if (date.value < berlinNow().date && !pastConfirmed) {
          pastConfirmed = true;
          error.textContent = 'Das Datum liegt in der Vergangenheit. Trotzdem speichern?';
          submit.textContent = 'Trotzdem speichern';
          return;
        }
        if (subjectId === '__new') {
          // Neues Fach in der gemeinsamen Liste anlegen (erscheint auch im Lerntimer)
          const used = activeSubjects().map(s => s.color);
          const fresh = { id: uid(), name: newSubject.value.trim(), color: COLORS.find(c => !used.includes(c)) ?? COLORS[activeSubjects().length % COLORS.length], updatedAt: Date.now() };
          subjects = { ...subjects, [fresh.id]: fresh };
          await save(SUBJECTS_KEY, subjects);
          subjectId = fresh.id;
        }
        await putExam({ ...exam, id: exam.id ?? uid(), subjectId, date: date.value, time: time.value, location: location.value.trim(), note: note.value.trim() });
        editing = null;
        draw();
      });
      return form;
    };

    // ---------- Anzeige ----------
    const examItem = (exam, { next = false } = {}) => {
      if (editing === exam.id) return h('li', {}, examForm(exam));
      const subject = subjectOf(exam.subjectId);
      const c = countdownFor(exam);
      const { total, week } = studied(exam.subjectId);
      return h('li', { class: `exam${next ? ' is-next' : ''}${c.past ? ' is-past' : ''}`, style: `--subject:${subject.color}` },
        h('div', { class: 'exam-head' },
          h('span', { class: 'dot', style: `background:${subject.color}` }),
          h('span', { class: 'exam-subject' }, subject.name),
          h('span', { class: 'exam-countdown' }, c.text)),
        h('div', { class: 'exam-meta muted' },
          [dateFmt.format(wall(exam.date)), exam.time && `${exam.time} Uhr`, exam.location].filter(Boolean).join(' · ')),
        exam.note && h('div', { class: 'exam-note' }, exam.note),
        h('div', { class: 'exam-foot' },
          h('span', { class: 'exam-studied muted' }, `Gelernt: ${duration(total)} gesamt · ${duration(week)} letzte 7 Tage`),
          h('span', { class: 'exam-actions' },
            h('button', { class: 'icon-btn icon-btn--xs', type: 'button', title: 'Bearbeiten', 'aria-label': `Klausur ${subject.name} bearbeiten`, onclick: () => { editing = exam.id; draw(); } }, '✎'),
            confirmButton({ class: 'icon-btn icon-btn--xs', title: 'Löschen', 'aria-label': `Klausur ${subject.name} löschen` }, '×', 'Löschen?', async () => {
              await putExam({ ...exam, deleted: true });
              draw();
            }))));
    };

    function draw() {
      formSlot.replaceChildren(...(editing === 'new' ? [examForm({})] : []));
      const all = Object.values(exams).filter(e => !e.deleted)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
      const upcoming = all.filter(e => !countdownFor(e).past);
      const past = all.filter(e => countdownFor(e).past).reverse();

      if (!all.length) {
        listEl.replaceChildren(...(editing === 'new' ? [] : [h('p', { class: 'exam-empty muted' },
          'Noch keine Klausur angelegt. ',
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = 'new'; draw(); } }, '+ Klausur hinzufügen'))]));
        return;
      }

      listEl.replaceChildren(...[
        upcoming.length
          ? h('ul', { class: 'exam-items' }, upcoming.map((e, i) => examItem(e, { next: i === 0 })))
          : h('p', { class: 'muted' }, 'Keine anstehenden Klausuren.'),
        past.length > 0 && h('details', {
          class: 'exam-past',
          open: pastOpen || past.some(e => e.id === editing),
          ontoggle: event => { pastOpen = event.target.open; },
        },
        h('summary', {}, `Vergangen (${past.length})`),
        h('ul', { class: 'exam-items' }, past.map(e => examItem(e)))),
      ].filter(Boolean));
    }

    // Änderungen anderer Geräte bzw. Widgets übernehmen (Fächer, Lernzeit)
    const isEditing = () => editing && container.contains(document.activeElement);
    ctx.store.subscribe('list', v => { exams = v ?? {}; if (!isEditing()) draw(); });
    ctx.onCleanup(subscribe(SUBJECTS_KEY, v => { subjects = v ?? {}; if (!isEditing()) draw(); }));
    ctx.onCleanup(subscribe(SESSIONS_KEY, v => { sessions = v ?? {}; if (!isEditing()) draw(); }));
    ctx.every(60 * 1000, () => { if (!isEditing()) draw(); });

    draw();
  },
};
