// Widget „Stundenplan“: RWTHonline-Kalender per iCal über den eigenen Cloudflare Worker
// (oder als importierte .ics-Datei). Kompakt im Kopfbereich (nächster Termin mit Countdown),
// Details per Klick. Eingerichtet wird in den Einstellungen (Bereich „Kalender (RWTH)“).
//
// Der geheime RWTHonline-Link liegt nur im Worker (Secret ICAL_URL), nie in Ember.
// Ember kennt nur die Worker-Adresse ('timetable.worker', synchronisiert) und den
// Zugangsschlüssel ('local/timetable.key', nur auf diesem Gerät). Der Schlüssel geht als
// Authorization-Header mit, nicht in der Adresse, und wird weder angezeigt noch geloggt.
import { h } from '../core/dom.js';
import { load as loadKey, subscribe } from '../core/storage.js';
import { fetchText } from '../core/http.js';
import { popover } from '../core/popover.js';
import { parseICS, expand } from '../core/ical.js';
import { setFact } from '../core/briefing.js';

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

export const WORKER_KEY = 'timetable.worker';
export const ACCESS_KEY = 'local/timetable.key';
export const ICS_KEY = 'local/cache/timetable.ics';
export const RELOAD_EVENT = 'ember:timetable-reload';

// Abruf über den Worker; der Schlüssel steht im Header, nicht in der Adresse.
export async function fetchCalendar(worker, key, timeout = 15000) {
  return fetchText(worker, { timeout, headers: key ? { Authorization: `Bearer ${key}` } : undefined });
}

// webcal:// in https:// umwandeln; relative Pfade (Beispieldatei) zulassen.
export function normalizeUrl(input) {
  const value = input.trim().replace(/^webcal:\/\//i, 'https://');
  const url = new URL(value, location.href);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Bitte einen http(s)- oder webcal-Link eingeben.');
  return url.href;
}

// Ehrliche Erklärung für die Antworten des Workers (proxy/cloudflare-worker)
export function explain(err) {
  if (err.code === 'network' && navigator.onLine) {
    return `Worker nicht erreichbar – Adresse prüfen. Falls im Worker ALLOWED_ORIGINS gesetzt ist, muss ${location.origin} darin stehen.`;
  }
  if (err.status === 401) return 'Falscher Zugangsschlüssel – er muss genau dem Worker-Secret ACCESS_KEY entsprechen.';
  if (err.status === 403) return `Der Worker erlaubt diese Adresse nicht – ${location.origin} in ALLOWED_ORIGINS ergänzen.`;
  if (err.status === 500) return 'Der Worker ist nicht fertig eingerichtet (Secret ICAL_URL oder ACCESS_KEY fehlt).';
  if (err.status === 502) return 'Der Worker erreicht RWTHonline nicht, oder der Link dort ist abgelaufen – in RWTHonline einen neuen Link erzeugen und als ICAL_URL eintragen.';
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

// RWTHonline stellt die Modulnummer voran („41.00030 Maschinengestaltung …“) und hängt
// die Gruppe an („… VO, Standardgruppe“). Für die Anzeige fallen die Nummer (nur mit Punkt,
// damit Titel wie „3D-Druck“ bleiben) und die nichtssagende „Standardgruppe“ weg;
// Veranstaltungsart (VO, UE …) und echte Gruppen („Tutorium W3“) bleiben stehen.
export const cleanTitle = title => title
  .replace(/^\s*\d+(?:\.\d+)+[A-Za-z]?\s+/, '')
  .replace(/,\s*Standardgruppe\s*$/i, '');
export const readEvents = text => parseICS(text).map(e => (e.title ? { ...e, title: cleanTitle(e.title) } : e));

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

    const state = { events: [], data: null, worker: '', notice: null, problem: null, offset: 0 };

    // ---------- Kompakte Anzeige ----------
    const drawToggle = () => {
      const now = Date.now();
      const label = h('span', { class: 'tt-toggle-text' });
      let title = 'Stundenplan';

      if (!state.data) {
        setFact('timetable', null);
        label.textContent = state.problem ? 'Stundenplan ⚠︎' : 'Stundenplan einrichten';
        title = state.problem ?? 'Stundenplan einrichten';
      } else {
        const upcoming = expand(state.events, now, now + LOOKAHEAD).filter(o => !o.cancelled && !o.allDay);
        const current = upcoming.find(o => o.start <= now && o.end > now);
        const following = upcoming.find(o => o.start > now);
        setFact('timetable', {
          current: current ? { title: current.title, end: current.end } : null,
          next: following ? { title: following.title, start: following.start } : null,
        });
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
    setupButton.addEventListener('click', () => {
      panelControl?.setOpen(false);
      document.dispatchEvent(new CustomEvent('ember:settings', { detail: 'kalender' }));
    });

    // ---------- Einrichtung: in den Einstellungen ----------
    const openSettings = () => {
      panelControl?.setOpen(false);
      document.dispatchEvent(new CustomEvent('ember:settings', { detail: 'kalender' }));
    };
    const drawSetup = () => {
      setup.replaceChildren(
        h('h2', { class: 'card-title' }, 'Stundenplan einrichten'),
        h('p', { class: 'muted' }, 'Der Stundenplan kommt über deinen eigenen Cloudflare Worker. Worker-Adresse und Zugangsschlüssel trägst du in den Einstellungen unter „Kalender (RWTH)“ ein – dort kannst du auch eine .ics-Datei importieren.'),
        state.notice && h('p', { class: 'settings-error' }, state.notice),
        h('button', { class: 'chip chip--accent', type: 'button', onclick: openSettings }, 'Zu den Einstellungen'));
    };

    // ---------- Laden ----------
    const load = async () => {
      state.worker = await loadKey(WORKER_KEY, '');
      const key = await loadKey(ACCESS_KEY, '');
      state.notice = (await loadKey('local/timetable.notice', null)) === 'direct-link-removed'
        ? 'Der früher gespeicherte RWTHonline-Link wurde aus Sicherheitsgründen gelöscht. Bitte den Worker einrichten.'
        : null;
      const cached = await ctx.cache.load('ics', null);
      state.problem = null;
      state.data = cached;

      if (state.worker) {
        try {
          const text = await fetchCalendar(state.worker, key);
          if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Der Worker liefert keinen iCal-Kalender.');
          state.data = { text, fetchedAt: Date.now(), source: 'url' };
          await ctx.cache.save('ics', state.data);
        } catch (err) {
          state.problem = explain(err); // zuletzt gespeicherte Daten bleiben sichtbar
        }
      }

      state.events = state.data ? readEvents(state.data.text) : [];
      drawAll();
      if (!setup.hidden || !state.data) drawSetup();
    };

    container.timetableLoad = load;
    // Einstellungen geändert (Worker, Schlüssel, Datei) oder „Stundenplan neu laden“
    const reload = () => ctx.refresh();
    document.addEventListener(RELOAD_EVENT, reload);
    ctx.onCleanup(() => document.removeEventListener(RELOAD_EVENT, reload));
    ctx.onCleanup(subscribe(WORKER_KEY, reload));
    ctx.onCleanup(subscribe(ACCESS_KEY, reload));
    ctx.every(30 * 1000, drawAll);
    await load();
  },

  async refresh(container) {
    await container.timetableLoad();
  },
};
