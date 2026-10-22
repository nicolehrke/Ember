// Spotify-Wiedergabegerät „Ember“ (Web Playback SDK) auf App-Ebene.
// Lebt unabhängig von der Musik-Kachel: Schließen der Kachel stoppt die Musik nicht,
// nur „Trennen“ oder das Schließen des Tabs.
//
// Das SDK-Skript (https://sdk.scdn.co/spotify-player.js, offizielle Quelle von Spotify)
// wird erst geladen, wenn du den Player benutzt – nie beim Seitenstart. Abgespielt wird
// nur nach einem Klick (Browser blockieren automatisches Abspielen ohnehin).
import { getAccessToken, onAuth } from './auth.js';
import { api, SpotifyError } from './api.js';
import { load, save } from '../core/storage.js';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const VOLUME_KEY = 'local/spotify/volume';
const DEVICE_NAME = 'Ember';

// status: 'idle' | 'loading' | 'ready' | 'offline' | 'unsupported' | 'premium' | 'auth' | 'error'
let state = { status: 'idle', message: '', deviceId: null, track: null, paused: true, position: 0, duration: 0, updatedAt: 0, disallows: {}, volume: 0.6 };
const listeners = new Set();
const setState = next => {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
};
export const getPlayerState = () => state;
export function onPlayer(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

// Aktuelle Position, aus dem letzten Zustand hochgerechnet.
export const livePosition = () => Math.min(state.duration, state.position + (state.paused ? 0 : Date.now() - state.updatedAt));

// ---------- Unterstützung prüfen ----------
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function supportProblem() {
  // Das SDK braucht verschlüsselte Medienwiedergabe (EME).
  if (!navigator.requestMediaKeySystemAccess) return 'Dieser Browser kann Spotify-Musik nicht direkt abspielen (fehlende Medien-Unterstützung).';
  if (!window.isSecureContext) return 'Spotify-Wiedergabe braucht eine sichere Verbindung (https oder 127.0.0.1).';
  return null;
}
export const iosNote = () => (isIOS() ? 'Auf iPad/iPhone ist die Wiedergabe im Browser eingeschränkt: Ton startet nur nach Antippen, im Hintergrund kann iOS sie anhalten.' : null);

// ---------- SDK laden und Gerät anlegen ----------
let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= new Promise((resolve, reject) => {
    if (window.Spotify?.Player) return resolve();
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      sdkPromise = null;
      reject(new SpotifyError('Der Spotify-Player konnte nicht geladen werden (offline oder blockiert?).', 'network'));
    };
    document.head.append(script);
  });
  return sdkPromise;
}

let player = null;
let connecting = null;

// Liefert die Geräte-ID von „Ember“; legt das Gerät beim ersten Aufruf an.
export function ensurePlayer() {
  if (state.deviceId && player) return Promise.resolve(state.deviceId);
  connecting ??= (async () => {
    const problem = supportProblem();
    if (problem) {
      setState({ status: 'unsupported', message: problem });
      throw new SpotifyError(problem, 'unsupported');
    }
    setState({ status: 'loading', message: '' });
    await loadSdk();
    const volume = await load(VOLUME_KEY, 0.6);
    player = new window.Spotify.Player({
      name: DEVICE_NAME,
      volume,
      getOAuthToken: cb => {
        getAccessToken().then(token => {
          if (token) cb(token);
          else setState({ status: 'auth', message: 'Die Spotify-Anmeldung ist abgelaufen – bitte neu verbinden.' });
        }).catch(() => setState({ status: 'error', message: 'Spotify ist nicht erreichbar.' }));
      },
    });

    const ready = new Promise((resolve, reject) => {
      player.addListener('ready', ({ device_id: id }) => {
        setState({ status: 'ready', deviceId: id, message: '', volume });
        resolve(id);
      });
      player.addListener('initialization_error', ({ message }) => {
        // Häufigste Ursache: fehlendes DRM (Widevine), z. B. in eingebetteten Browsern
        setState({ status: 'unsupported', message: `Spotify kann den Player in diesem Browser nicht starten (${message}). Meist fehlt die nötige DRM-Unterstützung – öffne Ember in Chrome, Firefox, Edge oder Safari.` });
        reject(new SpotifyError(state.message, 'unsupported'));
      });
      player.addListener('authentication_error', () => {
        setState({ status: 'auth', message: 'Die Spotify-Anmeldung ist abgelaufen oder ungültig – bitte neu verbinden.' });
        reject(new SpotifyError(state.message, 'auth'));
      });
      player.addListener('account_error', () => {
        setState({ status: 'premium', message: 'Für die Wiedergabe in Ember ist Spotify Premium nötig.' });
        reject(new SpotifyError(state.message, 'premium'));
      });
    });
    player.addListener('not_ready', () => setState({ status: 'offline', message: 'Gerät „Ember“ ist gerade nicht bereit (Verbindung verloren?).' }));
    player.addListener('playback_error', ({ message }) => setState({ message: `Wiedergabefehler: ${message}` }));
    player.addListener('autoplay_failed', () => setState({ message: 'Der Browser hat das Abspielen blockiert – bitte einmal auf Play tippen.' }));
    player.addListener('player_state_changed', sdkState => applySdkState(sdkState));

    const ok = await player.connect();
    if (!ok) throw new SpotifyError('Verbindung zum Spotify-Player fehlgeschlagen.', 'error');
    return ready;
  })().catch(err => {
    // Fehlgeschlagenes Gerät abräumen, damit beim nächsten Versuch kein zweites entsteht
    try { player?.disconnect(); } catch { /* egal */ }
    player = null;
    // Hat ein SDK-Ereignis den Grund schon geliefert, diesen weitergeben (keine Doppelmeldung)
    if (['unsupported', 'premium', 'auth'].includes(state.status)) throw new SpotifyError(state.message, state.status);
    throw err;
  }).finally(() => { connecting = null; });
  return connecting;
}

function applySdkState(s) {
  if (!s) {
    // Wiedergabe wurde auf ein anderes Gerät übertragen
    setState({ track: null, paused: true, position: 0, duration: 0, updatedAt: Date.now() });
    return;
  }
  const t = s.track_window?.current_track;
  setState({
    track: t ? {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: t.artists.map(a => a.name).join(', '),
      album: t.album?.name ?? '',
      image: [...(t.album?.images ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]?.url ?? '',
      url: t.id ? `https://open.spotify.com/track/${t.id}` : null,
    } : null,
    paused: s.paused,
    position: s.position,
    duration: s.duration,
    updatedAt: Date.now(),
    disallows: s.disallows ?? {},
    message: state.status === 'ready' ? '' : state.message,
  });
}

// ---------- Steuerung (immer nur nach einer Nutzeraktion aufrufen) ----------
// Muss im Klick-Handler laufen, bevor etwas abgewartet wird (Autoplay-Regeln, v. a. Safari).
export function activateAudio() {
  try { player?.activateElement(); } catch { /* ältere SDK-Versionen */ }
}

// Wiedergabe auf „Ember“ übertragen.
export async function playHere() {
  activateAudio();
  const deviceId = await ensurePlayer();
  activateAudio();
  await api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } });
}

// Playlist/Album (context) oder einzelne Titel (uris) auf „Ember“ abspielen.
export async function play({ contextUri, uris, offset } = {}) {
  activateAudio();
  const deviceId = await ensurePlayer();
  activateAudio();
  const body = contextUri ? { context_uri: contextUri, ...(offset != null ? { offset } : {}) } : { uris };
  await api('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body });
}

export const togglePlay = () => player?.togglePlay();
export const next = () => player?.nextTrack();
export const previous = () => player?.previousTrack();
export const seek = ms => player?.seek(ms);
export async function setVolume(volume) {
  await player?.setVolume(volume);
  setState({ volume });
  await save(VOLUME_KEY, volume);
}

// Was läuft gerade auf welchem Gerät? (für „Läuft auf iPhone – hier abspielen“)
export async function remoteState() {
  return api('/me/player');
}

// Gerät abmelden (beim Trennen).
export function shutdown() {
  try { player?.disconnect(); } catch { /* egal */ }
  player = null;
  setState({ status: 'idle', message: '', deviceId: null, track: null, paused: true, position: 0, duration: 0 });
}

// Beim Trennen der Spotify-Verbindung das Gerät sofort abmelden.
onAuth(auth => {
  if ((auth.status === 'no-client' || auth.status === 'expired') && player) shutdown();
});
