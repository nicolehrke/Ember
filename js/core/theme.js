// Hell/Dunkel-Umschaltung: System → Hell → Dunkel → System …
import { load, save } from './storage.js';

const MODES = {
  system: { icon: '🖥️', label: 'System' },
  light: { icon: '☀️', label: 'Hell' },
  dark: { icon: '🌙', label: 'Dunkel' },
};
const ORDER = Object.keys(MODES);

function apply(mode, button) {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  button.textContent = `${MODES[mode].icon} ${MODES[mode].label}`;
  button.title = 'Design umschalten (System → Hell → Dunkel)';
}

export async function initTheme(button) {
  let mode = await load('theme', 'system');
  if (!ORDER.includes(mode)) mode = 'system';
  apply(mode, button);

  button.addEventListener('click', () => {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    apply(mode, button);
    save('theme', mode);
  });
}
