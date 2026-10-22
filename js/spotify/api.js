// Aufrufe der Spotify Web API mit verständlichen Fehlern.
// Nur Endpunkte, die nach den Änderungen vom Februar 2026 im Development Mode verfügbar sind.
import { getAccessToken } from './auth.js';

const API = 'https://api.spotify.com/v1';

// code: 'auth' | 'premium' | 'scope' | 'forbidden' | 'no-device' | 'rate' | 'network' | 'server' | 'http'
export class SpotifyError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export async function api(path, { method = 'GET', query, body } = {}) {
  let token;
  try {
    token = await getAccessToken();
  } catch {
    throw new SpotifyError('Spotify ist nicht erreichbar.', 'network');
  }
  if (!token) throw new SpotifyError('Die Spotify-Anmeldung ist abgelaufen – bitte neu verbinden.', 'auth');

  const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const send = t => fetch(url, {
    method,
    headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res;
  try {
    res = await send(token);
    if (res.status === 401) {
      // Token kurz vor Ablauf widerrufen o. Ä.: einmal erneuern und wiederholen
      token = await getAccessToken({ force: true });
      if (!token) throw new SpotifyError('Die Spotify-Anmeldung ist abgelaufen – bitte neu verbinden.', 'auth');
      res = await send(token);
    }
  } catch (err) {
    if (err instanceof SpotifyError) throw err;
    throw new SpotifyError('Spotify ist nicht erreichbar.', 'network');
  }

  if (res.status === 204 || res.status === 202) return null;
  const data = await res.json().catch(() => null);
  if (res.ok) return data;

  const detail = data?.error?.message ?? '';
  const reason = data?.error?.reason ?? '';
  switch (res.status) {
    case 401:
      throw new SpotifyError('Die Spotify-Anmeldung ist abgelaufen – bitte neu verbinden.', 'auth');
    case 403:
      if (/premium/i.test(detail) || reason === 'PREMIUM_REQUIRED') throw new SpotifyError('Dafür ist Spotify Premium nötig.', 'premium');
      if (/scope/i.test(detail)) throw new SpotifyError('Ember fehlt eine Berechtigung – bitte in den Einstellungen neu verbinden.', 'scope');
      throw new SpotifyError(`Spotify erlaubt das nicht${detail ? ` (${detail})` : ''}.`, 'forbidden', { reason });
    case 404:
      if (/device/i.test(detail) || reason === 'NO_ACTIVE_DEVICE') throw new SpotifyError('Kein aktives Gerät – bitte „Hier abspielen“ wählen.', 'no-device');
      throw new SpotifyError('Bei Spotify nicht gefunden.', 'http', { status: 404 });
    case 429: {
      const retryAfter = Number(res.headers.get('Retry-After')) || null;
      throw new SpotifyError(`Zu viele Anfragen an Spotify – bitte ${retryAfter ? `etwa ${retryAfter} s` : 'kurz'} warten.`, 'rate', { retryAfter });
    }
    default:
      if (res.status >= 500) throw new SpotifyError('Spotify hat gerade Probleme – bitte später erneut versuchen.', 'server');
      throw new SpotifyError(detail || `Spotify antwortet mit Fehler ${res.status}.`, 'http', { status: res.status });
  }
}
