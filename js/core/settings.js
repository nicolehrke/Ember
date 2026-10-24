// Einstellungs-Panel (⚙︎ oben rechts) mit einklappbaren Bereichen:
// Darstellung, Konten und Sync, Kalender (RWTH), Licht, Musik (Spotify), Timer & Wecker, Daten.
// Andere Module öffnen einen Bereich mit document.dispatchEvent(new CustomEvent('ember:settings', { detail: '<id>' })).
import { h, confirmButton, secretField, infoToggle } from './dom.js';
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
import { notificationCapability } from './alerts.js';

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
  // Ein Bereich: Überschrift mit Kurzbeschreibung, optional ein ⓘ mit der Erklärung (zugeklappt)
  const section = (id, title, hint, content, info) => {
    const explain = info && infoToggle(title, ...info);
    return h('details', { class: 'settings-section', id: `settings-${id}` },
      h('summary', {}, h('span', { class: 'settings-section-title' }, title), hint && h('span', { class: 'muted small' }, hint)),
      explain && h('div', { class: 'settings-info' }, explain.button),
      explain?.panel,
      content);
  };
  const p = text => h('p', {}, text);
  const panel = h('div', { class: 'popover settings-panel', id: 'settings-panel', hidden: true, role: 'dialog', 'aria-label': 'Einstellungen' },
    h('h2', { class: 'card-title' }, 'Einstellungen'),
    section('darstellung', 'Darstellung', 'Stil, Hell/Dunkel', themeControls(), [
      p('„System“ folgt der Hell/Dunkel-Einstellung des Geräts. Glas und Jarvis gibt es nur dunkel, Papier nur hell – dort ist der Schalter gesperrt und die Wahl gilt wieder, sobald du zu Glut wechselst.'),
      p('Die Wahl wird zwischen deinen Geräten synchronisiert. Das Palettensymbol oben ist derselbe Schalter.'),
    ]),
    section('sync', 'Konten und Sync', 'GitHub-Gist zwischen deinen Geräten', body, [
      p('Ember gleicht deine Daten über ein geheimes Gist in deinem GitHub-Konto ab. Ein geheimes Gist ist nicht öffentlich gelistet, aber für jeden lesbar, der den Link kennt.'),
      p('Nicht synchronisiert werden Tokens, Schlüssel, Spotify, Kachelgrößen und welche Kacheln offen sind.'),
    ]),
    section('kalender', 'Kalender (RWTH)', 'Stundenplan über deinen Worker', calendarSettings(), [
      h('ol', { class: 'settings-steps' },
        h('li', {}, 'In RWTHonline im Terminkalender unter Export/Abo (iCal) einen neuen Link erzeugen.'),
        h('li', {}, 'Den Link im Cloudflare Worker als Secret ICAL_URL eintragen – nur dort, nirgends sonst.'),
        h('li', {}, 'Hier die Worker-Adresse und den Zugangsschlüssel (Secret ACCESS_KEY) eintragen.'),
        h('li', {}, '„Verbindung prüfen“ tippen.')),
      p('Die Worker-Adresse ist öffentlich und wird synchronisiert; der Schlüssel bleibt nur auf diesem Gerät. Ohne Worker geht auch eine .ics-Datei aus RWTHonline (nicht automatisch aktuell).'),
    ]),
    section('licht', 'Licht', 'Buttons für die Kurzbefehle', lightSettings(), [
      p('Der Kurzbefehl-Name muss genau so heißen wie der Kurzbefehl in der Kurzbefehle-App (Aktion „Home steuern“). Der Anzeigename steht nur auf dem Button.'),
      p('Tastenkürzel wirken, solange kein Eingabefeld aktiv ist. „Link testen“ zeigt den Link zum Kopieren, falls ein Kurzbefehl nicht startet.'),
    ]),
    section('musik', 'Musik (Spotify)', 'Verbinden, trennen, Tab-Titel', spotifySettings()),
    section('timer', 'Timer & Wecker', 'Klang, Benachrichtigungen, Bildschirm', alertSettings(), [
      p('Timer und Wecker klingeln nur, solange Ember in einem Tab geöffnet ist. Alles hier gilt nur für dieses Gerät.'),
      p(notificationCapability().text),
    ]),
    section('daten', 'Daten', 'Export, Import, Layout zurücksetzen', dataSettings(), [
      p('Der Export sichert Lernzeit, Gewohnheiten, Klausuren, Notizen, Einkaufsliste, Aufgaben, Licht-Buttons und Rezepte in einer JSON-Datei – ohne Tokens oder Schlüssel. Ein Import führt zusammen, statt zu überschreiben.'),
      p('Layout zurücksetzen stellt die Standardreihenfolge (alle Geräte) und die Standardgrößen (dieses Gerät) wieder her.'),
    ]));
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
      const help = infoToggle('GitHub-Token',
        h('ol', { class: 'settings-steps' },
          h('li', {}, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Token auf GitHub erstellen'),
            ' – klassischer Token, nur das Häkchen „gist“, Ablaufdatum nach Wunsch.'),
          h('li', {}, 'Token hier einfügen und verbinden.'),
          h('li', {}, 'Auf jedem weiteren Gerät denselben Token eintragen.')),
        h('p', {}, 'Der Token bleibt nur auf diesem Gerät gespeichert.'));
      body.replaceChildren(
        h('p', { class: 'muted' }, line),
        h('div', { class: 'settings-label-row' }, h('span', { class: 'settings-label' }, 'GitHub-Token'), help.button),
        help.panel,
        form,
        error);
      return;
    }

    body.replaceChildren(...[
      h('p', { class: `settings-state is-${s.state}` }, line),
      h('p', { class: 'settings-error' }, s.message ?? ''),
      s.gistPublic === true && h('p', { class: 'settings-error' }, 'Achtung: Das Sync-Gist ist öffentlich. Jeder mit dem Link kann deine Daten lesen. Erstelle ein neues, geheimes Gist (Trennen, Gist auf GitHub löschen, neu verbinden).'),
      s.gistPublic === false && h('p', { class: 'muted small' }, '🔒 Geheimes Gist'),
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
    h('div', { class: 'settings-actions' },
      confirmButton({ class: 'chip', title: 'Standardreihenfolge und -größen wiederherstellen' }, 'Layout zurücksetzen', 'Wirklich zurücksetzen?', async () => {
        await resetLayout();
        info.textContent = 'Reihenfolge und Größen sind zurückgesetzt.';
      })),
    info);
}
