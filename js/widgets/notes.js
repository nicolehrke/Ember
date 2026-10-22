// Widget „Notizen“: freie Textnotizen als Reiter, ohne Formatierung.
// Speichert automatisch kurz nach dem Tippen, beim Verlassen des Felds und
// wenn die Seite in den Hintergrund geht.
//
// Datenmodell:
//   ctx.store 'list':   { [id]: { id, title, text, order, updatedAt, deleted? } }  (wird synchronisiert)
//   ctx.cache 'active': id der zuletzt geöffneten Notiz (nur dieses Gerät)
// Jede Notiz ist ein eigener Eintrag: Der Sync führt Notizen einzeln zusammen.
// Bearbeiten zwei Geräte dieselbe Notiz vor dem Abgleich, gewinnt die zuletzt gespeicherte Fassung.
import { h, confirmButton } from '../core/dom.js';

const MAX_NOTES = 10;
const SAVE_DELAY = 500;
const MAX_TITLE = 30;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export default {
  id: 'notes',
  title: 'Notizen',
  size: 's',
  dock: { icon: 'notes', label: 'Notizen' },

  async render(container, ctx) {
    let notes = await ctx.store.load('list', {});
    let activeId = await ctx.cache.load('active', null);
    let dirty = false; // ungespeicherte Änderung im Textfeld
    let editingId = null; // Notiz, zu der die ungespeicherte Änderung gehört
    let saveTimer = null;

    const visible = () => Object.values(notes).filter(n => !n.deleted)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt - b.updatedAt);
    const active = () => notes[activeId] && !notes[activeId].deleted ? notes[activeId] : visible()[0] ?? null;

    const tabs = h('div', { class: 'note-tabs', role: 'tablist', 'aria-label': 'Notizen' });
    const area = h('textarea', {
      class: 'note-text', rows: 4, spellcheck: 'true',
      placeholder: 'Schreib einfach los – wird automatisch gespeichert.', 'aria-label': 'Notiz',
    });
    const status = h('span', { class: 'note-status muted', 'aria-live': 'polite' });
    const tools = h('span', { class: 'note-tools' });
    container.append(tabs, area, h('div', { class: 'note-foot' }, status, tools));

    // ---------- Speichern ----------
    const putNote = async note => {
      notes = { ...notes, [note.id]: { ...note, updatedAt: Date.now() } };
      return ctx.store.save('list', notes);
    };

    const flush = async () => {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!dirty) return;
      dirty = false;
      // In die Notiz speichern, in der getippt wurde – auch wenn sie inzwischen
      // auf einem anderen Gerät gelöscht wurde (der Text geht so nicht verloren).
      // Gibt es noch keine Notiz, entsteht die erste beim ersten Tippen.
      const note = notes[editingId] ?? { id: editingId, title: 'Notiz', text: '', order: 0 };
      const ok = await putNote({ ...note, text: area.value, deleted: false });
      status.textContent = ok ? `Gespeichert ${timeFmt.format(Date.now())}` : 'Konnte nicht speichern';
      status.classList.toggle('is-error', !ok);
    };

    // ---------- Textfeld: wächst mit, bis zur Höchsthöhe (CSS max-height), dann Scrollen ----------
    const autosize = () => {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight + 2}px`;
    };

    area.addEventListener('input', () => {
      if (!dirty) {
        editingId = active()?.id ?? uid();
        if (activeId !== editingId) {
          activeId = editingId;
          ctx.cache.save('active', activeId);
        }
      }
      dirty = true;
      status.textContent = 'Nicht gespeichert …';
      status.classList.remove('is-error');
      autosize();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DELAY);
    });
    area.addEventListener('blur', flush);
    // Tab-Wechsel, iPad zugeklappt, Seite schließen
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    ctx.onCleanup(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    });

    const showActive = () => {
      const note = active();
      area.value = note?.text ?? '';
      autosize();
      status.textContent = note ? `Zuletzt geändert ${timeFmt.format(note.updatedAt)}` : '';
      status.classList.remove('is-error');
    };

    // ---------- Reiter ----------
    const select = async id => {
      await flush();
      activeId = id;
      await ctx.cache.save('active', activeId);
      drawTabs();
      showActive();
    };

    function drawTabs() {
      const list = visible();
      const current = active();
      tabs.replaceChildren(...list.map(note => h('button', {
        class: `note-tab${note.id === current?.id ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(note.id === current?.id),
        title: note.title,
        onclick: () => { if (note.id !== current?.id) select(note.id); },
      }, note.title)),
      h('button', {
        class: 'note-tab note-add', type: 'button', disabled: list.length >= MAX_NOTES,
        title: list.length >= MAX_NOTES ? `Höchstens ${MAX_NOTES} Notizen` : 'Neue Notiz', 'aria-label': 'Neue Notiz',
        onclick: async () => {
          await flush();
          const note = { id: uid(), title: `Notiz ${list.length + 1}`, text: '', order: Math.max(-1, ...list.map(n => n.order ?? 0)) + 1 };
          await putNote(note);
          await select(note.id);
          area.focus();
        },
      }, '+'));
      drawTools();
    }

    function drawTools() {
      const note = active();
      if (!note) return tools.replaceChildren();
      tools.replaceChildren(
        h('button', { class: 'chip', type: 'button', onclick: rename }, 'Umbenennen'),
        confirmButton({ class: 'chip' }, 'Löschen', 'Wirklich löschen?', async () => {
          clearTimeout(saveTimer);
          dirty = false;
          await putNote({ ...note, deleted: true });
          activeId = visible()[0]?.id ?? null;
          await ctx.cache.save('active', activeId);
          drawTabs();
          showActive();
        }));
    }

    function rename() {
      const note = active();
      if (!note) return;
      const input = h('input', { type: 'text', value: note.title, maxlength: MAX_TITLE, 'aria-label': 'Name der Notiz' });
      const form = h('form', { class: 'note-rename' }, input, h('button', { class: 'chip chip--accent', type: 'submit' }, 'OK'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const title = input.value.trim().slice(0, MAX_TITLE);
        if (title && title !== note.title) await putNote({ ...active(), title });
        drawTabs();
      });
      input.addEventListener('keydown', event => { if (event.key === 'Escape') drawTools(); });
      tools.replaceChildren(form);
      input.select();
    }

    // ---------- Änderungen anderer Geräte ----------
    ctx.store.subscribe('list', v => {
      notes = v ?? {};
      drawTabs();
      const note = active();
      // Eigene ungespeicherte Eingaben nie überschreiben; sonst den neuen Stand zeigen
      if (!dirty && note && note.text !== area.value) {
        const { selectionStart, selectionEnd } = area;
        const focused = document.activeElement === area;
        area.value = note.text;
        autosize();
        if (focused) area.setSelectionRange(Math.min(selectionStart, area.value.length), Math.min(selectionEnd, area.value.length));
      }
    });

    drawTabs();
    showActive();
    // Höhe neu berechnen, wenn sich die Breite ändert (z. B. wenn die Kachel geöffnet wird)
    let lastWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width;
      autosize();
    });
    observer.observe(container);
    ctx.onCleanup(() => observer.disconnect());
  },
};
