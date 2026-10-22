// Widget „Uhr/Datum“ mit Begrüßung je nach Tageszeit.
import { h } from '../core/dom.js';

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function daypart(hour) {
  if (hour >= 5 && hour < 11) return { mood: 'morning', greeting: 'Guten Morgen' };
  if (hour >= 11 && hour < 17) return { mood: 'day', greeting: 'Guten Tag' };
  if (hour >= 17 && hour < 22) return { mood: 'evening', greeting: 'Guten Abend' };
  return { mood: 'night', greeting: 'Gute Nacht' };
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
  title: 'Heute',
  icon: '🕒',

  async render(container, ctx) {
    let name = await ctx.store.load('name', '');

    const greeting = h('p', { class: 'clock-greeting' });
    const time = h('p', { class: 'clock-time' });
    const date = h('p', { class: 'clock-date' });
    container.append(greeting, time, date);

    const update = () => {
      const now = new Date();
      const part = daypart(now.getHours());
      ctx.card.dataset.mood = part.mood;
      if (greeting.isConnected && !greeting.querySelector('form')) {
        greeting.textContent = name ? `${part.greeting}, ${name}!` : `${part.greeting}!`;
      }
      time.replaceChildren(timeFmt.format(now),
        h('span', { class: 'clock-seconds' }, String(now.getSeconds()).padStart(2, '0')));
      date.textContent = `${dateFmt.format(now)} · KW ${isoWeek(now)}`;
    };

    const editName = () => {
      const input = h('input', { type: 'text', value: name, placeholder: 'Dein Name', 'aria-label': 'Name für die Begrüßung', maxlength: 40 });
      const form = h('form', { class: 'clock-name-form' }, input, h('button', { class: 'chip', type: 'submit' }, 'OK'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        name = input.value.trim();
        await ctx.store.save('name', name);
        greeting.replaceChildren();
        update();
      });
      greeting.replaceChildren(form);
      input.focus();
    };

    ctx.addAction('✏️', editName, 'Namen für die Begrüßung ändern');
    update();
    ctx.every(1000, update);
  },
};
