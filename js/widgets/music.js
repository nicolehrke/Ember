// Widget „Musik“: Spotify-Wiedergabe in Ember (Web Playback SDK).
// Die Wiedergabe selbst liegt in js/spotify/player.js und läuft unabhängig von dieser Kachel.
// Spotify-Inhalte (Titel, Cover, Playlists) werden nirgends gespeichert – nur angezeigt.
import { h } from '../core/dom.js';
import { load, subscribe } from '../core/storage.js';
import { setTitlePart } from '../core/title.js';
import { onAuth, getAuthState, login, refreshStatus } from '../spotify/auth.js';
import { SETTINGS_KEY } from '../spotify/settings-section.js';
import * as P from '../spotify/player.js';
import { createBrowse } from './music-browse.js';

const pad = n => String(n).padStart(2, '0');
const mmss = ms => `${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Offizielles Spotify-Logo, unverändert; weiß im Dunkel-, schwarz im Hellmodus.
const logo = () => h('a', { class: 'spotify-logo', href: 'https://open.spotify.com/', target: '_blank', rel: 'noopener', title: 'Inhalte von Spotify – Spotify öffnen' },
  h('img', { class: 'spotify-logo-light', src: 'assets/spotify/Full_Logo_Black_RGB.svg', alt: 'Spotify', width: 90 }),
  h('img', { class: 'spotify-logo-dark', src: 'assets/spotify/Full_Logo_White_RGB.svg', alt: 'Spotify', width: 90 }));

export default {
  id: 'music',
  title: 'Musik',
  dock: { icon: '🎵', label: 'Musik' },

  async render(container, ctx) {
    let settings = await load(SETTINGS_KEY, {});
    let remote = null; // Wiedergabe auf einem anderen Gerät
    let busy = false;

    const notice = h('div', { class: 'music-notice' });
    const now = h('div', { class: 'music-now' });
    const status = h('p', { class: 'music-status muted', 'aria-live': 'polite' });
    const browse = h('div', { class: 'music-browse' });
    container.append(logo(), notice, now, status, browse);

    // Mini-Modus: nur Titel und knappe Steuerung; Wahl pro Gerät
    let mini = await ctx.cache.load('mini', false);
    const miniButton = ctx.addAction('', async () => {
      mini = !mini;
      applyMini();
      await ctx.cache.save('mini', mini);
    });
    const applyMini = () => {
      ctx.root.classList.toggle('is-mini', mini);
      miniButton.textContent = mini ? 'Groß' : 'Mini';
      miniButton.title = mini ? 'Vollständigen Player zeigen' : 'Auf eine Zeile verkleinern';
      miniButton.setAttribute('aria-label', miniButton.title);
      miniButton.setAttribute('aria-pressed', String(mini));
    };
    applyMini();

    const showError = err => {
      // Diese Fälle zeigt die Kachel bereits als eigenen Zustand an
      if (['unsupported', 'premium', 'auth'].includes(err?.code)) return;
      status.textContent = err?.message ?? String(err);
      status.classList.add('is-error');
    };
    // Aktionen nur nach Klick; Fehler verständlich anzeigen
    const run = fn => async () => {
      if (busy) return;
      busy = true;
      status.classList.remove('is-error');
      try { await fn(); } catch (err) { showError(err); } finally { busy = false; draw(); }
    };

    // ---------- Nicht verbunden / Einrichtung ----------
    const drawNotice = auth => {
      const items = [];
      if (auth.status === 'bad-origin') items.push(h('p', {}, auth.message));
      else if (auth.status === 'no-client') {
        items.push(h('p', {}, 'Spotify ist noch nicht eingerichtet. Trag in den Einstellungen (⚙︎ oben rechts) die Client-ID deiner Spotify-App ein – die Anleitung steht in der README.'));
        if (auth.message) items.push(h('p', { class: 'muted small' }, auth.message));
      } else if (['disconnected', 'expired', 'error', 'connecting'].includes(auth.status)) {
        if (auth.message) items.push(h('p', { class: auth.status === 'disconnected' ? 'muted' : 'settings-error' }, auth.message));
        items.push(h('button', { class: 'chip chip--accent music-big', type: 'button', disabled: auth.status === 'connecting', onclick: run(login) },
          auth.status === 'expired' ? 'Neu verbinden' : auth.status === 'connecting' ? 'Verbinde …' : 'Mit Spotify verbinden'));
      }
      const note = auth.status === 'connected' && P.iosNote();
      if (note) items.push(h('p', { class: 'muted small' }, note));
      notice.replaceChildren(...items);
      notice.hidden = !items.length;
    };

    // ---------- Wiedergabe ----------
    const progress = h('input', { type: 'range', class: 'music-progress', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Wiedergabeposition' });
    const elapsed = h('span', { class: 'music-time' }, '0:00');
    const total = h('span', { class: 'music-time' }, '0:00');
    let seeking = false;
    progress.addEventListener('input', () => {
      seeking = true;
      elapsed.textContent = mmss((progress.value / 1000) * P.getPlayerState().duration);
    });
    progress.addEventListener('change', run(async () => {
      await P.seek(Math.round((progress.value / 1000) * P.getPlayerState().duration));
      seeking = false;
    }));
    const volume = h('input', { type: 'range', class: 'music-volume', min: 0, max: 100, step: 1, 'aria-label': 'Lautstärke' });
    volume.addEventListener('change', run(() => P.setVolume(volume.value / 100)));

    const btn = (label, title, onclick, cls = '') => h('button', { class: `music-btn ${cls}`, type: 'button', title, 'aria-label': title, onclick }, label);
    const prevBtn = btn('⏮', 'Vorheriger Titel', run(P.previous));
    const playBtn = btn('▶', 'Abspielen', run(async () => { P.activateAudio(); await P.togglePlay(); }), 'music-btn--main');
    const nextBtn = btn('⏭', 'Nächster Titel', run(P.next));

    const drawNow = () => {
      const auth = getAuthState();
      const p = P.getPlayerState();
      if (auth.status !== 'connected') return now.replaceChildren();

      if (p.status === 'unsupported' || p.status === 'premium' || p.status === 'auth') {
        return now.replaceChildren(h('p', { class: 'settings-error' }, p.message));
      }

      const hereButton = h('button', { class: 'chip chip--accent music-big', type: 'button', onclick: run(async () => { await P.playHere(); remote = null; }) },
        p.status === 'loading' ? 'Gerät wird vorbereitet …' : 'Hier abspielen');
      hereButton.disabled = p.status === 'loading';

      if (!p.track) {
        // Auf „Ember“ läuft nichts – evtl. auf einem anderen Gerät
        return now.replaceChildren(...[
          remote?.device
            ? h('p', {}, `Läuft gerade auf „${remote.device.name}“${remote.item ? `: ${remote.item.name}` : ''}.`)
            : h('p', { class: 'muted' }, 'Wähle unten eine Playlist oder übernimm die laufende Wiedergabe.'),
          hereButton,
        ]);
      }

      const t = p.track;
      const d = p.disallows ?? {};
      playBtn.textContent = p.paused ? '▶' : '⏸';
      playBtn.title = p.paused ? 'Abspielen' : 'Pause';
      playBtn.setAttribute('aria-label', playBtn.title);
      playBtn.disabled = p.paused ? Boolean(d.resuming) : Boolean(d.pausing);
      prevBtn.disabled = Boolean(d.skipping_prev);
      nextBtn.disabled = Boolean(d.skipping_next);
      progress.disabled = Boolean(d.seeking);
      volume.value = Math.round(p.volume * 100);
      total.textContent = mmss(p.duration);

      now.replaceChildren(
        h('div', { class: 'music-track' },
          t.image ? h('img', { class: 'music-cover', src: t.image, alt: `Cover von „${t.album}“`, width: 72, height: 72 }) : null,
          h('div', { class: 'music-meta' },
            // Titel verlinkt zu Spotify (im Mini-Modus der einzige Link zurück)
            t.url
              ? h('a', { class: 'music-title', href: t.url, target: '_blank', rel: 'noopener', title: `${t.name} – Play on Spotify` }, t.name)
              : h('span', { class: 'music-title', title: t.name }, t.name),
            h('span', { class: 'music-artist muted', title: t.artists }, t.artists),
            t.url && h('a', { class: 'music-open', href: t.url, target: '_blank', rel: 'noopener' }, 'PLAY ON SPOTIFY'))),
        h('div', { class: 'music-progress-row' }, elapsed, progress, total),
        h('div', { class: 'music-controls' }, prevBtn, playBtn, nextBtn,
          h('label', { class: 'music-volume-wrap', title: 'Lautstärke' }, h('span', { 'aria-hidden': 'true' }, '🔈'), volume)));
      tick();
    };

    function tick() {
      const p = P.getPlayerState();
      if (!p.track || seeking) return;
      const pos = P.livePosition();
      elapsed.textContent = mmss(pos);
      progress.value = p.duration ? Math.round((pos / p.duration) * 1000) : 0;
    }

    // ---------- Status im Dock und im Tab-Titel ----------
    const drawStatus = () => {
      const p = P.getPlayerState();
      const playing = p.track && !p.paused;
      ctx.setBadge(playing ? `▶ ${shorten(p.track.name, 18)}` : '', {
        title: p.track ? `${p.track.name} – ${p.track.artists}${p.paused ? ' (pausiert)' : ''}` : null,
      });
      setTitlePart('music', playing && settings.tabTitle ? `♪ ${shorten(p.track.name, 40)}` : null);
      if (!status.classList.contains('is-error')) {
        status.textContent = p.message || (p.status === 'ready' && p.track ? 'Wiedergabe in Ember' : '');
      }
    };

    // Musikauswahl (Playlists, Suche, zuletzt gehört)
    const browser = createBrowse({ onError: showError, onPlayed: () => { status.classList.remove('is-error'); } });
    browse.append(browser.element);

    function draw() {
      const connected = getAuthState().status === 'connected';
      drawNotice(getAuthState());
      drawNow();
      drawStatus();
      browse.hidden = !connected;
      if (!connected) browser.reset();
      else if (!ctx.root.hidden) browser.show();
    }

    // Wiedergabe auf anderem Gerät gelegentlich abfragen (nur wenn verbunden und hier nichts läuft)
    const pollRemote = async () => {
      if (getAuthState().status !== 'connected' || P.getPlayerState().track || ctx.root.hidden) return;
      try {
        remote = await P.remoteState();
        drawNow();
      } catch (err) {
        // Abgelaufene Anmeldung zeigt der Hinweis oben („Neu verbinden“), hier nur das Limit
        if (err.code === 'rate') showError(err);
      }
    };

    ctx.onCleanup(onAuth(() => { draw(); pollRemote(); }));
    ctx.onCleanup(P.onPlayer(() => { drawNow(); drawStatus(); }));
    ctx.onCleanup(subscribe(SETTINGS_KEY, v => { settings = v ?? {}; drawStatus(); }));
    ctx.every(1000, tick);
    ctx.every(20 * 1000, pollRemote);
    ctx.onCleanup(() => setTitlePart('music', null));
    // Beim Öffnen der Kachel einmal nachsehen
    const openWatch = new MutationObserver(() => {
      if (ctx.root.hidden) return;
      pollRemote();
      if (getAuthState().status === 'connected') browser.show();
    });
    openWatch.observe(ctx.root, { attributes: true, attributeFilter: ['hidden'] });
    ctx.onCleanup(() => openWatch.disconnect());

    await refreshStatus();
    draw();
  },
};
