// Zentrale Widget-Liste. Neues Widget: Datei in diesem Ordner anlegen,
// hier importieren und ins Array eintragen. Reihenfolge = Reihenfolge im Raster.
import clock from './clock.js';
import timetable from './timetable.js';
import weather from './weather.js';
import mensa from './mensa.js';
import study from './study.js';
import habits from './habits.js';
import exams from './exams.js';
import notes from './notes.js';
import shopping from './shopping.js';
import music from './music.js';

export default [
  clock,
  timetable,
  weather,
  // Kacheln mit Dock-Button, in der Reihenfolge des Docks
  study,
  exams,
  habits,
  mensa,
  shopping,
  notes,
  music,
];
