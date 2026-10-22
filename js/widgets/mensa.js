// Widget „Mensa“: Speiseplan über die OpenMensa API v2 (https://openmensa.org/api/v2).
// Die API erlaubt Abrufe direkt aus dem Browser (CORS: Access-Control-Allow-Origin: *).
import { h } from '../core/dom.js';
import { fetchJSON } from '../core/http.js';

const API = 'https://openmensa.org/api/v2';

// Öffnungszeiten laut studierendenwerk-aachen.de (Stand Oktober 2026, Vorlesungszeit).
// OpenMensa liefert keine Öffnungszeiten; in der vorlesungsfreien Zeit können sie abweichen.
// Format: Wochentag (1 = Mo … 5 = Fr) → Liste von [von, bis].
const week = (monThu, fri) => ({ 1: monThu, 2: monThu, 3: monThu, 4: monThu, 5: fri });
const STANDARD = week([['11:30', '14:30']], [['11:30', '14:00']]);

// Canteen-IDs ermittelt über /canteens?near[lat]=50.7766&near[lng]=6.0834.
// Die Mensa Academica (187) ist dort nicht gelistet, aber per ID erreichbar;
// OpenMensa hat für sie derzeit keine Speisepläne (Stand Oktober 2026).
const CANTEENS = [
  { id: 94, name: 'Bistro Templergraben', mine: true, hours: week([['10:30', '18:00']], [['10:30', '14:30']]) },
  {
    id: 187, name: 'Mensa Academica', mine: true, hours: week([['11:30', '15:00']], [['11:30', '14:30']]),
    note: 'OpenMensa hat für die Mensa Academica derzeit keine Speisepläne. Laut Studierendenwerk ist sie zurzeit geschlossen, es gibt ein Interimsangebot.',
  },
  { id: 95, name: 'Mensa Ahornstraße', hours: STANDARD },
  { id: 96, name: 'Mensa Vita', hours: week([['11:30', '14:30']], [['11:30', '14:30']]) },
  { id: 97, name: 'Mensa Bayernallee', hours: STANDARD },
  { id: 98, name: 'Mensa Eupener Straße', hours: week([['11:15', '14:15'], ['14:30', '17:00']], [['11:15', '14:00']]) },
  { id: 1912, name: 'Mensa Bohr 4' },
  { id: 99, name: 'Gastro Goethe', hours: STANDARD },
  { id: 93, name: 'Forum Cafete' },
  { id: 100, name: 'Mensa Jülich', hours: STANDARD },
];
const DEFAULT_CANTEEN = 94;

// Ohne bekannte Öffnungszeiten springt das Widget ab 14:30 zum nächsten Öffnungstag.
const FALLBACK_CLOSE = '14:30';

const priceFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric' });

const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dayLabel(date) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (date === isoDate(today)) return 'Heute';
  if (date === isoDate(tomorrow)) return 'Morgen';
  return dayFmt.format(new Date(`${date}T12:00`));
}

const minutes = hm => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
const rangesOn = (canteen, date) => canteen.hours?.[date.getDay()] ?? [];

// Kurzer Öffnungsstatus, z. B. „Geöffnet bis 18:00“ oder „Öffnet morgen um 10:30“.
export function openingStatus(canteen, now = new Date()) {
  if (!canteen.hours) return null;
  const current = nowMinutes(now);
  const today = rangesOn(canteen, now);
  const open = today.find(([from, to]) => current >= minutes(from) && current < minutes(to));
  if (open) return { open: true, text: `Geöffnet bis ${open[1]}` };
  const later = today.find(([from]) => current < minutes(from));
  if (later) return { open: false, text: `Geschlossen · öffnet heute um ${later[0]}` };
  for (let i = 1; i <= 7; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const ranges = rangesOn(canteen, day);
    if (ranges.length) {
      const when = i === 1 ? 'morgen' : new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(day);
      return { open: false, text: `Geschlossen · öffnet ${when} um ${ranges[0][0]}` };
    }
  }
  return { open: false, text: 'Geschlossen' };
}

// Heute bis zum Ende der Öffnungszeit, danach der nächste Öffnungstag.
function defaultDay(openDays, canteen) {
  const now = new Date();
  const today = isoDate(now);
  const ranges = rangesOn(canteen, now);
  const close = ranges.length ? ranges[ranges.length - 1][1] : FALLBACK_CLOSE;
  const over = nowMinutes(now) >= minutes(close);
  const index = openDays.findIndex(d => d > today || (d === today && !over));
  let hint = null;
  if (index > 0 || (index === 0 && openDays[0] !== today)) {
    hint = openDays.includes(today) ? 'Die Ausgabe für heute ist vorbei.' : 'Heute geschlossen.';
  }
  return { index, hint };
}

// Lädt per fetchJSON und legt das Ergebnis im Cache ab; offline gibt es die letzte Version.
async function cachedFetch(ctx, key, url) {
  try {
    const data = await fetchJSON(url);
    const fetchedAt = Date.now();
    await ctx.cache.save(key, { data, fetchedAt });
    return { data, fetchedAt, problem: null };
  } catch (err) {
    const cache = await ctx.cache.load(key);
    if (!cache) throw err;
    return { ...cache, problem: err.message };
  }
}

function dietOf(meal) {
  if (meal.notes.includes('vegan')) return 'vegan';
  if (meal.notes.includes('OLV') || /vegetarisch/i.test(meal.category)) return 'vegetarisch';
  return null;
}

function drawMeals(list, meals) {
  // Beilagen ohne eigenen Preis als kurze Zeile ans Ende.
  const isSide = m => /beilage/i.test(m.category) && m.prices.students == null && m.prices.others == null;
  const mains = meals.filter(m => !isSide(m));
  const sides = meals.filter(isSide);

  if (!mains.length && !sides.length) {
    list.replaceChildren(h('p', { class: 'muted' }, 'Für diesen Tag sind keine Gerichte eingetragen.'));
    return;
  }

  const items = mains.map(meal => {
    const diet = dietOf(meal);
    const allergens = meal.notes.filter(n => n !== 'vegan' && n !== 'OLV');
    const { students } = meal.prices;
    return h('li', { class: 'meal', title: allergens.length ? `Enthält: ${allergens.join(', ')}` : null },
      h('div', { class: 'meal-text' },
        h('span', { class: 'meal-cat' }, meal.category),
        h('span', { class: 'meal-name' }, meal.name.split(/\s*\|\s*/).join(', ')),
        diet && h('span', { class: `tag tag-${diet}` }, diet)),
      h('div', { class: 'meal-price' },
        students != null && h('strong', {}, priceFmt.format(students))));
  });

  list.replaceChildren(...[
    h('ul', { class: 'meals' }, items),
    sides.length > 0 && h('p', { class: 'meal-sides muted' }, `Beilagen: ${sides.map(s => s.name).join(' · ')}`),
  ].filter(Boolean));
}

export default {
  id: 'mensa',
  title: 'Mensa',
  refreshInterval: 30 * 60 * 1000,

  async render(container, ctx) {
    const select = h('select', { class: 'select', 'aria-label': 'Mensa auswählen' },
      h('optgroup', { label: 'Meine Mensen' },
        CANTEENS.filter(c => c.mine).map(c => h('option', { value: c.id }, c.name))),
      h('optgroup', { label: 'Weitere' },
        CANTEENS.filter(c => !c.mine).map(c => h('option', { value: c.id }, c.name))));
    const prev = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Vorheriger Tag' }, '‹');
    const next = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Nächster Tag' }, '›');
    const label = h('span', { class: 'mensa-day' });
    const hint = h('p', { class: 'mensa-hint muted', hidden: true });
    const list = h('div', { class: 'mensa-list' });
    const nav = h('div', { class: 'mensa-nav' }, prev, label, next);

    const hours = h('p', { class: 'mensa-hours' });
    container.append(select, hours, nav, hint, list);

    // Öffnungsstatus; die ganze Woche als Tooltip
    const drawHours = () => {
      const status = state.canteen && openingStatus(state.canteen);
      hours.hidden = !status;
      if (!status) return;
      hours.className = `mensa-hours${status.open ? ' is-open' : ''}`;
      hours.textContent = status.text;
      const fmt = r => r.map(([a, b]) => `${a}–${b}`).join(', ');
      const hrs = state.canteen.hours;
      hours.title = `Mo–Do ${fmt(hrs[1])} · Fr ${fmt(hrs[5])} (laut Studierendenwerk, Vorlesungszeit)`;
    };

    // Zustand dieser Ansicht; bleibt bei automatischen Aktualisierungen erhalten.
    const state = { canteen: null, openDays: [], index: -1, picked: false, request: 0 };

    const showDay = async () => {
      const date = state.openDays[state.index];
      const request = ++state.request;
      label.textContent = dayLabel(date);
      prev.disabled = state.index <= 0;
      next.disabled = state.index >= state.openDays.length - 1;
      const { data, fetchedAt, problem } = await cachedFetch(ctx, `meals.${state.canteen.id}.${date}`,
        `${API}/canteens/${state.canteen.id}/days/${date}/meals`);
      // Beim schnellen Blättern nur die Antwort zum zuletzt gewählten Tag anzeigen.
      if (request !== state.request) return;
      drawMeals(list, data);
      ctx.setStatus(problem
        ? `${problem} Stand ${timeFmt.format(fetchedAt)} Uhr.`
        : `Aktualisiert ${timeFmt.format(fetchedAt)} Uhr · OpenMensa`);
    };

    const step = async delta => {
      state.index += delta;
      state.picked = true;
      hint.hidden = true;
      const request = state.request + 1;
      try {
        await showDay();
      } catch (err) {
        if (request === state.request) list.replaceChildren(h('p', { class: 'muted' }, err.message));
      }
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));

    const load = async () => {
      const id = Number(await ctx.store.load('canteen', DEFAULT_CANTEEN));
      state.canteen = CANTEENS.find(c => c.id === id) ?? CANTEENS[0];
      select.value = state.canteen.id;
      drawHours();

      const { data: days } = await cachedFetch(ctx, `days.${state.canteen.id}`, `${API}/canteens/${state.canteen.id}/days`);
      const today = isoDate(new Date());
      const current = state.openDays[state.index];
      state.openDays = days.filter(d => !d.closed && d.date >= today).map(d => d.date);

      if (!state.openDays.length) {
        state.request++;
        state.index = -1;
        nav.hidden = true;
        hint.hidden = true;
        list.replaceChildren(h('p', { class: 'muted' }, state.canteen.note ?? 'Derzeit sind keine Speisepläne verfügbar.'));
        ctx.setStatus('Quelle: OpenMensa');
        return;
      }

      nav.hidden = false;
      // Selbst gewählten Tag bei Aktualisierungen beibehalten, solange er noch gültig ist.
      if (state.picked && state.openDays.includes(current)) {
        state.index = state.openDays.indexOf(current);
      } else {
        const pick = defaultDay(state.openDays, state.canteen);
        state.index = pick.index === -1 ? state.openDays.length - 1 : pick.index;
        state.picked = false;
        hint.textContent = pick.hint ?? '';
        hint.hidden = !pick.hint;
      }
      await showDay();
    };

    select.addEventListener('change', async () => {
      await ctx.store.save('canteen', Number(select.value));
      state.picked = false;
      ctx.refresh();
    });

    container.mensaLoad = load;
    ctx.every(60 * 1000, drawHours);
    await load();
  },

  async refresh(container) {
    await container.mensaLoad();
  },
};
