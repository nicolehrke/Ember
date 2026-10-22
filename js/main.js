import { runMigrations } from './core/migrations.js';
import { initTheme } from './core/theme.js';
import { initBriefing } from './core/briefing.js';
import { initLayout } from './core/layout.js';
import { initSettings } from './core/settings.js';
import { initSync } from './core/sync.js';
import { handleRedirect as handleSpotifyRedirect, refreshStatus as refreshSpotifyStatus } from './spotify/auth.js';
import { mountWidget } from './core/widget-host.js';
import { setTitleBase } from './core/title.js';
import { setMusicHook } from './core/ringer.js';
import { muteButton } from './core/alert-settings.js';
import { getPlayerState, togglePlay } from './spotify/player.js';
import widgets from './widgets/index.js';

// Stil zuerst, damit die Seite gleich im gewählten Design erscheint
await initTheme(document.getElementById('theme'));
await runMigrations();
// Klingelnde Timer/Wecker pausieren laufende Musik in Ember und setzen sie danach fort
setMusicHook({
  isPlaying: () => Boolean(getPlayerState().track && !getPlayerState().paused),
  pause: () => togglePlay(),
  resume: () => (getPlayerState().paused ? togglePlay() : undefined),
});
// Rückkehr von der Spotify-Anmeldung: Code eintauschen und URL bereinigen
await handleSpotifyRedirect();
await refreshSpotifyStatus();

initSettings(document.getElementById('settings'));
document.getElementById('settings').before(muteButton());

const slots = {
  hero: document.getElementById('slot-hero'),
  header: document.getElementById('slot-header'),
  grid: document.getElementById('grid'),
  dock: document.getElementById('dock'),
  only: false,
};

// Nur-Ansicht einzelner Widgets, z. B. ?nur=einkauf fürs Handy im Laden:
// lädt nur dieses Widget, als immer sichtbare Kachel ohne Dock.
const ONLY = { einkauf: 'shopping' };
const only = ONLY[new URLSearchParams(location.search).get('nur')];
if (only) {
  document.documentElement.classList.add('only-view');
  slots.only = true;
  setTitleBase('Einkaufsliste');
  slots.grid.after(Object.assign(document.createElement('a'), { className: 'only-back', href: './', textContent: 'Zum Dashboard' }));
}
for (const widget of widgets) {
  if (only && widget.id !== only) continue;
  mountWidget(slots, only ? { ...widget, dock: undefined } : widget);
}
// Kacheln verschiebbar, gespeicherte Reihenfolge anwenden (nicht in der Nur-Ansicht)
if (!only) initLayout(slots.grid);

initBriefing(document.getElementById('brief'));
initSync();
