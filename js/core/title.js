// Tab-Titel aus mehreren Teilen, z. B. „🍅 12:34 Fokus · ♪ Titel – Ember“.
// Widgets setzen nur ihren eigenen Teil und überschreiben sich so nicht gegenseitig.
let base = 'Ember';
const parts = new Map();

function apply() {
  const list = [...parts.values()];
  const next = list.length ? `${list.join(' · ')} – ${base}` : base;
  if (document.title !== next) document.title = next;
}

export function setTitleBase(name) {
  base = name;
  apply();
}

// text leer/null entfernt den Teil wieder.
export function setTitlePart(key, text) {
  if (text) parts.set(key, text);
  else parts.delete(key);
  apply();
}
