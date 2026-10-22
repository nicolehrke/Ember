// Widget „Wetter“ über Open-Meteo (https://open-meteo.com, kein API-Key nötig).
import { h, esc } from '../core/dom.js';
import { fetchJSON } from '../core/http.js';

const DEFAULT_LOCATION = { name: 'Aachen', region: 'Nordrhein-Westfalen, Deutschland', lat: 50.7766, lon: 6.0834 };
const HOURS_AHEAD = 24;

// WMO-Wettercodes → [Text, Symbol Tag, Symbol Nacht, Stimmung]
const WMO = {
  0: ['Klar', '☀️', '🌙', 'clear'],
  1: ['Überwiegend klar', '🌤️', '🌙', 'clear'],
  2: ['Teilweise bewölkt', '⛅', '☁️', 'cloudy'],
  3: ['Bedeckt', '☁️', '☁️', 'cloudy'],
  45: ['Nebel', '🌫️', '🌫️', 'fog'],
  48: ['Reifnebel', '🌫️', '🌫️', 'fog'],
  51: ['Leichter Niesel', '🌦️', '🌧️', 'rain'],
  53: ['Nieselregen', '🌦️', '🌧️', 'rain'],
  55: ['Starker Niesel', '🌧️', '🌧️', 'rain'],
  56: ['Gefrierender Niesel', '🌧️', '🌧️', 'rain'],
  57: ['Gefrierender Niesel', '🌧️', '🌧️', 'rain'],
  61: ['Leichter Regen', '🌦️', '🌧️', 'rain'],
  63: ['Regen', '🌧️', '🌧️', 'rain'],
  65: ['Starker Regen', '🌧️', '🌧️', 'rain'],
  66: ['Gefrierender Regen', '🌧️', '🌧️', 'rain'],
  67: ['Gefrierender Regen', '🌧️', '🌧️', 'rain'],
  71: ['Leichter Schneefall', '🌨️', '🌨️', 'snow'],
  73: ['Schneefall', '🌨️', '🌨️', 'snow'],
  75: ['Starker Schneefall', '❄️', '❄️', 'snow'],
  77: ['Schneegriesel', '🌨️', '🌨️', 'snow'],
  80: ['Leichte Schauer', '🌦️', '🌧️', 'rain'],
  81: ['Regenschauer', '🌧️', '🌧️', 'rain'],
  82: ['Heftige Schauer', '⛈️', '⛈️', 'storm'],
  85: ['Schneeschauer', '🌨️', '🌨️', 'snow'],
  86: ['Starke Schneeschauer', '❄️', '❄️', 'snow'],
  95: ['Gewitter', '⛈️', '⛈️', 'storm'],
  96: ['Gewitter mit Hagel', '⛈️', '⛈️', 'storm'],
  99: ['Gewitter mit Hagel', '⛈️', '⛈️', 'storm'],
};

function wmo(code, isDay = 1) {
  const [text, day, night, mood] = WMO[code] ?? ['Unbekannt', '🌡️', '🌡️', 'cloudy'];
  return {
    text,
    icon: isDay ? day : night,
    mood: mood === 'clear' && !isDay ? 'clear-night' : mood,
  };
}

const locationKey = loc => `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const round = n => Math.round(n);

function forecastUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 7,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function geocodeUrl(query) {
  const params = new URLSearchParams({ name: query, count: 6, language: 'de', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${params}`;
}

async function update(content, ctx) {
  const loc = await ctx.store.load('location', DEFAULT_LOCATION);
  let data;
  let fetchedAt;
  let problem = null;

  try {
    data = await fetchJSON(forecastUrl(loc));
    fetchedAt = Date.now();
    await ctx.store.save('cache', { key: locationKey(loc), fetchedAt, data });
  } catch (err) {
    // Offline oder Server-Fehler: letzte bekannte Daten zeigen, falls vorhanden.
    const cache = await ctx.store.load('cache');
    if (cache?.key !== locationKey(loc)) throw err;
    ({ data, fetchedAt } = cache);
    problem = err.message;
  }

  draw(content, loc, data, ctx);
  ctx.setStatus(problem
    ? `⚠️ ${problem} Daten von ${timeFmt.format(fetchedAt)} Uhr.`
    : `Aktualisiert ${timeFmt.format(fetchedAt)} Uhr · Daten: Open-Meteo`);
}

function draw(content, loc, data, ctx) {
  const { current, hourly, daily } = data;
  const now = wmo(current.weather_code, current.is_day);
  ctx.card.dataset.mood = now.mood;

  // Stündlicher Verlauf ab der aktuellen Stunde (Zeiten sind Ortszeit-Strings).
  const currentHour = current.time.slice(0, 13) + ':00';
  const start = Math.max(0, hourly.time.findIndex(t => t >= currentHour));
  const hours = hourly.time.slice(start, start + HOURS_AHEAD).map((t, i) => {
    const j = start + i;
    const w = wmo(hourly.weather_code[j], hourly.is_day[j]);
    const rain = hourly.precipitation_probability[j];
    return `
      <li class="wx-hour${i === 0 ? ' is-now' : ''}" title="${esc(w.text)}">
        <span>${i === 0 ? 'Jetzt' : `${t.slice(11, 13)} Uhr`}</span>
        <span class="wx-hour-icon" aria-hidden="true">${w.icon}</span>
        <span class="wx-hour-temp">${round(hourly.temperature_2m[j])}°</span>
        <span class="wx-rain">${rain >= 10 ? `💧${rain}%` : ''}</span>
      </li>`;
  }).join('');

  // Tagesvorschau mit Temperaturspanne relativ zur ganzen Woche.
  const lo = Math.min(...daily.temperature_2m_min);
  const hi = Math.max(...daily.temperature_2m_max);
  const span = Math.max(1, hi - lo);
  const days = daily.time.map((d, i) => {
    const w = wmo(daily.weather_code[i]);
    const min = daily.temperature_2m_min[i];
    const max = daily.temperature_2m_max[i];
    const rain = daily.precipitation_probability_max[i];
    const label = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : weekdayFmt.format(new Date(`${d}T12:00`));
    return `
      <li class="wx-day" title="${esc(w.text)}">
        <span class="wx-day-name">${label}</span>
        <span class="wx-day-icon" aria-hidden="true">${w.icon}</span>
        <span class="wx-rain">${rain >= 10 ? `💧${rain}%` : ''}</span>
        <span class="wx-day-min">${round(min)}°</span>
        <span class="wx-range"><span style="left:${((min - lo) / span) * 100}%;width:${((max - min) / span) * 100}%"></span></span>
        <span class="wx-day-max">${round(max)}°</span>
      </li>`;
  }).join('');

  content.innerHTML = `
    <div class="wx-now">
      <span class="wx-icon" aria-hidden="true">${now.icon}</span>
      <div>
        <div class="wx-temp">${round(current.temperature_2m)}°</div>
        <div class="wx-desc">${esc(now.text)}</div>
      </div>
      <div class="wx-meta">
        <span class="wx-place">${esc(loc.name)}</span>
        <span>Gefühlt ${round(current.apparent_temperature)}°</span>
        <span>💨 ${round(current.wind_speed_10m)} km/h · 💧 ${round(current.relative_humidity_2m)} %</span>
      </div>
    </div>
    <ol class="wx-hours" aria-label="Nächste Stunden">${hours}</ol>
    <ol class="wx-days" aria-label="Nächste Tage">${days}</ol>`;
}

function buildPicker(picker, ctx) {
  const input = h('input', { type: 'search', placeholder: 'Ort suchen, z. B. Köln', 'aria-label': 'Ort suchen', autocomplete: 'off' });
  const results = h('ul', { class: 'wx-results' });

  const choose = async loc => {
    await ctx.store.save('location', loc);
    picker.hidden = true;
    results.replaceChildren();
    input.value = '';
    ctx.refresh();
  };

  const search = async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    results.replaceChildren(h('li', { class: 'muted' }, 'Suche …'));
    try {
      const { results: places = [] } = await fetchJSON(geocodeUrl(query));
      if (!places.length) {
        results.replaceChildren(h('li', { class: 'muted' }, 'Kein Ort gefunden.'));
        return;
      }
      results.replaceChildren(...places.map(p => {
        const region = [p.admin1, p.country].filter(Boolean).join(', ');
        const loc = { name: p.name, region, lat: p.latitude, lon: p.longitude };
        return h('li', {},
          h('button', { class: 'wx-result', type: 'button', onclick: () => choose(loc) },
            p.name, h('span', { class: 'muted' }, region)));
      }));
    } catch (err) {
      results.replaceChildren(h('li', {}, `⚠️ ${err.message}`));
    }
  };

  picker.append(
    h('form', { class: 'wx-search', onsubmit: search },
      input,
      h('button', { class: 'chip', type: 'submit' }, 'Suchen')),
    results,
    h('div', {},
      h('button', { class: 'chip', type: 'button', onclick: () => choose(DEFAULT_LOCATION) }, '↺ Aachen')));

  return input;
}

export default {
  id: 'weather',
  title: 'Wetter',
  icon: '🌦️',
  size: 'wide',
  refreshInterval: 15 * 60 * 1000,

  async render(container, ctx) {
    const picker = h('div', { class: 'wx-picker', hidden: true });
    const content = h('div', { class: 'wx-content' });
    container.append(picker, content);

    const input = buildPicker(picker, ctx);
    ctx.addAction('📍 Ort', () => {
      picker.hidden = !picker.hidden;
      if (!picker.hidden) input.focus();
    }, 'Ort ändern');

    await update(content, ctx);
  },

  async refresh(container, ctx) {
    await update(container.querySelector('.wx-content'), ctx);
  },
};
