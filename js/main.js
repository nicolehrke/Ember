import { runMigrations } from './core/migrations.js';
import { initTheme } from './core/theme.js';
import { initSettings } from './core/settings.js';
import { initSync } from './core/sync.js';
import { handleRedirect as handleSpotifyRedirect, refreshStatus as refreshSpotifyStatus } from './spotify/auth.js';
import { mountWidget } from './core/widget-host.js';
import widgets from './widgets/index.js';

await runMigrations();
// Rückkehr von der Spotify-Anmeldung: Code eintauschen und URL bereinigen
await handleSpotifyRedirect();
await refreshSpotifyStatus();

initTheme(document.getElementById('theme-toggle'));
initSettings(document.getElementById('settings'));

const slots = {
  hero: document.getElementById('slot-hero'),
  header: document.getElementById('slot-header'),
  grid: document.getElementById('grid'),
  dock: document.getElementById('dock'),
};

// Nur-Ansicht einzelner Widgets, z. B. ?nur=einkauf fürs Handy im Laden:
// lädt nur dieses Widget, als immer sichtbare Kachel ohne Dock.
const ONLY = { einkauf: 'shopping' };
const only = ONLY[new URLSearchParams(location.search).get('nur')];
if (only) {
  document.documentElement.classList.add('only-view');
  document.title = 'Einkaufsliste';
  slots.grid.after(Object.assign(document.createElement('a'), { className: 'only-back', href: './', textContent: 'Zum Dashboard' }));
}
for (const widget of widgets) {
  if (only && widget.id !== only) continue;
  mountWidget(slots, only ? { ...widget, dock: undefined } : widget);
}

initSync();
