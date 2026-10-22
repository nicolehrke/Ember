// Zentrale Speicher-Schicht.
// Alle Widgets lesen und schreiben ausschließlich über dieses Modul.
// Die Schnittstelle ist bewusst asynchron (Promises): Um später ein Backend
// mit Sync anzubinden, muss nur diese Datei ausgetauscht werden.
//
//   load(key, fallback)  -> Promise<Wert | fallback>
//   save(key, value)     -> Promise<boolean>
//   remove(key)          -> Promise<void>
//   keys()               -> Promise<string[]>   (z. B. für Export)
//   subscribe(key, fn)   -> Abmelde-Funktion; fn(value) bei Änderungen
//   scope(namespace)     -> { load, save, remove, subscribe } mit Präfix

const PREFIX = 'dashboard:';

// Fallback, falls localStorage nicht verfügbar ist (z. B. privater Modus,
// blockierte Website-Daten). Daten leben dann nur bis zum Neuladen.
const memory = new Map();
const listeners = new Map();

function backend() {
  try {
    const ls = window.localStorage;
    const probe = PREFIX + '__probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

const ls = backend();
if (!ls) console.warn('[storage] localStorage nicht verfügbar – Daten werden nur im Speicher gehalten.');

function readRaw(key) {
  return ls ? ls.getItem(PREFIX + key) : memory.get(key) ?? null;
}

function notify(key, value) {
  for (const fn of listeners.get(key) ?? []) {
    try { fn(value); } catch (err) { console.error('[storage] Listener-Fehler', err); }
  }
}

export async function load(key, fallback = null) {
  try {
    const raw = readRaw(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] Konnte "${key}" nicht lesen`, err);
    return fallback;
  }
}

export async function save(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (ls) ls.setItem(PREFIX + key, raw);
    else memory.set(key, raw);
    notify(key, value);
    return true;
  } catch (err) {
    console.warn(`[storage] Konnte "${key}" nicht speichern`, err);
    return false;
  }
}

export async function remove(key) {
  try {
    if (ls) ls.removeItem(PREFIX + key);
    else memory.delete(key);
    notify(key, null);
  } catch (err) {
    console.warn(`[storage] Konnte "${key}" nicht löschen`, err);
  }
}

export async function keys() {
  if (!ls) return [...memory.keys()];
  const result = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k?.startsWith(PREFIX)) result.push(k.slice(PREFIX.length));
  }
  return result;
}

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

export function scope(namespace) {
  const k = key => `${namespace}.${key}`;
  return {
    load: (key, fallback) => load(k(key), fallback),
    save: (key, value) => save(k(key), value),
    remove: key => remove(k(key)),
    subscribe: (key, fn) => subscribe(k(key), fn),
  };
}

// Änderungen aus anderen Tabs weiterreichen.
window.addEventListener('storage', event => {
  if (!event.key?.startsWith(PREFIX)) return;
  let value = null;
  try { value = event.newValue == null ? null : JSON.parse(event.newValue); } catch { /* ignorieren */ }
  notify(event.key.slice(PREFIX.length), value);
});
