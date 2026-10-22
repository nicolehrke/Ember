import { runMigrations } from './core/migrations.js';
import { initTheme } from './core/theme.js';
import { initSettings } from './core/settings.js';
import { initSync } from './core/sync.js';
import { mountWidget } from './core/widget-host.js';
import widgets from './widgets/index.js';

await runMigrations();

initTheme(document.getElementById('theme-toggle'));
initSettings(document.getElementById('settings'));

const slots = {
  hero: document.getElementById('slot-hero'),
  header: document.getElementById('slot-header'),
  grid: document.getElementById('grid'),
};
for (const widget of widgets) mountWidget(slots, widget);

initSync();
