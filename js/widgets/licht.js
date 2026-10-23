// Widget „Licht“: schaltet Lichter (z. B. IKEA über Apple Home) über Apple-Kurzbefehle.
// Kein Server, keine API: Jeder Button ist ein Link shortcuts://run-shortcut?name=<Name>,
// der beim Klick den gleichnamigen Kurzbefehl in der Kurzbefehle-App startet. Ember kennt
// keinen Zustand der Lichter und zeigt auch keinen an.
//
// Datenmodell (über ctx.store, wird synchronisiert):
//   buttons: { [id]: { id, label, shortcut, icon, order, key, updatedAt, deleted? } }
//            label = Anzeigename, shortcut = Name des Kurzbefehls, key = Ziffer für Shift+Ziffer oder null.
// Wie bei der Einkaufsliste ist jeder Button ein eigener Eintrag mit Zeitstempel; gelöschte bleiben
// als Grabstein (deleted) stehen. Die Standard-Buttons haben feste IDs, damit zwei Geräte beim
// ersten Start nicht je eigene anlegen; sie tragen den Zeitstempel 0, damit beim ersten Sync
// eines neuen Geräts jede echte Änderung aus dem Gist gewinnt. Bearbeitet werden die Buttons in
// den Einstellungen (js/widgets/licht-settings.js), das Zahnrad der Kachel öffnet sie dort.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

const FEEDBACK_MS = 1500;
const TOMBSTONE_DAYS = 30;
export const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const keyLabel = key => (key ? `Shift+${key}` : '');
export const ICONS = { bulb: 'Glühbirne', moon: 'Mond', sun: 'Sonne', book: 'Buch', candle: 'Kerze', star: 'Stern', house: 'Haus', screen: 'Bildschirm' };
export const DEFAULTS = [
  { id: 'licht-an', label: 'Licht an', shortcut: 'Licht an', icon: 'bulb', key: '1' },
  { id: 'licht-aus', label: 'Licht aus', shortcut: 'Licht aus', icon: 'moon', key: '2' },
  { id: 'licht-lesen', label: 'Lesen', shortcut: 'Lesen', icon: 'book', key: '3' },
  { id: 'licht-gemuetlich', label: 'Gemütlich', shortcut: 'Gemütlich', icon: 'candle', key: '4' },
];

// Link zum Kurzbefehl; encodeURIComponent codiert Leerzeichen, Umlaute und Sonderzeichen.
export const shortcutLink = name => `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;

// Grabsteine älter als 30 Tage entfernen (null, wenn nichts zu tun ist).
export function prune(buttons, now = Date.now()) {
  const limit = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const old = Object.values(buttons).filter(b => b.deleted && b.updatedAt < limit);
  if (!old.length) return null;
  const rest = { ...buttons };
  for (const b of old) delete rest[b.id];
  return rest;
}

const isTyping = el => Boolean(el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

// Grober Hinweis: Kurzbefehle gibt es nur auf Mac, iPhone und iPad. Im Zweifel Buttons zeigen.
function lacksShortcuts() {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return false;
  return /Windows|Android|CrOS/.test(ua) || /Linux/.test(ua);
}

export default {
  id: 'licht',
  title: 'Licht',
  size: 's',
  dock: { icon: 'bulb', label: 'Licht' },

  async render(container, ctx) {
    let buttons = await ctx.store.load('buttons', null);
    if (!buttons) {
      buttons = Object.fromEntries(DEFAULTS.map((b, order) => [b.id, { ...b, order, updatedAt: 0 }]));
      await ctx.store.save('buttons', buttons);
    }
    const pruned = prune(buttons);
    if (pruned) {
      buttons = pruned;
      await ctx.store.save('buttons', buttons);
    }
    const unsupported = lacksShortcuts();
    const active = () => Object.values(buttons).filter(b => !b.deleted).sort((a, b) => a.order - b.order);

    const list = h('div', { class: 'light-buttons' });
    const note = h('p', { class: 'light-note muted small' }, 'Ember sendet nur den Befehl. Der aktuelle Zustand der Lichter wird nicht angezeigt.');

    // Zahnrad öffnet den Bereich „Licht“ in den Einstellungen
    const gear = ctx.addAction('', () => document.dispatchEvent(new CustomEvent('ember:settings', { detail: 'licht' })), 'Buttons verwalten (Einstellungen)');
    gear.replaceChildren(icon('gear'));
    gear.classList.add('light-gear');

    // Ohne Kurzbefehle-App (Windows, Linux, Android) ruhiger Hinweis statt Buttons; verwalten geht trotzdem.
    container.append(...(unsupported
      ? [h('p', { class: 'muted' }, 'Diese Funktion braucht die Apple-Kurzbefehle (Mac, iPhone oder iPad).')]
      : [list, note]));

    // Kurzer Haken als Rückmeldung – nur „Gesendet“, nie „Licht ist an“.
    const sent = link => {
      clearTimeout(link.sentTimer);
      link.classList.add('is-sent');
      link.querySelector('.light-label-text').textContent = 'Gesendet';
      link.querySelector('.light-icon').replaceWith(icon('check', 'ln-ic light-icon'));
      link.sentTimer = setTimeout(() => {
        link.classList.remove('is-sent');
        link.querySelector('.light-label-text').textContent = link.dataset.label;
        link.querySelector('.light-icon').replaceWith(icon(link.dataset.icon, 'ln-ic light-icon'));
      }, FEEDBACK_MS);
    };

    const draw = () => {
      const items = active();
      ctx.setEmpty(!items.length);
      list.replaceChildren(...(items.length ? items.map(b => {
        const link = h('a', {
          class: 'light-btn', href: shortcutLink(b.shortcut), 'data-id': b.id, 'data-label': b.label, 'data-icon': b.icon,
          'aria-label': `${b.label}, Kurzbefehl ausführen`,
          title: `Kurzbefehl „${b.shortcut}“ ausführen${b.key ? ` (${keyLabel(b.key)})` : ''}`,
        },
        icon(ICONS[b.icon] ? b.icon : 'bulb', 'ln-ic light-icon'),
        h('span', { class: 'light-label-text' }, b.label));
        // Der Link selbst öffnet die Kurzbefehle-App (echte Nutzeraktion); hier nur die Rückmeldung.
        link.addEventListener('click', () => sent(link));
        return link;
      }) : [h('p', { class: 'muted' }, 'Noch keine Buttons – über das Zahnrad (Einstellungen → Licht) anlegen.')]));
    };

    // ---------- Tastenkürzel Shift+1 … Shift+9 ----------
    const onKey = event => {
      if (unsupported || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (!digit || isTyping(document.activeElement)) return;
      const b = active().find(item => item.key === digit);
      const link = b && list.querySelector(`[data-id="${CSS.escape(b.id)}"]`);
      if (!link) return;
      event.preventDefault();
      link.click(); // Tastendruck ist eine echte Nutzeraktion
    };
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

    // Änderungen von anderen Geräten (Sync) oder Tabs
    ctx.store.subscribe('buttons', value => {
      buttons = value ?? {};
      draw();
    });

    draw();
  },
};
