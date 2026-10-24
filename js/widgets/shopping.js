// Widget „Einkaufsliste“: schnell hinzufügen, abhaken, häufig Gekauftes mit einem Tipp.
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   items:   { [id]: { id, name, qty, status: 'open' | 'done' | 'deleted', addedAt, updatedAt } }
//   history: { [key]: { key, name, count, lastAdded, pinned?, hidden?, updatedAt } }   key = normalisierter Name
// Jeder Artikel ist ein eigener Eintrag mit Zeitstempel: Der Sync führt Artikel einzeln
// zusammen, pro Artikel gewinnt die jüngste Änderung. Gelöschte Artikel bleiben als
// Grabstein (status 'deleted') stehen und werden nach 30 Tagen aufgeräumt.
import { h, confirmButton } from '../core/dom.js';
import { setFact } from '../core/briefing.js';
import { load, save } from '../core/storage.js';

const TOMBSTONE_DAYS = 30;
const UNDO_MS = 6000;
const FREQUENT_MIN = 2; // ab so vielen Käufen erscheint ein Artikel unter „Häufig gekauft“
const FREQUENT_MAX = 8;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const normalize = name => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
const clean = name => name.trim().replace(/\s+/g, ' ');

// Grabsteine älter als 30 Tage entfernen (liefert null, wenn nichts zu tun ist).
export function pruneTombstones(items, now = Date.now()) {
  const limit = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const old = Object.values(items).filter(i => i.status === 'deleted' && i.updatedAt < limit);
  if (!old.length) return null;
  const rest = { ...items };
  for (const i of old) delete rest[i.id];
  return rest;
}

// Duplikatlogik, gemeinsam für das Eingabefeld und addToShoppingList(): gleicher Name
// (normalisiert: Groß/Klein, Leerzeichen) mit gleichem Status
export const findByName = (items, name, status) =>
  Object.values(items).find(i => i.status === status && normalize(i.name) === normalize(name));

// Mehrere Artikel auf einmal (z. B. Rezept-Zutaten) mit derselben Logik wie das Eingabefeld:
// Steht der Artikel schon offen auf der Liste, bleibt er (eine fehlende Menge wird ergänzt);
// ein erledigter kommt zurück, sonst wird er neu angelegt. Zählt auch für „Häufig gekauft“.
// Gibt { added, reopened, existing } zurück.
export async function addToShoppingList(entries) {
  const items = { ...(await load('shopping.items', {})) };
  const history = { ...(await load('shopping.history', {})) };
  const result = { added: 0, reopened: 0, existing: 0 };
  for (const entry of entries) {
    const name = clean(entry.name ?? '');
    const qty = clean(entry.qty ?? '');
    if (!name) continue;
    const now = Date.now();
    const open = findByName(items, name, 'open');
    if (open) {
      result.existing++;
      if (!open.qty && qty) items[open.id] = { ...open, qty, updatedAt: now };
      continue;
    }
    const doneItem = findByName(items, name, 'done');
    if (doneItem) {
      items[doneItem.id] = { ...doneItem, status: 'open', qty: qty || doneItem.qty, updatedAt: now };
      result.reopened++;
    } else {
      const id = uid();
      items[id] = { id, name, qty, status: 'open', addedAt: now, updatedAt: now };
      result.added++;
    }
    const key = normalize(name);
    history[key] = { ...history[key], key, name, count: (history[key]?.count ?? 0) + 1, lastAdded: now, updatedAt: now };
  }
  await save('shopping.items', items);
  await save('shopping.history', history);
  return result;
}

export default {
  id: 'shopping',
  title: 'Einkaufsliste',
  size: 's',
  dock: { icon: 'shopping', label: 'Einkauf' },

  async render(container, ctx) {
    let items = await ctx.store.load('items', {});
    let history = await ctx.store.load('history', {});
    let editing = null; // id des bearbeiteten Artikels
    let manageFrequent = false;
    let flashId = null;
    let undo = null; // { item, timer }

    const pruned = pruneTombstones(items);
    if (pruned) {
      items = pruned;
      await ctx.store.save('items', items);
    }

    const byStatus = status => Object.values(items).filter(i => i.status === status);
    const findOpen = name => findByName(items, name, 'open');

    // ---------- Elemente ----------
    const input = h('input', {
      type: 'text', class: 'shop-input', placeholder: 'Artikel hinzufügen …', 'aria-label': 'Artikel hinzufügen',
      autocomplete: 'off', enterkeyhint: 'enter', list: 'shop-suggestions', maxlength: 60,
    });
    const datalist = h('datalist', { id: 'shop-suggestions' });
    const form = h('form', { class: 'shop-add' }, input, h('button', { class: 'shop-add-btn', type: 'submit', 'aria-label': 'Hinzufügen' }, '+'), datalist);
    const openList = h('ul', { class: 'shop-list' });
    const empty = h('p', { class: 'shop-empty muted' }, 'Die Liste ist leer. Tippe oben einen Artikel ein.');
    const frequent = h('div', { class: 'shop-frequent' });
    const done = h('details', { class: 'shop-done' });
    const toast = h('div', { class: 'shop-toast', role: 'status', hidden: true });
    const onlyLink = h('a', { class: 'shop-only-link muted', href: '?nur=einkauf', title: 'Nur die Einkaufsliste – z. B. als eigenes Symbol auf dem Home-Bildschirm' }, 'Nur-Einkaufsliste-Ansicht ↗');
    container.append(form, openList, empty, frequent, done, toast, onlyLink);

    // ---------- Speichern ----------
    const putItem = async item => {
      items = { ...items, [item.id]: { ...item, updatedAt: Date.now() } };
      return ctx.store.save('items', items);
    };
    const remember = async name => {
      const key = normalize(name);
      const prev = history[key];
      history = { ...history, [key]: { ...prev, key, name: clean(name), count: (prev?.count ?? 0) + 1, lastAdded: Date.now(), updatedAt: Date.now() } };
      await ctx.store.save('history', history);
    };
    const putHistory = async entry => {
      history = { ...history, [entry.key]: { ...entry, updatedAt: Date.now() } };
      await ctx.store.save('history', history);
    };

    // Hinzufügen: kein Duplikat – vorhandenen offenen Artikel kurz hervorheben,
    // erledigten zurückholen, sonst neu anlegen.
    const add = async name => {
      name = clean(name);
      if (!name) return;
      const open = findOpen(name);
      if (open) {
        flashId = open.id;
        draw();
        return;
      }
      const doneItem = findByName(items, name, 'done');
      if (doneItem) await putItem({ ...doneItem, status: 'open' });
      else await putItem({ id: uid(), name, qty: '', status: 'open', addedAt: Date.now() });
      await remember(name);
      draw();
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = input.value;
      input.value = '';
      input.focus(); // Fokus bleibt im Feld für den nächsten Artikel
      await add(value);
    });
    // Feld bei Fokus sichtbar halten, wenn die Bildschirmtastatur aufgeht
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
    const itemRow = item => {
      if (editing === item.id) return h('li', {}, editForm(item));
      const isDone = item.status === 'done';
      return h('li', { class: `shop-item${isDone ? ' is-done' : ''}${flashId === item.id ? ' is-flash' : ''}` },
        h('button', {
          class: 'shop-toggle', type: 'button', 'aria-pressed': String(isDone),
          'aria-label': `${item.name}${item.qty ? `, ${item.qty}` : ''} – ${isDone ? 'zurück auf die Liste' : 'abhaken'}`,
          onclick: async () => {
            await putItem({ ...item, status: isDone ? 'open' : 'done' });
            draw();
          },
        },
        h('span', { class: 'shop-check', 'aria-hidden': 'true' }),
        h('span', { class: 'shop-name' }, item.name),
        item.qty && h('span', { class: 'shop-qty muted' }, item.qty)),
        !isDone && h('button', { class: 'shop-icon-btn', type: 'button', title: 'Bearbeiten', 'aria-label': `${item.name} bearbeiten`, onclick: () => { editing = item.id; draw(); } }, '✎'),
        h('button', {
          class: 'shop-icon-btn', type: 'button', title: 'Löschen', 'aria-label': `${item.name} löschen`,
          onclick: async () => {
            await putItem({ ...item, status: 'deleted' });
            showUndo(item, `„${item.name}“ gelöscht`);
            draw();
          },
        }, '×'));
    };

    const editForm = item => {
      const name = h('input', { type: 'text', class: 'shop-input', value: item.name, 'aria-label': 'Name', maxlength: 60 });
      const qty = h('input', { type: 'text', class: 'shop-input shop-qty-input', value: item.qty ?? '', placeholder: 'Menge, z. B. 2 Packungen', 'aria-label': 'Menge', maxlength: 30 });
      const f = h('form', { class: 'shop-edit' }, name, qty,
        h('div', { class: 'study-form-row' },
          h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern'),
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; draw(); } }, 'Abbrechen')));
      f.addEventListener('submit', async event => {
        event.preventDefault();
        const newName = clean(name.value);
        if (!newName) return;
        editing = null;
        await putItem({ ...item, name: newName, qty: clean(qty.value) });
        if (normalize(newName) !== normalize(item.name)) await remember(newName);
        draw();
      });
      setTimeout(() => name.focus(), 0);
      return f;
    };

    const drawFrequent = () => {
      const onList = new Set(byStatus('open').map(i => normalize(i.name)));
      const all = Object.values(history).filter(e => e.pinned || e.count >= FREQUENT_MIN)
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.count - a.count || b.lastAdded - a.lastAdded);
      const shown = manageFrequent ? all : all.filter(e => !e.hidden && !onList.has(e.key)).slice(0, FREQUENT_MAX);
      if (!all.length) return frequent.replaceChildren();

      frequent.replaceChildren(
        h('div', { class: 'shop-frequent-head' },
          h('h3', { class: 'shop-section-title' }, 'Häufig gekauft'),
          h('button', { class: 'chip', type: 'button', 'aria-pressed': String(manageFrequent), onclick: () => { manageFrequent = !manageFrequent; draw(); } }, manageFrequent ? 'Fertig' : 'Anpassen')),
        shown.length
          ? h('div', { class: 'shop-chips' }, shown.map(e => (manageFrequent
            ? h('span', { class: `shop-chip-manage${e.hidden ? ' is-hidden' : ''}` },
              h('span', { class: 'shop-chip-name' }, `${e.pinned ? '📌 ' : ''}${e.name}`),
              h('button', { class: 'shop-icon-btn', type: 'button', 'aria-pressed': String(Boolean(e.pinned)), title: e.pinned ? 'Nicht mehr anheften' : 'Anheften', 'aria-label': `${e.name} ${e.pinned ? 'nicht mehr anheften' : 'anheften'}`, onclick: async () => { await putHistory({ ...e, pinned: !e.pinned, hidden: false }); draw(); } }, '📌'),
              h('button', { class: 'shop-icon-btn', type: 'button', title: e.hidden ? 'Wieder vorschlagen' : 'Ausblenden', 'aria-label': `${e.name} ${e.hidden ? 'wieder vorschlagen' : 'ausblenden'}`, onclick: async () => { await putHistory({ ...e, hidden: !e.hidden, pinned: false }); draw(); } }, e.hidden ? '↺' : '×'))
            : h('button', { class: 'shop-chip', type: 'button', title: `${e.name} auf die Liste`, onclick: () => add(e.name) }, `${e.pinned ? '📌 ' : '+ '}${e.name}`))))
          : h('p', { class: 'muted shop-hint' }, 'Alle Vorschläge stehen schon auf der Liste.'));
    };

    function draw() {
      const open = byStatus('open').sort((a, b) => a.addedAt - b.addedAt);
      const finished = byStatus('done').sort((a, b) => b.updatedAt - a.updatedAt);

      openList.replaceChildren(...open.map(itemRow));
      empty.hidden = open.length > 0;
      ctx.setEmpty(!open.length && !finished.length);
      setFact('shopping', open.length ? { open: open.length } : null);

      done.hidden = !finished.length;
      const wasOpen = done.open;
      done.replaceChildren(
        h('summary', {}, `Erledigt (${finished.length})`),
        h('ul', { class: 'shop-list' }, finished.map(itemRow)),
        confirmButton({ class: 'chip shop-clear' }, 'Erledigte entfernen', 'Wirklich alle entfernen?', async () => {
          const now = Date.now();
          items = { ...items };
          for (const i of byStatus('done')) items[i.id] = { ...i, status: 'deleted', updatedAt: now };
          await ctx.store.save('items', items);
          draw();
        }));
      done.open = wasOpen;

      drawFrequent();
      // Autovervollständigung aus allen bisherigen Artikeln (auch ausgeblendeten Vorschlägen)
      datalist.replaceChildren(...Object.values(history)
        .sort((a, b) => b.count - a.count).map(e => h('option', { value: e.name })));

      // Hervorhebung bei Duplikat kurz anzeigen
      const flashed = openList.querySelector('.is-flash');
      if (flashed) {
        flashId = null;
        flashed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(() => flashed.classList.remove('is-flash'), 1200);
      }
    }

    // Änderungen anderer Geräte übernehmen (nicht während eines Bearbeitungsformulars)
    const busy = () => editing && container.contains(document.activeElement);
    ctx.store.subscribe('items', v => { items = v ?? {}; if (!busy()) draw(); });
    ctx.store.subscribe('history', v => { history = v ?? {}; if (!busy()) draw(); });
    ctx.onCleanup(hideUndo);

    draw();
  },
};
