import { initTheme } from './core/theme.js';
import { mountWidget } from './core/widget-host.js';
import widgets from './widgets/index.js';

initTheme(document.getElementById('theme-toggle'));

const slots = {
  hero: document.getElementById('slot-hero'),
  header: document.getElementById('slot-header'),
  grid: document.getElementById('grid'),
};
for (const widget of widgets) mountWidget(slots, widget);
