// Widget „Aufgaben“: To-do-Liste mit optionalem Fälligkeitsdatum.
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   items: { [id]: { id, text, status: 'open' | 'done' | 'deleted', addedAt, updatedAt,
//                    due: 'YYYY-MM-DD' | null, doneAt?, order } }
// Wie bei der Einkaufsliste ist jede Aufgabe ein eigener Eintrag mit Zeitstempel: Der Sync
// (js/core/sync.js) führt Aufgaben einzeln zusammen, pro Aufgabe gewinnt die jüngste Änderung.
// Gelöschte bleiben als Grabstein (status 'deleted') und werden nach 30 Tagen aufgeräumt.
// due ist ein reines Kalenderdatum (Europe/Berlin) – direkt nutzbar für einen späteren Kalender.
import { h, confirmButton } from '../core/dom.js';
import { pruneTombstones } from './shopping.js';

const UNDO_MS = 6000;
const TZ = 'Europe/Berlin';

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const clean = text => text.trim().replace(/\s+/g, ' ');

// ---------- Kalendertage in Berlin ----------
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const berlinDate = (t = Date.now()) => isoFmt.format(t); // 'YYYY-MM-DD'
const isIsoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayNumber = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
// Abstand in Kalendertagen (ohne Uhrzeit, daher unabhängig von der Zeitumstellung)
export const daysBetween = (from, to) => Math.round(dayNumber(to) - dayNumber(from));
const shortDate = iso => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

export function dueLabel(due, today) {
  const diff = daysBetween(today, due);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'überfällig seit gestern';
  if (diff < 0) return `überfällig seit ${-diff} Tagen`;
  if (diff < 7) return `in ${diff} Tagen`;
  return shortDate(due);
}

// Reihenfolge von Hand: Griff ⠿ ziehen (Maus, Finger, Stift – ohne Hover) oder Pfeiltasten.
// Verschoben wird nur innerhalb einer Gruppe (Zeilen mit gleichem data-group).
// onMove(id, prevId, nextId) bekommt die neuen Nachbarn.
function enableReorder(list, onMove, setDragging) {
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.todo-handle');
    if (!handle || event.button > 0) return;
    const li = handle.closest('li');
    const group = li.dataset.group;
    const same = () => [...list.children].filter(x => x.dataset.group === group);
    if (same().length < 2) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    li.classList.add('is-dragging');
    let startY = event.clientY;
    const top = () => li.getBoundingClientRect().top - (Number(li.dataset.dy) || 0);

    const move = e => {
      const dy = e.clientY - startY;
      li.dataset.dy = dy;
      li.style.transform = `translateY(${dy}px)`;
      const before = top();
      // Bei schnellen Bewegungen über mehrere Zeilen hinweg so weit wandern, wie der Zeiger reicht
      let moved = false;
      for (;;) {
        const siblings = same();
        const index = siblings.indexOf(li);
        const prev = siblings[index - 1];
        const next = siblings[index + 1];
        // Die Nachbarn wandern, nicht die gezogene Zeile – sonst verliert sie die Zeiger-Bindung
        if (prev && e.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) li.after(prev);
        else if (next && e.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) li.before(next);
        else break;
        moved = true;
      }
      if (!moved) return;
      // Zeile ist im DOM gesprungen – Verschiebung so anpassen, dass sie unter dem Finger bleibt
      startY += top() - before;
      const fixed = e.clientY - startY;
      li.dataset.dy = fixed;
      li.style.transform = `translateY(${fixed}px)`;
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      li.classList.remove('is-dragging');
      li.style.transform = '';
      delete li.dataset.dy;
      setDragging(false);
      const siblings = same();
      const index = siblings.indexOf(li);
      onMove(li.dataset.id, siblings[index - 1]?.dataset.id, siblings[index + 1]?.dataset.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });

  list.addEventListener('keydown', event => {
    const handle = event.target.closest('.todo-handle');
    if (!handle || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const li = handle.closest('li');
    const siblings = [...list.children].filter(x => x.dataset.group === li.dataset.group);
    const index = siblings.indexOf(li);
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) return;
    const rest = siblings.filter(x => x !== li);
    onMove(li.dataset.id, rest[target - 1]?.dataset.id, rest[target]?.dataset.id, true);
  });
}

// Defekte oder unvollständige Einträge aus dem Speicher nicht anzeigen
const valid = t => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.text === 'string'
  && ['open', 'done', 'deleted'].includes(t.status) && typeof t.updatedAt === 'number';

export default {
  id: 'todos',
  title: 'Aufgaben',
  dock: { icon: '📋', label: 'Aufgaben' },

  async render(container, ctx) {
    let items = await ctx.store.load('items', {});
    if (!items || typeof items !== 'object' || Array.isArray(items)) items = {};
    let editing = null;
    let undo = null; // { item, timer }
    let today = berlinDate();
    let dragging = false;

    // Defekte Einträge entfernen (sonst kann der Sync die Aufgaben nicht einzeln zusammenführen),
    // alte Grabsteine aufräumen
    const broken = Object.keys(items).filter(id => !valid(items[id]));
    for (const id of broken) delete items[id];
    const pruned = pruneTombstones(items);
    if (pruned) items = pruned;
    if (pruned || broken.length) await ctx.store.save('items', items);

    const byStatus = status => Object.values(items).filter(t => valid(t) && t.status === status);

    // ---------- Elemente ----------
    const input = h('input', {
      type: 'text', class: 'shop-input', placeholder: 'Aufgabe hinzufügen …', 'aria-label': 'Aufgabe hinzufügen',
      autocomplete: 'off', enterkeyhint: 'enter', maxlength: 200,
    });
    const dueInput = h('input', { type: 'date', class: 'todo-date', 'aria-label': 'Fällig am (optional)', title: 'Fällig am (optional)' });
    const form = h('form', { class: 'shop-add todo-add' }, input, dueInput, h('button', { class: 'shop-add-btn', type: 'submit', 'aria-label': 'Hinzufügen' }, '+'));
    const openList = h('ul', { class: 'shop-list todo-list' });
    const empty = h('p', { class: 'shop-empty muted' }, 'Keine offenen Aufgaben. Tippe oben eine ein – Enter fügt hinzu.');
    const done = h('details', { class: 'shop-done' });
    const toast = h('div', { class: 'shop-toast', role: 'status', hidden: true });
    container.append(form, openList, empty, done, toast);

    // ---------- Speichern ----------
    const putItem = async item => {
      items = { ...items, [item.id]: { ...item, updatedAt: Date.now() } };
      return ctx.store.save('items', items);
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = clean(input.value);
      if (!text) return;
      const now = Date.now();
      input.value = '';
      input.focus(); // Fokus bleibt im Feld für die nächste Aufgabe
      await putItem({ id: uid(), text, status: 'open', addedAt: now, due: isIsoDate(dueInput.value) ? dueInput.value : null, order: now });
      dueInput.value = '';
      draw();
    });
    // Feld sichtbar halten, wenn die Bildschirmtastatur aufgeht
    input.addEventListener('focus', () => setTimeout(() => input.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300));

    // ---------- Rückgängig ----------
    const showUndo = (item, text) => {
      clearTimeout(undo?.timer);
      undo = { item, timer: setTimeout(hideUndo, UNDO_MS) };
      toast.replaceChildren(
        h('span', {}, text),
        h('button', {
          class: 'chip', type: 'button',
          onclick: async () => {
            const { item: previous } = undo;
            hideUndo();
            await putItem(previous);
            draw();
          },
        }, 'Rückgängig'));
      toast.hidden = false;
    };
    function hideUndo() {
      clearTimeout(undo?.timer);
      undo = null;
      toast.hidden = true;
    }

    // ---------- Anzeige ----------
    // Neuer Rang zwischen den Nachbarn – geändert wird nur die verschobene Aufgabe
    const rank = t => t.order ?? t.addedAt;
    const moveItem = async (id, prevId, nextId, refocus) => {
      const t = items[id];
      if (!t) return;
      const prev = items[prevId];
      const next = items[nextId];
      let order;
      if (prev && next) order = (rank(prev) + rank(next)) / 2;
      else if (prev) order = rank(prev) + 1000;
      else if (next) order = rank(next) - 1000;
      else return;
      await putItem({ ...t, order });
      draw();
      if (refocus) openList.querySelector(`[data-id="${CSS.escape(id)}"] .todo-handle`)?.focus();
    };

    const meta = t => {
      if (t.status === 'done') return t.doneAt ? `erledigt am ${shortDate(berlinDate(t.doneAt))}` : 'erledigt';
      return t.due ? dueLabel(t.due, today) : '';
    };

    const row = t => {
      if (editing === t.id) return h('li', {}, editForm(t));
      const isDone = t.status === 'done';
      const overdue = !isDone && t.due && t.due < today;
      const info = meta(t);
      return h('li', { class: `shop-item todo-item${isDone ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}${!isDone && t.due === today ? ' is-due' : ''}`, 'data-id': t.id, 'data-group': t.due ?? '' },
        !isDone && h('button', { class: 'todo-handle', type: 'button', title: 'Ziehen zum Verschieben (oder Pfeiltasten)', 'aria-label': `${t.text} verschieben, Pfeiltasten hoch oder runter` }, '⠿'),
        h('button', {
          class: 'shop-toggle', type: 'button', 'aria-pressed': String(isDone),
          'aria-label': `${t.text}${info ? `, ${info}` : ''} – ${isDone ? 'zurückholen' : 'abhaken'}`,
          onclick: async () => {
            await putItem(isDone ? { ...t, status: 'open', doneAt: null } : { ...t, status: 'done', doneAt: Date.now() });
            draw();
          },
        },
        h('span', { class: 'shop-check', 'aria-hidden': 'true' }),
        h('span', { class: 'todo-text' },
          h('span', { class: 'shop-name' }, t.text),
          info && h('span', { class: 'todo-meta' }, info))),
        !isDone && h('button', { class: 'shop-icon-btn', type: 'button', title: 'Bearbeiten', 'aria-label': `${t.text} bearbeiten`, onclick: () => { editing = t.id; draw(); } }, '✎'),
        h('button', {
          class: 'shop-icon-btn', type: 'button', title: 'Löschen', 'aria-label': `${t.text} löschen`,
          onclick: async () => {
            await putItem({ ...t, status: 'deleted' });
            showUndo(t, `„${t.text}“ gelöscht`);
            draw();
          },
        }, '×'));
    };

    const editForm = t => {
      const text = h('input', { type: 'text', class: 'shop-input', value: t.text, 'aria-label': 'Aufgabe', maxlength: 200 });
      const due = h('input', { type: 'date', class: 'todo-date', value: t.due ?? '', 'aria-label': 'Fällig am (optional)' });
      const f = h('form', { class: 'shop-edit' }, text,
        h('div', { class: 'study-form-row' }, h('label', { class: 'todo-due-label muted' }, 'Fällig', due),
          h('button', { class: 'chip', type: 'button', onclick: () => { due.value = ''; } }, 'Kein Datum')),
        h('div', { class: 'study-form-row' },
          h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern'),
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; draw(); } }, 'Abbrechen')));
      f.addEventListener('submit', async event => {
        event.preventDefault();
        const newText = clean(text.value);
        if (!newText) return;
        editing = null;
        await putItem({ ...t, text: newText, due: isIsoDate(due.value) ? due.value : null });
        draw();
      });
      setTimeout(() => text.focus(), 0);
      return f;
    };

    // Sortierung: überfällig zuerst, dann nach Datum, dann ohne Datum; innerhalb gleich
    // (gleiches Datum bzw. ohne Datum) nach order – zunächst die Reihenfolge des Hinzufügens.
    const sortOpen = list => list.sort((a, b) => {
      if (a.due !== b.due) {
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due < b.due ? -1 : 1;
      }
      return (a.order ?? a.addedAt) - (b.order ?? b.addedAt);
    });

    function draw() {
      const open = sortOpen(byStatus('open'));
      const finished = byStatus('done').sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt));

      openList.replaceChildren(...open.map(row));
      empty.hidden = open.length > 0;

      done.hidden = !finished.length;
      const wasOpen = done.open;
      done.replaceChildren(
        h('summary', {}, `Erledigt (${finished.length})`),
        h('ul', { class: 'shop-list' }, finished.map(row)),
        confirmButton({ class: 'chip shop-clear' }, 'Erledigte entfernen', 'Wirklich alle entfernen?', async () => {
          const now = Date.now();
          items = { ...items };
          for (const t of byStatus('done')) items[t.id] = { ...t, status: 'deleted', updatedAt: now };
          await ctx.store.save('items', items);
          draw();
        }));
      done.open = wasOpen;
    }

    // Änderungen anderer Geräte übernehmen (nicht während eines Bearbeitungsformulars)
    const busy = () => dragging || (editing && container.contains(document.activeElement));
    enableReorder(openList, moveItem, value => { dragging = value; });
    ctx.store.subscribe('items', v => { items = v && typeof v === 'object' ? v : {}; if (!busy()) draw(); });
    ctx.onCleanup(hideUndo);

    // Tageswechsel (Mitternacht in Berlin): „heute“, „morgen“, „überfällig“ neu berechnen
    ctx.every(60 * 1000, () => {
      if (berlinDate() === today) return;
      today = berlinDate();
      if (!busy()) draw();
    });

    draw();
  },
};
