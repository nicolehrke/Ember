// Widget „Uhr/Datum“ als Kopfbereich mit Begrüßung je nach Tageszeit.
import { h } from '../core/dom.js';

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

function greetingFor(hour) {
  if (hour >= 5 && hour < 11) return 'Guten Morgen';
  if (hour >= 11 && hour < 17) return 'Guten Tag';
  if (hour >= 17 && hour < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

// ISO-Kalenderwoche
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export default {
  id: 'clock',
  title: 'Uhr',
  placement: 'hero',

  async render(container, ctx) {
    let name = await ctx.store.load('name', '');
    let editing = false;

    // Klick auf die Begrüßung ändert den Namen.
    const greeting = h('button', { class: 'hero-greeting', type: 'button', title: 'Namen für die Begrüßung ändern' });
    const greetingSlot = h('div', { class: 'hero-greeting-slot' }, greeting);
    const time = h('p', { class: 'hero-time' });
    const date = h('p', { class: 'hero-date' });
    container.append(greetingSlot, time, date);

    const update = () => {
      const now = new Date();
      const text = greetingFor(now.getHours());
      greeting.textContent = name ? `${text}, ${name}` : text;
      time.textContent = timeFmt.format(now);
      date.textContent = `${dateFmt.format(now)} · KW ${isoWeek(now)}`;
    };

    greeting.addEventListener('click', () => {
      if (editing) return;
      editing = true;
      const input = h('input', { type: 'text', value: name, placeholder: 'Dein Name', 'aria-label': 'Name für die Begrüßung', maxlength: 40 });
      const form = h('form', { class: 'hero-name-form' }, input, h('button', { class: 'chip', type: 'submit' }, 'Speichern'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        name = input.value.trim();
        await ctx.store.save('name', name);
        editing = false;
        greetingSlot.replaceChildren(greeting);
        update();
      });
      greetingSlot.replaceChildren(form);
      input.focus();
    });

    update();
    ctx.every(1000, update);
  },
};
