// Gemeinsame Ton-, Benachrichtigungs- und Bildschirm-Funktionen für Pomodoro, Timer und Wecker.
//
// Ton: über die Web Audio API, ohne Dateien. Browser erlauben Ton erst nach einer
// Nutzeraktion – nach jedem Neuladen erneut. Der erste Klick/Tastendruck irgendwo in
// Ember schaltet ihn frei (unlock); bis dahin ist isAudioReady() false.
// Einstellungen pro Gerät in 'local/alerts': { sound, volume, notify, wakeLock, tabTitle, snooze }.
import { load, save, subscribe } from './storage.js';

const SETTINGS_KEY = 'local/alerts';
export const DEFAULT_SETTINGS = { sound: 'glocke', volume: 0.6, notify: false, wakeLock: false, tabTitle: true, snooze: 5 };

// ---------- Einstellungen ----------
let settings = { ...DEFAULT_SETTINGS };
const settingsReady = load(SETTINGS_KEY, {}).then(v => { settings = { ...DEFAULT_SETTINGS, ...(v && typeof v === 'object' ? v : {}) }; });
subscribe(SETTINGS_KEY, v => { settings = { ...DEFAULT_SETTINGS, ...(v ?? {}) }; notify(); });
export const getAlertSettings = () => settings;
export async function setAlertSettings(patch) {
  await settingsReady;
  settings = { ...settings, ...patch };
  await save(SETTINGS_KEY, settings);
}
export const alertSettingsReady = () => settingsReady;

// ---------- Zustand für die Oberfläche ----------
const listeners = new Set();
function notify() { for (const fn of listeners) fn(); }
export function onAlerts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Audio ----------
let audio = null;
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    if (!audio) {
      audio = new AC();
      audio.addEventListener?.('statechange', notify);
    }
    audio.resume?.().then(notify, () => {});
  } catch { /* ohne Ton weiter */ }
  return true;
}
export const isAudioReady = () => audio?.state === 'running';
export const audioSupported = () => Boolean(window.AudioContext || window.webkitAudioContext);

// Erster Klick oder Tastendruck irgendwo schaltet den Ton frei.
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => { if (!isAudioReady()) unlockAudio(); }, { capture: true, passive: true });
}

// Ein Ton: Sinus/Dreieck mit sanftem Ein- und Ausschwingen
function note(freq, at, length, peak, type = 'sine') {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

// Klänge – bewusst sanft und eher tief. Jeder Klang spielt ein kurzes Muster (Dauer in s).
export const SOUNDS = {
  glocke: { label: 'Glocke', length: 1.6, play: (t, v) => { note(660, t, 0.9, v); note(880, t + 0.2, 1.1, v * 0.8); } },
  marimba: { label: 'Marimba', length: 1.4, play: (t, v) => { [523, 659, 784].forEach((f, i) => note(f, t + i * 0.16, 0.45, v, 'triangle')); } },
  puls: { label: 'Sanfter Puls', length: 1.5, play: (t, v) => { note(440, t, 0.35, v * 0.8); note(440, t + 0.45, 0.35, v * 0.8); } },
  klangschale: { label: 'Klangschale', length: 3, play: (t, v) => { note(392, t, 2.6, v); note(394.5, t, 2.6, v * 0.5); note(784, t, 1.2, v * 0.2); } },
};

// Einmal abspielen (z. B. Pomodoro-Phasenwechsel, Testton)
export function playOnce(soundId = settings.sound, volume = settings.volume) {
  if (!audio) unlockAudio();
  if (!audio) return;
  const sound = SOUNDS[soundId] ?? SOUNDS.glocke;
  sound.play(audio.currentTime + 0.02, Math.max(0.0002, 0.25 * volume));
}

// In Dauerschleife bis stop(); beginnt leise und wird über 15 s lauter (nicht erschreckend).
export function playLoop(soundId = settings.sound, volume = settings.volume) {
  if (!audio) unlockAudio();
  if (!audio) return () => {};
  const sound = SOUNDS[soundId] ?? SOUNDS.glocke;
  const startedAt = Date.now();
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const ramp = Math.min(1, 0.3 + (Date.now() - startedAt) / 15000 * 0.7);
    sound.play(audio.currentTime + 0.02, Math.max(0.0002, 0.25 * volume * ramp));
    timer = setTimeout(step, (sound.length + 0.4) * 1000);
  };
  let timer = null;
  step();
  return () => { stopped = true; clearTimeout(timer); };
}

// ---------- Benachrichtigungen ----------
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// Was geht auf diesem Gerät? { available, text }
export function notificationCapability() {
  if (!('Notification' in window)) {
    return {
      available: false,
      text: isIOS() && !isStandalone()
        ? 'Auf iPad/iPhone gibt es Benachrichtigungen nur, wenn Ember über Teilen → „Zum Home-Bildschirm“ als App geöffnet wird (ab iOS 16.4).'
        : 'Dieser Browser unterstützt keine Benachrichtigungen.',
    };
  }
  if (Notification.permission === 'denied') return { available: false, text: 'Benachrichtigungen sind für Ember blockiert – das lässt sich in den Website-Einstellungen des Browsers ändern.' };
  return { available: true, text: 'Benachrichtigungen erscheinen nur, solange Ember in einem Tab geöffnet ist.' };
}

export async function requestNotifications() {
  if (!('Notification' in window)) return false;
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  return permission === 'granted';
}

export function showNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  try {
    return new Notification(title, { body, tag, requireInteraction: tag === 'ring' });
  } catch {
    return null; // z. B. iPad ohne Unterstützung
  }
}

// ---------- Bildschirm anlassen (Screen Wake Lock) ----------
let wakeLock = null;
let wantWake = false;
export const wakeLockSupported = () => 'wakeLock' in navigator;

async function acquireWake() {
  if (!wantWake || wakeLock || document.visibilityState !== 'visible' || !wakeLockSupported()) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* z. B. Energiesparmodus – ohne weiter */ }
}
// Aufrufer sagen, ob gerade etwas läuft; die Einstellung entscheidet, ob gesperrt wird.
export function keepScreenOn(active) {
  wantWake = Boolean(active && settings.wakeLock);
  if (wantWake) acquireWake();
  else if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
// Das System gibt die Sperre frei, wenn der Tab unsichtbar wird – beim Zurückkehren neu holen.
document.addEventListener('visibilitychange', acquireWake);
