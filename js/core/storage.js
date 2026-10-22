// Zentrale Speicher-Schicht.
// Alle Widgets lesen und schreiben ausschließlich über dieses Modul.
// Die Schnittstelle ist bewusst asynchron (Promises), damit sich die
// Ablage später austauschen lässt, ohne Widgets anzupassen.
//
//   load(key, fallback)  -> Promise<Wert | fallback>
//   save(key, value)     -> Promise<boolean>
//   remove(key)          -> Promise<void>
//   keys()               -> Promise<string[]>
//   subscribe(key, fn)   -> Abmelde-Funktion; fn(value) bei Änderungen
//   scope(namespace)     -> { load, save, remove, subscribe } mit Präfix
//
// Synchronisation: Schlüssel, die mit "local/" beginnen, bleiben auf dem
// Gerät (Caches, Zugangsdaten, Design). Alle anderen werden mit Zeitstempel
// versehen und können von einem Sync-Modul (js/core/sync.js) abgeglichen werden.

const PREFIX = 'dashboard:';
const META_KEY = 'local/meta';

// Fallback, falls localStorage nicht verfügbar ist (z. B. privater Modus,
// blockierte Website-Daten). Daten leben dann nur bis zum Neuladen.
const memory = new Map();
const listeners = new Map();
const changeListeners = new Set();

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

export const isLocalKey = key => key.startsWith('local/');

function readRaw(key) {
  return ls ? ls.getItem(PREFIX + key) : memory.get(key) ?? null;
}

function writeRaw(key, raw) {
  if (raw == null) {
    if (ls) ls.removeItem(PREFIX + key);
    else memory.delete(key);
  } else if (ls) {
    ls.setItem(PREFIX + key, raw);
  } else {
    memory.set(key, raw);
  }
}

function parse(raw, fallback) {
  try { return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
}

function notify(key, value) {
  for (const fn of listeners.get(key) ?? []) {
    try { fn(value); } catch (err) { console.error('[storage] Listener-Fehler', err); }
  }
}

// Merkt sich, wann ein synchronisierbarer Schlüssel zuletzt geändert wurde.
function touch(key, time = Date.now()) {
  const meta = parse(readRaw(META_KEY), {});
  meta[key] = time;
  writeRaw(META_KEY, JSON.stringify(meta));
}

function changed(key) {
  if (isLocalKey(key)) return;
  touch(key);
  for (const fn of changeListeners) {
    try { fn(key); } catch (err) { console.error('[storage] Listener-Fehler', err); }
  }
}

export async function load(key, fallback = null) {
  try {
    return parse(readRaw(key), fallback);
  } catch (err) {
    console.warn(`[storage] Konnte "${key}" nicht lesen`, err);
    return fallback;
  }
}

export async function save(key, value) {
  try {
    writeRaw(key, JSON.stringify(value));
    changed(key);
    notify(key, value);
    return true;
  } catch (err) {
    console.warn(`[storage] Konnte "${key}" nicht speichern`, err);
    return false;
  }
}

export async function remove(key) {
  try {
    writeRaw(key, null);
    changed(key);
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

// Löscht Schlüssel endgültig, ohne die Löschung zu synchronisieren
// (für Aufräumarbeiten nach Umbauten, siehe js/core/migrations.js).
export async function purge(predicate) {
  const meta = parse(readRaw(META_KEY), {});
  for (const key of await keys()) {
    if (key === META_KEY || !predicate(key)) continue;
    writeRaw(key, null);
    delete meta[key];
  }
  writeRaw(META_KEY, JSON.stringify(meta));
}

// ---------- Schnittstelle für Sync-Module ----------

// Wird nach jeder lokalen Änderung eines synchronisierbaren Schlüssels aufgerufen.
export function onLocalChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

// Alle synchronisierbaren Einträge als { key: { value, updatedAt } };
// gelöschte Schlüssel erscheinen mit value null.
export async function snapshot() {
  const meta = parse(readRaw(META_KEY), {});
  const result = {};
  for (const key of await keys()) {
    if (isLocalKey(key) || key in meta) continue;
    meta[key] = 0; // ältere Daten ohne Zeitstempel
  }
  for (const [key, updatedAt] of Object.entries(meta)) {
    if (isLocalKey(key)) continue;
    result[key] = { value: parse(readRaw(key), null), updatedAt };
  }
  return result;
}

// Übernimmt Einträge aus dem Sync, ohne sie erneut als lokale Änderung zu melden.
export async function applyRemote(entries) {
  for (const [key, { value, updatedAt }] of Object.entries(entries)) {
    if (isLocalKey(key)) continue;
    writeRaw(key, value == null ? null : JSON.stringify(value));
    touch(key, updatedAt);
    notify(key, value);
  }
}

// Änderungen aus anderen Tabs weiterreichen.
window.addEventListener('storage', event => {
  if (!event.key?.startsWith(PREFIX)) return;
  notify(event.key.slice(PREFIX.length), parse(event.newValue, null));
});
