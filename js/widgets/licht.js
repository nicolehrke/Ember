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
// ersten Start nicht je eigene anlegen.
import { h, confirmButton } from '../core/dom.js';
import { icon } from '../core/icons.js';

const FEEDBACK_MS = 1500;
const TOMBSTONE_DAYS = 30;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const ICONS = { bulb: 'Glühbirne', moon: 'Mond', sun: 'Sonne', book: 'Buch', candle: 'Kerze', star: 'Stern', house: 'Haus', screen: 'Bildschirm' };
const DEFAULTS = [
  { id: 'licht-an', label: 'Licht an', shortcut: 'Licht an', icon: 'bulb', key: '1' },
  { id: 'licht-aus', label: 'Licht aus', shortcut: 'Licht aus', icon: 'moon', key: '2' },
  { id: 'licht-lesen', label: 'Lesen', shortcut: 'Lesen', icon: 'book', key: '3' },
  { id: 'licht-gemuetlich', label: 'Gemütlich', shortcut: 'Gemütlich', icon: 'candle', key: '4' },
];

// Link zum Kurzbefehl; encodeURIComponent codiert Leerzeichen, Umlaute und Sonderzeichen.
export const shortcutLink = name => `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;

// Grabsteine älter als 30 Tage entfernen (null, wenn nichts zu tun ist).
function prune(buttons, now = Date.now()) {
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
      const now = Date.now();
      buttons = Object.fromEntries(DEFAULTS.map((b, order) => [b.id, { ...b, order, updatedAt: now }]));
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

    const manage = h('div', { class: 'study-panel light-manage', hidden: true });
    const gear = ctx.addAction('', () => {
      manage.hidden = !manage.hidden;
      gear.setAttribute('aria-expanded', String(!manage.hidden));
      if (!manage.hidden) drawManage();
    }, 'Buttons verwalten');
    gear.replaceChildren(icon('gear'));
    gear.classList.add('light-gear');
    gear.setAttribute('aria-expanded', 'false');

    // Ohne Kurzbefehle-App (Windows, Linux, Android) ruhiger Hinweis statt Buttons; verwalten geht trotzdem.
    container.append(manage, ...(unsupported
      ? [h('p', { class: 'muted' }, 'Diese Funktion braucht die Apple-Kurzbefehle (Mac, iPhone oder iPad).')]
      : [list, note]));

    // ---------- Speichern ----------
    const put = async (...changed) => {
      const now = Date.now();
      buttons = { ...buttons };
      for (const b of changed) buttons[b.id] = { ...b, updatedAt: now };
      await ctx.store.save('buttons', buttons);
      draw();
    };
    const keyLabel = key => (key ? `Shift+${key}` : '');

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
      }) : [h('p', { class: 'muted' }, 'Noch keine Buttons – über das Zahnrad anlegen.')]));
    };

    // ---------- Verwalten (Zahnrad) ----------
    const testing = new Set(); // IDs mit sichtbarem Test-Link

    const row = (b, index, items) => {
      // Immer den aktuellen Stand ändern (Textfelder bauen die Liste nicht neu auf)
      const cur = () => buttons[b.id] ?? b;
      const field = (name, label, value, onChange) => {
        const input = h('input', { type: 'text', value, 'aria-label': `${label} (${b.label})`, maxlength: 80, 'data-focus': `${b.id}:${name}`, autocomplete: 'off', spellcheck: 'false' });
        input.addEventListener('change', () => {
          const text = input.value.trim();
          if (!text) return void (input.value = value);
          onChange(text);
        });
        return h('label', { class: 'light-field' }, h('span', { class: 'muted small' }, label), input);
      };
      const icons = h('div', { class: 'light-icons', role: 'group', 'aria-label': `Symbol für ${b.label}` },
        ...Object.entries(ICONS).map(([id, name]) => h('button', {
          class: 'icon-btn icon-btn--sm light-icon-pick', type: 'button', 'aria-pressed': String(b.icon === id),
          'aria-label': name, title: name, 'data-focus': `${b.id}:icon-${id}`,
          onclick: () => put({ ...cur(), icon: id }).then(drawManage),
        }, icon(id))));
      const keySelect = h('select', { class: 'select light-key', 'aria-label': `Tastenkürzel für ${b.label}`, 'data-focus': `${b.id}:key` },
        h('option', { value: '' }, 'Kein Kürzel'),
        ...KEYS.map(k => h('option', { value: k }, keyLabel(k))));
      keySelect.value = b.key ?? '';
      keySelect.addEventListener('change', async () => {
        const key = keySelect.value || null;
        // Ein Kürzel gehört nur zu einem Button
        const others = active().filter(o => o.id !== b.id && key && o.key === key).map(o => ({ ...o, key: null }));
        await put({ ...cur(), key }, ...others);
        drawManage();
      });
      const move = async step => {
        const list = active();
        const self = cur();
        const other = list[list.findIndex(o => o.id === b.id) + step];
        if (!other) return;
        await put({ ...self, order: other.order }, { ...other, order: self.order });
        drawManage();
      };
      const link = shortcutLink(b.shortcut);
      return h('li', { class: 'light-row' },
        h('div', { class: 'light-row-fields' },
          field('label', 'Anzeigename', b.label, text => put({ ...cur(), label: text })),
          field('shortcut', 'Name des Kurzbefehls', b.shortcut, text => {
            put({ ...cur(), shortcut: text });
            // Test-Link sofort nachziehen
            const out = manage.querySelector(`[data-focus="${b.id}:link"]`);
            if (out) out.value = shortcutLink(text);
          })),
        icons,
        h('div', { class: 'study-form-row' },
          keySelect,
          h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `${b.label} nach oben`, title: 'Nach oben', disabled: index === 0, 'data-focus': `${b.id}:up`, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `${b.label} nach unten`, title: 'Nach unten', disabled: index === items.length - 1, 'data-focus': `${b.id}:down`, onclick: () => move(1) }, '↓'),
          h('button', {
            class: 'chip', type: 'button', 'aria-expanded': String(testing.has(b.id)), 'data-focus': `${b.id}:test`,
            onclick: () => { testing.has(b.id) ? testing.delete(b.id) : testing.add(b.id); drawManage(); },
          }, 'Link testen'),
          confirmButton({ class: 'chip', 'data-focus': `${b.id}:delete` }, 'Löschen', 'Wirklich löschen?', async () => {
            testing.delete(b.id);
            await put({ ...cur(), deleted: true });
            drawManage();
          })),
        testing.has(b.id) && h('div', { class: 'light-test' },
          h('span', { class: 'muted small' }, 'Dieser Link wird geöffnet (zum Kopieren):'),
          h('input', { type: 'text', class: 'light-link', readonly: true, value: link, 'aria-label': `Link für ${b.label}`, 'data-focus': `${b.id}:link`, onfocus: e => e.target.select() })));
    };

    function drawManage() {
      if (manage.hidden) return;
      const focusKey = document.activeElement?.dataset?.focus;
      const items = active();
      const add = h('button', {
        class: 'chip chip--accent', type: 'button',
        onclick: async () => {
          const id = uid();
          const order = Math.max(-1, ...items.map(b => b.order)) + 1;
          await put({ id, label: 'Neuer Button', shortcut: 'Neuer Button', icon: 'bulb', order, key: null });
          drawManage();
          manage.querySelector(`[data-focus="${id}:label"]`)?.select();
        },
      }, '+ Button hinzufügen');
      manage.replaceChildren(
        h('p', { class: 'muted small' }, 'Der Kurzbefehl-Name muss genau so heißen wie der Kurzbefehl in der Kurzbefehle-App. Tastenkürzel wirken, solange kein Eingabefeld aktiv ist.'),
        h('ol', { class: 'light-rows' }, ...items.map((b, i) => row(b, i, items))),
        h('div', { class: 'study-form-row' }, add));
      if (focusKey) manage.querySelector(`[data-focus="${focusKey}"]`)?.focus();
    }

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
      if (!manage.contains(document.activeElement)) drawManage();
    });

    draw();
  },
};
