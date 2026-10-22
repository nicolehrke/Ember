// Spotify-Anmeldung: Authorization Code Flow mit PKCE, ohne Server und ohne Client-Secret.
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
//
// Alles liegt unter 'local/spotify/…' – nur auf diesem Gerät, nie im Gist-Sync
// und nie im Export der Daten-Funktion:
//   local/spotify/clientId  Client-ID der eigenen Spotify-App
//   local/spotify/pkce      { verifier, state, redirectUri, createdAt } während der Anmeldung
//   local/spotify/tokens    { accessToken, refreshToken, expiresAt, scope, authorizedAt }
//
// Access-Tokens gelten 1 Stunde und werden automatisch erneuert. Refresh-Tokens
// gelten laut Spotify 6 Monate ab der Anmeldung (Erneuern verlängert das nicht);
// danach – oder bei 'invalid_grant' – heißt es „Neu verbinden“.
import { load, save, remove } from '../core/storage.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private', // vom Web Playback SDK verlangt
  'user-read-playback-state', 'user-modify-playback-state',
  'playlist-read-private', 'playlist-read-collaborative',
  'user-read-recently-played',
];
const KEYS = { clientId: 'local/spotify/clientId', pkce: 'local/spotify/pkce', tokens: 'local/spotify/tokens' };
const REFRESH_MARGIN = 60 * 1000;
const REFRESH_LIFETIME = 182 * 24 * 60 * 60 * 1000; // ca. 6 Monate

// ---------- Status für die Oberfläche ----------
// status: 'no-client' | 'bad-origin' | 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error'
let state = { status: 'disconnected', message: '' };
const listeners = new Set();
const setState = next => {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
};
export const getAuthState = () => state;
export function onAuth(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

// ---------- Weiterleitungs-Adresse ----------
// Muss exakt der im Spotify-Dashboard eingetragenen entsprechen.
export const redirectUri = () => `${location.origin}${location.pathname}`;

// Spotify erlaubt nur https oder http mit 127.0.0.1 / [::1]; „localhost“ ist verboten.
export function originProblem() {
  const { protocol, hostname, port } = location;
  if (hostname === 'localhost') {
    return `Spotify erlaubt „localhost“ nicht als Weiterleitungs-Adresse. Öffne Ember über http://127.0.0.1:${port || 80}${location.pathname}`;
  }
  const loopback = hostname === '127.0.0.1' || hostname === '[::1]';
  if (protocol !== 'https:' && !loopback) return 'Spotify verlangt eine https-Adresse (lokal: http://127.0.0.1:PORT).';
  return null;
}

// ---------- PKCE-Helfer ----------
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomString = (byteLength = 64) => base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
export async function codeChallenge(verifier) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

// ---------- Client-ID ----------
export const getClientId = () => load(KEYS.clientId, '');
export async function setClientId(id) {
  await save(KEYS.clientId, id.trim());
  await refreshStatus();
}

// ---------- Anmeldung starten ----------
export async function login() {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Bitte zuerst die Client-ID eintragen.');
  const problem = originProblem();
  if (problem) throw new Error(problem);

  const verifier = randomString(64); // 86 Zeichen, erlaubt sind 43–128
  const pkce = { verifier, state: randomString(16), redirectUri: redirectUri(), createdAt: Date.now() };
  if (!(await save(KEYS.pkce, pkce))) throw new Error('Der Gerätespeicher ist nicht verfügbar.');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: pkce.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state: pkce.state,
    scope: SCOPES.join(' '),
  });
  setState({ status: 'connecting', message: '' });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

// URL von code/state/error befreien, ohne andere Parameter (z. B. ?nur=einkauf) zu verlieren.
function cleanUrl() {
  const url = new URL(location.href);
  for (const key of ['code', 'state', 'error']) url.searchParams.delete(key);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  } catch {
    const err = new Error('Spotify ist nicht erreichbar.');
    err.code = 'network';
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Spotify antwortet mit Fehler ${res.status}.`);
    err.code = data.error || `http-${res.status}`;
    throw err;
  }
  return data;
}

// Nach der Rückkehr von Spotify (beim Seitenstart aufrufen): Code gegen Tokens tauschen.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  if (!params.has('state')) return false; // nicht von uns

  const pkce = await load(KEYS.pkce, null);
  const returnedState = params.get('state');
  const code = params.get('code');
  const error = params.get('error');
  cleanUrl();
  await remove(KEYS.pkce);

  if (!pkce || returnedState !== pkce.state) {
    setState({ status: 'error', message: 'Anmeldung abgelehnt: Der Sicherheits-Code (state) passt nicht. Bitte erneut verbinden.' });
    return true;
  }
  if (error) {
    setState({ status: 'disconnected', message: error === 'access_denied' ? 'Anmeldung bei Spotify abgebrochen.' : `Spotify meldet: ${error}` });
    return true;
  }
  try {
    const data = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pkce.redirectUri,
      client_id: await getClientId(),
      code_verifier: pkce.verifier,
    });
    await storeTokens(data, { authorizedAt: Date.now() });
    setState({ status: 'connected', message: '' });
  } catch (err) {
    setState({ status: 'error', message: `Anmeldung fehlgeschlagen: ${err.message}` });
  }
  return true;
}

async function storeTokens(data, extra = {}) {
  const previous = await load(KEYS.tokens, {});
  const tokens = {
    ...previous,
    ...extra,
    accessToken: data.access_token,
    // Spotify schickt nicht immer einen neuen Refresh-Token – dann den alten behalten.
    refreshToken: data.refresh_token ?? previous.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? previous.scope,
  };
  await save(KEYS.tokens, tokens);
  return tokens;
}

// ---------- Gültigen Access-Token liefern (erneuert bei Bedarf) ----------
let refreshing = null;
export async function getAccessToken({ force = false } = {}) {
  const tokens = await load(KEYS.tokens, null);
  if (!tokens?.accessToken) {
    await refreshStatus();
    return null;
  }
  if (!force && tokens.expiresAt - REFRESH_MARGIN > Date.now()) return tokens.accessToken;

  refreshing ??= (async () => {
    try {
      const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: await getClientId() });
      const next = await storeTokens(data);
      if (state.status !== 'connected') setState({ status: 'connected', message: '' });
      return next.accessToken;
    } catch (err) {
      if (err.code === 'invalid_grant' || err.code === 'invalid_client') {
        // Abgelaufen oder widerrufen: Tokens verwerfen, neu anmelden lassen.
        await remove(KEYS.tokens);
        setState({ status: 'expired', message: 'Die Spotify-Anmeldung ist abgelaufen.' });
        return null;
      }
      throw err; // z. B. offline – Tokens behalten
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Fehlen Berechtigungen (z. B. nach einer Erweiterung der Scopes)?
export async function missingScopes() {
  const tokens = await load(KEYS.tokens, null);
  if (!tokens?.scope) return [];
  const granted = new Set(tokens.scope.split(' '));
  return SCOPES.filter(s => !granted.has(s));
}

export async function tokenInfo() {
  const tokens = await load(KEYS.tokens, null);
  if (!tokens) return null;
  return { authorizedAt: tokens.authorizedAt, refreshExpiresAt: tokens.authorizedAt ? tokens.authorizedAt + REFRESH_LIFETIME : null };
}

// ---------- Trennen: alle Spotify-Daten dieses Geräts löschen ----------
export async function disconnectAll() {
  for (const key of Object.values(KEYS)) await remove(key);
  setState({ status: 'no-client', message: 'Spotify getrennt. Alle Spotify-Daten auf diesem Gerät wurden gelöscht.' });
}

export async function refreshStatus() {
  if (originProblem()) return setState({ status: 'bad-origin', message: originProblem() });
  if (!(await getClientId())) return setState({ status: 'no-client', message: state.status === 'no-client' ? state.message : '' });
  const tokens = await load(KEYS.tokens, null);
  if (tokens?.accessToken) return setState({ status: 'connected', message: '' });
  if (state.status === 'expired' || state.status === 'error') return undefined;
  return setState({ status: 'disconnected', message: state.message });
}
