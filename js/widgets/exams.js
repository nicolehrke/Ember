// Widget „Klausuren“: Countdown bis zu den nächsten Klausuren mit der bisher
// gelernten Zeit pro Fach (aus dem Lernzeit-Widget). Sitzt als Chip 🎓 in der
// Kopfleiste und öffnet sich als Seitenleiste; der Chip kann die Tage bis zur
// nächsten Klausur zeigen (Einstellung pro Gerät in ctx.cache 'showDays').
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   list: { [id]: { id, subjectId, date: 'YYYY-MM-DD', time: 'HH:MM' | '', location, note,
//                   date2?, time2?, location2?, chosen?: null | 1 | 2, updatedAt, deleted? } }
//         Optionaler 2. Termin: Solange chosen leer ist, werden beide angezeigt.
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

const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const HIGHLIGHT_DAYS = 14;

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

// Termine einer Klausur; ist einer gewählt, zählt nur dieser.
export function termsOf(exam) {
  const all = [{ n: 1, date: exam.date, time: exam.time ?? '', location: exam.location ?? '' }];
  if (exam.date2) all.push({ n: 2, date: exam.date2, time: exam.time2 ?? '', location: exam.location2 ?? '' });
  if (all.length > 1 && (exam.chosen === 1 || exam.chosen === 2)) return { all, active: [all[exam.chosen - 1]], undecided: false };
  return { all, active: all, undecided: all.length > 1 };
}

// Maßgeblich ist der nächste noch anstehende Termin, sonst der letzte.
export function statusOf(exam, t = Date.now()) {
  const { active } = termsOf(exam);
  const upcoming = active.find(term => !countdownFor(term, t).past);
  const term = upcoming ?? active[active.length - 1];
  return { term, countdown: countdownFor(term, t), past: !upcoming };
}

// Nächste Klausur über alle Fächer: früheste noch anstehende Termin-Variante
// (gewählter Termin bzw. bei „noch offen“ der frühere noch anstehende).
export function nextExam(exams, t = Date.now()) {
  let best = null;
  for (const exam of Object.values(exams)) {
    if (exam.deleted) continue;
    const status = statusOf(exam, t);
    if (status.past) continue;
    const key = wall(status.term.date, status.term.time || '00:00');
    if (!best || key < best.key) best = { exam, ...status, key };
  }
  return best;
}

// Kurzform für den Chip: „107 Tage“, unter einer Woche „4 Tage 18 Std“.
export function chipCountdown(term, t = Date.now()) {
  const now = berlinNow(t);
  const days = calendarDays(now.date, term.date);
  if (days >= 7) return `${days} Tage`;
  if (!term.time) return days === 0 ? 'heute' : days === 1 ? 'morgen' : `${days} Tage`;
  const diff = wall(term.date, term.time) - wall(now.date, now.time);
  const d = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const minutes = Math.floor((diff % HOUR) / 60000);
  if (d > 0) return `${plural(d, 'Tag', 'Tage')} ${hours} Std`;
  if (hours > 0) return `${hours} Std ${minutes} min`;
  return `${minutes} min`;
}

const termLine = term => [dateFmt.format(wall(term.date)), term.time && `${term.time} Uhr`, term.location].filter(Boolean).join(' · ');

export default {
  id: 'exams',
  title: 'Klausuren',
  icon: '🎓',
  placement: 'drawer',

  async render(container, ctx) {
    let exams = await ctx.store.load('list', {});
    let subjects = await load(SUBJECTS_KEY, {});
    let sessions = await load(SESSIONS_KEY, {});
    let editing = null; // id der bearbeiteten Klausur oder 'new'
    let pastOpen = false; // Bereich „Vergangen“ bleibt beim Neuzeichnen auf/zu

    let showDays = await ctx.cache.load('showDays', true);

    const listEl = h('div', { class: 'exam-list' });
    const formSlot = h('div', { class: 'exam-form-slot' });
    // Nächste Klausur als Text (für das iPad, wo es keine Tooltips gibt) und Chip-Einstellung
    const summary = h('p', { class: 'exam-summary' });
    const showDaysInput = h('input', { type: 'checkbox', checked: showDays });
    showDaysInput.addEventListener('change', async () => {
      showDays = showDaysInput.checked;
      await ctx.cache.save('showDays', showDays);
      updateChip();
    });
    container.append(summary,
      h('label', { class: 'pomo-check exam-setting' }, showDaysInput, 'Tage bis zur nächsten Klausur im Chip anzeigen (dieses Gerät)'),
      formSlot, listEl);

    // Chip in der Kopfleiste und Zusammenfassung oben in der Ansicht
    function updateChip() {
      const next = nextExam(exams);
      if (!next) {
        summary.textContent = 'Keine anstehende Klausur.';
        ctx.setBadge('', { title: 'Klausuren – keine anstehende Klausur' });
        return;
      }
      const name = subjectOf(next.exam.subjectId).name;
      const soon = next.countdown.days <= HIGHLIGHT_DAYS;
      const text = `Nächste Klausur: ${name} ${next.countdown.text} (${dateFmt.format(wall(next.term.date))}${next.term.time ? `, ${next.term.time} Uhr` : ''})`;
      const hint = soon ? ` – hervorgehoben, weil es weniger als ${HIGHLIGHT_DAYS} Tage sind` : '';
      summary.textContent = `${text}${hint}.`;
      summary.classList.toggle('is-soon', soon);
      ctx.setBadge(showDays ? chipCountdown(next.term) : '', { highlight: soon, title: `${text}${hint}` });
    }
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
      // Optionaler 2. Termin
      const hasSecond = h('input', { type: 'checkbox', checked: Boolean(exam.date2) });
      const date2 = h('input', { type: 'date', value: exam.date2 ?? '', min: today, 'aria-label': 'Datum 2. Termin' });
      const time2 = h('input', { type: 'time', value: exam.time2 ?? '', 'aria-label': 'Uhrzeit 2. Termin (optional)' });
      const location2 = h('input', { type: 'text', value: exam.location2 ?? '', placeholder: 'Ort 2. Termin (optional)', 'aria-label': 'Ort 2. Termin', maxlength: 80 });
      const chosen = h('select', { class: 'select', 'aria-label': 'Welchen Termin schreibst du?' },
        h('option', { value: '' }, 'Noch nicht entschieden'),
        h('option', { value: '1' }, 'Ich schreibe den 1. Termin'),
        h('option', { value: '2' }, 'Ich schreibe den 2. Termin'));
      chosen.value = exam.chosen ? String(exam.chosen) : '';
      const second = h('div', { class: 'exam-second', hidden: !exam.date2 },
        h('div', { class: 'study-form-row' }, date2, time2),
        h('div', { class: 'study-form-row' }, location2),
        h('div', { class: 'study-form-row' }, chosen));
      hasSecond.addEventListener('change', () => {
        second.hidden = !hasSecond.checked;
        if (hasSecond.checked) date2.focus();
      });
      const error = h('p', { class: 'settings-error' });
      const submit = h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern');
      let pastConfirmed = false;
      // Eine Änderung am Datum hebt die Bestätigung für ein vergangenes Datum wieder auf.
      for (const input of [date, date2]) input.addEventListener('input', () => { pastConfirmed = false; submit.textContent = 'Speichern'; error.textContent = ''; });

      const form = h('form', { class: 'study-form exam-form', novalidate: true },
        h('div', { class: 'study-form-row' }, subject, newSubject),
        h('div', { class: 'study-form-row' }, date, time),
        h('div', { class: 'study-form-row' }, location),
        h('div', { class: 'study-form-row' }, note),
        h('label', { class: 'pomo-check' }, hasSecond, '2. Termin (noch nicht entschieden, wann ich schreibe)'),
        second,
        error,
        h('div', { class: 'study-form-row' }, submit,
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; draw(); } }, 'Abbrechen')));

      form.addEventListener('submit', async event => {
        event.preventDefault();
        let subjectId = subject.value;
        if (subjectId === '__new' && !newSubject.value.trim()) return void (error.textContent = 'Bitte einen Namen für das neue Fach eingeben.');
        if (!subjectId) return void (error.textContent = 'Bitte ein Fach wählen.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return void (error.textContent = 'Bitte ein Datum wählen.');
        const withSecond = hasSecond.checked;
        if (withSecond && !/^\d{4}-\d{2}-\d{2}$/.test(date2.value)) return void (error.textContent = 'Bitte ein Datum für den 2. Termin wählen.');
        if (withSecond && `${date2.value}T${time2.value || '00:00'}` <= `${date.value}T${time.value || '00:00'}`) {
          return void (error.textContent = 'Der 2. Termin muss nach dem 1. Termin liegen.');
        }
        // Vergangenes Datum nur nach ausdrücklicher Bestätigung
        const todayNow = berlinNow().date;
        if ((date.value < todayNow || (withSecond && date2.value < todayNow)) && !pastConfirmed) {
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
        await putExam({
          ...exam, id: exam.id ?? uid(), subjectId,
          date: date.value, time: time.value, location: location.value.trim(), note: note.value.trim(),
          date2: withSecond ? date2.value : '',
          time2: withSecond ? time2.value : '',
          location2: withSecond ? location2.value.trim() : '',
          chosen: withSecond && chosen.value ? Number(chosen.value) : null,
        });
        editing = null;
        draw();
      });
      return form;
    };

    // ---------- Anzeige ----------
    const examItem = (exam, { next = false } = {}) => {
      if (editing === exam.id) return h('li', {}, examForm(exam));
      const subject = subjectOf(exam.subjectId);
      const status = statusOf(exam);
      const { all, active, undecided } = termsOf(exam);
      const { total, week } = studied(exam.subjectId);
      const choose = n => putExam({ ...exam, chosen: n });

      let terms;
      if (undecided) {
        // Beide Termine mit eigenem Countdown, darunter die Entscheidung
        terms = [
          h('ul', { class: 'exam-terms' }, all.map(term => {
            const c = countdownFor(term);
            return h('li', { class: `exam-term${c.past ? ' is-past' : ''}` },
              h('span', { class: 'exam-term-label' }, `${term.n}. Termin`),
              h('span', { class: 'exam-term-when muted' }, termLine(term)),
              h('span', { class: 'exam-term-countdown' }, c.past ? 'vorbei' : c.text));
          })),
          h('div', { class: 'exam-decide' },
            h('span', { class: 'muted' }, 'Noch nicht entschieden'),
            ...all.filter(term => !countdownFor(term).past).map(term =>
              h('button', { class: 'chip', type: 'button', onclick: () => choose(term.n) }, `${term.n}. Termin schreiben`))),
        ];
      } else {
        const term = active[0];
        terms = [h('div', { class: 'exam-meta muted' },
          all.length > 1 && h('span', { class: 'exam-term-label' }, `${term.n}. Termin · `),
          termLine(term),
          all.length > 1 && h('button', { class: 'link-btn', type: 'button', title: 'Entscheidung zurücksetzen', onclick: () => choose(null) }, 'ändern'))];
      }

      return h('li', { class: `exam${next ? ' is-next' : ''}${status.past ? ' is-past' : ''}`, style: `--subject:${subject.color}` },
        h('div', { class: 'exam-head' },
          h('span', { class: 'dot', style: `background:${subject.color}` }),
          h('span', { class: 'exam-subject' }, subject.name),
          h('span', { class: 'exam-countdown' }, status.countdown.text)),
        ...terms,
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
      updateChip();
      formSlot.replaceChildren(...(editing === 'new' ? [examForm({})] : []));
      const key = e => { const { term } = statusOf(e); return `${term.date}T${term.time || '99'}`; };
      const all = Object.values(exams).filter(e => !e.deleted).sort((a, b) => key(a).localeCompare(key(b)));
      const upcoming = all.filter(e => !statusOf(e).past);
      const past = all.filter(e => statusOf(e).past).reverse();

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
    ctx.every(60 * 1000, () => { if (!isEditing()) draw(); else updateChip(); });

    draw();
  },
};
