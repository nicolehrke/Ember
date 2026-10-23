// Einmalige Aufräumarbeiten nach Umbauten, laufen bei jedem Start (sind idempotent).
import { load, save, remove, purge } from './storage.js';

export async function runMigrations() {
  // Phase 3: Caches und Design liegen jetzt unter "local/" und werden nicht synchronisiert.
  const theme = await load('theme');
  if (theme && !(await load('local/theme'))) await save('local/theme', theme);
  await purge(key => key === 'theme' || key === 'weather.cache' || /^mensa\.(days|meals)\./.test(key));
  // Dock statt Einklappen: der alte Auf/Zu-Zustand der Kacheln wird nicht mehr gebraucht.
  await purge(key => key === 'local/layout');
  await migrateCalendarLink();
}

// Stundenplan: Früher lag der ganze Abruf-Link in 'local/cache/timetable.url' (bei einem Worker mit
// ?key=…, sonst womöglich der geheime RWTHonline-Link). Jetzt gibt es nur noch die Worker-Adresse
// ('timetable.worker', synchronisiert) und den Zugangsschlüssel ('local/timetable.key', nur hier).
// Ein direkter RWTHonline-Link wird gelöscht, nicht übernommen. Werte werden nie ausgegeben.
async function migrateCalendarLink() {
  const old = await load('local/cache/timetable.url', null);
  if (!old) return;
  try {
    const url = new URL(old, location.href);
    if (/rwth-aachen\.de$/i.test(url.hostname) || /campus|online\.rwth/i.test(url.hostname)) {
      await save('local/timetable.notice', 'direct-link-removed');
    } else {
      const key = url.searchParams.get('key');
      url.searchParams.delete('key');
      if (!(await load('timetable.worker', ''))) await save('timetable.worker', url.href);
      if (key && !(await load('local/timetable.key', ''))) await save('local/timetable.key', key);
    }
  } catch {
    // unlesbarer alter Wert: einfach verwerfen
  }
  await remove('local/cache/timetable.url');
}
