// Kleine DOM-Helfer, damit Widgets ohne Framework übersichtlich bleiben.

// h('button', { class: 'chip', onclick: fn }, 'Text', kindElement)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter(c => c != null && c !== false));
  return el;
}

// Button mit Bestätigung im Button selbst: erster Klick zeigt `question`,
// zweiter Klick (innerhalb weniger Sekunden) führt `action` aus.
// Ersetzt confirm(), das in eingebetteten Ansichten oft blockiert ist.
export function confirmButton(attrs, label, question, action) {
  let timer = null;
  const button = h('button', { type: 'button', ...attrs }, label);
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    button.textContent = label;
    button.classList.remove('is-confirming');
  };
  button.addEventListener('click', async () => {
    if (!timer) {
      button.textContent = question;
      button.classList.add('is-confirming');
      timer = setTimeout(reset, 4000);
      return;
    }
    reset();
    await action();
  });
  button.addEventListener('blur', reset);
  return button;
}

// Passwortfeld mit „Anzeigen“-Schalter (Geheimnisse nur maskiert; Klartext nur auf Wunsch)
export function secretField(attrs) {
  const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', ...attrs });
  const toggle = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'aria-label': `${attrs['aria-label'] ?? 'Wert'} anzeigen` }, 'Anzeigen');
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Verbergen' : 'Anzeigen';
    toggle.setAttribute('aria-pressed', String(show));
  });
  return { input, element: h('div', { class: 'settings-secret' }, input, toggle) };
}

// Zugeklappte Erklärung hinter einem ⓘ-Button: { button, panel }. Der Button steuert das Panel
// (aria-expanded/aria-controls); content sind Elemente oder Texte. Fehler und Warnungen gehören
// nicht hier hinein, die bleiben sichtbar.
let infoCount = 0;
export function infoToggle(label, ...content) {
  const id = `info-${++infoCount}`;
  const panel = h('div', { class: 'info-panel', id, hidden: true }, ...content);
  const button = h('button', {
    class: 'info-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': id,
    'aria-label': `Erklärung: ${label}`, title: `Erklärung: ${label}`,
  }, 'ⓘ');
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  return { button, panel };
}

// Escapen für Texte, die per innerHTML eingesetzt werden (z. B. API-Daten).
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);
