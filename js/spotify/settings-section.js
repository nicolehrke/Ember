// Spotify-Bereich im Einstellungs-Panel: Client-ID, Weiterleitungs-Adresse, Verbinden/Trennen,
// Tab-Titel-Schalter. Alles nur auf diesem Gerät gespeichert.
import { h, confirmButton, infoToggle } from '../core/dom.js';
import { load, save } from '../core/storage.js';
import { onAuth, getClientId, setClientId, login, disconnectAll, redirectUri, tokenInfo, originProblem } from './auth.js';

export const SETTINGS_KEY = 'local/spotify/settings';
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

const STATUS_TEXT = {
  'no-client': 'Nicht eingerichtet',
  'bad-origin': 'Diese Adresse wird von Spotify nicht akzeptiert',
  disconnected: 'Nicht verbunden',
  connecting: 'Verbinde …',
  connected: 'Verbunden',
  expired: 'Anmeldung abgelaufen',
  error: 'Fehler',
};

export function spotifySettings() {
  const section = h('div', { class: 'settings-body' });

  const draw = async auth => {
    const clientId = await getClientId();
    const settings = await load(SETTINGS_KEY, {});
    const info = auth.status === 'connected' ? await tokenInfo() : null;
    const error = h('p', { class: 'settings-error' }, auth.message && auth.status !== 'connected' ? auth.message : '');

    const idInput = h('input', { type: 'text', value: clientId, placeholder: 'Client-ID deiner Spotify-App', 'aria-label': 'Spotify Client-ID', autocomplete: 'off', spellcheck: 'false' });
    const idForm = h('form', { class: 'settings-form' }, idInput, h('button', { class: 'chip', type: 'submit' }, 'Speichern'));
    idForm.addEventListener('submit', async event => {
      event.preventDefault();
      await setClientId(idInput.value);
    });

    // Unter „localhost“ die Adresse anzeigen, die Spotify akzeptiert (127.0.0.1)
    const uri = originProblem() && location.hostname === 'localhost'
      ? `http://127.0.0.1:${location.port || 80}${location.pathname}`
      : redirectUri();
    const copy = h('button', {
      class: 'chip', type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(uri);
          copy.textContent = 'Kopiert';
        } catch {
          copy.textContent = 'Bitte von Hand kopieren';
        }
      },
    }, 'Kopieren');

    const connect = h('button', {
      class: 'chip chip--accent', type: 'button',
      onclick: async () => {
        try { await login(); } catch (err) { error.textContent = err.message; }
      },
    }, auth.status === 'expired' ? 'Neu verbinden' : 'Mit Spotify verbinden');

    const tabTitle = h('input', { type: 'checkbox', checked: Boolean(settings.tabTitle) });
    tabTitle.addEventListener('change', async () => {
      await save(SETTINGS_KEY, { ...(await load(SETTINGS_KEY, {})), tabTitle: tabTitle.checked });
    });

    // Kurzanleitung hinter dem ⓘ am Feld (ausführlich in der README unter „Musik (Spotify)“)
    const help = infoToggle('Spotify einrichten',
      h('ol', { class: 'settings-steps' },
        h('li', {}, h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com/dashboard'), ' öffnen und anmelden.'),
        h('li', {}, '„Create app“: Name ohne „Spotify“, bei den APIs „Web API“ und „Web Playback SDK“ ankreuzen.'),
        h('li', {}, 'Die Weiterleitungs-Adresse unten (Kopieren) exakt als Redirect URI eintragen.'),
        h('li', {}, 'Die Client ID kopieren und hier einfügen – ein Client-Secret braucht Ember nicht.'),
        h('li', {}, '„Mit Spotify verbinden“ tippen und bei Spotify zustimmen.')),
      h('p', {}, 'Die App läuft im Entwicklermodus: Trag dein eigenes Spotify-Konto in der App unter „User Management“ ein. Der Player braucht Spotify Premium. Client-ID und Anmeldung bleiben nur auf diesem Gerät.'));

    section.replaceChildren(...[
      h('p', { class: `settings-state is-${auth.status === 'connected' ? 'ok' : auth.status === 'error' || auth.status === 'expired' ? 'error' : 'off'}` },
        STATUS_TEXT[auth.status] ?? auth.status,
        info?.refreshExpiresAt ? ` · Anmeldung gültig bis ca. ${dateFmt.format(info.refreshExpiresAt)}` : ''),
      error,
      auth.status !== 'connected' && h('div', { class: 'settings-label-row' }, h('span', { class: 'settings-label' }, 'Client-ID'), help.button),
      auth.status !== 'connected' && help.panel,
      auth.status !== 'connected' && idForm,
      auth.status !== 'connected' && h('span', { class: 'settings-label' }, 'Weiterleitungs-Adresse (Redirect URI)'),
      auth.status !== 'connected' && h('div', { class: 'settings-form' }, h('code', { class: 'settings-code' }, uri), copy),
      h('div', { class: 'settings-actions' },
        clientId && auth.status !== 'connected' && auth.status !== 'bad-origin' && connect,
        (clientId || auth.status === 'connected') && confirmButton({ class: 'chip' }, 'Trennen', 'Alle Spotify-Daten löschen?', disconnectAll)),
      h('label', { class: 'pomo-check' }, tabTitle, 'Laufenden Titel im Tab-Titel anzeigen'),
    ].filter(Boolean));
  };

  onAuth(auth => { draw(auth); });
  return section;
}
