// Widget „Stundenplan“: RWTHonline-Kalender per iCal (Abo-Link oder Datei-Import).
// Kompakt im Kopfbereich (nächster Termin mit Countdown), Details per Klick.
//
// Der Abo-Link enthält einen persönlichen Schlüssel. Er wird deshalb nur über
// ctx.cache gespeichert (Bereich local/: bleibt auf dem Gerät, nie im Gist-Sync)
// und weder angezeigt noch geloggt.
import { h, confirmButton } from '../core/dom.js';
import { fetchText } from '../core/http.js';
import { popover } from '../core/popover.js';
import { parseICS, expand } from '../core/ical.js';

const DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_PAGE = 2;
const MAX_OFFSET = 14;
const LOOKAHEAD = 7 * DAY;
const MIN_GAP = 30 * 60 * 1000;

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const stampFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

function span(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return min % 60 ? `${hours}:${String(min % 60).padStart(2, '0')} h` : `${hours} h`;
  const days = Math.round(min / 1440);
  return days === 1 ? '1 Tag' : `${days} Tagen`;
}

function dayLabel(day) {
  const today = dayStart(Date.now());
  if (day === today) return 'Heute';
  if (day === addDays(today, 1)) return 'Morgen';
  return dayFmt.format(day);
}

// webcal:// in https:// umwandeln; relative Pfade (Beispieldatei) zulassen.
function normalizeUrl(input) {
  const value = input.trim().replace(/^webcal:\/\//i, 'https://');
  const url = new URL(value, location.href);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Bitte einen http(s)- oder webcal-Link eingeben.');
  return url.href;
}

function explain(err) {
  if (err.code === 'network' && navigator.onLine) {
    return 'Kalender nicht abrufbar – RWTHonline blockiert den direkten Abruf (CORS) oder ist nicht erreichbar. Als Ausweg die .ics-Datei importieren.';
  }
  return err.message;
}

const calendarIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic ic-calendar');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
  return svg;
};

let panelControl;

export default {
  id: 'timetable',
  title: 'Stundenplan',
  placement: 'header',
  refreshInterval: 30 * 60 * 1000,

  async render(container, ctx) {
    const toggle = h('button', { class: 'tt-toggle', type: 'button', 'aria-controls': 'tt-panel' });
    const prev = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Frühere Tage' }, '‹');
    const next = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Spätere Tage' }, '›');
    const navLabel = h('span', { class: 'tt-nav-label' });
    const nav = h('div', { class: 'tt-nav' }, prev, navLabel, next);
    const days = h('div', { class: 'tt-days' });
    const setup = h('div', { class: 'tt-setup', hidden: true });
    const status = h('p', { class: 'tt-status muted' });
    const setupButton = h('button', { class: 'chip', type: 'button' }, 'Einrichten');
    const footer = h('div', { class: 'tt-footer' }, status, setupButton);
    const panel = h('div', { class: 'popover tt-panel', id: 'tt-panel', hidden: true }, nav, days, setup, footer);
    container.append(toggle, panel);

    panelControl?.destroy();
    panelControl = popover(toggle, panel, container);

    const state = { events: [], data: null, url: '', problem: null, offset: 0 };

    // ---------- Kompakte Anzeige ----------
    const drawToggle = () => {
      const now = Date.now();
      const label = h('span', { class: 'tt-toggle-text' });
      let title = 'Stundenplan';

      if (!state.data) {
        label.textContent = state.problem ? 'Stundenplan ⚠︎' : 'Stundenplan einrichten';
        title = state.problem ?? 'Stundenplan einrichten';
      } else {
        const upcoming = expand(state.events, now, now + LOOKAHEAD).filter(o => !o.cancelled && !o.allDay);
        const current = upcoming.find(o => o.start <= now && o.end > now);
        const following = upcoming.find(o => o.start > now);
        if (current) {
          label.append(h('strong', {}, 'Jetzt '), `${current.title} · noch ${span(current.end - now)}`);
          title = `${current.title}, ${timeFmt.format(current.start)}–${timeFmt.format(current.end)}${current.location ? `, ${current.location}` : ''}`;
        } else if (following) {
          const when = dayStart(following.start) === dayStart(now)
            ? timeFmt.format(following.start)
            : `${shortDayFmt.format(following.start)} ${timeFmt.format(following.start)}`;
          label.append(h('strong', {}, when), ` ${following.title} · in ${span(following.start - now)}`);
          title = `${following.title}${following.location ? `, ${following.location}` : ''}`;
        } else {
          label.textContent = 'Keine Termine';
        }
        if (state.problem) title += ` – ${state.problem}`;
      }
      toggle.replaceChildren(calendarIcon(), label);
      toggle.classList.toggle('is-stale', Boolean(state.problem));
      toggle.title = `${title} – Details anzeigen`;
    };

    // ---------- Detailansicht ----------
    const drawDay = day => {
      const now = Date.now();
      const list = expand(state.events, day, addDays(day, 1));
      const allDay = list.filter(o => o.allDay);
      const timed = list.filter(o => !o.allDay);
      const rows = [];

      for (const o of allDay) {
        rows.push(h('li', { class: `tt-allday${o.cancelled ? ' is-cancelled' : ''}` }, o.title, o.cancelled && h('span', { class: 'tt-flag' }, 'entfällt')));
      }
      let lastEnd = null;
      for (const o of timed) {
        if (!o.cancelled && lastEnd != null && o.start - lastEnd >= MIN_GAP) {
          rows.push(h('li', { class: 'tt-gap' }, `frei · ${span(o.start - lastEnd)}`));
        }
        const running = !o.cancelled && o.start <= now && o.end > now;
        const past = o.end <= now;
        rows.push(h('li', { class: `tt-event${running ? ' is-now' : ''}${past ? ' is-past' : ''}${o.cancelled ? ' is-cancelled' : ''}` },
          h('span', { class: 'tt-time' }, timeFmt.format(o.start), h('br'), h('span', { class: 'muted' }, timeFmt.format(o.end))),
          h('div', { class: 'tt-info' },
            h('span', { class: 'tt-title' }, o.title),
            o.location && h('span', { class: 'tt-room muted' }, o.location),
            running && h('span', { class: 'tt-flag tt-flag--now' }, `läuft · noch ${span(o.end - now)}`),
            o.cancelled && h('span', { class: 'tt-flag' }, 'entfällt'),
            o.description && h('details', { class: 'tt-desc' }, h('summary', {}, 'Beschreibung'), h('p', {}, o.description)))));
        if (!o.cancelled) lastEnd = Math.max(lastEnd ?? 0, o.end);
      }
      if (!rows.length) rows.push(h('li', { class: 'tt-empty muted' }, 'Keine Termine'));

      return h('section', { class: 'tt-day' },
        h('h3', { class: 'tt-day-title' }, dayLabel(day)),
        h('ul', { class: 'tt-list' }, rows));
    };

    const drawPanel = () => {
      const configured = Boolean(state.data);
      nav.hidden = !configured;
      days.hidden = !configured;
      if (configured) {
        const first = addDays(dayStart(Date.now()), state.offset);
        prev.disabled = state.offset <= 0;
        next.disabled = state.offset >= MAX_OFFSET;
        navLabel.textContent = state.offset === 0 ? 'Heute & Morgen'
          : `${shortDayFmt.format(first)} – ${shortDayFmt.format(addDays(first, DAYS_PER_PAGE - 1))}`;
        days.replaceChildren(...Array.from({ length: DAYS_PER_PAGE }, (_, i) => drawDay(addDays(first, i))));
      }
      if (!configured) setup.hidden = false;
      setupButton.hidden = !configured;
      panel.classList.toggle('is-unconfigured', !configured);

      let text = '';
      if (state.data?.source === 'url') text = `Aktualisiert ${stampFmt.format(state.data.fetchedAt)} Uhr`;
      if (state.data?.source === 'file') text = `Aus Datei „${state.data.name}“ vom ${stampFmt.format(state.data.fetchedAt)} Uhr`;
      status.replaceChildren(...[
        state.problem && h('span', { class: 'tt-problem' }, state.problem),
        text,
      ].filter(Boolean));
      footer.hidden = !configured && !state.problem;
    };

    const drawAll = () => {
      drawToggle();
      if (!panel.hidden) drawPanel();
    };
    panel.addEventListener('popover-close', () => { state.offset = 0; });
    toggle.addEventListener('click', drawPanel);
    prev.addEventListener('click', () => { state.offset = Math.max(0, state.offset - DAYS_PER_PAGE); drawPanel(); });
    next.addEventListener('click', () => { state.offset = Math.min(MAX_OFFSET, state.offset + DAYS_PER_PAGE); drawPanel(); });
    setupButton.addEventListener('click', () => { setup.hidden = !setup.hidden; drawSetup(); });

    // ---------- Einrichtung ----------
    const fileInput = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true });
    const setupInfo = h('p', { class: 'tt-setup-info' });

    const drawSetup = () => {
      const input = h('input', { type: 'url', placeholder: 'https://online.rwth-aachen.de/…', 'aria-label': 'iCal-Abo-Link', autocomplete: 'off', spellcheck: 'false' });
      // novalidate: webcal://-Links und relative Pfade prüft normalizeUrl() selbst
      const form = h('form', { class: 'settings-form', novalidate: true }, input, h('button', { class: 'chip chip--accent', type: 'submit' }, 'Speichern'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        try {
          const url = normalizeUrl(input.value);
          await ctx.cache.save('url', url);
          setupInfo.textContent = 'Gespeichert, lade Kalender …';
          input.value = '';
          setup.hidden = true;
          ctx.refresh();
        } catch (err) {
          setupInfo.textContent = err instanceof TypeError ? 'Das ist kein gültiger Link.' : err.message;
        }
      });

      setup.replaceChildren(...[
        h('h2', { class: 'card-title' }, state.data ? 'Einrichtung' : 'Stundenplan einrichten'),
        h('p', { class: 'muted' }, 'So findest du den Link: In RWTHonline deinen Terminkalender öffnen, dort die Export- bzw. Abo-Funktion (iCal) wählen und den Abo-Link kopieren. Der Link ist persönlich – behandle ihn wie ein Passwort.'),
        state.url
          ? h('div', { class: 'tt-saved' },
            h('span', {}, 'Abo-Link ist gespeichert (nur auf diesem Gerät).'),
            confirmButton({ class: 'chip' }, 'Link entfernen', 'Wirklich entfernen?', async () => {
              await ctx.cache.remove('url');
              setupInfo.textContent = 'Link entfernt. Der zuletzt geladene Stundenplan bleibt sichtbar, bis du ihn ersetzt.';
              ctx.refresh();
            }))
          : null,
        h('label', { class: 'tt-label' }, state.url ? 'Neuen Link eintragen' : 'iCal-Abo-Link'),
        form,
        h('div', { class: 'tt-import' },
          h('span', { class: 'muted' }, 'Oder ohne Link:'),
          h('button', { class: 'chip', type: 'button', onclick: () => fileInput.click() }, '.ics-Datei importieren')),
        setupInfo,
        fileInput,
      ].filter(Boolean));
    };

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Die Datei ist kein iCal-Kalender.');
        const events = parseICS(text);
        const data = { text, fetchedAt: Date.now(), source: 'file', name: file.name };
        if (!(await ctx.cache.save('ics', data))) throw new Error('Die Datei ist zu groß für den Gerätespeicher.');
        setupInfo.textContent = `${events.length} Einträge importiert.${state.url ? ' Hinweis: Beim nächsten Abruf über den Link wird die Datei ersetzt.' : ''}`;
        state.data = data;
        state.events = events;
        state.problem = null;
        drawAll();
      } catch (err) {
        setupInfo.textContent = err.message;
      }
    });

    // ---------- Laden ----------
    const load = async () => {
      state.url = await ctx.cache.load('url', '');
      const cached = await ctx.cache.load('ics', null);
      state.problem = null;
      state.data = cached;

      if (state.url) {
        try {
          const text = await fetchText(state.url, { timeout: 15000 });
          if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Der Link liefert keinen iCal-Kalender.');
          state.data = { text, fetchedAt: Date.now(), source: 'url' };
          await ctx.cache.save('ics', state.data);
        } catch (err) {
          state.problem = explain(err); // zuletzt gespeicherte Daten bleiben sichtbar
        }
      }

      state.events = state.data ? parseICS(state.data.text) : [];
      drawAll();
      if (!setup.hidden || !state.data) drawSetup();
    };

    container.timetableLoad = load;
    ctx.every(30 * 1000, drawAll);
    await load();
  },

  async refresh(container) {
    await container.timetableLoad();
  },
};
