// Schlanker iCal-Parser (RFC 5545) ohne Abhängigkeiten.
//
//   parseICS(text)            -> [Ereignis, …]  (rohe VEVENTs)
//   expand(events, from, to)  -> [Termin, …]    (aufgelöste Termine im Zeitraum, sortiert)
//
// Termin: { uid, title, location, description, start, end, allDay, cancelled }  (Zeiten in ms)
//
// Unterstützt: TZID (IANA-Namen, z. B. Europe/Berlin, inkl. Sommer-/Winterzeit),
// UTC- und „floating“-Zeiten, ganztägige Termine, DTEND/DURATION,
// RRULE mit FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY,
// EXDATE, geänderte Einzeltermine (RECURRENCE-ID) und STATUS:CANCELLED.
// Nicht unterstützt: komplexe BY-Regeln für Monate/Jahre (z. B. „2. Dienstag“).

const DEFAULT_TZ = 'Europe/Berlin';
const MAX_ITERATIONS = 5000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------- Zeitzonen ----------

const offsetFormatters = new Map();

// Abstand der Zeitzone zu UTC (ms) zum Zeitpunkt t.
function tzOffset(t, tz) {
  if (!offsetFormatters.has(tz)) {
    offsetFormatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  const p = Object.fromEntries(offsetFormatters.get(tz).formatToParts(t).map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Wanduhrzeit in einer Zeitzone → UTC-Zeitstempel.
function zonedToUtc({ y, mo, d, h = 0, mi = 0, s = 0 }, tz) {
  if (tz === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, s);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  const corrected = guess - tzOffset(t, tz);
  if (corrected !== t) t = corrected; // an der Zeitumstellung nachjustieren
  return t;
}

// ---------- Zeilen und Werte ----------

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  // NAME;PARAM=WERT;PARAM="WERT":INHALT (Doppelpunkte in Anführungszeichen beachten)
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...rawParams] = head.split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

const unescapeText = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

// Datum/Zeit → { time, allDay, tz, parts }
function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const parts = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  const allDay = params.VALUE === 'DATE' || m[4] === undefined;
  let tz = DEFAULT_TZ;
  if (m[7]) tz = 'UTC';
  else if (params.TZID && validTz(params.TZID)) tz = params.TZID;
  return { time: zonedToUtc(parts, tz), allDay, tz, parts };
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseRule(value) {
  const rule = Object.fromEntries(value.split(';').map(p => p.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  return {
    freq: rule.FREQ,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: rule.COUNT ? Number(rule.COUNT) : null,
    until: rule.UNTIL ? parseDate(rule.UNTIL, {})?.time ?? null : null,
    byDay: rule.BYDAY ? rule.BYDAY.split(',').map(d => WEEKDAYS.indexOf(d.slice(-2))).filter(d => d >= 0) : null,
  };
}

// ---------- Parser ----------

export function parseICS(text) {
  const events = [];
  let current = null;
  let depth = 0; // verschachtelte Komponenten (z. B. VALARM) überspringen

  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const { name, params, value } = parseLine(line);

    if (name === 'BEGIN') {
      if (value.toUpperCase() === 'VEVENT' && !current) current = { exdates: [] };
      else if (current) depth++;
      continue;
    }
    if (name === 'END') {
      if (current && depth > 0) depth--;
      else if (current && value.toUpperCase() === 'VEVENT') {
        if (current.start) events.push(current);
        current = null;
      }
      continue;
    }
    if (!current || depth > 0) continue;

    switch (name) {
      case 'UID': current.uid = value.trim(); break;
      case 'SUMMARY': current.title = unescapeText(value); break;
      case 'LOCATION': current.location = unescapeText(value); break;
      case 'DESCRIPTION': current.description = unescapeText(value); break;
      case 'STATUS': current.cancelled = value.trim().toUpperCase() === 'CANCELLED'; break;
      case 'DTSTART': current.start = parseDate(value, params); break;
      case 'DTEND': current.end = parseDate(value, params); break;
      case 'DURATION': current.duration = parseDuration(value); break;
      case 'RRULE': current.rule = parseRule(value); break;
      case 'EXDATE':
        for (const v of value.split(',')) {
          const date = parseDate(v, params);
          if (date) current.exdates.push(date.time);
        }
        break;
      case 'RECURRENCE-ID': current.recurrenceId = parseDate(value, params)?.time ?? null; break;
      default: break;
    }
  }
  return events;
}

// ---------- Wiederholungen auflösen ----------

function eventLength(event) {
  if (event.end) return event.end.time - event.start.time;
  if (event.duration) return event.duration;
  return event.start.allDay ? 86400000 : 0;
}

// Kalenderdatum (ohne Zeitzone) um n Tage/Monate verschieben.
function shiftDate({ y, mo, d }, days = 0, months = 0) {
  const date = new Date(Date.UTC(y, mo - 1 + months, d + days));
  return { y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate() };
}
const weekday = ({ y, mo, d }) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

// Startzeitpunkte einer Serie bis `to`. Gerechnet wird in der Wanduhrzeit der
// Zeitzone von DTSTART, damit „jeden Montag 10:30“ auch nach der Zeitumstellung 10:30 bleibt.
function* occurrences(event, to) {
  const { start, rule } = event;
  const { parts, tz } = start;
  const time = { h: parts.h, mi: parts.mi, s: parts.s };
  const at = date => (start.allDay ? zonedToUtc(date, DEFAULT_TZ) : zonedToUtc({ ...date, ...time }, tz));
  const limit = rule.until ?? Infinity;
  let emitted = 0;

  const emit = function* (date) {
    const t = at(date);
    if (t < start.time) return false;
    if (t > limit || t > to || (rule.count && emitted >= rule.count)) return true;
    emitted++;
    yield t;
    return false;
  };

  let base = { y: parts.y, mo: parts.mo, d: parts.d };
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (rule.freq === 'WEEKLY') {
      // Woche ab Montag; alle gewünschten Wochentage dieser Woche
      const monday = shiftDate(base, -((weekday(base) + 6) % 7));
      const days = (rule.byDay ?? [weekday({ y: parts.y, mo: parts.mo, d: parts.d })])
        .map(wd => (wd + 6) % 7).sort((a, b) => a - b);
      for (const offset of days) {
        if (yield* emit(shiftDate(monday, offset))) return;
      }
      base = shiftDate(monday, 7 * rule.interval);
    } else if (rule.freq === 'DAILY') {
      if (!rule.byDay || rule.byDay.includes(weekday(base))) {
        if (yield* emit(base)) return;
      }
      base = shiftDate(base, rule.interval);
    } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
      const months = rule.freq === 'MONTHLY' ? rule.interval * (i + 1) : 12 * rule.interval * (i + 1);
      if (yield* emit(base)) return;
      base = shiftDate({ y: parts.y, mo: parts.mo, d: parts.d }, 0, months);
    } else {
      if (yield* emit(base)) return; // unbekannte Regel: nur der erste Termin
      return;
    }
  }
}

function toOccurrence(event, start, length) {
  return {
    uid: event.uid ?? '',
    title: event.title ?? '(ohne Titel)',
    location: event.location ?? '',
    description: event.description ?? '',
    start,
    end: start + length,
    allDay: event.start.allDay,
    cancelled: Boolean(event.cancelled),
  };
}

export function expand(events, from, to) {
  // Geänderte Einzeltermine nach UID und ursprünglichem Start
  const overrides = new Map();
  for (const e of events) {
    if (e.recurrenceId != null) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  }

  const result = [];
  // Im Zeitraum, wenn er hineinragt (Termine ohne Dauer: wenn sie darin beginnen).
  const add = o => {
    if (o.start < to && (o.end > from || (o.end === o.start && o.start >= from))) result.push(o);
  };

  for (const event of events) {
    if (event.recurrenceId != null) continue;
    const length = eventLength(event);

    if (!event.rule) {
      add(toOccurrence(event, event.start.time, length));
      continue;
    }
    const excluded = new Set(event.exdates);
    for (const start of occurrences(event, to)) {
      if (excluded.has(start)) continue;
      const override = overrides.get(`${event.uid}|${start}`);
      if (override) continue; // wird unten separat eingefügt
      add(toOccurrence(event, start, length));
    }
  }

  // Geänderte Einzeltermine (auch abgesagte, die dann als cancelled erscheinen)
  for (const override of overrides.values()) {
    add(toOccurrence(override, override.start.time, eventLength(override)));
  }

  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}
