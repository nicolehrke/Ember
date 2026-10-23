// Musikauswahl für das Musik-Widget (Hilfsmodul, kein eigenes Widget):
// eigene Playlists, Suche, zuletzt gehörte Titel. Ein Klick spielt auf „Ember“.
// Ergebnisse liegen nur im Arbeitsspeicher der Seite – nichts wird gespeichert
// (Spotify erlaubt nur kurzzeitiges Zwischenspeichern).
// Höchstens 20 Einträge pro Liste (Spotify-Designrichtlinie), Suche höchstens 10 pro Typ (API-Grenze).
import { h } from '../core/dom.js';
import { api } from '../spotify/api.js';
import { play } from '../spotify/player.js';

const PAGE = 20;
const SEARCH_LIMIT = 10;
const CACHE_MS = 5 * 60 * 1000;

// Kleinstes Bild, das noch scharf genug ist
const thumb = images => {
  const list = (images ?? []).filter(Boolean);
  return [...list].sort((a, b) => (a.height ?? 999) - (b.height ?? 999)).find(i => (i.height ?? 999) >= 60)?.url ?? list[0]?.url ?? '';
};

export function createBrowse({ onError, onPlayed }) {
  let tab = 'playlists';
  let playlistOffset = 0;
  const cache = new Map(); // Schlüssel → { at, data }

  const cached = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  };

  const tabs = h('div', { class: 'segmented music-tabs', role: 'tablist', 'aria-label': 'Musikauswahl' });
  const body = h('div', { class: 'music-list-wrap' });
  const element = h('div', { class: 'music-browse-inner' }, tabs, body);

  const start = item => async () => {
    try {
      await play(item.contextUri ? { contextUri: item.contextUri } : { uris: [item.uri] });
      onPlayed?.();
    } catch (err) {
      onError(err);
    }
  };

  const row = item => h('li', {},
    h('button', { class: 'music-row', type: 'button', title: `${item.name} abspielen`, onclick: start(item) },
      item.image
        ? h('img', { class: 'music-thumb', src: item.image, alt: '', width: 40, height: 40, loading: 'lazy' })
        : h('span', { class: 'music-thumb music-thumb--empty', 'aria-hidden': 'true' }, '♪'),
      h('span', { class: 'music-row-text' },
        h('span', { class: 'music-row-name' }, item.name),
        item.sub && h('span', { class: 'music-row-sub muted' }, item.sub))));

  const list = items => (items.length
    ? h('ul', { class: 'music-list' }, items.map(row))
    : h('p', { class: 'muted' }, 'Nichts gefunden.'));

  const loading = () => body.replaceChildren(h('p', { class: 'muted' }, 'Lädt …'));
  // Fehler direkt in der Liste zeigen, mit „Erneut versuchen“ – nie stillschweigend leer
  const failed = (err, retry) => {
    body.replaceChildren(h('div', { class: 'music-notice' },
      h('p', { class: 'settings-error' }, err?.message ?? 'Die Liste konnte nicht geladen werden.'),
      h('button', { class: 'chip', type: 'button', onclick: retry }, 'Erneut versuchen')));
    onError(err);
  };

  // ---------- Playlists ----------
  async function showPlaylists() {
    loading();
    try {
      const data = await cached(`playlists:${playlistOffset}`, () => api('/me/playlists', { query: { limit: PAGE, offset: playlistOffset } }));
      const items = (data?.items ?? []).filter(Boolean).map(p => ({
        name: p.name, sub: p.owner?.display_name ? `von ${p.owner.display_name}` : '', image: thumb(p.images), contextUri: p.uri,
      }));
      const total = data?.total ?? items.length;
      const pager = total > PAGE && h('div', { class: 'music-pager' },
        h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Vorherige Seite', disabled: playlistOffset === 0, onclick: () => { playlistOffset -= PAGE; showPlaylists(); } }, '‹'),
        h('span', { class: 'muted' }, `${playlistOffset + 1}–${Math.min(playlistOffset + PAGE, total)} von ${total}`),
        h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Nächste Seite', disabled: playlistOffset + PAGE >= total, onclick: () => { playlistOffset += PAGE; showPlaylists(); } }, '›'));
      body.replaceChildren(...[items.length ? list(items) : h('p', { class: 'muted' }, 'Du hast noch keine Playlists.'), pager].filter(Boolean));
    } catch (err) {
      failed(err, showPlaylists);
    }
  }

  // ---------- Suche ----------
  const searchInput = h('input', { type: 'search', class: 'shop-input', placeholder: 'Titel, Album oder Playlist suchen', 'aria-label': 'Spotify durchsuchen', enterkeyhint: 'search', autocomplete: 'off' });
  const searchForm = h('form', { class: 'music-search' }, searchInput, h('button', { class: 'chip', type: 'submit' }, 'Suchen'));
  const results = h('div', { class: 'music-results' });
  searchForm.addEventListener('submit', async event => {
    event.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    results.replaceChildren(h('p', { class: 'muted' }, 'Suche …'));
    try {
      const data = await cached(`search:${q}`, () => api('/search', { query: { q, type: 'track,album,playlist', limit: SEARCH_LIMIT } }));
      const tracks = (data?.tracks?.items ?? []).filter(Boolean).map(t => ({ name: t.name, sub: t.artists?.map(a => a.name).join(', '), image: thumb(t.album?.images), uri: t.uri }));
      const albums = (data?.albums?.items ?? []).filter(Boolean).map(a => ({ name: a.name, sub: a.artists?.map(x => x.name).join(', '), image: thumb(a.images), contextUri: a.uri }));
      const playlists = (data?.playlists?.items ?? []).filter(Boolean).map(p => ({ name: p.name, sub: p.owner?.display_name ? `von ${p.owner.display_name}` : '', image: thumb(p.images), contextUri: p.uri }));
      const section = (title, items) => items.length > 0 && h('section', {}, h('h3', { class: 'shop-section-title' }, title), list(items));
      const parts = [section('Titel', tracks), section('Alben', albums), section('Playlists', playlists)].filter(Boolean);
      results.replaceChildren(...(parts.length ? parts : [h('p', { class: 'muted' }, 'Nichts gefunden.')]));
    } catch (err) {
      results.replaceChildren();
      onError(err);
    }
  });
  const showSearch = () => {
    body.replaceChildren(searchForm, results);
  };

  // ---------- Zuletzt gehört ----------
  async function showRecent() {
    loading();
    try {
      const data = await cached('recent', () => api('/me/player/recently-played', { query: { limit: PAGE } }));
      const seen = new Set();
      const items = (data?.items ?? []).map(i => i.track).filter(t => t && !seen.has(t.id) && seen.add(t.id))
        .map(t => ({ name: t.name, sub: t.artists?.map(a => a.name).join(', '), image: thumb(t.album?.images), uri: t.uri }));
      body.replaceChildren(items.length ? list(items) : h('p', { class: 'muted' }, 'Noch nichts gehört.'));
    } catch (err) {
      failed(err, showRecent);
    }
  }

  const TABS = { playlists: ['Playlists', showPlaylists], search: ['Suche', showSearch], recent: ['Zuletzt gehört', showRecent] };
  const drawTabs = () => tabs.replaceChildren(...Object.entries(TABS).map(([key, [label]]) =>
    h('button', {
      class: 'segment', type: 'button', role: 'tab', 'aria-pressed': String(tab === key), 'aria-selected': String(tab === key),
      onclick: () => { tab = key; if (key === 'recent') cache.delete('recent'); drawTabs(); TABS[key][1](); },
    }, label)));

  let shown = false;
  return {
    element,
    // Beim ersten Anzeigen (verbunden und Kachel offen) laden
    show() {
      if (shown) return;
      shown = true;
      drawTabs();
      TABS[tab][1]();
    },
    reset() {
      shown = false;
      cache.clear();
      body.replaceChildren();
    },
  };
}
