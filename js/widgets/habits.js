// Widget „Gewohnheiten“: eigene Gewohnheiten mit Ein-Klick-Abhaken, Streaks
// und Wochenansicht (Tage rückwirkend nachtragbar, nicht in der Zukunft).
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   list: { [id]: { id, name, emoji, color, goal, order, archived, createdOn, updatedAt, deleted? } }
//         goal: null (kein Ziel) oder Anzahl pro Woche
//   days: { ['<id>|YYYY-MM-DD']: { done, updatedAt } }
// Jeder Tag ist ein eigener Eintrag mit Zeitstempel: Der Sync führt so Tage
// einzeln zusammen, und auch ein Rückgängigmachen (done: false) kommt an.
// Streaks werden immer aus den Tagen berechnet, nie gespeichert.
// Tagesgrenze: Europe/Berlin.
import { h, confirmButton } from '../core/dom.js';

const COLORS = ['#c8553d', '#3c82cf', '#3c8a4a', '#8b62d0', '#d99a1f', '#2a9d8f', '#d65b8f', '#6b7a8f'];
const RATE_WINDOW_MAX = 30;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- Kalendertage als Strings (Europe/Berlin) ----------
const berlinDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => berlinDate.format(Date.now());
const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = t => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => fromUTC(toUTC(s) + n * 86400000);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const monday = s => addDays(s, -((new Date(toUTC(s)).getUTCDay() + 6) % 7));

const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Auswertung (nur aus den Tagen) ----------
export function stats(habit, doneSet, now = today()) {
  if (habit.goal) {
    // Wochenziel: Streak in Wochen mit erreichtem Ziel
    const perWeek = new Map();
    for (const d of doneSet) perWeek.set(monday(d), (perWeek.get(monday(d)) ?? 0) + 1);
    const thisWeek = monday(now);
    const reached = w => (perWeek.get(w) ?? 0) >= habit.goal;
    let current = 0;
    for (let w = reached(thisWeek) ? thisWeek : addDays(thisWeek, -7); reached(w); w = addDays(w, -7)) current++;
    let longest = 0;
    let run = 0;
    const first = [...perWeek.keys()].sort()[0];
    for (let w = first; w && w <= thisWeek; w = addDays(w, 7)) {
      run = reached(w) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return { unit: 'week', current, longest, weekCount: perWeek.get(thisWeek) ?? 0, goal: habit.goal };
  }

  // Ohne Ziel: Tages-Streak und Quote seit dem Anlegen (höchstens 30 Tage)
  let current = 0;
  for (let d = doneSet.has(now) ? now : addDays(now, -1); doneSet.has(d); d = addDays(d, -1)) current++;
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of [...doneSet].sort()) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const window = Math.min(RATE_WINDOW_MAX, Math.max(1, daysBetween(habit.createdOn ?? now, now) + 1));
  const from = addDays(now, -(window - 1));
  const count = [...doneSet].filter(d => d >= from && d <= now).length;
  return { unit: 'day', current, longest, count, window };
}

export default {
  id: 'habits',
  title: 'Gewohnheiten',

  async render(container, ctx) {
    let list = await ctx.store.load('list', {});
    let days = await ctx.store.load('days', {});
    let weekOffset = 0;
    let lastPopped = null; // Gewohnheit, die gerade abgehakt wurde (für die Animation)

    const active = () => Object.values(list).filter(x => !x.deleted && !x.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'de'));
    const archived = () => Object.values(list).filter(x => !x.deleted && x.archived).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const doneSet = id => new Set(Object.entries(days).filter(([k, v]) => v.done && k.startsWith(`${id}|`)).map(([k]) => k.slice(id.length + 1)));

    const rows = h('ul', { class: 'habit-list' });
    const weekLabel = h('span', { class: 'habit-week-label' });
    const prev = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Vorherige Woche' }, '‹');
    const next = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Nächste Woche' }, '›');
    const weekbar = h('div', { class: 'habit-weekbar' }, prev, weekLabel, next);
    const manage = h('div', { class: 'study-panel habit-manage', hidden: true });
    container.append(manage, weekbar, rows);

    ctx.addAction('Bearbeiten', () => {
      manage.hidden = !manage.hidden;
      if (!manage.hidden) drawManage();
    }, 'Gewohnheiten anlegen und bearbeiten');

    // ---------- Speichern ----------
    const putHabit = async habit => {
      list = { ...list, [habit.id]: { ...habit, updatedAt: Date.now() } };
      await ctx.store.save('list', list);
    };
    // Zeichnet über das Abo neu; gibt false zurück, wenn nicht gespeichert wurde.
    const setDay = async (id, date, done) => {
      if (date > today()) return false; // keine Zukunft
      days = { ...days, [`${id}|${date}`]: { done, updatedAt: Date.now() } };
      return ctx.store.save('days', days);
    };

    // ---------- Hauptansicht ----------
    const draw = () => {
      const now = today();
      const weekStart = addDays(monday(now), weekOffset * 7);
      const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      weekLabel.textContent = weekOffset === 0 ? 'Diese Woche' : `${shortFmt.format(toUTC(weekStart))} – ${shortFmt.format(toUTC(weekDays[6]))}`;
      next.disabled = weekOffset >= 0;
      const habits = active();
      weekbar.hidden = !habits.length;

      if (!habits.length) {
        rows.replaceChildren(h('li', { class: 'habit-empty muted' },
          'Noch keine Gewohnheit angelegt. ',
          h('button', { class: 'chip', type: 'button', onclick: () => { manage.hidden = false; drawManage(); } }, '+ Gewohnheit anlegen')));
        return;
      }

      rows.replaceChildren(...habits.map(habit => {
        const done = doneSet(habit.id);
        const s = stats(habit, done, now);
        const doneToday = done.has(now);

        const check = h('button', {
          class: `habit-check${doneToday ? ' is-done' : ''}${lastPopped === habit.id ? ' pop' : ''}`,
          type: 'button',
          style: `--habit:${habit.color}`,
          'aria-pressed': String(doneToday),
          'aria-label': `${habit.name} heute ${doneToday ? 'erledigt – rückgängig machen' : 'abhaken'}`,
          title: doneToday ? 'Heute erledigt – klicken zum Rückgängigmachen' : 'Heute erledigt?',
          onclick: async () => {
            lastPopped = doneToday ? null : habit.id;
            if (!(await setDay(habit.id, now, !doneToday))) draw();
          },
        }, habit.emoji ? h('span', { class: 'habit-emoji' }, habit.emoji) : null, h('span', { class: 'habit-tick', 'aria-hidden': 'true' }, '✓'));

        const dots = weekDays.map(d => {
          const future = d > now;
          const isDone = done.has(d);
          return h('button', {
            class: `habit-dot${isDone ? ' is-done' : ''}${d === now ? ' is-today' : ''}`,
            type: 'button',
            style: `--habit:${habit.color}`,
            disabled: future,
            'aria-pressed': String(isDone),
            'aria-label': `${dateFmt.format(toUTC(d))}: ${isDone ? 'erledigt' : 'nicht erledigt'}`,
            title: `${dateFmt.format(toUTC(d))}${future ? '' : ` – ${isDone ? 'erledigt' : 'offen'}, klicken zum Ändern`}`,
            onclick: async () => {
              lastPopped = null;
              if (!(await setDay(habit.id, d, !isDone))) draw();
            },
          }, h('span', { class: 'habit-dot-day' }, weekdayFmt.format(toUTC(d)).slice(0, 2)));
        });

        let summary;
        if (s.unit === 'week') {
          const status = s.weekCount >= s.goal ? h('span', { class: 'habit-goal is-reached' }, `✓ Ziel erreicht (${s.weekCount}/${s.goal})`) : h('span', { class: 'habit-goal' }, `${s.weekCount}/${s.goal} diese Woche`);
          summary = [status, ` · Serie ${plural(s.current, 'Woche', 'Wochen')} · Rekord ${plural(s.longest, 'Woche', 'Wochen')}`];
        } else {
          const rate = s.window === 1 ? `${s.count}× heute` : `${s.count}× in den letzten ${s.window} Tagen`;
          summary = [`Serie ${plural(s.current, 'Tag', 'Tage')} · Rekord ${plural(s.longest, 'Tag', 'Tage')} · ${rate}`];
        }

        return h('li', { class: 'habit' },
          check,
          h('div', { class: 'habit-body' },
            h('div', { class: 'habit-name' }, habit.name),
            h('div', { class: 'habit-stats muted' }, summary),
            h('div', { class: 'habit-week', role: 'group', 'aria-label': `${habit.name}: Woche` }, dots)));
      }));
      lastPopped = null;
    };

    // ---------- Verwalten ----------
    const drawManage = () => {
      const habits = active();
      const goalSelect = habit => {
        const select = h('select', { class: 'select habit-goal-select', 'aria-label': `Ziel für ${habit.name}` },
          h('option', { value: '' }, 'Kein Ziel'),
          ...[1, 2, 3, 4, 5, 6, 7].map(n => h('option', { value: n }, `${n}× pro Woche`)));
        select.value = habit.goal ? String(habit.goal) : '';
        select.addEventListener('change', async () => {
          await putHabit({ ...habit, goal: select.value ? Number(select.value) : null });
          draw();
          drawManage();
        });
        return select;
      };
      const move = async (habit, delta) => {
        const ordered = active();
        const i = ordered.findIndex(x => x.id === habit.id);
        const j = i + delta;
        if (j < 0 || j >= ordered.length) return;
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        const now = Date.now();
        list = { ...list };
        ordered.forEach((x, index) => { list[x.id] = { ...x, order: index, updatedAt: now }; });
        await ctx.store.save('list', list);
        draw();
        drawManage();
      };

      const emojiInput = h('input', { type: 'text', class: 'habit-emoji-input', placeholder: '🙂', 'aria-label': 'Emoji (optional)', maxlength: 4 });
      const nameInput = h('input', { type: 'text', placeholder: 'Neue Gewohnheit, z. B. Lesen', 'aria-label': 'Name der Gewohnheit', maxlength: 40 });
      const add = h('form', { class: 'study-form-row' }, emojiInput, nameInput, h('button', { class: 'chip chip--accent', type: 'submit' }, 'Hinzufügen'));
      add.addEventListener('submit', async event => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return;
        const used = habits.map(x => x.color);
        await putHabit({
          id: uid(), name, emoji: emojiInput.value.trim(),
          color: COLORS.find(c => !used.includes(c)) ?? COLORS[habits.length % COLORS.length],
          goal: null, order: habits.length, archived: false, createdOn: today(),
        });
        draw();
        drawManage();
      });

      manage.replaceChildren(...[
        h('ul', { class: 'habit-manage-list' }, habits.map((habit, i) => {
          const emoji = h('input', { type: 'text', class: 'habit-emoji-input', value: habit.emoji ?? '', placeholder: '🙂', 'aria-label': `Emoji von ${habit.name}`, maxlength: 4 });
          emoji.addEventListener('change', async () => { await putHabit({ ...habit, emoji: emoji.value.trim() }); draw(); });
          const name = h('input', { type: 'text', value: habit.name, 'aria-label': `Name von ${habit.name}`, maxlength: 40 });
          name.addEventListener('change', async () => {
            if (!name.value.trim()) return void (name.value = habit.name);
            await putHabit({ ...habit, name: name.value.trim() });
            draw();
          });
          return h('li', {},
            h('div', { class: 'habit-manage-row' },
              h('button', {
                class: 'dot dot--btn', type: 'button', style: `background:${habit.color}`, title: 'Farbe wechseln', 'aria-label': `Farbe von ${habit.name} wechseln`,
                onclick: async () => { await putHabit({ ...habit, color: COLORS[(COLORS.indexOf(habit.color) + 1) % COLORS.length] }); draw(); drawManage(); },
              }),
              emoji, name),
            h('div', { class: 'habit-manage-row' },
              goalSelect(habit),
              h('button', { class: 'icon-btn icon-btn--xs', type: 'button', title: 'Nach oben', 'aria-label': `${habit.name} nach oben`, disabled: i === 0, onclick: () => move(habit, -1) }, '↑'),
              h('button', { class: 'icon-btn icon-btn--xs', type: 'button', title: 'Nach unten', 'aria-label': `${habit.name} nach unten`, disabled: i === habits.length - 1, onclick: () => move(habit, 1) }, '↓'),
              h('button', { class: 'chip', type: 'button', onclick: async () => { await putHabit({ ...habit, archived: true }); draw(); drawManage(); } }, 'Archivieren'),
              confirmButton({ class: 'chip' }, 'Löschen', 'Wirklich löschen?', async () => { await putHabit({ ...habit, deleted: true }); draw(); drawManage(); })));
        })),
        add,
        archived().length > 0 && h('details', { class: 'habit-archive' },
          h('summary', {}, `Archiviert (${archived().length})`),
          h('ul', { class: 'habit-manage-list' }, archived().map(habit => h('li', { class: 'habit-manage-row' },
            h('span', { class: 'dot', style: `background:${habit.color}` }),
            h('span', { class: 'habit-archived-name' }, [habit.emoji, habit.name].filter(Boolean).join(' ')),
            h('button', { class: 'chip', type: 'button', onclick: async () => { await putHabit({ ...habit, archived: false, order: active().length }); draw(); drawManage(); } }, 'Wiederherstellen'),
            confirmButton({ class: 'chip' }, 'Löschen', 'Wirklich löschen?', async () => { await putHabit({ ...habit, deleted: true }); draw(); drawManage(); }))))),
      ].filter(Boolean));
    };

    prev.addEventListener('click', () => { weekOffset--; draw(); });
    next.addEventListener('click', () => { weekOffset = Math.min(0, weekOffset + 1); draw(); });

    // Änderungen anderer Geräte (Sync) oder Tabs übernehmen
    ctx.store.subscribe('list', v => { list = v ?? {}; draw(); if (!manage.hidden && !manage.contains(document.activeElement)) drawManage(); });
    ctx.store.subscribe('days', v => { days = v ?? {}; draw(); });

    // Tageswechsel um Mitternacht (Berlin)
    let shownDay = today();
    ctx.every(60 * 1000, () => {
      if (today() === shownDay) return;
      shownDay = today();
      draw();
    });

    draw();
  },
};
