// Widget „Lernzeit“: Start/Stopp-Timer mit Fächern, Tages-/Wochenübersicht,
// Einträge korrigieren/löschen, Export/Import als JSON.
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   subjects: { [id]: { id, name, color, updatedAt, deleted? } }
//   sessions: { [id]: { id, subjectId, start, end, updatedAt, deleted? } }  (Zeiten in ms)
//   running:  { start, subjectId } | null
// Gelöschte Einträge bleiben als { deleted: true } stehen, damit der Sync
// das Löschen an andere Geräte weitergeben kann.
import { h } from '../core/dom.js';

const COLORS = ['#c8553d', '#3c82cf', '#3c8a4a', '#8b62d0', '#d99a1f', '#2a9d8f', '#d65b8f', '#6b7a8f'];
const NO_SUBJECT = { id: '', name: 'Ohne Fach', color: '#a3a097' };
const MIN_SESSION = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const weekStart = t => { const d = new Date(dayStart(t)); return addDays(d, -((d.getDay() + 6) % 7)); };

const pad = n => String(n).padStart(2, '0');
const isoDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}:${pad(min % 60)} h`;
}

const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric' });
const rangeFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });

// Einträge zweier Sammlungen zusammenführen (neuere Änderung gewinnt).
function mergeRecords(a = {}, b = {}) {
  const result = { ...a };
  for (const [id, r] of Object.entries(b)) {
    if (r && typeof r.updatedAt === 'number' && (!result[id] || r.updatedAt > result[id].updatedAt)) result[id] = r;
  }
  return result;
}

export default {
  id: 'study',
  title: 'Lernzeit',
  size: 'wide',

  async render(container, ctx) {
    let subjects = await ctx.store.load('subjects', {});
    let sessions = await ctx.store.load('sessions', {});
    let running = await ctx.store.load('running', null);
    let lastSubject = await ctx.store.load('lastSubject', '');
    let week = weekStart(Date.now());
    let editing = null; // id des bearbeiteten Eintrags oder 'new'
    let flash = null; // kurzer Hinweis unter den Summen

    const activeSubjects = () => Object.values(subjects).filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const subjectOf = id => subjects[id] ?? NO_SUBJECT;
    const activeSessions = () => {
      const list = Object.values(sessions).filter(s => !s.deleted);
      if (running) list.push({ id: 'running', subjectId: running.subjectId, start: running.start, end: Date.now(), live: true });
      return list;
    };

    // ---------- Elemente ----------
    const subjectSelect = h('select', { class: 'select', 'aria-label': 'Fach' });
    const timeEl = h('span', { class: 'study-time' });
    const startStop = h('button', { class: 'study-btn', type: 'button' });
    const totals = h('p', { class: 'study-totals' });
    const weekLabel = h('span', { class: 'study-week' });
    const prevWeek = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Vorherige Woche' }, '‹');
    const nextWeek = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Nächste Woche' }, '›');
    const chart = h('div', { class: 'study-chart', role: 'img' });
    const legend = h('ul', { class: 'study-legend' });
    const entries = h('div', { class: 'study-entries' });
    const entriesBox = h('details', { class: 'study-details' },
      h('summary', {}, 'Einträge dieser Woche'),
      entries);
    const subjectsPanel = h('div', { class: 'study-panel', hidden: true });
    const dataPanel = h('div', { class: 'study-panel', hidden: true });

    container.append(
      subjectsPanel,
      dataPanel,
      h('div', { class: 'study-timer' },
        h('div', { class: 'study-timer-main' }, subjectSelect, timeEl),
        startStop),
      totals,
      h('div', { class: 'study-weekbar' }, prevWeek, weekLabel, nextWeek),
      chart,
      legend,
      entriesBox);

    const togglePanel = panel => {
      const open = panel.hidden;
      subjectsPanel.hidden = dataPanel.hidden = true;
      panel.hidden = !open;
    };
    ctx.addAction('Fächer', () => { drawSubjects(); togglePanel(subjectsPanel); }, 'Fächer verwalten');
    ctx.addAction('Daten', () => togglePanel(dataPanel), 'Export und Import');

    // ---------- Speichern ----------
    const putSession = async session => {
      sessions = { ...sessions, [session.id]: { ...session, updatedAt: Date.now() } };
      await ctx.store.save('sessions', sessions);
    };
    const putSubject = async subject => {
      subjects = { ...subjects, [subject.id]: { ...subject, updatedAt: Date.now() } };
      await ctx.store.save('subjects', subjects);
    };

    // ---------- Timer ----------
    const drawTimer = () => {
      timeEl.textContent = clock(running ? Date.now() - running.start : 0);
      startStop.textContent = running ? 'Stopp' : 'Start';
      startStop.classList.toggle('is-running', Boolean(running));
      container.classList.toggle('is-running', Boolean(running));
    };

    const drawSubjectSelect = () => {
      const current = running ? running.subjectId : lastSubject;
      subjectSelect.replaceChildren(
        h('option', { value: '' }, NO_SUBJECT.name),
        ...activeSubjects().map(s => h('option', { value: s.id }, s.name)));
      subjectSelect.value = subjects[current] && !subjects[current].deleted ? current : '';
    };

    startStop.addEventListener('click', async () => {
      if (running) {
        const session = { id: uid(), subjectId: running.subjectId, start: running.start, end: Date.now() };
        running = null;
        if (session.end - session.start >= MIN_SESSION) await putSession(session);
        else flash = { text: 'Unter einer Minute – nicht gespeichert.', until: Date.now() + 5000 };
        await ctx.store.save('running', null);
      } else {
        running = { start: Date.now(), subjectId: subjectSelect.value };
        await ctx.store.save('running', running);
      }
      drawAll();
    });

    subjectSelect.addEventListener('change', async () => {
      lastSubject = subjectSelect.value;
      await ctx.store.save('lastSubject', lastSubject);
      if (running) {
        running = { ...running, subjectId: subjectSelect.value };
        await ctx.store.save('running', running);
      }
      drawStats();
    });

    // ---------- Übersicht ----------
    const drawStats = () => {
      const list = activeSessions();
      const today = dayStart(Date.now());
      const sum = (from, to) => list.filter(s => s.start >= from && s.start < to).reduce((t, s) => t + (s.end - s.start), 0);

      totals.replaceChildren(...[
        h('span', {}, 'Heute ', h('strong', {}, duration(sum(today, today + DAY)))),
        h('span', {}, 'Diese Woche ', h('strong', {}, duration(sum(weekStart(today), addDays(weekStart(today), 7))))),
        flash && Date.now() < flash.until && h('span', { class: 'muted' }, flash.text),
      ].filter(Boolean));

      // Balkendiagramm Mo–So der gewählten Woche, gestapelt nach Fach.
      const weekEnd = addDays(week, 7);
      const isCurrent = week === weekStart(Date.now());
      weekLabel.textContent = isCurrent ? 'Diese Woche' : `${rangeFmt.format(week)} – ${rangeFmt.format(addDays(week, 6))}`;
      nextWeek.disabled = isCurrent;
      entriesBox.querySelector('summary').textContent = isCurrent ? 'Einträge dieser Woche' : 'Einträge dieser Woche (Auswahl)';

      const inWeek = list.filter(s => s.start >= week && s.start < weekEnd);
      const days = Array.from({ length: 7 }, (_, i) => {
        const from = addDays(week, i);
        const bySubject = new Map();
        for (const s of inWeek.filter(s => s.start >= from && s.start < addDays(from, 1))) {
          bySubject.set(s.subjectId, (bySubject.get(s.subjectId) ?? 0) + (s.end - s.start));
        }
        return { from, bySubject, total: [...bySubject.values()].reduce((a, b) => a + b, 0) };
      });
      const max = Math.max(60 * 60 * 1000, ...days.map(d => d.total));

      chart.setAttribute('aria-label', `Lernzeit pro Tag: ${days.map(d => `${weekdayFmt.format(d.from)} ${duration(d.total)}`).join(', ')}`);
      chart.replaceChildren(...days.map(d => h('div', { class: `study-day${d.from === today ? ' is-today' : ''}`, title: `${dayFmt.format(d.from)}: ${duration(d.total)}` },
        h('span', { class: 'study-day-total' }, d.total ? (d.total / 3600000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : ''),
        h('div', { class: 'study-bar' },
          [...d.bySubject].map(([id, ms]) => h('span', {
            style: `height:${(ms / max) * 100}%;background:${subjectOf(id).color}`,
            title: `${subjectOf(id).name}: ${duration(ms)}`,
          }))),
        h('span', { class: 'study-day-name' }, weekdayFmt.format(d.from)))));

      // Legende: Summe pro Fach in der gewählten Woche.
      const perSubject = new Map();
      for (const s of inWeek) perSubject.set(s.subjectId, (perSubject.get(s.subjectId) ?? 0) + (s.end - s.start));
      legend.replaceChildren(...[...perSubject].sort((a, b) => b[1] - a[1]).map(([id, ms]) =>
        h('li', {}, h('span', { class: 'dot', style: `background:${subjectOf(id).color}` }), subjectOf(id).name, h('span', { class: 'muted' }, duration(ms)))));

      drawEntries(inWeek.filter(s => !s.live));
    };

    // ---------- Einträge ----------
    const entryForm = session => {
      const date = h('input', { type: 'date', value: isoDate(session.start), required: true, 'aria-label': 'Datum' });
      const from = h('input', { type: 'time', value: hhmm(session.start), required: true, 'aria-label': 'Beginn' });
      const to = h('input', { type: 'time', value: hhmm(session.end), required: true, 'aria-label': 'Ende' });
      const subject = h('select', { class: 'select', 'aria-label': 'Fach' },
        h('option', { value: '' }, NO_SUBJECT.name),
        activeSubjects().map(s => h('option', { value: s.id }, s.name)));
      subject.value = subjects[session.subjectId] && !subjects[session.subjectId].deleted ? session.subjectId : '';
      const error = h('p', { class: 'settings-error' });

      const form = h('form', { class: 'study-form' },
        h('div', { class: 'study-form-row' }, date, from, h('span', { class: 'muted' }, '–'), to),
        subject,
        error,
        h('div', { class: 'study-form-row' },
          h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern'),
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; drawStats(); } }, 'Abbrechen')));

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const start = new Date(`${date.value}T${from.value}`).getTime();
        let end = new Date(`${date.value}T${to.value}`).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return void (error.textContent = 'Bitte Datum und Uhrzeiten angeben.');
        const overnight = end <= start;
        if (overnight) end += DAY; // z. B. 23:00–01:00
        if (end - start > 16 * 60 * 60 * 1000) {
          error.textContent = overnight ? 'Das Ende liegt vor dem Beginn – bitte die Uhrzeiten prüfen.' : 'Ein Eintrag darf höchstens 16 Stunden lang sein.';
          return;
        }
        await putSession({ ...session, id: session.id ?? uid(), subjectId: subject.value, start, end });
        editing = null;
        week = weekStart(start);
        drawStats();
      });
      return form;
    };

    const drawEntries = list => {
      const rows = [];
      if (editing === 'new') {
        const now = Date.now();
        rows.push(entryForm({ subjectId: lastSubject, start: now - 60 * 60 * 1000, end: now }));
      } else {
        rows.push(h('button', { class: 'chip', type: 'button', onclick: () => { editing = 'new'; drawStats(); } }, '+ Eintrag nachtragen'));
      }

      const byDay = new Map();
      for (const s of list.sort((a, b) => b.start - a.start)) {
        const key = dayStart(s.start);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(s);
      }
      if (!byDay.size) rows.push(h('p', { class: 'muted' }, 'Keine Einträge in dieser Woche.'));

      for (const [day, items] of byDay) {
        rows.push(h('h3', { class: 'study-entries-day' }, dayFmt.format(day)));
        rows.push(h('ul', { class: 'study-entry-list' }, items.map(s => {
          if (editing === s.id) return h('li', {}, entryForm(s));
          const subject = subjectOf(s.subjectId);
          return h('li', { class: 'study-entry' },
            h('span', { class: 'dot', style: `background:${subject.color}` }),
            h('span', { class: 'study-entry-time' }, `${hhmm(s.start)}–${hhmm(s.end)}`),
            h('span', { class: 'study-entry-subject' }, subject.name),
            h('span', { class: 'study-entry-dur muted' }, duration(s.end - s.start)),
            h('button', { class: 'icon-btn icon-btn--xs', type: 'button', title: 'Bearbeiten', 'aria-label': 'Eintrag bearbeiten', onclick: () => { editing = s.id; drawStats(); } }, '✎'),
            h('button', {
              class: 'icon-btn icon-btn--xs', type: 'button', title: 'Löschen', 'aria-label': 'Eintrag löschen',
              onclick: async () => {
                if (!confirm(`Eintrag ${hhmm(s.start)}–${hhmm(s.end)} (${subject.name}) löschen?`)) return;
                await putSession({ ...s, deleted: true });
                drawStats();
              },
            }, '×'));
        })));
      }
      entries.replaceChildren(...rows);
    };

    // ---------- Fächer ----------
    const drawSubjects = () => {
      const name = h('input', { type: 'text', placeholder: 'Neues Fach, z. B. Analysis', 'aria-label': 'Name des Fachs', maxlength: 40 });
      const add = h('form', { class: 'study-form-row' }, name, h('button', { class: 'chip chip--accent', type: 'submit' }, 'Hinzufügen'));
      add.addEventListener('submit', async event => {
        event.preventDefault();
        if (!name.value.trim()) return;
        const used = activeSubjects().map(s => s.color);
        const color = COLORS.find(c => !used.includes(c)) ?? COLORS[activeSubjects().length % COLORS.length];
        await putSubject({ id: uid(), name: name.value.trim(), color });
        drawAll();
        drawSubjects();
      });

      subjectsPanel.replaceChildren(
        h('ul', { class: 'study-subjects' }, activeSubjects().map(s => {
          const rename = h('input', { type: 'text', value: s.name, 'aria-label': `Name von ${s.name}`, maxlength: 40 });
          rename.addEventListener('change', async () => {
            if (!rename.value.trim()) return void (rename.value = s.name);
            await putSubject({ ...s, name: rename.value.trim() });
            drawAll();
          });
          return h('li', {},
            h('button', {
              class: 'dot dot--btn', type: 'button', style: `background:${s.color}`, title: 'Farbe wechseln', 'aria-label': `Farbe von ${s.name} wechseln`,
              onclick: async () => {
                await putSubject({ ...s, color: COLORS[(COLORS.indexOf(s.color) + 1) % COLORS.length] });
                drawAll();
                drawSubjects();
              },
            }),
            rename,
            h('button', {
              class: 'icon-btn icon-btn--xs', type: 'button', title: 'Fach löschen', 'aria-label': `${s.name} löschen`,
              onclick: async () => {
                if (!confirm(`Fach „${s.name}“ löschen? Bestehende Einträge bleiben erhalten.`)) return;
                await putSubject({ ...s, deleted: true });
                drawAll();
                drawSubjects();
              },
            }, '×'));
        })),
        add);
    };

    // ---------- Export / Import ----------
    const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    const dataInfo = h('p', { class: 'muted small' });
    dataPanel.append(
      h('div', { class: 'study-form-row' },
        h('button', {
          class: 'chip', type: 'button',
          onclick: () => {
            const data = { app: 'dashboard', type: 'lernzeit', version: 1, exportedAt: new Date().toISOString(), subjects, sessions };
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = h('a', { href: url, download: `lernzeit-${isoDate(Date.now())}.json` });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            dataInfo.textContent = 'Export erstellt.';
          },
        }, 'Als JSON exportieren'),
        h('button', { class: 'chip', type: 'button', onclick: () => importInput.click() }, 'JSON importieren')),
      importInput,
      dataInfo);

    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data?.type !== 'lernzeit' || typeof data.sessions !== 'object' || typeof data.subjects !== 'object') {
          throw new Error('Die Datei ist kein Lernzeit-Export.');
        }
        const before = Object.keys(sessions).length;
        subjects = mergeRecords(subjects, data.subjects);
        sessions = mergeRecords(sessions, data.sessions);
        await ctx.store.save('subjects', subjects);
        await ctx.store.save('sessions', sessions);
        const added = Object.keys(sessions).length - before;
        dataInfo.textContent = `Import fertig: ${added === 1 ? '1 neuer Eintrag' : `${added} neue Einträge`}, vorhandene wurden abgeglichen.`;
        drawAll();
      } catch (err) {
        dataInfo.textContent = err instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : err.message;
      }
    });

    // ---------- Zusammenspiel ----------
    const drawAll = () => {
      drawSubjectSelect();
      drawTimer();
      drawStats();
    };

    prevWeek.addEventListener('click', () => { week = addDays(week, -7); editing = null; drawStats(); });
    nextWeek.addEventListener('click', () => { week = addDays(week, 7); editing = null; drawStats(); });

    // Änderungen von anderen Geräten (Sync) oder Tabs übernehmen.
    ctx.store.subscribe('subjects', v => { subjects = v ?? {}; drawAll(); });
    ctx.store.subscribe('sessions', v => { sessions = v ?? {}; if (!editing) drawStats(); });
    ctx.store.subscribe('running', v => { running = v; drawAll(); });

    drawAll();
    ctx.every(1000, drawTimer);
    // Bei laufendem Timer Übersicht regelmäßig nachziehen; um Mitternacht Tageswechsel.
    ctx.every(30 * 1000, () => { if (running && !editing) drawStats(); });
    let today = dayStart(Date.now());
    ctx.every(60 * 1000, () => {
      if (dayStart(Date.now()) === today) return;
      today = dayStart(Date.now());
      week = weekStart(today);
      drawStats();
    });
  },
};
