// Einstellungs-Panel (⚙︎ oben rechts): Sync über GitHub Gist verbinden/trennen, Spotify einrichten.
import { h, confirmButton } from './dom.js';
import { popover } from './popover.js';
import { connect, disconnect, syncNow, onStatus, getConfig } from './sync.js';
import { spotifySettings } from '../spotify/settings-section.js';
import { alertSettings } from './alert-settings.js';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Ember-Sync';
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

const STATE_TEXT = {
  off: 'Sync ist aus. Daten liegen nur auf diesem Gerät.',
  syncing: 'Synchronisiere …',
  ok: 'Synchronisiert',
  offline: 'Offline',
  error: 'Sync-Fehler',
};

export function initSettings(root) {
  const button = h('button', { class: 'icon-btn settings-btn', type: 'button', title: 'Einstellungen', 'aria-label': 'Einstellungen', 'aria-controls': 'settings-panel' },
    '⚙︎', h('span', { class: 'sync-dot', 'aria-hidden': 'true' }));
  const body = h('div', { class: 'settings-body' });
  const panel = h('div', { class: 'popover', id: 'settings-panel', hidden: true },
    h('h2', { class: 'card-title' }, 'Sync zwischen Geräten'),
    body,
    alertSettings(),
    spotifySettings());
  root.append(button, panel);
  popover(button, panel, root);

  let status = null;

  const draw = async () => {
    const config = await getConfig();
    const s = status;
    let line = STATE_TEXT[s.state];
    if (s.state === 'ok' && s.lastSync) line += ` um ${timeFmt.format(s.lastSync)} Uhr`;

    if (!config) {
      const input = h('input', { type: 'password', placeholder: 'GitHub-Token (ghp_…)', 'aria-label': 'GitHub-Token', autocomplete: 'off', spellcheck: 'false' });
      const error = h('p', { class: 'settings-error' }, s.message || '');
      const form = h('form', { class: 'settings-form' },
        input,
        h('button', { class: 'chip chip--accent', type: 'submit' }, 'Verbinden'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        error.textContent = 'Verbinde …';
        try {
          await connect(input.value);
        } catch (err) {
          error.textContent = err.message;
        }
      });
      body.replaceChildren(
        h('p', { class: 'muted' }, line),
        h('ol', { class: 'settings-steps' },
          h('li', {}, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Token auf GitHub erstellen'),
            ' – nur das Häkchen „gist“ setzen, Ablaufdatum nach Wunsch.'),
          h('li', {}, 'Token hier einfügen und verbinden.'),
          h('li', {}, 'Auf jedem weiteren Gerät denselben Token eintragen.')),
        form,
        error,
        h('p', { class: 'muted small' }, 'Der Token bleibt nur auf diesem Gerät gespeichert. Die Daten liegen in einem geheimen Gist deines GitHub-Kontos.'));
      return;
    }

    body.replaceChildren(...[
      h('p', { class: `settings-state is-${s.state}` }, line),
      h('p', { class: 'settings-error' }, s.message ?? ''),
      s.gistPublic === true && h('p', { class: 'settings-error' }, 'Achtung: Das Sync-Gist ist öffentlich. Jeder mit dem Link kann deine Daten lesen. Erstelle ein neues, geheimes Gist (Trennen, Gist auf GitHub löschen, neu verbinden).'),
      s.gistPublic === false && h('p', { class: 'muted small' }, '🔒 Geheimes Gist – nicht öffentlich gelistet, nur über den Link oder deinen Token erreichbar.'),
      h('div', { class: 'settings-actions' },
        h('button', { class: 'chip', type: 'button', onclick: () => syncNow() }, 'Jetzt synchronisieren'),
        h('a', { class: 'chip', href: config.gistUrl, target: '_blank', rel: 'noopener' }, 'Gist öffnen'),
        confirmButton({ class: 'chip', title: 'Die Daten bleiben auf diesem Gerät und im Gist erhalten.' },
          'Trennen', 'Wirklich trennen?', disconnect)),
    ].filter(Boolean));
  };

  onStatus(next => {
    status = next;
    button.dataset.sync = next.state;
    draw();
  });
}
