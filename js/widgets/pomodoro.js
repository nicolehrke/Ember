// Pomodoro-Betriebsart für das Lernzeit-Widget (Hilfsmodul, kein eigenes Widget).
//
// Gerechnet wird nur mit Zeitstempeln: Eine Phase speichert Start, geplantes
// Ende, Pausenbeginn und Pausensumme. Die Restzeit wird daraus abgeleitet,
// dadurch stimmt sie auch nach Neuladen, in gedrosselten Hintergrund-Tabs und
// auf dem iPad.
//
// Daten:
//   ctx.store 'pomodoro'          aktueller Zustand (wird synchronisiert)
//   ctx.store 'pomodoroSettings'  Dauern, Runden, Autostart (wird synchronisiert)
//   ctx.cache 'pomodoroAlerts'    Ton/Benachrichtigung (nur dieses Gerät, Standard: aus)
//
// Zustand: null | { phase, round, subjectId, start, end, pausedAt, pausedTotal }
//          | { phase, round, subjectId, waiting: true }      nächste Phase wartet auf Start
//          | { …Phase, expired: true }                       Fokus lief ab, als niemand zusah
import { h, confirmButton } from '../core/dom.js';
// Ton und Benachrichtigung kommen aus dem gemeinsamen Modul (auch für Timer und Wecker)
import { unlockAudio, playOnce, showNotification, requestNotifications, notificationCapability } from '../core/alerts.js';

export const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15, rounds: 4, autoStart: false };
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 90], rounds: [1, 12] };
const PHASES = {
  focus: { label: 'Fokus', icon: '🍅', badge: '●' },
  short: { label: 'Kurze Pause', icon: '☕', badge: '☕' },
  long: { label: 'Lange Pause', icon: '☕', badge: '☕' },
};
const MIN_SESSION = 60 * 1000;
// War die Seite zum Phasenende aktiv? Hintergrund-Tabs ticken mitunter nur
// einmal pro Minute; längere Lücken (Seite zu, iPad eingefroren) gelten als „nicht da“.
const ALIVE_GRACE = 3 * 60 * 1000;
const RING = 2 * Math.PI * 54;

const pad = n => String(n).padStart(2, '0');
export function countdown(ms) {
  const s = Math.ceil(ms / 1000);
  const hours = Math.floor(s / 3600);
  return hours ? `${hours}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const isActive = s => Boolean(s && !s.waiting && !s.expired);
const remaining = (s, now = Date.now()) => Math.max(0, s.end - (s.pausedAt ?? now));

export function createPomodoro({ ctx, getSubjectId, saveFocus, onChange }) {
  let settings = { ...DEFAULT_SETTINGS };
  let state = null;
  let alerts = { sound: false, notify: false };
  let lastTick = null; // letzter Tick dieser Seite – null direkt nach dem Laden
  let busy = false;

  // ---------- Elemente ----------
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 120 120');
  ring.setAttribute('class', 'pomo-ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.innerHTML = `<circle class="pomo-ring-track" cx="60" cy="60" r="54"/><circle class="pomo-ring-bar" cx="60" cy="60" r="54" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/>`;
  const bar = ring.querySelector('.pomo-ring-bar');
  const time = h('span', { class: 'pomo-time' });
  const phaseLabel = h('span', { class: 'pomo-phase' });
  const roundLabel = h('span', { class: 'pomo-round muted' });
  const primary = h('button', { class: 'chip chip--accent pomo-primary', type: 'button' });
  const skip = h('button', { class: 'chip', type: 'button' }, 'Überspringen');
  const cancel = confirmButton({ class: 'chip' }, 'Abbrechen', 'Wirklich abbrechen?', () => abort());
  const controls = h('div', { class: 'pomo-controls' }, primary, skip, cancel);
  const question = h('div', { class: 'pomo-question', hidden: true });
  const settingsBox = h('details', { class: 'pomo-settings' }, h('summary', {}, 'Pomodoro-Einstellungen'));

  const element = h('div', { class: 'pomo' },
    h('div', { class: 'pomo-main' },
      h('div', { class: 'pomo-dial' }, ring, h('div', { class: 'pomo-dial-text' }, time, phaseLabel)),
      h('div', { class: 'pomo-side' }, roundLabel, controls, question)),
    settingsBox);

  // ---------- Zustand speichern ----------
  const setState = async next => {
    state = next;
    await ctx.store.save('pomodoro', state);
    draw();
    onChange();
  };

  const phaseLength = phase => settings[phase] * 60 * 1000;

  const nextOf = s => (s.phase === 'focus'
    ? { phase: s.round % settings.rounds === 0 ? 'long' : 'short', round: s.round }
    : { phase: 'focus', round: s.phase === 'long' ? 1 : s.round + 1 });

  const startPhase = async ({ phase, round }) => {
    const now = Date.now();
    await setState({ phase, round, subjectId: getSubjectId(), start: now, end: now + phaseLength(phase), pausedAt: null, pausedTotal: 0 });
  };

  // Fokuszeit als normalen Lerneintrag speichern (nur tatsächlich gelaufene Zeit).
  const recordFocus = async (s, end) => {
    if (s.phase !== 'focus') return;
    const session = { id: `pomo-${s.start}`, subjectId: s.subjectId, start: s.start, end, pause: s.pausedTotal ?? 0 };
    if (session.end - session.start - session.pause >= MIN_SESSION) await saveFocus(session);
  };

  const goNext = async s => {
    const next = nextOf(s);
    if (settings.autoStart) await startPhase(next);
    else await setState({ ...next, subjectId: s.subjectId, waiting: true });
  };

  const announce = s => {
    const next = nextOf(s);
    const title = s.phase === 'focus' ? 'Fokus beendet' : 'Pause vorbei';
    const body = `Als Nächstes: ${PHASES[next.phase].label}${settings.autoStart ? ' (startet automatisch)' : ''}.`;
    if (alerts.sound) playOnce();
    if (alerts.notify) showNotification(title, body, 'pomodoro');
  };

  // ---------- Bedienung ----------
  primary.addEventListener('click', async () => {
    if (alerts.sound) unlockAudio(); // Ton erst nach Nutzeraktion erlaubt (Safari)
    if (!state) return startPhase({ phase: 'focus', round: 1 });
    if (state.waiting) return startPhase(state);
    if (!isActive(state)) return;
    const now = Date.now();
    if (state.pausedAt) {
      const paused = now - state.pausedAt;
      await setState({ ...state, pausedAt: null, end: state.end + paused, pausedTotal: (state.pausedTotal ?? 0) + paused });
    } else {
      await setState({ ...state, pausedAt: now });
    }
  });

  skip.addEventListener('click', async () => {
    if (!state) return;
    if (isActive(state)) {
      await recordFocus(state, state.pausedAt ?? Date.now());
      await goNext(state);
    } else if (state.waiting) {
      await setState({ ...nextOf(state), subjectId: state.subjectId, waiting: true });
    }
  });

  async function abort() {
    if (isActive(state)) await recordFocus(state, state.pausedAt ?? Date.now());
    await setState(null);
  }

  // ---------- Ablauf prüfen (pro Tick) ----------
  async function tick() {
    const now = Date.now();
    const alive = lastTick != null && now - lastTick < ALIVE_GRACE;
    lastTick = now;
    if (busy || !isActive(state) || state.pausedAt || now < state.end) return draw();
    busy = true;
    try {
      if (alive) {
        // Phase ist regulär abgelaufen, während das Dashboard offen war.
        const ended = state;
        await recordFocus(ended, ended.end);
        announce(ended);
        await goNext(ended);
      } else if (state.phase === 'focus') {
        // Seite war zu: keine Lernzeit erfinden, sondern nachfragen.
        await setState({ ...state, expired: true });
      } else {
        await setState({ ...nextOf(state), subjectId: state.subjectId, waiting: true });
      }
    } finally {
      busy = false;
    }
    return draw();
  }

  const answerExpired = async count => {
    if (!state?.expired) return;
    if (count) await recordFocus(state, state.end);
    await setState(null);
  };

  // ---------- Anzeige ----------
  function draw() {
    const now = Date.now();
    const s = state;
    const phase = s?.phase ?? 'focus';
    const total = phaseLength(phase);
    const rest = isActive(s) ? remaining(s, now) : total;
    const progress = isActive(s) ? 1 - rest / (s.end - s.start - (s.pausedTotal ?? 0) || 1) : 0;

    element.dataset.phase = phase;
    element.classList.toggle('is-paused', Boolean(s?.pausedAt));
    bar.setAttribute('stroke-dashoffset', String(RING * (1 - Math.min(1, Math.max(0, progress)))));
    time.textContent = countdown(rest);
    phaseLabel.textContent = s?.waiting ? `Als Nächstes: ${PHASES[phase].label}` : PHASES[phase].label;
    roundLabel.textContent = `Runde ${s?.round ?? 1} von ${settings.rounds}`;

    primary.textContent = !s ? 'Start'
      : s.waiting ? (phase === 'focus' ? 'Fokus starten' : 'Pause starten')
      : s.pausedAt ? 'Weiter' : 'Pause';
    skip.hidden = !s || Boolean(s.expired);
    cancel.hidden = !s || Boolean(s.expired);
    controls.hidden = Boolean(s?.expired);

    question.hidden = !s?.expired;
    if (s?.expired) {
      const minutes = Math.round((s.end - s.start - (s.pausedTotal ?? 0)) / 60000);
      question.replaceChildren(
        h('p', {}, `Die Fokusphase (${minutes} min, ${hhmm(s.start)}–${hhmm(s.end)}) ist abgelaufen, während das Dashboard nicht offen war. Als Lernzeit zählen?`),
        h('div', { class: 'study-form-row' },
          h('button', { class: 'chip chip--accent', type: 'button', onclick: () => answerExpired(true) }, 'Ja, zählen'),
          h('button', { class: 'chip', type: 'button', onclick: () => answerExpired(false) }, 'Nein, verwerfen')));
    }
  }

  // Kurzstatus für Kachelkopf und Tab-Titel, null wenn nichts läuft.
  const status = () => {
    if (!isActive(state)) return state?.expired ? { badge: '⚠︎ Fokus abgelaufen', title: '⚠︎ Fokus abgelaufen' } : null;
    const p = PHASES[state.phase];
    const rest = countdown(remaining(state));
    const label = state.pausedAt ? `${p.label} (pausiert)` : p.label;
    return {
      badge: `${p.badge} ${rest} ${label}`, title: `${p.icon} ${rest} ${label}`, ms: state.pausedAt ? Infinity : remaining(state),
      // für Fokus-Satz und -Ring
      phase: p.label, round: state.round, rounds: settings.rounds,
      time: rest, progress: 1 - remaining(state) / (state.end - state.start - (state.pausedTotal ?? 0) || 1),
    };
  };

  // Laufende Fokusphase für die Live-Summen der Übersicht.
  const liveSession = () => (isActive(state) && state.phase === 'focus'
    ? { id: 'pomodoro', subjectId: state.subjectId, start: state.start, end: Math.min(state.pausedAt ?? Date.now(), state.end), pause: state.pausedTotal ?? 0, live: true }
    : null);

  const setSubject = async id => {
    if (state && !state.expired) await setState({ ...state, subjectId: id });
  };

  // ---------- Einstellungen ----------
  const drawSettings = () => {
    const number = (key, label) => {
      const [min, max] = LIMITS[key];
      const input = h('input', { type: 'number', min, max, step: 1, inputmode: 'numeric', value: settings[key], 'aria-label': label });
      input.addEventListener('change', async () => {
        const value = Math.round(Number(input.value));
        if (!Number.isFinite(value) || value < min || value > max) {
          input.value = settings[key];
          return;
        }
        settings = { ...settings, [key]: value };
        await ctx.store.save('pomodoroSettings', settings);
        draw();
      });
      return h('label', { class: 'pomo-field' }, label, input);
    };
    const checkbox = (checked, label, onToggle) => {
      const input = h('input', { type: 'checkbox', checked });
      input.addEventListener('change', () => onToggle(input));
      return h('label', { class: 'pomo-check' }, input, label);
    };
    const notifySupported = 'Notification' in window;
    const notifyInfo = h('p', { class: 'muted small' });

    settingsBox.replaceChildren(
      h('summary', {}, 'Pomodoro-Einstellungen'),
      h('div', { class: 'pomo-fields' },
        number('focus', 'Fokus (min)'),
        number('short', 'Kurze Pause (min)'),
        number('long', 'Lange Pause (min)'),
        number('rounds', 'Runden bis lange Pause')),
      checkbox(settings.autoStart, 'Nächste Phase automatisch starten', async input => {
        settings = { ...settings, autoStart: input.checked };
        await ctx.store.save('pomodoroSettings', settings);
      }),
      checkbox(alerts.sound, 'Ton beim Phasenwechsel (dieses Gerät)', async input => {
        alerts = { ...alerts, sound: input.checked };
        if (input.checked) {
          unlockAudio();
          playOnce(); // Probeton
        }
        await ctx.cache.save('pomodoroAlerts', alerts);
      }),
      checkbox(alerts.notify && notifySupported && Notification.permission === 'granted', 'Benachrichtigung beim Phasenwechsel (dieses Gerät)', async input => {
        if (!input.checked) {
          alerts = { ...alerts, notify: false };
          await ctx.cache.save('pomodoroAlerts', alerts);
          return;
        }
        if (!notifySupported) {
          input.checked = false;
          notifyInfo.textContent = notificationCapability().text;
          return;
        }
        if (!(await requestNotifications())) {
          input.checked = false;
          notifyInfo.textContent = 'Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Website-Einstellungen des Browsers ändern.';
          return;
        }
        alerts = { ...alerts, notify: true };
        await ctx.cache.save('pomodoroAlerts', alerts);
        notifyInfo.textContent = '';
      }),
      notifyInfo,
      h('p', { class: 'muted small' },
        'Ton und Benachrichtigung kommen nur, solange Ember geöffnet ist (Klang und Lautstärke unter ⚙︎ → Timer & Wecker). Auf dem iPad (Safari) gibt es Benachrichtigungen nur für Web-Apps auf dem Home-Bildschirm, und Töne können stummgeschaltet sein. Den Stand siehst du immer im Tab-Titel und im Kopf dieser Kachel.'));
  };

  // ---------- Start ----------
  const init = async () => {
    settings = { ...DEFAULT_SETTINGS, ...(await ctx.store.load('pomodoroSettings', {})) };
    state = await ctx.store.load('pomodoro', null);
    alerts = { sound: false, notify: false, ...(await ctx.cache.load('pomodoroAlerts', {})) };
    ctx.store.subscribe('pomodoro', v => { state = v; draw(); onChange(); });
    ctx.store.subscribe('pomodoroSettings', v => { settings = { ...DEFAULT_SETTINGS, ...(v ?? {}) }; drawSettings(); draw(); });
    drawSettings();
    draw();
  };

  return { element, init, tick, status, liveSession, setSubject, isBusy: () => Boolean(state) };
}
