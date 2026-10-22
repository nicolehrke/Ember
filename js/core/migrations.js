// Einmalige Aufräumarbeiten nach Umbauten, laufen bei jedem Start (sind idempotent).
import { load, save, purge } from './storage.js';

export async function runMigrations() {
  // Phase 3: Caches und Design liegen jetzt unter "local/" und werden nicht synchronisiert.
  const theme = await load('theme');
  if (theme && !(await load('local/theme'))) await save('local/theme', theme);
  await purge(key => key === 'theme' || key === 'weather.cache' || /^mensa\.(days|meals)\./.test(key));
  // Dock statt Einklappen: der alte Auf/Zu-Zustand der Kacheln wird nicht mehr gebraucht.
  await purge(key => key === 'local/layout');
}
