// Einstellungs-Bereich „Licht“: Buttons der Licht-Kachel verwalten (hinzufügen, Anzeigename und
// Kurzbefehl-Name getrennt, Symbol, Reihenfolge, Tastenkürzel, Löschen, Test-Link).
// Gespeichert wie in der Kachel unter 'licht.buttons' (synchronisiert, pro Button ein Eintrag
// mit Zeitstempel, Löschungen als Grabstein).
import { h, confirmButton } from '../core/dom.js';
import { load, save, subscribe } from '../core/storage.js';
import { icon } from '../core/icons.js';
import { ICONS, KEYS, DEFAULTS, keyLabel, shortcutLink } from './licht.js';

const KEY = 'licht.buttons';
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function lightSettings() {
  let buttons = {};
  const list = h('div', { class: 'light-manage' });
  const section = h('div', { class: 'settings-body' }, list);
  const active = () => Object.values(buttons).filter(b => !b.deleted).sort((a, b) => a.order - b.order);
  const put = async (...changed) => {
    const now = Date.now();
    buttons = { ...buttons };
    for (const b of changed) buttons[b.id] = { ...b, updatedAt: now };
    await save(KEY, buttons);
  };

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
        onclick: () => put({ ...cur(), icon: id }).then(draw),
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
      draw();
    });
    const move = async step => {
      const list = active();
      const self = cur();
      const other = list[list.findIndex(o => o.id === b.id) + step];
      if (!other) return;
      await put({ ...self, order: other.order }, { ...other, order: self.order });
      draw();
    };
    const link = shortcutLink(b.shortcut);
    return h('li', { class: 'light-row' },
      h('div', { class: 'light-row-fields' },
        field('label', 'Anzeigename', b.label, text => put({ ...cur(), label: text })),
        field('shortcut', 'Name des Kurzbefehls', b.shortcut, text => {
          put({ ...cur(), shortcut: text });
          // Test-Link sofort nachziehen
          const out = section.querySelector(`[data-focus="${b.id}:link"]`);
          if (out) out.value = shortcutLink(text);
        })),
      icons,
      h('div', { class: 'study-form-row' },
        keySelect,
        h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `${b.label} nach oben`, title: 'Nach oben', disabled: index === 0, 'data-focus': `${b.id}:up`, onclick: () => move(-1) }, '↑'),
        h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `${b.label} nach unten`, title: 'Nach unten', disabled: index === items.length - 1, 'data-focus': `${b.id}:down`, onclick: () => move(1) }, '↓'),
        h('button', {
          class: 'chip', type: 'button', 'aria-expanded': String(testing.has(b.id)), 'data-focus': `${b.id}:test`,
          onclick: () => { testing.has(b.id) ? testing.delete(b.id) : testing.add(b.id); draw(); },
        }, 'Link testen'),
        confirmButton({ class: 'chip', 'data-focus': `${b.id}:delete` }, 'Löschen', 'Wirklich löschen?', async () => {
          testing.delete(b.id);
          await put({ ...cur(), deleted: true });
          draw();
        })),
      testing.has(b.id) && h('div', { class: 'light-test' },
        h('span', { class: 'muted small' }, 'Dieser Link wird geöffnet (zum Kopieren):'),
        h('input', { type: 'text', class: 'light-link', readonly: true, value: link, 'aria-label': `Link für ${b.label}`, 'data-focus': `${b.id}:link`, onfocus: e => e.target.select() })));
  };

  function draw() {
        const focusKey = document.activeElement?.dataset?.focus;
    const items = active();
    const add = h('button', {
      class: 'chip chip--accent', type: 'button',
      onclick: async () => {
        const id = uid();
        const order = Math.max(-1, ...items.map(b => b.order)) + 1;
        await put({ id, label: 'Neuer Button', shortcut: 'Neuer Button', icon: 'bulb', order, key: null });
        draw();
        section.querySelector(`[data-focus="${id}:label"]`)?.select();
      },
    }, '+ Button hinzufügen');
    list.replaceChildren(
      h('ol', { class: 'light-rows' }, ...items.map((b, i) => row(b, i, items))),
      h('div', { class: 'study-form-row' }, add));
    if (focusKey) section.querySelector(`[data-focus="${focusKey}"]`)?.focus();
  }

  load(KEY, null).then(value => {
    buttons = value ?? Object.fromEntries(DEFAULTS.map((b, order) => [b.id, { ...b, order, updatedAt: 0 }]));
    draw();
  });
  // Änderungen aus der Kachel, anderen Tabs oder dem Sync – nicht mitten in einer Eingabe
  subscribe(KEY, value => {
    buttons = value ?? {};
    if (!section.contains(document.activeElement)) draw();
  });
  return section;
}
