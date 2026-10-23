// Bereich „Timer & Wecker“ im Einstellungs-Panel: Klang, Lautstärke, Testton,
// Benachrichtigungen (mit Hinweis, was auf diesem Gerät geht), Bildschirm anlassen, Tab-Titel.
// Alles pro Gerät (local/alerts).
import { h } from './dom.js';
import { icon } from './icons.js';
import {
  SOUNDS, getAlertSettings, setAlertSettings, alertSettingsReady, onAlerts, unlockAudio, playOnce,
  isAudioReady, audioSupported, notificationCapability, requestNotifications, wakeLockSupported, isMuted, setMuted,
} from './alerts.js';

// Stumm-Schalter oben neben ⚙︎: schaltet jeden Ton von Ember auf diesem Gerät ab
// (Pomodoro, Timer, Wecker, Testton). Fenster, Tab-Titel und Benachrichtigungen bleiben – lautlos.
export function muteButton() {
  const button = h('button', { class: 'icon-btn mute-btn', type: 'button' });
  const draw = () => {
    const muted = isMuted();
    button.replaceChildren(icon(muted ? 'bell-off' : 'bell'));
    button.setAttribute('aria-pressed', String(muted));
    button.classList.toggle('is-muted', muted);
    const text = muted ? 'Stumm – Ember spielt keinen Ton (klicken für Ton an)' : 'Ton an (klicken für stumm)';
    button.title = text;
    button.setAttribute('aria-label', muted ? 'Stumm, Ton einschalten' : 'Stumm schalten');
  };
  button.addEventListener('click', () => setMuted(!isMuted()));
  alertSettingsReady().then(draw);
  onAlerts(draw);
  return button;
}

export function alertSettings() {
  const section = h('div', { class: 'settings-body' });

  const draw = () => {
    const s = getAlertSettings();
    const sound = h('select', { class: 'select', 'aria-label': 'Klang' },
      Object.entries(SOUNDS).map(([id, { label }]) => h('option', { value: id }, label)));
    sound.value = s.sound;
    sound.addEventListener('change', () => setAlertSettings({ sound: sound.value }));

    const volume = h('input', { type: 'range', min: 5, max: 100, step: 5, value: Math.round(s.volume * 100), 'aria-label': 'Lautstärke', class: 'music-volume' });
    volume.addEventListener('change', () => setAlertSettings({ volume: volume.value / 100 }));

    const test = h('button', {
      class: 'chip', type: 'button',
      onclick: () => {
        if (isMuted()) {
          test.textContent = 'Stumm ist an';
          setTimeout(() => { test.textContent = 'Testton'; }, 2000);
          return;
        }
        unlockAudio();
        playOnce(sound.value, volume.value / 100);
      },
    }, 'Testton');

    const capability = notificationCapability();
    const notifyInfo = h('p', { class: 'muted small' }, capability.text);
    const notify = h('input', { type: 'checkbox', checked: Boolean(s.notify && capability.available && Notification.permission === 'granted'), disabled: !capability.available });
    notify.addEventListener('change', async () => {
      if (!notify.checked) return setAlertSettings({ notify: false });
      if (!(await requestNotifications())) {
        notify.checked = false;
        notifyInfo.textContent = 'Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Website-Einstellungen des Browsers ändern.';
        return undefined;
      }
      return setAlertSettings({ notify: true });
    });

    const wake = h('input', { type: 'checkbox', checked: Boolean(s.wakeLock), disabled: !wakeLockSupported() });
    wake.addEventListener('change', () => setAlertSettings({ wakeLock: wake.checked }));

    const snooze = h('select', { class: 'select', 'aria-label': 'Schlummerdauer' },
      [3, 5, 9, 10, 15].map(min => h('option', { value: min }, `${min} min`)));
    snooze.value = String(s.snooze ?? 5);
    snooze.addEventListener('change', () => setAlertSettings({ snooze: Number(snooze.value) }));

    const title = h('input', { type: 'checkbox', checked: s.tabTitle !== false });
    title.addEventListener('change', () => setAlertSettings({ tabTitle: title.checked }));

    section.replaceChildren(...[
      isMuted() ? h('p', { class: 'settings-state is-off' }, '🔕 Stumm – Ember spielt keinen Ton (Schalter oben neben ⚙︎)')
      : !audioSupported()
        ? h('p', { class: 'settings-error' }, 'Dieser Browser kann keine Töne erzeugen.')
        : h('p', { class: `settings-state is-${isAudioReady() ? 'ok' : 'off'}` }, isAudioReady() ? 'Ton ist freigeschaltet' : 'Ton noch nicht freigeschaltet – ein Klick irgendwo in Ember genügt'),
      h('div', { class: 'settings-form' }, sound, test),
      h('label', { class: 'pomo-check' }, 'Lautstärke', volume),
      h('label', { class: 'pomo-check' }, notify, 'Benachrichtigungen (dieses Gerät)'),
      notifyInfo,
      h('label', { class: 'pomo-check' }, 'Schlummern für', snooze),
      h('label', { class: 'pomo-check' }, wake, 'Bildschirm anlassen, solange ein Timer läuft oder ein Wecker in den nächsten 12 Stunden klingelt'),
      !wakeLockSupported() && h('p', { class: 'muted small' }, 'Dieser Browser kann den Bildschirm nicht anlassen.'),
      h('label', { class: 'pomo-check' }, title, 'Nächsten Timer/Wecker im Tab-Titel zeigen'),
      h('p', { class: 'muted small' }, 'Timer und Wecker klingeln nur, solange Ember in einem Tab geöffnet ist.'),
    ].filter(Boolean));
  };

  alertSettingsReady().then(draw);
  // Neu zeichnen, wenn der Ton freigeschaltet wird (Status oben)
  onAlerts(() => {
    if (!section.contains(document.activeElement)) draw();
  });
  return section;
}
