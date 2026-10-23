// Einstellungs-Panel (⚙︎ oben rechts) mit einklappbaren Bereichen:
// Darstellung, Konten und Sync, Kalender (RWTH), Licht, Musik (Spotify), Timer & Wecker, Daten.
// Andere Module öffnen einen Bereich mit document.dispatchEvent(new CustomEvent('ember:settings', { detail: '<id>' })).
import { h, confirmButton, secretField } from './dom.js';
import { popover } from './popover.js';
import { connect, disconnect, syncNow, onStatus, getConfig } from './sync.js';
import { spotifySettings } from '../spotify/settings-section.js';
import { alertSettings } from './alert-settings.js';
import { icon } from './icons.js';
import { resetLayout } from './layout.js';
import { themeControls } from './theme.js';
import { exportBackup, importBackup } from './backup.js';
import { calendarSettings } from '../widgets/timetable-settings.js';
import { lightSettings } from '../widgets/licht-settings.js';

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
    icon('gear'), h('span', { class: 'sync-dot', 'aria-hidden': 'true' }));
  const body = h('div', { class: 'settings-body' });
  const section = (id, title, hint, content) => h('details', { class: 'settings-section', id: `settings-${id}` },
    h('summary', {}, h('span', { class: 'settings-section-title' }, title), hint && h('span', { class: 'muted small' }, hint)),
    content);
  const panel = h('div', { class: 'popover settings-panel', id: 'settings-panel', hidden: true, role: 'dialog', 'aria-label': 'Einstellungen' },
    h('h2', { class: 'card-title' }, 'Einstellungen'),
    section('darstellung', 'Darstellung', 'Stil, Hell/Dunkel', themeControls()),
    section('sync', 'Konten und Sync', 'GitHub-Gist zwischen deinen Geräten', body),
    section('kalender', 'Kalender (RWTH)', 'Stundenplan über deinen Worker', calendarSettings()),
    section('licht', 'Licht', 'Buttons für die Kurzbefehle', lightSettings()),
    section('musik', 'Musik (Spotify)', 'Verbinden, trennen, Tab-Titel', spotifySettings()),
    section('timer', 'Timer & Wecker', 'Klang, Benachrichtigungen, Bildschirm', alertSettings()),
    section('daten', 'Daten', 'Export, Import, Layout zurücksetzen', dataSettings()));
  root.append(button, panel);
  const control = popover(button, panel, root);

  // Bereich von außen öffnen (Zahnrad der Licht-Kachel, „Daten“ der Lernzeit, Stundenplan einrichten).
  // Erst nach dem auslösenden Klick, sonst schließt ihn der Klick-daneben-Schutz des Popovers gleich wieder.
  document.addEventListener('ember:settings', event => setTimeout(() => {
    control.setOpen(true);
    const target = panel.querySelector(`#settings-${event.detail}`);
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ block: 'start' });
    target.querySelector('summary').focus({ preventScroll: true });
  }));

  let status = null;

  const draw = async () => {
    const config = await getConfig();
    const s = status;
    let line = STATE_TEXT[s.state];
    if (s.state === 'ok' && s.lastSync) line += ` um ${timeFmt.format(s.lastSync)} Uhr`;

    if (!config) {
      const { input, element: tokenField } = secretField({ placeholder: 'GitHub-Token (ghp_…)', 'aria-label': 'GitHub-Token' });
      const error = h('p', { class: 'settings-error' }, s.message || '');
      const form = h('form', { class: 'settings-form' },
        tokenField,
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

// Bereich „Layout“: Reihenfolge (synchronisiert) und Größen (dieses Gerät) auf Standard
// Bereich „Daten“: Sicherung als JSON (alle Sammlungen aus core/backup.js) und Layout zurücksetzen
function dataSettings() {
  const info = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const added = await importBackup(JSON.parse(await file.text()));
      info.textContent = `Import fertig: ${added.length ? `neu sind ${added.join(', ')}` : 'keine neuen Einträge'}; vorhandene wurden abgeglichen.`;
    } catch (err) {
      info.textContent = err instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : err.message;
    }
  });

  return h('div', { class: 'settings-body' },
    h('p', { class: 'muted small' }, 'Sichert Lernzeit (Fächer, Einträge), Gewohnheiten, Klausuren, Notizen, Einkaufsliste, Aufgaben und Licht-Buttons in einer JSON-Datei – ohne Tokens oder Schlüssel. Ein Import führt zusammen, statt zu überschreiben.'),
    h('div', { class: 'settings-actions' },
      h('button', {
        class: 'chip', type: 'button',
        onclick: async () => {
          const data = await exportBackup();
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const a = h('a', { href: url, download: `dashboard-backup-${today()}.json` });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          info.textContent = 'Export erstellt.';
        },
      }, 'Als JSON exportieren'),
      h('button', { class: 'chip', type: 'button', onclick: () => importInput.click() }, 'JSON importieren')),
    importInput,
    h('h3', { class: 'settings-label' }, 'Layout'),
    h('p', { class: 'muted small' }, 'Kacheln lassen sich am Kopf verschieben und über den Größen-Button umschalten. Zurücksetzen stellt die Standardreihenfolge (alle Geräte) und die Standardgrößen (dieses Gerät) wieder her.'),
    h('div', { class: 'settings-actions' },
      confirmButton({ class: 'chip', title: 'Standardreihenfolge und -größen wiederherstellen' }, 'Layout zurücksetzen', 'Wirklich zurücksetzen?', async () => {
        await resetLayout();
        info.textContent = 'Reihenfolge und Größen sind zurückgesetzt.';
      })),
    info);
}
