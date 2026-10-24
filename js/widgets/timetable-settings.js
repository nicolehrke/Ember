// Einstellungs-Bereich „Kalender (RWTH)“: Worker-Adresse (synchronisiert) und Zugangsschlüssel
// (nur dieses Gerät, maskiert), Verbindung prüfen, Stundenplan neu laden, .ics-Datei importieren.
// Der geheime RWTHonline-Link selbst kommt hier nie vor – er liegt nur als Secret ICAL_URL im Worker.
import { h, confirmButton, secretField } from '../core/dom.js';
import { load, save, remove } from '../core/storage.js';
import { WORKER_KEY, ACCESS_KEY, ICS_KEY, RELOAD_EVENT, fetchCalendar, normalizeUrl, explain, readEvents } from './timetable.js';

const stampFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const reloadTimetable = () => document.dispatchEvent(new Event(RELOAD_EVENT));

export function calendarSettings() {
  const result = h('p', { class: 'settings-result', role: 'status', 'aria-live': 'polite' });
  const workerInput = h('input', { type: 'url', placeholder: 'https://…workers.dev/', 'aria-label': 'Worker-Adresse', autocomplete: 'off', spellcheck: 'false' });
  const key = secretField({ placeholder: 'Zugangsschlüssel (ACCESS_KEY)', 'aria-label': 'Zugangsschlüssel' });
  const keyState = h('p', { class: 'muted small' });
  const loaded = h('p', { class: 'muted small' });
  const fileInput = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true });
  const show = (text, ok = false) => {
    result.textContent = text;
    result.classList.toggle('is-ok', ok);
    result.classList.toggle('is-error', !ok);
  };

  const drawState = async () => {
    const stored = await load(ACCESS_KEY, '');
    keyState.textContent = stored ? 'Schlüssel ist gespeichert – nur auf diesem Gerät, nicht im Sync.' : 'Noch kein Schlüssel auf diesem Gerät.';
    const data = await load(ICS_KEY, null);
    loaded.textContent = data
      ? `Stundenplan zuletzt geladen: ${stampFmt.format(data.fetchedAt)} Uhr${data.source === 'file' ? ` (Datei „${data.name}“)` : ''}.`
      : 'Noch kein Stundenplan geladen.';
  };

  workerInput.addEventListener('change', async () => {
    const value = workerInput.value.trim();
    if (!value) {
      await remove(WORKER_KEY);
      return show('Worker-Adresse entfernt.', true);
    }
    try {
      const url = new URL(normalizeUrl(value));
      // Ein Schlüssel gehört in das eigene Feld, nie in die (synchronisierte) Adresse
      if (url.searchParams.has('key')) {
        const fromUrl = url.searchParams.get('key');
        url.searchParams.delete('key');
        await save(ACCESS_KEY, fromUrl);
        key.input.value = fromUrl;
      }
      workerInput.value = url.href;
      await save(WORKER_KEY, url.href);
      show('Worker-Adresse gespeichert.', true);
      drawState();
    } catch {
      show('Das ist keine gültige Adresse.');
    }
  });
  key.input.addEventListener('change', async () => {
    const value = key.input.value.trim();
    if (value) await save(ACCESS_KEY, value);
    else await remove(ACCESS_KEY);
    show(value ? 'Schlüssel gespeichert (nur auf diesem Gerät).' : 'Schlüssel entfernt.', true);
    drawState();
  });

  // Verbindung prüfen: den Worker abrufen und das Ergebnis ehrlich zeigen
  const check = async () => {
    const worker = await load(WORKER_KEY, '');
    if (!worker) return show('Bitte zuerst die Worker-Adresse eintragen.');
    show('Prüfe …', true);
    try {
      const text = await fetchCalendar(worker, await load(ACCESS_KEY, ''));
      if (!/BEGIN:VCALENDAR/i.test(text)) return show('Der Worker antwortet, liefert aber keinen Kalender.');
      const count = readEvents(text).length;
      show(count ? `Verbunden – ${count} Termine im Kalender.` : 'Verbunden, aber der Kalender ist leer (keine Termine im Feed).', count > 0);
    } catch (err) {
      show(explain(err));
    }
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Die Datei ist kein iCal-Kalender.');
      const count = readEvents(text).length;
      if (!(await save(ICS_KEY, { text, fetchedAt: Date.now(), source: 'file', name: file.name }))) throw new Error('Die Datei ist zu groß für den Gerätespeicher.');
      show(`${count} Einträge importiert.${(await load(WORKER_KEY, '')) ? ' Beim nächsten Abruf über den Worker wird die Datei ersetzt.' : ''}`, true);
      reloadTimetable();
      drawState();
    } catch (err) {
      show(err.message);
    }
  });

  load(WORKER_KEY, '').then(value => { workerInput.value = value; });
  load(ACCESS_KEY, '').then(value => { key.input.value = value; });
  drawState();

  return h('div', { class: 'settings-body' },
    h('label', { class: 'settings-field' }, h('span', { class: 'settings-label' }, 'Worker-Adresse'), workerInput),
    h('div', { class: 'settings-field' }, h('span', { class: 'settings-label' }, 'Zugangsschlüssel'), key.element, keyState),
    h('div', { class: 'settings-actions' },
      h('button', { class: 'chip chip--accent', type: 'button', onclick: check }, 'Verbindung prüfen'),
      h('button', { class: 'chip', type: 'button', onclick: () => { reloadTimetable(); show('Stundenplan wird neu geladen …', true); setTimeout(drawState, 3000); } }, 'Stundenplan neu laden')),
    result,
    loaded,
    h('div', { class: 'settings-actions' },
      h('button', { class: 'chip', type: 'button', onclick: () => fileInput.click() }, '.ics-Datei importieren'),
      confirmButton({ class: 'chip', title: 'Schlüssel und geladenen Stundenplan von diesem Gerät entfernen, die Worker-Adresse auf allen Geräten' }, 'Kalender entfernen', 'Wirklich entfernen?', async () => {
        await remove(ACCESS_KEY);
        await remove(ICS_KEY);
        await remove(WORKER_KEY);
        await remove('local/timetable.notice');
        workerInput.value = '';
        key.input.value = '';
        show('Kalender entfernt.', true);
        reloadTimetable();
        drawState();
      })),
    fileInput);
}
