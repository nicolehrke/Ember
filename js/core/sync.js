// Sync zwischen Geräten über ein privates GitHub Gist.
//
// Ablauf: Gist laden → mit lokalen Daten zusammenführen → Ergebnis lokal
// übernehmen und, falls nötig, zurück ins Gist schreiben.
// Zusammenführen: Pro Schlüssel gewinnt die neuere Änderung. Sind beide Werte
// Sammlungen von Einträgen mit eigenem updatedAt (z. B. Lernzeiten), wird
// Eintrag für Eintrag zusammengeführt, damit nichts verloren geht.
import { load, save, remove, snapshot, applyRemote, onLocalChange } from './storage.js';

const API = 'https://api.github.com';
const FILE = 'dashboard-sync.json';
const CONFIG_KEY = 'local/sync';
const PUSH_DELAY = 2000;
const INTERVAL = 5 * 60 * 1000;

let status = { state: 'off', message: '', lastSync: null };
const statusListeners = new Set();
let running = null;
let again = false;
let pushTimer = null;

function setStatus(next) {
  status = { ...status, ...next };
  for (const fn of statusListeners) fn(status);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export const getConfig = () => load(CONFIG_KEY, null);

async function gh(path, token, { method = 'GET', body } = {}) {
  if (!navigator.onLine) throw new Error('Offline – Sync folgt, sobald du wieder online bist.');
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('GitHub ist nicht erreichbar.');
  }
  if (res.status === 401) throw new Error('Der Token ist ungültig oder abgelaufen.');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub verweigert den Zugriff (fehlende Gist-Berechtigung oder Limit erreicht).');
  if (res.status === 404) throw new Error('Das Sync-Gist wurde nicht gefunden.');
  if (!res.ok) throw new Error(`GitHub antwortet mit Fehler ${res.status}.`);
  return res.json();
}

// ---------- Zusammenführen ----------

const isRecordMap = v => v != null && typeof v === 'object' && !Array.isArray(v)
  && Object.values(v).every(r => r != null && typeof r === 'object' && typeof r.updatedAt === 'number');

function mergeEntry(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (isRecordMap(a.value) && isRecordMap(b.value)) {
    const value = { ...a.value };
    for (const [id, record] of Object.entries(b.value)) {
      if (!value[id] || record.updatedAt > value[id].updatedAt) value[id] = record;
    }
    return { value, updatedAt: Math.max(a.updatedAt, b.updatedAt) };
  }
  return b.updatedAt > a.updatedAt ? b : a;
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every(k => equal(a[k], b[k]));
}

export function merge(local, remote) {
  const merged = {};
  const toLocal = {};
  let remoteChanged = false;
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    merged[key] = mergeEntry(local[key], remote[key]);
    if (!equal(merged[key], local[key])) toLocal[key] = merged[key];
    if (!equal(merged[key], remote[key])) remoteChanged = true;
  }
  return { merged, toLocal, remoteChanged };
}

// ---------- Gist lesen/schreiben ----------

async function readGist(config) {
  const gist = await gh(`/gists/${config.gistId}`, config.token);
  const file = gist.files?.[FILE];
  if (!file) return {};
  let content = file.content;
  if (file.truncated) content = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  try {
    return JSON.parse(content).keys ?? {};
  } catch {
    throw new Error('Die Sync-Datei im Gist ist beschädigt.');
  }
}

async function writeGist(config, entries) {
  const content = JSON.stringify({ version: 1, updatedAt: Date.now(), keys: entries }, null, 1);
  await gh(`/gists/${config.gistId}`, config.token, { method: 'PATCH', body: { files: { [FILE]: { content } } } });
}

async function runSync() {
  const config = await getConfig();
  if (!config) return setStatus({ state: 'off', message: '' });
  setStatus({ state: 'syncing', message: '' });
  try {
    const remote = await readGist(config);
    const { merged, toLocal, remoteChanged } = merge(await snapshot(), remote);
    await applyRemote(toLocal);
    if (remoteChanged) await writeGist(config, merged);
    setStatus({ state: 'ok', message: '', lastSync: Date.now() });
  } catch (err) {
    setStatus({ state: navigator.onLine ? 'error' : 'offline', message: err.message });
  }
}

// Nie zwei Abgleiche gleichzeitig; Anfragen währenddessen werden nachgeholt.
export function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = runSync().finally(() => {
    running = null;
    if (again) {
      again = false;
      syncNow();
    }
  });
  return running;
}

// ---------- Verbinden / Trennen ----------

export async function connect(token) {
  token = token.trim();
  if (!token) throw new Error('Bitte einen Token eingeben.');
  setStatus({ state: 'syncing', message: '' });
  try {
    const gists = await gh('/gists?per_page=100', token);
    let gist = gists.find(g => g.files?.[FILE]);
    if (!gist) {
      gist = await gh('/gists', token, {
        method: 'POST',
        body: {
          description: 'Dashboard-Sync (wird automatisch verwaltet)',
          public: false,
          files: { [FILE]: { content: JSON.stringify({ version: 1, keys: {} }) } },
        },
      });
    }
    await save(CONFIG_KEY, { token, gistId: gist.id, gistUrl: gist.html_url });
  } catch (err) {
    setStatus({ state: 'off', message: err.message });
    throw err;
  }
  await syncNow();
}

export async function disconnect() {
  await remove(CONFIG_KEY);
  setStatus({ state: 'off', message: '', lastSync: null });
}

// ---------- Start ----------

export async function initSync() {
  onLocalChange(() => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY);
  });
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncNow();
  });
  setInterval(syncNow, INTERVAL);
  await syncNow();
}
