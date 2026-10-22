// Gemeinsamer Export/Import (Backup) für die Sammlungen mehrerer Widgets.
// Neue Sammlungen hier in COLLECTIONS eintragen – mehr ist nicht nötig.
//
// Format (version 2): { app: 'dashboard', type: 'backup', version: 2, exportedAt, data: { '<key>': {…} } }
// Ältere Lernzeit-Exporte (type 'lernzeit', version 1) werden weiterhin gelesen.
import { load, save } from './storage.js';

export const COLLECTIONS = [
  { key: 'study.subjects', one: 'Fach', many: 'Fächer' },
  { key: 'study.sessions', one: 'Lerneintrag', many: 'Lerneinträge' },
  { key: 'habits.list', one: 'Gewohnheit', many: 'Gewohnheiten' },
  { key: 'habits.days', one: 'Gewohnheits-Tag', many: 'Gewohnheits-Tage' },
  { key: 'exams.list', one: 'Klausur', many: 'Klausuren' },
  { key: 'notes.list', one: 'Notiz', many: 'Notizen' },
  { key: 'shopping.items', one: 'Einkaufsartikel', many: 'Einkaufsartikel' },
  { key: 'shopping.history', one: 'Einkaufsvorschlag', many: 'Einkaufsvorschläge' },
];

// Einträge zweier Sammlungen zusammenführen (neuere Änderung gewinnt).
export function mergeRecords(a = {}, b = {}) {
  const result = { ...a };
  for (const [id, record] of Object.entries(b ?? {})) {
    if (record && typeof record.updatedAt === 'number' && (!result[id] || record.updatedAt > result[id].updatedAt)) result[id] = record;
  }
  return result;
}

export async function exportBackup() {
  const data = {};
  for (const { key } of COLLECTIONS) data[key] = await load(key, {});
  return { app: 'dashboard', type: 'backup', version: 2, exportedAt: new Date().toISOString(), data };
}

// Gibt pro Sammlung die Anzahl neuer Einträge zurück.
export async function importBackup(file) {
  let data;
  if (file?.type === 'backup' && file.data && typeof file.data === 'object') data = file.data;
  else if (file?.type === 'lernzeit' && typeof file.sessions === 'object' && typeof file.subjects === 'object') {
    data = { 'study.subjects': file.subjects, 'study.sessions': file.sessions };
  } else {
    throw new Error('Die Datei ist kein Dashboard-Export.');
  }

  const added = [];
  for (const { key, one, many } of COLLECTIONS) {
    if (!data[key] || typeof data[key] !== 'object') continue;
    const current = await load(key, {});
    const merged = mergeRecords(current, data[key]);
    const count = Object.keys(merged).length - Object.keys(current).length;
    await save(key, merged);
    if (count > 0) added.push(`${count} ${count === 1 ? one : many}`);
  }
  return added;
}
