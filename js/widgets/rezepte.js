// Widget „Rezepte“: eigene Rezepte mit Suche, Filtern, Portionsrechner, Zufallsvorschlag
// und „Zutaten auf die Einkaufsliste“.
//
// Datenmodell (über ctx.store, wird synchronisiert und exportiert):
//   list: { [id]: { id, title, tags: [], duration (min) | null, servings | null, source, steps,
//                   ingredients: [{ amount: Zahl | null, unit, name }], favorite, lastCooked: 'YYYY-MM-DD' | null,
//                   createdAt, updatedAt, deleted? } }
// Wie bei der Einkaufsliste ist jedes Rezept ein eigener Eintrag mit Zeitstempel; gelöschte bleiben
// als Grabstein (deleted) stehen und werden nach 30 Tagen aufgeräumt. Portionen umrechnen ändert
// nur die Anzeige, nie das gespeicherte Rezept.
import { h, confirmButton } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { addToShoppingList } from './shopping.js';

const TOMBSTONE_DAYS = 30;
const RECENT_DAYS = 7; // so lange überspringt der Zufall Gekochtes
const DURATIONS = [[0, 'Jede Dauer'], [20, 'bis 20 min'], [30, 'bis 30 min'], [45, 'bis 45 min'], [60, 'bis 1 h']];
export const OPEN_EVENT = 'ember:rezept';

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const pad = n => String(n).padStart(2, '0');
export const isoDay = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysSince = iso => (iso ? Math.round((new Date(`${isoDay()}T12:00`) - new Date(`${iso}T12:00`)) / 86400000) : Infinity);
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const clean = text => String(text ?? '').trim().replace(/\s+/g, ' ');

// ---------- Zutaten: Text ⇄ Struktur ----------
const UNITS = ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'EL', 'TL', 'Prise', 'Prisen', 'Msp.', 'Stk.', 'Stück', 'Dose', 'Dosen', 'Becher',
  'Pck.', 'Packung', 'Packungen', 'Bund', 'Zehe', 'Zehen', 'Scheibe', 'Scheiben', 'Tasse', 'Tassen', 'Glas', 'Gläser', 'Handvoll', 'Würfel'];
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const unitPattern = UNITS.map(u => u.replace('.', '\\.')).sort((a, b) => b.length - a.length).join('|');
const LINE = new RegExp(`^\\s*(\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔])?\\s*(?:(${unitPattern})(?=\\s|$))?\\s*(.*)$`, 'i');

function parseAmount(text) {
  if (!text) return null;
  if (FRACTIONS[text]) return FRACTIONS[text];
  if (text.includes('/')) {
    const [a, b] = text.split('/').map(Number);
    return b ? a / b : null;
  }
  return Number(text.replace(',', '.'));
}

// „200 g Mehl“ → { amount: 200, unit: 'g', name: 'Mehl' }; „Salz“ → { amount: null, unit: '', name: 'Salz' }
export function parseIngredient(line) {
  const [, amount, unit, name] = LINE.exec(clean(line)) ?? [];
  const parsed = { amount: parseAmount(amount), unit: unit ? UNITS.find(u => u.toLowerCase() === unit.toLowerCase()) : '', name: clean(name) };
  // Nur eine Zahl ohne Namen („3“) ist kein sinnvoller Eintrag
  return parsed.name ? parsed : null;
}

// Zahl lesbar auf Deutsch: 0,5 · 1,5 · 250 · ⅓ wird 0,3
export function formatAmount(value) {
  if (value == null || !Number.isFinite(value)) return '';
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return rounded.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}
const ingredientText = (ing, factor = 1) => [formatAmount(ing.amount == null ? null : ing.amount * factor), ing.unit, ing.name].filter(Boolean).join(' ');
const qtyText = (ing, factor) => [formatAmount(ing.amount == null ? null : ing.amount * factor), ing.unit].filter(Boolean).join(' ');

// Rezept des Tages für die Mensa-Kachel: pro Datum stabil, ohne Zufallszahlen
export function dailyPick(list, day = isoDay()) {
  const recipes = Object.values(list ?? {}).filter(r => !r.deleted).sort((a, b) => a.id.localeCompare(b.id));
  if (!recipes.length) return null;
  let hash = 0;
  for (const c of day) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return recipes[hash % recipes.length];
}

function prune(list, now = Date.now()) {
  const limit = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const old = Object.values(list).filter(r => r.deleted && r.updatedAt < limit);
  if (!old.length) return null;
  const rest = { ...list };
  for (const r of old) delete rest[r.id];
  return rest;
}

export default {
  id: 'rezepte',
  title: 'Rezepte',
  size: 'm',
  dock: { icon: 'recipe', label: 'Rezepte' },

  async render(container, ctx) {
    let list = await ctx.store.load('list', {});
    const pruned = prune(list);
    if (pruned) {
      list = pruned;
      await ctx.store.save('list', list);
    }

    // Ansichtszustand (nur in dieser Sitzung)
    const filter = { query: '', tags: new Set(), maxDuration: 0, favorites: false };
    const portions = new Map(); // id → gewählte Portionen
    let expanded = null;        // aufgeklapptes Rezept
    let editing = null;         // id oder 'new'
    let pick = null;            // Zufallsvorschlag { id } oder { none: true }
    const notice = new Map();   // id → Rückmeldung (z. B. „3 Zutaten hinzugefügt“)

    const recipes = () => Object.values(list).filter(r => !r.deleted).sort((a, b) => a.title.localeCompare(b.title, 'de'));
    const allTags = () => [...new Set(recipes().flatMap(r => r.tags ?? []))].sort((a, b) => a.localeCompare(b, 'de'));
    const matches = r => {
      const q = filter.query.toLocaleLowerCase('de');
      if (q && ![r.title, ...(r.tags ?? []), ...(r.ingredients ?? []).map(i => i.name)].some(t => t.toLocaleLowerCase('de').includes(q))) return false;
      if (filter.favorites && !r.favorite) return false;
      if (filter.maxDuration && !(r.duration && r.duration <= filter.maxDuration)) return false;
      return [...filter.tags].every(t => r.tags?.includes(t));
    };

    const put = async recipe => {
      list = { ...list, [recipe.id]: { ...recipe, updatedAt: Date.now() } };
      await ctx.store.save('list', list);
    };

    // ---------- Elemente ----------
    const search = h('input', { type: 'search', class: 'shop-input recipe-search', placeholder: 'Rezept oder Zutat suchen …', 'aria-label': 'Rezepte durchsuchen', autocomplete: 'off', enterkeyhint: 'search' });
    const filters = h('div', { class: 'recipe-filters' });
    const randomBox = h('div', { class: 'recipe-random', 'aria-live': 'polite' });
    const listEl = h('ul', { class: 'recipe-list' });
    const formSlot = h('div', { class: 'recipe-form-slot' });
    const count = h('p', { class: 'recipe-count muted small' });
    const randomButton = h('button', { class: 'chip recipe-dice', type: 'button', title: 'Zufälliges Rezept (beachtet die Filter)' }, icon('dice', 'ln-ic'), 'Zufall');
    container.append(formSlot, h('div', { class: 'recipe-toolbar' }, search, randomButton), filters, randomBox, count, listEl);

    ctx.addAction('+ Rezept', () => { editing = editing === 'new' ? null : 'new'; draw(); }, 'Rezept hinzufügen');
    search.addEventListener('input', () => { filter.query = search.value.trim(); drawList(); });

    // ---------- Filter ----------
    const drawFilters = () => {
      const tags = allTags();
      const duration = h('select', { class: 'select recipe-duration', 'aria-label': 'Höchstdauer' },
        ...DURATIONS.map(([min, label]) => h('option', { value: min }, label)));
      duration.value = String(filter.maxDuration);
      duration.addEventListener('change', () => { filter.maxDuration = Number(duration.value); drawList(); });
      const fav = h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(filter.favorites),
        onclick: () => { filter.favorites = !filter.favorites; drawFilters(); drawList(); },
      }, '★ Favoriten');
      filters.replaceChildren(fav, duration, ...tags.map(tag => h('button', {
        class: 'chip recipe-tag', type: 'button', 'aria-pressed': String(filter.tags.has(tag)),
        onclick: () => { filter.tags.has(tag) ? filter.tags.delete(tag) : filter.tags.add(tag); drawFilters(); drawList(); },
      }, tag)));
    };

    // ---------- Zufall ----------
    const roll = () => {
      const pool = recipes().filter(r => matches(r) && daysSince(r.lastCooked) >= RECENT_DAYS);
      // Möglichst nicht dasselbe Rezept zweimal hintereinander
      const others = pool.length > 1 && pick?.id ? pool.filter(r => r.id !== pick.id) : pool;
      pick = others.length ? { id: others[Math.floor(Math.random() * others.length)].id } : { none: true };
      drawRandom();
    };
    randomButton.addEventListener('click', roll);

    const drawRandom = () => {
      if (!pick) return randomBox.replaceChildren();
      if (pick.none || !list[pick.id] || list[pick.id].deleted) {
        return randomBox.replaceChildren(h('div', { class: 'recipe-pick' },
          h('p', { class: 'muted' }, `Kein passendes Rezept – alle passenden wurden in den letzten ${RECENT_DAYS} Tagen gekocht, oder die Filter sind zu eng.`),
          h('button', { class: 'chip', type: 'button', onclick: () => { pick = null; drawRandom(); } }, 'Schließen')));
      }
      const r = list[pick.id];
      randomBox.replaceChildren(h('div', { class: 'recipe-pick' },
        h('p', { class: 'recipe-pick-title' }, h('span', { class: 'muted small' }, 'Vorschlag: '), r.title),
        h('div', { class: 'study-form-row' },
          h('button', { class: 'chip', type: 'button', onclick: () => openRecipe(r.id) }, 'Ansehen'),
          h('button', { class: 'chip', type: 'button', onclick: roll }, 'Nochmal würfeln'),
          h('button', { class: 'chip chip--accent', type: 'button', onclick: () => cooked(r) }, 'Heute gekocht'),
          h('button', { class: 'icon-btn icon-btn--xs', type: 'button', 'aria-label': 'Vorschlag schließen', onclick: () => { pick = null; drawRandom(); } }, '×'))));
    };

    const cooked = async r => {
      await put({ ...r, lastCooked: isoDay() });
      notice.set(r.id, 'Als heute gekocht vermerkt.');
      if (pick?.id === r.id) pick = null;
      draw();
    };

    // ---------- Einkaufsliste ----------
    const toShopping = async (r, factor) => {
      const entries = (r.ingredients ?? []).map(ing => ({ name: ing.name, qty: qtyText(ing, factor) }));
      const { added, reopened, existing } = await addToShoppingList(entries);
      const fresh = added + reopened;
      const zutaten = n => `${n} ${n === 1 ? 'Zutat' : 'Zutaten'}`;
      notice.set(r.id, !fresh
        ? `${existing === 1 ? 'Die Zutat steht' : `Alle ${existing} Zutaten stehen`} schon auf der Einkaufsliste.`
        : `${zutaten(fresh)} auf die Einkaufsliste gesetzt${existing ? `, ${existing} ${existing === 1 ? 'stand' : 'standen'} schon drauf` : ''}.`);
      drawList();
    };

    // ---------- Liste und Detailansicht ----------
    const detail = r => {
      const base = r.servings || null;
      const current = portions.get(r.id) ?? base ?? 1;
      const factor = base ? current / base : 1;
      const setPortions = n => { portions.set(r.id, Math.max(1, Math.min(99, n))); drawList(); listEl.querySelector(`[data-portions="${r.id}"]`)?.focus(); };
      const isUrl = /^https?:\/\//i.test(r.source ?? '');
      return h('div', { class: 'recipe-detail' },
        base && h('div', { class: 'recipe-portions' },
          h('span', { class: 'muted' }, 'Portionen'),
          h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Eine Portion weniger', disabled: current <= 1, onclick: () => setPortions(current - 1) }, '−'),
          h('output', { class: 'recipe-portions-value', 'aria-live': 'polite', 'data-portions': r.id, tabindex: '-1' }, String(current)),
          h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Eine Portion mehr', onclick: () => setPortions(current + 1) }, '+'),
          current !== base && h('button', { class: 'chip', type: 'button', onclick: () => setPortions(base) }, `Original (${base})`)),
        r.ingredients?.length > 0 && h('ul', { class: 'recipe-ingredients' }, ...r.ingredients.map(ing => h('li', {}, ingredientText(ing, factor)))),
        r.steps && h('div', { class: 'recipe-steps' }, r.steps),
        h('p', { class: 'muted small recipe-meta' }, ...[
          r.source && (isUrl ? h('a', { href: r.source, target: '_blank', rel: 'noopener' }, 'Quelle ↗') : `Quelle: ${r.source}`),
          r.source && ' · ',
          r.lastCooked ? `Zuletzt gekocht: ${dateFmt.format(new Date(`${r.lastCooked}T12:00`))}` : 'Noch nie gekocht',
        ].filter(Boolean)),
        notice.has(r.id) && h('p', { class: 'recipe-notice', role: 'status' }, notice.get(r.id)),
        h('div', { class: 'study-form-row recipe-actions' },
          r.ingredients?.length > 0 && h('button', { class: 'chip chip--accent', type: 'button', onclick: () => toShopping(r, factor) },
            `Zutaten auf die Einkaufsliste${base && current !== base ? ` (${current} Portionen)` : ''}`),
          h('button', { class: 'chip', type: 'button', onclick: () => cooked(r) }, 'Heute gekocht'),
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = r.id; draw(); } }, 'Bearbeiten'),
          confirmButton({ class: 'chip' }, 'Löschen', 'Wirklich löschen?', async () => {
            await put({ ...r, deleted: true });
            expanded = null;
            draw();
          })));
    };

    const row = r => {
      const open = expanded === r.id;
      const meta = [r.duration && `${r.duration} min`, r.servings && `${r.servings} Port.`, ...(r.tags ?? [])].filter(Boolean).join(' · ');
      return h('li', { class: `recipe${open ? ' is-open' : ''}`, 'data-id': r.id },
        h('div', { class: 'recipe-head' },
          h('button', {
            class: 'recipe-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': `recipe-${r.id}`,
            onclick: () => { expanded = open ? null : r.id; drawList(); },
          },
          h('span', { class: 'recipe-title' }, r.title),
          meta && h('span', { class: 'recipe-sub muted' }, meta)),
          h('button', {
            class: 'icon-btn icon-btn--xs recipe-fav', type: 'button', 'aria-pressed': String(Boolean(r.favorite)),
            'aria-label': r.favorite ? `${r.title}: Favorit entfernen` : `${r.title} als Favorit merken`, title: 'Favorit',
            onclick: () => put({ ...r, favorite: !r.favorite }).then(drawList),
          }, r.favorite ? '★' : '☆')),
        open && h('div', { id: `recipe-${r.id}` }, detail(r)));
    };

    function drawList() {
      const all = recipes();
      const shown = all.filter(matches);
      ctx.setEmpty(!all.length && editing !== 'new');
      count.textContent = all.length && shown.length !== all.length ? `${shown.length} von ${all.length} Rezepten` : '';
      if (!all.length) {
        listEl.replaceChildren(h('li', { class: 'recipe-empty muted' }, 'Noch keine Rezepte. ',
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = 'new'; draw(); } }, '+ Rezept anlegen')));
        return;
      }
      listEl.replaceChildren(...(shown.length ? shown.map(row) : [h('li', { class: 'recipe-empty muted' }, 'Kein Rezept passt zu Suche und Filtern.')]));
    }

    // ---------- Formular ----------
    const drawForm = () => {
      if (!editing) return formSlot.replaceChildren();
      const r = editing === 'new' ? { title: '', tags: [], duration: null, servings: 2, source: '', steps: '', ingredients: [] } : list[editing];
      const field = (label, el) => h('label', { class: 'recipe-field' }, h('span', { class: 'muted small' }, label), el);
      const title = h('input', { type: 'text', value: r.title, required: true, maxlength: 120, 'aria-label': 'Titel' });
      const tags = h('input', { type: 'text', value: (r.tags ?? []).join(', '), placeholder: 'z. B. vegetarisch, schnell', maxlength: 200 });
      const duration = h('input', { type: 'number', min: 1, max: 1440, inputmode: 'numeric', value: r.duration ?? '' });
      const servings = h('input', { type: 'number', min: 1, max: 99, inputmode: 'numeric', value: r.servings ?? '' });
      const source = h('input', { type: 'text', value: r.source ?? '', placeholder: 'Link oder Buch, Seite', maxlength: 300 });
      const ingredients = h('textarea', { class: 'note-text recipe-textarea', rows: 6, placeholder: 'Eine Zutat pro Zeile, z. B.\n200 g Spaghetti\n2 EL Olivenöl\n1 Zehe Knoblauch\nSalz' },
        (r.ingredients ?? []).map(ing => ingredientText(ing)).join('\n'));
      const steps = h('textarea', { class: 'note-text recipe-textarea', rows: 6, placeholder: 'Zubereitung' }, r.steps ?? '');
      const error = h('p', { class: 'settings-error' });
      const form = h('form', { class: 'study-form recipe-form' },
        field('Titel', title),
        h('div', { class: 'recipe-form-row' }, field('Dauer (min)', duration), field('Portionen', servings)),
        field('Tags (mit Komma getrennt)', tags),
        field('Zutaten', ingredients),
        field('Schritte', steps),
        field('Quelle', source),
        error,
        h('div', { class: 'study-form-row' },
          h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern'),
          h('button', { class: 'chip', type: 'button', onclick: () => { editing = null; draw(); } }, 'Abbrechen')));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!clean(title.value)) return void (error.textContent = 'Bitte einen Titel eingeben.');
        const id = editing === 'new' ? uid() : editing;
        const number = el => (el.value ? Math.max(1, Math.round(Number(el.value))) || null : null);
        await put({
          ...(list[id] ?? { id, favorite: false, lastCooked: null, createdAt: Date.now() }),
          title: clean(title.value),
          tags: [...new Set(tags.value.split(',').map(clean).filter(Boolean))],
          duration: number(duration),
          servings: number(servings),
          source: clean(source.value),
          steps: steps.value.trim(),
          ingredients: ingredients.value.split('\n').map(parseIngredient).filter(Boolean),
        });
        editing = null;
        expanded = id;
        draw();
      });
      formSlot.replaceChildren(form);
      title.focus();
    };

    function draw() {
      drawForm();
      drawFilters();
      drawRandom();
      drawList();
    }

    // Von außen öffnen (Mensa-Kachel: „Heute selbst kochen?“)
    function openRecipe(id) {
      if (!list[id] || list[id].deleted) return;
      expanded = id;
      filter.query = '';
      search.value = '';
      drawList();
      requestAnimationFrame(() => listEl.querySelector(`[data-id="${CSS.escape(id)}"] .recipe-toggle`)?.focus());
    }
    const onOpen = event => {
      const dockButton = document.querySelector('[aria-controls="card-rezepte"]');
      if (ctx.root.hidden && dockButton) dockButton.click();
      openRecipe(event.detail);
      requestAnimationFrame(() => requestAnimationFrame(() => ctx.root.scrollIntoView({ block: 'nearest' })));
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    ctx.onCleanup(() => document.removeEventListener(OPEN_EVENT, onOpen));

    // Änderungen von anderen Geräten (Sync) oder Tabs – nicht mitten im Bearbeiten
    ctx.store.subscribe('list', value => {
      list = value ?? {};
      if (!editing) draw();
    });

    draw();
  },
};
