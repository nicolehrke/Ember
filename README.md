# Ember

Ember ist ein persönliches Dashboard für das Studium an der RWTH Aachen: reine statische Seite aus HTML, CSS und Vanilla-JavaScript (ES-Module), ohne Build-Step und ohne Abhängigkeiten.

## Lokal starten

ES-Module funktionieren nicht über `file://`, deshalb braucht es einen kleinen lokalen Webserver. Im Projektordner:

```bash
python3 -m http.server 8000
```

Danach <http://localhost:8000> öffnen. Jeder andere statische Server (z. B. `npx serve`) funktioniert genauso.

## Ordnerstruktur

```
index.html              Einstiegsseite
css/style.css           Grundgerüst: Variablen (Werte von „Glut“), Layout, alle Widgets
css/styles/<stil>.css   Ein Stil pro Datei (glut, glas, papier, jarvis), nur der aktive wird geladen
js/main.js              Startpunkt: Migrationen, Theme, Einstellungen, Widgets, Sync
js/core/storage.js      Speicher-Schicht (einzige Stelle mit localStorage)
js/core/sync.js         Sync zwischen Geräten über ein GitHub Gist
js/core/settings.js     Einstellungs-Panel (⚙︎) mit allen Bereichen (siehe „Einstellungen“)
js/core/migrations.js   Einmalige Aufräumarbeiten nach Umbauten
js/core/widget-host.js  Baut Kacheln, ruft Widgets auf, fängt Fehler ab
js/core/theme.js        Stil, Hell/Dunkel und Tageszeit-Akzente, Stil-Menü (Palettensymbol)
js/theme/palettes.js    Alle Stile: Phasen, Farb-Stützpunkte über den Tag, Schriften
js/core/briefing.js     Briefing-Satz neben der Uhr und Fokus-Modus
js/core/icons.js        Liniensymbole für Dock und Kopfleiste
js/core/layout.js       Masonry-Raster, Kacheln verschieben (Ziehen, Tastatur), Reihenfolge, Zurücksetzen
js/core/popover.js      Aufklapp-Panels (Wetter, Stundenplan, Einstellungen)
js/core/http.js         fetchJSON()/fetchText() mit Timeout und verständlichen Fehlern
js/core/ical.js         Schlanker iCal-Parser inkl. Wiederholungen und Zeitzonen
js/core/dom.js          Kleine DOM-Helfer (h(), esc(), confirmButton())
js/core/title.js        Tab-Titel aus Teilen (Lernzeit, Musik)
js/core/alerts.js       Töne (Web Audio), Benachrichtigungen, Bildschirm anlassen
js/core/ringer.js       Klingel-Fenster für Timer und Wecker
js/core/alert-settings.js  Bereich „Timer & Wecker“ in ⚙︎
js/widgets/*-settings.js   Bereiche „Kalender (RWTH)“ und „Licht“ in ⚙︎
js/spotify/             Spotify: Anmeldung (PKCE), Web API, Player-Gerät „Ember“
assets/spotify/         Offizielles Spotify-Logo (unverändert, aus dem Logo-Paket von developer.spotify.com)
js/core/backup.js       Gemeinsamer Export/Import aller Sammlungen
js/widgets/index.js     Zentrale Widget-Liste
js/widgets/*.js         Ein Modul pro Widget
examples/               Beispiel-Stundenplan (.ics) mit erfundenen Terminen
proxy/cloudflare-worker Optionaler eigener Proxy für den RWTHonline-Kalender
```

## Bedienung: Dock

Lernzeit, Aufgaben, Klausuren, Gewohnheiten, Mensa, Einkaufsliste, Rezepte, Notizen, Musik und Licht sind gleichartige Kacheln im Hauptbereich. Geöffnet und geschlossen werden sie über das Dock, die Leiste mit Liniensymbolen und Beschriftung unter der Uhr (Lernzeit, Aufgaben, Klausuren, Gewohnheiten, Mensa, Einkauf, Rezepte, Notizen, Musik, Licht), oder über das × in der Kachel. Geschlossene Kacheln verschwinden vollständig, laufen aber unsichtbar weiter – ein Lerntimer oder Pomodoro zählt also weiter. Mehrere Kacheln können gleichzeitig offen sein; ihre Reihenfolge und Größe lassen sich frei anpassen (siehe „Layout anpassen“). Sind alle geschlossen, bleibt der Hauptbereich leer.

Neben dem Symbol zeigen die Dock-Buttons – auch bei geschlossener Kachel – ihren Stand: Lernzeit den laufenden Timer („● 12:34 Fokus“, „☕ 3:10 Kurze Pause“), Klausuren die Tage bis zur nächsten Klausur (falls eingeschaltet, 14 Tage vorher hervorgehoben). Gewohnheiten und Mensa zeigen nur ihr Symbol.

Welche Kacheln offen sind, speichert jedes Gerät für sich in `local/open` (wird nicht synchronisiert), damit Mac und iPad unterschiedliche Ansichten haben können. Ohne gespeicherten Zustand sind Mensa und Gewohnheiten offen.

## Einstellungen

Alles Einstellbare liegt im Panel hinter ⚙︎ oben rechts, in einklappbaren Bereichen (per Tastatur: Tab und Enter/Leertaste auf die Überschrift). Kacheln mit eigener Einrichtung öffnen den passenden Bereich direkt.

Das Panel zeigt nur Status, Felder und Aktionen; Fehler und Warnungen stehen immer sichtbar da. Erklärungen und Schrittlisten liegen zugeklappt hinter einem **ⓘ** – einmal pro Bereich, bei Sync (GitHub-Token) und Spotify (Client-ID, mit Kurzanleitung) direkt am Feld. Der Baustein dafür ist `infoToggle()` in `js/core/dom.js`.

| Bereich | Inhalt | Gespeichert |
| --- | --- | --- |
| **Darstellung** | Stil (Glut, Glas, Papier, Jarvis) und Hell/Dunkel – dasselbe wie das Palettensymbol oben | synchronisiert (`design`) |
| **Konten und Sync** | GitHub-Token (maskiert, mit „Anzeigen“), Gist-Status, Jetzt synchronisieren, Gist öffnen, Trennen | Token nur auf dem Gerät |
| **Kalender (RWTH)** | Worker-Adresse, Zugangsschlüssel (maskiert), Verbindung prüfen, Stundenplan neu laden, .ics-Import – siehe „Kalender (RWTH)“ | Adresse synchronisiert, Schlüssel nur auf dem Gerät |
| **Licht** | Buttons der Licht-Kachel: Anzeigename, Kurzbefehl-Name, Symbol, Reihenfolge, Tastenkürzel, Löschen, Test-Link (auch über das Zahnrad der Kachel) | synchronisiert (`licht.buttons`) |
| **Musik (Spotify)** | Client-ID, Verbinden/Trennen, Weiterleitungs-Adresse, Titel im Tab | nur auf dem Gerät |
| **Timer & Wecker** | Klang, Lautstärke, Testton, Benachrichtigungen, Bildschirm anlassen, Tab-Titel, Schlummerdauer | nur auf dem Gerät |
| **Daten** | Export/Import als JSON (ohne Tokens und Schlüssel), Layout zurücksetzen (auch über „Daten“ in der Lernzeit-Kachel) | – |

Einstellungen, die nur eine Kachel betreffen, bleiben dort: Fächer der Lernzeit, Pomodoro-Dauern, Anzeige-Optionen der Aufgaben, Tage bis zur Klausur im Dock, Mini-Ansicht der Musik. Geheimnisse (GitHub-Token, Kalender-Schlüssel) erscheinen nie im Klartext, außer du tippst auf „Anzeigen“; sie stehen nicht in Fehlermeldungen oder der Konsole.

## Layout anpassen

**Raster.** Die Kacheln liegen in einem Masonry-Raster (`js/core/layout.js`): ab 1200 px Fensterbreite 4 Spalten, ab 900 px 3, ab 560 px 2, darunter eine. S ist eine Spalte breit, M und L zwei (höchstens so viele, wie es Spalten gibt). Die Höhe bestimmt allein der Inhalt – es gibt keine Zeilen und kein Strecken auf die Höhe der Nachbarn. Die Kacheln werden in ihrer Reihenfolge nacheinander an die Stelle mit der niedrigsten freien Oberkante gesetzt, die für ihre Breite passt (bei Gleichstand links). Wird eine Kachel geschlossen, kleiner oder ihr Inhalt kürzer, rücken die folgenden hoch und füllen die Lücke (200 ms, bei reduzierter Bewegung ohne Animation). Neu gerechnet wird bei Fenstergröße, Öffnen/Schließen, Größenwechsel, Inhaltsänderung, Fokus-Modus und nachgeladenen Schriften; beim Laden bleiben die Kacheln unsichtbar, bis ihre Positionen stehen. Im Fokus-Modus nimmt die Lernzeit die volle Breite vorn ein. Abstände kommen aus `--gap` (oder `--gap-x` / `--gap-y`), die Layout-Logik kennt keine Stile.

Ohne eigenen Anordnen-Modus: Jede Kachel lässt sich jederzeit verschieben und in der Größe ändern.

- **Größe:** Fährt die Maus über eine Kachel (oder liegt der Tastaturfokus darin), erscheint links vom × ein Button mit zwei Diagonalpfeilen. Jeder Klick wechselt reihum Klein → Mittel → Groß (S → M → L); die aktuelle Größe steht im Tooltip und in der Sprachausgabe. Auf Touch-Geräten ohne Hover blendet ein Tipp auf den Kachelkopf den Button für 4 Sekunden ein; bis dahin ist er unsichtbar und nicht antippbar, damit niemand versehentlich die Größe ändert.
- **Verschieben mit Maus:** Kachelkopf greifen und ziehen (bei Hover zeigt ein Griff mit sechs Punkten, wo). Das Ziehen beginnt nach 6 px Bewegung, ein einfacher Klick bleibt ein Klick. Buttons im Kopf und der Kachelinhalt lösen kein Ziehen aus.
- **Verschieben mit Touch (iPad, Handy):** Kachelkopf 300 ms gedrückt halten (kurze Vibration, wo verfügbar), dann ziehen. Wer sofort wischt, scrollt ganz normal.
- **Beim Ziehen** hält ein gestrichelter Platzhalter in Größe der Kachel den Platz und wird sofort ins Raster eingerechnet; die anderen Kacheln rücken animiert zur Seite oder nach oben. Ziel ist die Kachel, über der der Zeiger steht – erst wenn er mindestens 12 px in ihr ist, damit nichts flackert; die gezogene Kachel kommt davor (beim Ziehen nach hinten dahinter). Unter allen Kacheln heißt: ans Ende. Beim Loslassen rastet die Kachel in den Platzhalter ein. Am oberen und unteren Fensterrand scrollt die Seite mit. Esc bricht ab.
- **Tastatur:** Mit Tab den Griff einer Kachel ansteuern, Leertaste greift, Pfeiltasten verschieben um eine Position, Leertaste setzt ab, Esc bricht ab. Die Position wird angesagt („Mensa, Position 3 von 6“).
- Während Pomodoro oder ein Timer läuft (Fokus-Modus), ist Verschieben aus.

Die Reihenfolge liegt als Liste der Kachel-IDs unter `layout.order` und wird über das Gist synchronisiert (die jüngste Änderung gewinnt). Kacheln, die in der Liste fehlen (z. B. neue Widgets), kommen ans Ende; unbekannte IDs werden ignoriert. Geschlossene Kacheln behalten ihren Platz in der Reihenfolge und erscheinen beim Öffnen wieder dort. Weil jede Kachel an die höchste freie Stelle rückt, kann eine schmale Kachel neben oder über einer früheren breiten landen. Die Größen gelten pro Gerät (`local/sizes`).

**⚙︎ → Daten → Layout zurücksetzen** stellt die Standardreihenfolge (auf allen Geräten) und die Standardgrößen (auf diesem Gerät) wieder her; der Button fragt einmal nach („Wirklich zurücksetzen?“).

## Neues Widget hinzufügen

1. Datei `js/widgets/mein-widget.js` anlegen:

   ```js
   export default {
     id: 'mein-widget',          // eindeutig, dient auch als Speicher-Namespace
     title: 'Mein Widget',
     icon: '✨',                  // optional, Zeichen vor dem Kacheltitel
     placement: 'grid',          // optional: 'grid' (Kachel), 'hero' (Kopfbereich links)
                                 //           oder 'header' (kompakt oben rechts)
     size: 's',                  // optional, nur für 'grid': Standardgröße 's', 'm' oder 'l'
     sizes: ['s', 'm', 'l'],     // optional: erlaubte Größen (der Größen-Button überspringt fehlende)
     dock: { icon: 'notes', label: 'Mein Widget' }, // optional: Button im Dock öffnet/schließt die Kachel;
                                 // icon ist ein Name aus js/core/icons.js
     defaultOpen: false,         // optional, mit dock: ohne gespeicherten Zustand geöffnet?
     refreshInterval: 60_000,    // optional, in ms: ruft regelmäßig refresh() auf

     async render(container, ctx) {
       const zaehler = await ctx.store.load('zaehler', 0);
       container.textContent = `Geladen: ${zaehler}×`;
       await ctx.store.save('zaehler', zaehler + 1);
     },

     // optional; fehlt es, wird bei Aktualisierung render() erneut aufgerufen
     async refresh(container, ctx) {},
   };
   ```

2. In `js/widgets/index.js` importieren und ins Array eintragen.

Das `ctx`-Objekt bietet:

| Eigenschaft | Zweck |
| --- | --- |
| `ctx.store` | `load(key, fallback)`, `save(key, value)`, `remove(key)`, `subscribe(key, fn)`, automatisch mit der Widget-`id` als Präfix. Wird zwischen Geräten synchronisiert. |
| `ctx.cache` | Wie `ctx.store`, bleibt aber auf dem Gerät, z. B. für zwischengespeicherte API-Antworten |
| `ctx.addAction(label, onClick, title)` | Kleiner Button oben rechts in der Kachel (nur `grid`) |
| `ctx.every(ms, fn)` | Intervall, z. B. für eine Uhr; wird beim Neuaufbau automatisch beendet |
| `ctx.setStatus(text)` | Fußzeile der Kachel (z. B. „Aktualisiert 13:20 Uhr“), bei kompakten Widgets als Tooltip |
| `ctx.refresh()` | Widget neu laden |
| `ctx.root` | Das äußere Element des Widgets |
| `ctx.setBadge(text, { highlight, title })` | Kleiner Status (z. B. laufender Timer), leer = ausgeblendet. Bei Dock-Widgets erscheint er am Dock-Button (auch bei geschlossener Kachel), `highlight` hebt den Button hervor, `title` ist sein Tooltip; sonst neben dem Kacheltitel |
| `ctx.setEmpty(empty)` | Kachel als leer markieren (z. B. keine Einträge): sie schrumpft dann auf ihren Inhalt |
| `ctx.onCleanup(fn)` | Funktion, die beim Neuaufbau des Widgets aufgerufen wird (z. B. Abo auf Schlüssel eines anderen Widgets abmelden) |

Wirft `render()` oder `refresh()` einen Fehler, zeigt das Widget eine Fehlermeldung mit „Erneut versuchen“ (kompakte Widgets als kleinen Button), und der Rest der Seite läuft weiter. Für Netzwerkzugriffe `fetchJSON()` aus `js/core/http.js` verwenden.

## Design & Stile

Ember hat vier Stile, umschaltbar über das Palettensymbol oben rechts. Das Menü zeigt jeden Stil mit Mini-Farbvorschau und der aktuellen Tageszeit-Phase, darunter den Schalter System / Hell / Dunkel. Die Wahl liegt unter `design` (`{ style, mode }`) und wird wie andere Einstellungen über das Gist synchronisiert; die frühere Hell/Dunkel-Wahl (`local/theme`) wird beim ersten Start übernommen. Standard: Glut, hell oder dunkel nach Systemeinstellung.

| Stil | Modus | Kennzeichen | Phasen |
| --- | --- | --- | --- |
| **Glut** | hell & dunkel | warmer dunkler Grund mit atmendem Glühen oben links, dunkle Karten (Radius 20 px), Dock mit Symbol über Label; hell: warmes Papier, Akzent abgedunkelt, Glühen halbiert | Funke 5–10, Flamme 10–15, Glut 15–19, Dämmerung 19–23, Asche 23–5 |
| **Glas** | nur dunkel | drei große Verlaufsflächen nach Tageszeit, Kacheln aus Milchglas (Radius 30 px), Dock als Glaskapsel, weiße primäre Buttons, Briefing-Teile als helle Pillen | Zitrus 5–10, Kobalt 10–16, Orchidee 16–19, Beere 19–23, Eis 23–5 |
| **Papier** | nur hell | warmer Papiergrund ohne Glühen und Kartenflächen, Kacheln durch eine Linie oben getrennt, Newsreader für Uhr, Satz und Titel, ein Tinten-Akzent pro Phase, Dock als Textleiste, alle Radien 0 | wie Glas |
| **Jarvis** | nur dunkel | Gitter auf fast Schwarz, Eckklammern an den Kacheln, JetBrains Mono für Titel und Briefing, Uhr in Rajdhani mit rotierendem HUD-Ring, Outline-Buttons mit Leuchten | wie Glas |

Bei Glas, Papier und Jarvis wird der Modus erzwungen; der Hell/Dunkel-Schalter ist dann mit Hinweis gesperrt.

**Aufbau.** Auf `<html>` sitzen `data-style` und `data-theme` (`dark` | `light`). Alle Farben, Radien, Schatten und Schriften laufen über CSS-Variablen; die Grundwerte in `css/style.css` entsprechen Glut dunkel, `css/styles/<stil>.css` überschreibt sie. `js/core/theme.js` lädt nur die Datei und die Google-Fonts des aktiven Stils (mit System-Schriften als Fallback). Widgets enthalten keine festen Farben; Ausnahmen sind frei gewählte Fach- und Gewohnheitsfarben (Daten) und das Spotify-Grün.

**Tageszeit-Akzente.** Minütlich interpoliert `theme.js` aus den Stützpunkten in `js/theme/palettes.js` linear `--ui` (Akzent), `--glow-rgb` (Leuchtfarbe) und `--k` (Glühstärke); `--breath` ist 9 s am Tag, 11 s am Abend und 14 s in der Nacht. Dem Akzent folgen nur Atmosphäre, primäre Buttons, das aktive Dock-Symbol und Fortschrittsringe. Statusfarben (`--ok`, `--danger`, `--warn`) bleiben fest. Neue Farben oder Phasen nur in `palettes.js` eintragen.

**Kontrast.** Text auf Fläche hält in allen Stilen und Phasen mindestens 4.5:1, geprüft für jede 5-Minuten-Stufe des Tages. Dafür ist der Glut-Akzent im Hellen stärker abgedunkelt (45 % Akzent + Braun), der nächtliche Glut-Akzent etwas heller, im Stil Glas sind die Glasflächen leicht getönt, die Verlaufsflächen gedämpft und Akzent sowie Statusfarben aufgehellt.

**Kopf und Briefing.** Links Uhr und Datum, rechts daneben (unter 900 px darunter) ein Satz aus festen Vorlagen, ohne KI (`js/core/briefing.js`). Quellen sind der nächste Stundenplan-Termin, das Mensa-Gericht von heute, die gelernte Zeit heute und diese Woche, die nächste Klausur und offene Einkaufs- und Aufgaben-Einträge; die Widgets melden diese Werte mit `setFact()`. Pro Tageszeit gibt es mehrere Vorlagen, gewählt wird beim Laden und beim Phasenwechsel, nie dieselbe wie zuletzt (`local/briefing`).

**Ruhe und Fokus.** Läuft Pomodoro, ein Countdown-Timer oder der freie Lerntimer, wechselt Ember in den Fokus: Die Lernzeit wird zur großen Kachel mit Ring und Zeit, die übrigen Kacheln gehen auf 36 % Deckkraft (beim Darüberfahren wieder voll), die Uhr auf 50 %, das Glühen wandert in die Mitte und statt des Briefings steht ein Fokus-Satz. Danach geht es automatisch zurück in die Ruhe.

**Kachelgrößen.** S (eine Spalte), M und L (zwei Spalten) im Masonry-Raster (siehe „Layout anpassen“); die Größe bestimmt nur Breite und Inhaltsdichte, die Höhe ergibt sich aus dem Inhalt. S zeigt Kennzahl und Hauptaktion, M mehr Details, L zusätzlich Wochenbalken und Verlauf (z. B. Lernzeit: S Timer und Summen, M mit Modus-Umschalter, L mit Wochenbalken und Einträgen). Umgeschaltet wird über den Größen-Button im Kachelkopf (siehe „Layout anpassen“); die Wahl gilt pro Gerät (`local/sizes`). Leere Kacheln schrumpfen auf ihren Inhalt.

**Bewegung und Bedienung.** Animationen nutzen nur `transform` und `opacity` (Kachel öffnen 240 ms). `prefers-reduced-motion` schaltet Atmen, HUD-Ring und Eingangsanimationen ab. Fokusring 2 px in Akzentfarbe in allen Stilen; Touch-Ziele mindestens 40 px, bestehende 44 px bleiben.

**Stil-Wechsel von Hand testen** (nach Änderungen an `theme.js` oder einer Stil-Datei):

1. Im Stil-Menü schnell hintereinander Glas → Papier → Jarvis → Glut klicken: Am Ende gilt Glut, und in den Entwicklerwerkzeugen gibt es genau ein `link#style-css` und ein `link#style-fonts`.
2. Glas → sofort zurück zu Glut: Es bleibt Glut, kein Glas-Hintergrund.
3. In Glut Hell und Dunkel umschalten, dann Glas wählen (Schalter gesperrt, dunkel), zurück zu Glut: Die vorherige Hell/Dunkel-Wahl ist wieder da.
4. Papier wählen und neu laden: Die Seite erscheint direkt in Papier, ohne kurzes Glut.
5. Einen Timer starten (Fokus) und dabei alle Stile durchschalten: Lernzeit bleibt volle Breite, keine Kachel überlappt, nach dem Stoppen zurück in Ruhe.
6. Nach jedem Wechsel stimmen Akzentfarbe und Phasenname im Menü mit der Uhrzeit überein.

**Neuer Stil.** Eintrag in `STYLES` in `js/theme/palettes.js` (Name, Modi, Phasen, Stützpunkte, Schriften, Vorschaufarben) und eine Datei `css/styles/<id>.css`, die die Variablen aus `css/style.css` überschreibt.

## Speicher-Schicht und Sync

Alle Daten laufen über `js/core/storage.js`. Die Funktionen sind bewusst asynchron, damit sich die Ablage austauschen lässt, ohne Widgets anzupassen. Ist `localStorage` nicht verfügbar (z. B. im privaten Modus), hält das Modul die Daten im Arbeitsspeicher, statt abzustürzen.

Schlüssel, die mit `local/` beginnen (Caches, offene Kacheln und Kachelgrößen, Sync-Zugangsdaten); die Stil-Wahl (`design`) wird dagegen synchronisiert, bleiben immer auf dem Gerät. Alle anderen bekommen einen Änderungszeitstempel und werden von `js/core/sync.js` abgeglichen:

- **Einrichten:** ⚙︎ oben rechts → Token auf GitHub erstellen (klassischer Token, nur Häkchen „gist“) → einfügen → Verbinden. Auf jedem weiteren Gerät denselben Token eintragen. Beim ersten Verbinden legt das Dashboard ein geheimes Gist `dashboard-sync.json` an bzw. findet das vorhandene.
- **Wann:** beim Start, etwa 2 Sekunden nach jeder Änderung, beim Zurückkehren in den Tab, wenn das Gerät wieder online ist und alle 5 Minuten.
- **Zusammenführen:** Pro Schlüssel gewinnt die neuere Änderung. Sammlungen von Einträgen mit eigenem `updatedAt` (z. B. Lernzeiten) werden Eintrag für Eintrag zusammengeführt. Gelöschte Einträge bleiben als `deleted: true` stehen, damit das Löschen auf allen Geräten ankommt.
- **Hinweis:** Ein geheimes Gist ist nicht öffentlich auffindbar, aber für jeden lesbar, der den Link kennt. Der Token wird nur im Browser des jeweiligen Geräts gespeichert. ⚙︎ zeigt nach jedem Sync „🔒 Geheimes Gist“ bzw. eine Warnung, falls es öffentlich ist. Selbst nachsehen: auf gist.github.com bei deinem Konto – geheime Gists tragen dort das Label „Secret“.

## Lernzeit-Tracker

Die Lernzeit öffnest du über den Dock-Button „Lernzeit“. Läuft ein Timer, zeigt der Button den Stand, z. B. „● 12:34 Fokus“ – auch bei geschlossener Kachel.

- Start, Pause/Weiter und Stopp mit Fachauswahl. Die Startzeit wird gespeichert, der Timer läuft also über Neuladen und Geräte hinweg weiter. Pausen werden von der Lernzeit abgezogen und am Eintrag gespeichert. Sitzungen unter einer Minute werden verworfen.
- Löschen per Doppelklick-Bestätigung am Button („×“ → „Löschen?“) statt Browser-Dialog, weil `confirm()` in eingebetteten Ansichten oft blockiert ist.
- **Pomodoro-Modus:** Umschalter „Frei“/„Pomodoro“/„Timer“/„Wecker“ über dem Timer (wird gespeichert). Freier Timer und Pomodoro laufen nicht gleichzeitig; Timer laufen unabhängig davon. Fokus, kurze und lange Pause sowie die Runden bis zur langen Pause sind unter „Pomodoro-Einstellungen“ einstellbar (Standard 25/5/15 min, 4 Runden), ebenso der automatische Start der nächsten Phase. Bedienung: Start, Pause/Weiter, Überspringen, Abbrechen.
  - Gerechnet wird nur mit gespeicherten Zeitstempeln (Start, Ende, Pausen) – die Restzeit stimmt daher auch nach Neuladen, in Hintergrund-Tabs und auf dem iPad.
  - Nur Fokusphasen werden als normale Lerneinträge gespeichert (Pausen nicht); abgebrochene oder übersprungene Fokusphasen zählen mit der tatsächlich gelaufenen Zeit. Sie erscheinen in derselben Wochenübersicht.
  - Lief eine Fokusphase ab, während das Dashboard nicht offen war, fragt das Widget, ob sie gezählt werden soll.
  - Ton und Benachrichtigung beim Phasenwechsel sind standardmäßig aus und werden pro Gerät eingeschaltet (Benachrichtigungen erst nach Zustimmung im Browser). Beides funktioniert nur, solange das Dashboard geöffnet ist; auf dem iPad gibt es Benachrichtigungen nur für Web-Apps auf dem Home-Bildschirm. Den Stand zeigen immer der Tab-Titel (z. B. „🍅 12:34 Fokus“) und der Kopf der Lernzeit-Kachel.
  - Daten: `study.pomodoro` (aktuelle Phase) und `study.pomodoroSettings` werden synchronisiert, `local/cache/study.pomodoroAlerts` (Ton/Benachrichtigung) bleibt auf dem Gerät. Klang und Lautstärke kommen aus ⚙︎ → „Timer & Wecker“.
- **Timer:** Countdown mit Stunden/Minuten/Sekunden oder Schnellbuttons (5/10/15/30 min), optional mit Name. Bis zu 5 Timer gleichzeitig, jeweils mit Pause/Fortsetzen, Zurücksetzen und ×.
  - Gespeichert wird das Ende als Zeitstempel und alle 250 ms sowie beim Zurückkehren in den Tab geprüft. Nach dem Neuladen laufen Timer weiter; lief einer ab, während Ember zu war, steht dort „abgelaufen um HH:MM“ statt zu klingeln.
  - Beim Ablaufen: Fenster mit „Stopp“ und „+1 Minute“, Ton in Schleife (beginnt leise), blinkender Tab-Titel, Benachrichtigung nur nach Zustimmung. Läuft Musik in Ember, pausiert sie und spielt nach „Stopp“ weiter.
  - Timer zählen nicht als Lernzeit. Der Haken „als Lernzeit“ legt beim Ablaufen (oder beim Zurücksetzen/Entfernen mit der bis dahin gelaufenen Zeit) denselben Eintrag an wie der freie Timer, mit dem gewählten Fach.
  - Der Dock-Button zeigt den nächsten Auslöser, z. B. „⏱ 4:32“ (Timer) oder „● 12:34 Fokus“ (Pomodoro); sonst den freien Timer. Der Tab-Titel ebenso, abschaltbar in ⚙︎.
  - **Wichtig:** Timer klingeln nur, solange Ember in einem Tab geöffnet ist. Browser erlauben Ton erst nach einem Klick – nach dem Neuladen genügt ein Klick irgendwo in Ember; bis dahin zeigt die Kachel einen Hinweis.
  - Daten: `local/timers`, nur auf diesem Gerät, nicht im Sync und nicht im Export – ein laufender Countdown ist an den offenen Tab gebunden und auf einem anderen Gerät oder nach einem Import nicht sinnvoll.
- **Wecker:** Uhrzeit, optional Name, Wiederholung an ausgewählten Wochentagen (kein Tag = einmalig). Liste mit Ein/Aus-Schalter, ✎ Bearbeiten und × Löschen (mit Bestätigung).
  - Uhrzeiten gelten immer in Europe/Berlin, auch über die Sommer-/Winterzeit-Umstellung.
  - Pro Wecker wählbar: **Nur dieses Gerät** (📱, `local/alarms`) oder **Alle Geräte** (🌐, `study.alarms`, über den Gist-Sync). Was ein Gerät mit einem Wecker vorhat (nächster Termin, Schlummern, verpasst), steht immer nur lokal in `local/alarmState`.
  - Beim Klingeln: Fenster mit großen Buttons „Stopp“ und „Schlummern“ (Dauer in ⚙︎, Standard 5 min), Ton in Schleife, blinkender Tab-Titel, Benachrichtigung nur nach Zustimmung. Läuft Musik in Ember, pausiert sie und spielt nach Stopp oder Schlummern weiter; sonst wird Spotify nie angefasst.
  - War Ember zum Weckzeitpunkt nicht offen (oder schlief das Gerät), klingelt es nicht nachträglich. Stattdessen erscheint einmal „Wecker XY wurde um HH:MM verpasst“. Einmalige Wecker sind danach aus, wiederholte planen den nächsten Termin.
  - Der Dock-Button zeigt den nächsten Wecker, z. B. „⏰ 07:00“ oder „⏰ Fr 07:00“, wenn er nicht heute klingelt. Laufende Timer, Pomodoro und der freie Timer haben Vorrang; ein Wecker in der nächsten Stunde zählt wie ein Timer.
  - **Wichtig:** Wecker klingeln nur, solange Ember in einem Tab geöffnet ist. Auf dem iPad heißt das: Ember im Vordergrund, Bildschirm an (dafür „Bildschirm anlassen“ einschalten und das iPad ans Ladekabel). Einen Server oder Push-Dienst gibt es bewusst nicht.
- **Export:** Timer und Wecker sind nicht im JSON-Export. Timer sind an den offenen Tab gebunden; globale Wecker liegen ohnehin im Sync, und der Plan pro Gerät lässt sich nicht sinnvoll übertragen. Ein paar Wecker sind schnell neu angelegt.
- **Stumm (🔔/🔕 oben neben ⚙︎):** schaltet auf diesem Gerät jeden Ton von Ember ab – Pomodoro, Timer, Wecker und Testton. Technisch wird die Gesamtlautstärke auf 0 gesetzt und gar kein Ton mehr erzeugt. Klingeln zeigt dann nur Fenster und Tab-Titel; Benachrichtigungen kommen lautlos. Spotify-Musik, die du selbst startest, ist davon nicht betroffen. Schaltest du den Ton während eines Klingelns wieder an, ist es sofort hörbar.
- **⚙︎ → Timer & Wecker** (pro Gerät): Schlummerdauer, Klang (Glocke, Marimba, Sanfter Puls, Klangschale), Lautstärke, Testton, Benachrichtigungen (mit Hinweis, was der Browser kann – auf iPad/iPhone nur als Home-Bildschirm-App ab iOS 16.4), „Bildschirm anlassen“ (Screen Wake Lock, solange ein Timer läuft oder ein Wecker in den nächsten 12 Stunden klingelt) und Tab-Titel.
- Fächer anlegen, umbenennen, Farbe wechseln und löschen über „Fächer“.
- Übersicht über heute und die Woche, Balkendiagramm Mo–So nach Fach, Wochen mit ‹ › durchblättern.
- Unter „Einträge dieser Woche“ Einträge bearbeiten, löschen oder nachtragen.
- Über ⚙︎ → Daten (oder „Daten“ in der Lernzeit-Kachel, das den Bereich öffnet) als JSON exportieren und importieren (zentral über `js/core/backup.js`, enthält auch Gewohnheiten, Klausuren, Notizen, Einkauf, Aufgaben, Licht-Buttons und Rezepte). Ein Import führt zusammen, statt zu überschreiben, und erzeugt keine Duplikate. Ältere Lernzeit-Exporte lassen sich weiter importieren.

## Gewohnheiten

- Über „Bearbeiten“ Gewohnheiten anlegen (Name, optional Emoji), umbenennen, Farbe wechseln, umsortieren (↑/↓), archivieren und löschen. Archivierte lassen sich wiederherstellen.
- Großer Knopf pro Gewohnheit: heute erledigt; erneuter Klick macht es rückgängig. Die Punkte Mo–So tragen Tage rückwirkend nach (nicht in der Zukunft), ‹ › blättert zu früheren Wochen.
- **Ohne Ziel:** Serie und Rekord in Tagen sowie „15× in den letzten 23 Tagen“ (Zeitraum seit dem Anlegen, höchstens 30 Tage).
- **Mit Wochenziel** (1–7× pro Woche): „2/3 diese Woche“ bzw. „Ziel erreicht“; Serie und Rekord zählen Wochen mit erreichtem Ziel.
- Daten: `habits.list` (Gewohnheiten) und `habits.days` mit einem Eintrag pro Gewohnheit und Tag (`<id>|JJJJ-MM-TT`, Tagesgrenze Europe/Berlin) inklusive Zeitstempel. Streaks werden immer daraus berechnet. Weil jeder Tag ein eigener Eintrag ist, führt der Gist-Sync Abhaken auf mehreren Geräten tageweise zusammen; auch ein Rückgängigmachen (`done: false`) kommt auf allen Geräten an.

## Aufgaben

Dock-Button 📋. Aufgabe eintippen und Enter – der Fokus bleibt im Feld für die nächste. Optional ein Fälligkeitsdatum daneben.

- **Abhaken** über den Kreis; erledigte rutschen in den eingeklappten Bereich „Erledigt“ (mit Datum) und kommen mit einem Tipp zurück. „Erledigte entfernen“ fragt nach.
- **Bearbeiten:** Tipp auf den Text (Text und Datum ändern). **Löschen** mit × ohne Rückfrage, dafür 6 Sekunden „Rückgängig“.
- **Fälligkeit:** „heute“, „morgen“, „in 3 Tagen“, „überfällig seit 2 Tagen“ (überfällige dezent rot hinterlegt). Gerechnet in Kalendertagen nach Europe/Berlin, daher unabhängig von der Zeitumstellung; um Mitternacht aktualisiert sich alles von selbst.
- **Reihenfolge:** überfällig zuerst, dann nach Datum, dann ohne Datum. Innerhalb gleicher Fälligkeit (bzw. bei „ohne Datum“) lässt sich von Hand umsortieren: Griff ⠿ ziehen – mit Finger, Stift oder Maus, ohne Hover – oder Griff fokussieren und Pfeiltasten.
- **Heute (☀︎):** markiert eine Aufgabe nur für den heutigen Kalendertag; sie steht dann oben im Bereich „Heute“. Ab 6 Aufgaben erscheint ein sanfter Hinweis, gesperrt wird nichts. Am nächsten Tag stehen nicht erledigte wieder normal in der Liste, und einmal pro Gerät fragt die Kachel „Noch offen von gestern: … – Wieder für heute / Nein, danke“.
- **Zähler am Dock:** Anzahl offener Aufgaben, die heute fällig oder überfällig sind (farbig, wenn etwas überfällig ist); ohne solche Aufgaben kein Zähler.
- „Heute“ und Zähler lassen sich unter **Anzeige** in der Kachel abschalten.
- **Daten und Sync:** `todos.items` mit einem Eintrag pro Aufgabe (ID, Text, Status offen/erledigt/gelöscht, `due` als `YYYY-MM-DD`, `today`, Rang für die Reihenfolge, Zeitstempel), `todos.settings` für die Anzeige. Zusammengeführt wird wie bei der Einkaufsliste über die allgemeine Logik in `js/core/sync.js`: Aufgabe für Aufgabe, die jüngste Änderung gewinnt. Gelöschte bleiben als Grabstein und werden nach 30 Tagen aufgeräumt. Im Export enthalten.
- **Grenzen:** Ändern zwei Geräte offline *dieselbe* Aufgabe (z. B. Text auf A, abhaken auf B), gewinnt die spätere Änderung als Ganzes. War ein Gerät länger als 30 Tage nicht online, kann eine dort noch offene, anderswo gelöschte Aufgabe zurückkommen.

## Einkaufsliste

- Artikel eintippen und Enter: kommt auf die Liste, der Fokus bleibt im Feld für den nächsten. Beim Tippen schlägt das Feld bisherige Artikel vor. Steht ein Artikel schon auf der Liste, wird er kurz hervorgehoben statt doppelt angelegt; ein bereits erledigter wird zurückgeholt.
- Antippen hakt ab; erledigte Artikel landen im eingeklappten Bereich „Erledigt“ und kommen per Antippen zurück. ✎ bearbeitet Name und Menge (Freitext, z. B. „2 Packungen“), × löscht ohne Rückfrage, aber mit „Rückgängig“ für einige Sekunden. „Erledigte entfernen“ fragt nach.
- „Häufig gekauft“ zeigt Artikel, die mindestens zweimal auf der Liste waren und gerade nicht draufstehen – ein Tipp setzt sie wieder auf die Liste. Über „Anpassen“ lassen sich Vorschläge anheften (📌, immer oben) oder ausblenden.
- **Handy-Ansicht:** `…/?nur=einkauf` lädt nur die Einkaufsliste in voller Breite, ohne Kopfbereich und Dock (Link „Nur-Einkaufsliste-Ansicht“ unten in der Kachel). Auf iPhone/iPad in Safari öffnen → Teilen → „Zum Home-Bildschirm“ ergibt ein eigenes Symbol. Alle Bedienflächen sind mindestens 44 px groß, Eingabefelder nutzen 16 px Schrift (kein Zoom beim Antippen).
- **Daten und Sync:** `shopping.items` mit einem Eintrag pro Artikel (ID, Name, Menge, Status offen/erledigt/gelöscht, Zeitstempel) und `shopping.history` mit einem Eintrag pro Artikelname (Häufigkeit, angeheftet/ausgeblendet). Der Gist-Sync führt beides Eintrag für Eintrag zusammen, pro Artikel gewinnt die jüngste Änderung. Gelöschte Artikel bleiben als Grabstein stehen, damit ein anderes Gerät sie nicht wiederherstellt, und werden nach 30 Tagen aufgeräumt. Beides ist im Export enthalten.
- **Schlechter Empfang:** Jede Änderung wird sofort lokal gespeichert; der Sync zieht sie nach, sobald wieder Netz da ist. Einschränkungen: Die Seite muss geladen sein (ohne Netz neu laden geht nicht, es gibt noch keinen Offline-Cache für die Dateien), und ein Gerät, das länger als 30 Tage gar nicht synchronisiert hat, könnte gelöschte Artikel wieder einspielen. Zwei gleichzeitige Erhöhungen der Häufigkeit eines Artikels auf zwei Geräten zählen nur einmal.

## Rezepte

Eigene Rezepte als Kachel (Dock: Rezepte, Standardgröße M). Pro Rezept: Titel, Tags, Dauer (min), Portionen, Quelle (Link oder Text), Schritte (Freitext), Favorit und zuletzt gekocht; Zutaten werden strukturiert gespeichert als `{ amount, unit, name }`. Kein Foto.

- **Anlegen und bearbeiten:** „+ Rezept“ im Kachelkopf. Zutaten eine pro Zeile, z. B. `200 g Spaghetti`, `½ TL Chiliflocken`, `1,5 TL Curry`, `Salz` – Menge (auch Brüche), Einheit (g, kg, ml, l, EL, TL, Prise, Stück, Dose, Zehe, Bund …) und Name werden erkannt. Tags mit Komma trennen.
- **Finden:** Suche über Titel, Tags und Zutaten; Filter nach Tags, Höchstdauer und Favoriten (☆/★ an jedem Rezept).
- **Detailansicht:** Antippen klappt das Rezept auf. Portionen mit −/+ umrechnen – nur die Anzeige ändert sich, das Rezept bleibt wie gespeichert („Original“ springt zurück).
- **Zufall:** wählt aus den gerade gefilterten Rezepten und überspringt alles, was in den letzten 7 Tagen gekocht wurde; „Nochmal würfeln“, „Heute gekocht“ (setzt das Datum, ebenso in der Detailansicht).
- **Zutaten auf die Einkaufsliste:** in der gewählten Portionszahl, mit derselben Duplikatlogik wie das Eingabefeld der Einkaufsliste (`addToShoppingList` in `shopping.js`): Steht ein Artikel schon offen drauf, bleibt er (eine fehlende Menge wird ergänzt), ein erledigter kommt zurück. Die Kachel meldet, wie viele neu dazukamen und wie viele schon drauf standen.
- **Mensa-Kachel:** Gibt es Rezepte, steht dort „Heute selbst kochen? → Titel“ – ein Vorschlag, der pro Tag gleich bleibt (aus dem Datum berechnet, nicht zufällig). Antippen öffnet das Rezept.
- **Größen:** S Suche, Zufall und kompakte Liste; M mit Filtern; L Liste zweispaltig.
- **Daten:** `rezepte.list`, synchronisiert und im Export wie Einkaufsliste und Notizen: ein Eintrag pro Rezept mit Zeitstempel, gelöschte bleiben 30 Tage als Grabstein.

## Musik (Spotify)

Ember ist selbst ein Spotify-Wiedergabegerät („Ember“, Web Playback SDK). Steuerung in der Musik-Kachel: Play/Pause, Weiter/Zurück, Lautstärke, Fortschrittsbalken mit Spulen, Cover, Titel und Interpret mit Link „PLAY ON SPOTIFY“. Musik wählst du aus deinen Playlists, über die Suche oder „Zuletzt gehört“. Die Wiedergabe läuft weiter, wenn die Kachel geschlossen ist; der Dock-Button zeigt dann den Titel. Abgespielt wird nur nach einem Klick, nie automatisch beim Laden. Über „Mini“ im Kachelkopf schrumpft die Kachel auf eine Zeile (kleines Cover, Titel/Interpret als Link zu Spotify, ⏮ ⏯ ⏭, Spotify-Logo in Mindestgröße); „Groß“ holt den vollständigen Player zurück. Die Wahl merkt sich jedes Gerät.

**Voraussetzungen:** Spotify Premium (für den Player und, im Development Mode, für den App-Besitzer) und ein Desktop-Browser mit DRM-Unterstützung (Chrome, Firefox, Edge, Safari). In eingebetteten Browsern ohne Widevine startet der Player nicht – Ember zeigt dann einen Hinweis.

### Spotify-App anlegen (einmalig)

1. Auf <https://developer.spotify.com/dashboard> mit deinem Spotify-Konto anmelden und die Developer Terms akzeptieren.
2. **Create app**: Name z. B. „Ember“ (Spotify verbietet Namen, die „Spotify“ enthalten), kurze Beschreibung.
3. **Redirect URIs** – genau so eintragen (Spotify vergleicht exakt, inkl. Schrägstrich am Ende):
   - lokal: `http://127.0.0.1:8000/` (Spotify verbietet `localhost`; deshalb Ember lokal über <http://127.0.0.1:8000/> öffnen)
   - veröffentlicht: deine GitHub-Pages-Adresse, z. B. `https://<benutzer>.github.io/<repo>/`
   Die passende Adresse für die gerade geöffnete Seite steht auch in Ember unter ⚙︎ → Musik (Spotify) (mit „Kopieren“).
4. Bei **Which API/SDKs are you planning to use?** „Web API“ und „Web Playback SDK“ ankreuzen, speichern.
5. Die **Client ID** kopieren (kein Client-Secret – Ember braucht und speichert keins).
6. **User Management:** Die App läuft im Entwicklermodus – dort dein eigenes Spotify-Konto (Name und E-Mail des Kontos) eintragen, sonst lehnt Spotify die Anmeldung ab. Der Player braucht Spotify Premium.
7. In Ember: ⚙︎ → Musik (Spotify) → Client-ID eintragen → **Mit Spotify verbinden** → bei Spotify zustimmen.

**Wichtig zu `127.0.0.1`:** Für den Browser ist `http://127.0.0.1:8000` eine andere Website als `http://localhost:8000` mit eigenem Speicher. Synchronisierte Daten holt der Gist-Sync (Token dort einmal eintragen); Lokales wie Kachelgrößen, Stundenplan-Link und die Spotify-Verbindung richtest du dort neu ein.

### Anmeldung, Daten und Grenzen

- **Anmeldung:** Authorization Code Flow mit PKCE, mit Prüfung des `state`-Parameters; Code und State werden nach der Rückkehr aus der Adresszeile entfernt. Berechtigungen: `streaming`, `user-read-email`, `user-read-private` (vom Player verlangt), `user-read-playback-state`, `user-modify-playback-state`, `playlist-read-private`, `playlist-read-collaborative`, `user-read-recently-played`.
- **Tokens:** Access-Tokens gelten 1 Stunde und werden automatisch erneuert. Refresh-Tokens gelten laut Spotify 6 Monate ab der Anmeldung; danach (oder wenn Spotify die Anmeldung widerruft) zeigt Ember „Neu verbinden“.
- **Speicherort:** Client-ID, Tokens, Lautstärke und der Tab-Titel-Schalter liegen nur auf dem jeweiligen Gerät (`local/spotify/…`) – nie im Gist-Sync, nie im Export. Spotify-Inhalte (Titel, Cover, Playlists) werden nicht gespeichert, nur kurz im Arbeitsspeicher der Seite gehalten. **Trennen** (⚙︎ → Musik (Spotify)) löscht alle Spotify-Daten dieses Geräts und meldet das Gerät „Ember“ ab.
- **Tab-Titel:** Mit dem Schalter unter ⚙︎ → Musik (Spotify) zeigt der Tab bei laufender Musik „♪ Titel – Ember“.
- **Regeln seit Februar 2026 (Development Mode):** Die App funktioniert nur, solange der Besitzer Premium hat, und für höchstens 5 Nutzer. `GET /me` liefert kein `product`/`email` mehr – „kein Premium“ erkennt Ember deshalb über den Player. Die Suche liefert höchstens 10 Treffer pro Typ. Titel einer Playlist darf man nur bei eigenen oder gemeinsamen Playlists auflisten (Ember spielt Playlists als Ganzes, das betrifft es nicht).
- **Spotify-Designrichtlinien:** Logo (unverändert, mind. 70 px) neben den Inhalten, Cover unverändert mit runden Ecken, Link „PLAY ON SPOTIFY“, höchstens 20 Einträge pro Liste, gesperrte Steuerelemente, wenn Spotify eine Aktion verbietet. **Abweichung auf Wunsch:** Der Fortschrittsbalken erlaubt Spulen; die Richtlinie verlangt einen rein anzeigenden Balken.
- **Bekannte Einschränkungen:** Auf iPad/iPhone ist das SDK zwar offiziell unterstützt, Ton startet aber nur nach Antippen, und Entwickler berichten von unzuverlässigem Verhalten (nicht getestet; Ember ist für den Mac eingerichtet). Ohne Netz kann Spotify nicht abspielen.

## Licht über Kurzbefehle

Die Kachel „Licht“ schaltet Lichter (z. B. IKEA-Lampen in Apple Home) über die Apple-Kurzbefehle. Es gibt keinen Server und keine API: Jeder Button ist ein Link `shortcuts://run-shortcut?name=<Name>`, der beim Klick den gleichnamigen Kurzbefehl startet. Die Kurzbefehle-App öffnet sich dabei kurz und gibt dann zurück an den Browser – das ist normal.

**Einrichten (einmal pro Button):**

1. Kurzbefehle-App öffnen, neuen Kurzbefehl anlegen, Aktion „Home steuern“ wählen, Lichter und Szene einstellen.
2. Den Kurzbefehl benennen – genau so wie der Kurzbefehl-Name im Button (Groß-/Kleinschreibung, Leerzeichen, Umlaute).
3. In Ember unter ⚙︎ → Licht (oder über das Zahnrad der Kachel, das diesen Bereich öffnet) den Namen eintragen. Die Anleitung steht nur hier, nicht in der Kachel.
4. Beim ersten Klick fragt macOS bzw. iOS einmal, ob die Seite die Kurzbefehle-App öffnen darf.

Beim ersten Start gibt es vier Buttons: „Licht an“, „Licht aus“, „Lesen“, „Gemütlich“ (mit Shift+1 bis Shift+4). Unter ⚙︎ → Licht lassen sie sich umbenennen (Anzeigename und Kurzbefehl-Name sind getrennt), mit einem von acht Symbolen versehen, umsortieren, löschen und ergänzen. Pro Button ist ein Tastenkürzel Shift+1 … Shift+9 möglich; es wirkt nur, wenn gerade kein Eingabefeld aktiv ist. „Link testen“ zeigt den kompletten Link zum Kopieren, falls ein Kurzbefehl nicht startet (meist stimmt dann der Name nicht genau).

**Kein Zustand.** Ember sendet nur den Befehl und weiß nicht, ob ein Licht an ist. Nach dem Klick zeigt der Button 1,5 s „Gesendet“ mit Haken – mehr nicht. Kann das System den Link nicht öffnen, passiert einfach nichts. Der Briefing-Satz nutzt keine Licht-Daten.

**Größen:** S zeigt die ersten zwei Buttons, M bis zu vier in einer Reihe, L alle als Raster mit Symbol über dem Label. Auf Geräten ohne Kurzbefehle (Windows, Linux, Android – grob am User-Agent erkannt) steht statt der Buttons ein kurzer Hinweis; im Zweifel zeigt Ember die Buttons.

**Daten:** `licht.buttons` – pro Button `{ id, label, shortcut, icon, order, key, updatedAt, deleted? }`, über das Gist synchronisiert wie die Einkaufsliste (pro Button gewinnt die jüngste Änderung, Löschungen als Grabstein für 30 Tage). Die vier Standard-Buttons haben feste IDs und den Zeitstempel 0: Startet Ember auf einem neuen Gerät, überschreiben dessen Standard-Buttons beim ersten Sync nichts, sondern übernehmen die Namen aus dem Gist. Mit demselben Token erscheinen so auf jedem Gerät dieselben Buttons. Gespeichert werden nur Anzeige- und Kurzbefehl-Namen, keine Zugangsdaten.

## Notizen

- Freie Textnotizen als Reiter (höchstens 10): „+“ legt eine neue an, „Umbenennen“ und „Löschen“ (mit Rückfrage) stehen unter dem Textfeld. Ohne Notiz genügt es, einfach loszuschreiben – die erste Notiz entsteht dabei.
- Gespeichert wird automatisch: 500 ms nach dem Tippen, beim Verlassen des Felds und wenn die Seite in den Hintergrund geht (z. B. iPad zugeklappt). Unter dem Feld steht „Gespeichert 19:27“.
- Das Feld wächst mit dem Text bis zu einer Höchsthöhe und scrollt dann. Schriftgröße 16 px, damit Safari auf iPad/iPhone beim Antippen nicht hineinzoomt.
- Daten: `notes.list` mit einem Eintrag pro Notiz (wird synchronisiert und ist im Export enthalten); welche Notiz zuletzt offen war, merkt sich jedes Gerät in `local/cache/notes.active`.
- Zwei Geräte: Verschiedene Notizen werden einzeln zusammengeführt. Wird dieselbe Notiz auf beiden Geräten vor dem Abgleich bearbeitet, gewinnt die zuletzt gespeicherte Fassung. Eingaben, die gerade getippt und noch nicht gespeichert sind, überschreibt ein Abgleich nie; wird eine Notiz auf einem Gerät gelöscht, während auf dem anderen darin getippt wird, bleibt der Text erhalten und die Notiz wird wiederhergestellt.

## Klausuren

Die Klausuren öffnest du über den Dock-Button „🎓 Klausuren“. Oben in der Kachel steht die nächste Klausur als Text, darunter die Einstellung „Tage bis zur nächsten Klausur im Dock anzeigen“ (gilt auf allen Geräten, wird synchronisiert; Standard: an). Ist sie an, zeigt der Dock-Button z. B. „107 Tage“, unter einer Woche „4 Tage 18 Std“. Als nächste Klausur zählt der früheste noch anstehende Termin über alle Fächer – bei entschiedenem Termin nur der gewählte, bei „noch nicht entschieden“ der frühere noch anstehende. In den letzten 14 Tagen davor ist der Dock-Button farbig hervorgehoben; die Begründung steht im Tooltip und (für das iPad) oben in der Kachel. Datumsangaben erscheinen als Tag.Monat.Jahr.

- Über „+ Klausur“ anlegen: Fach (aus derselben Fächerliste wie die Lernzeit; „+ Neues Fach …“ legt es dort direkt mit an), Datum, optional Uhrzeit, Ort und Notiz. Ein Datum in der Vergangenheit wird nur nach „Trotzdem speichern“ übernommen.
- **2. Termin:** Optional lässt sich ein zweiter Termin eintragen (muss nach dem ersten liegen). Beide Termine erscheinen als zwei kleine Felder (`1. 06.02.2027, 09:00` | `2. 25.03.2027, 09:00`). Antippen legt fest, welchen Termin du schreibst (farbig gefüllt); erneutes Antippen hebt die Wahl auf. Solange nichts gewählt ist, steht „offen“ neben dem Fach, und Countdown und Sortierung richten sich nach dem nächsten anstehenden Termin; danach zählt nur der gewählte. Vergangene Termine sind durchgestrichen und nicht wählbar. Ort und Restzeit je Termin stehen im Tooltip bzw. werden vorgelesen.
- Liste nach Datum, die nächste Klausur hervorgehoben. Pro Klausur: Countdown („in 63 Tagen“, unter einer Woche mit Uhrzeit „in 4 Tagen, 18 Std“), Datum, Ort und die für das Fach erfasste Lernzeit gesamt und in den letzten 7 Tagen.
- Vergangene Klausuren wandern in den eingeklappten Bereich „Vergangen“ und bleiben, bis du sie löschst.
- Datumsrechnung nach Europe/Berlin: Tage zählen als Kalendertage; Stunden werden in Wanduhrzeit gerechnet, damit die Zeitumstellung nichts verschiebt.
- Daten: `exams.list` (wird synchronisiert und ist im Export enthalten; 2. Termin in `date2`/`time2`/`location2`, Entscheidung in `chosen`); Fächer in `study.subjects`.

## Kalender (RWTH)

Das Widget oben in der Kopfleiste zeigt den laufenden bzw. nächsten Termin mit Countdown. Titel werden gekürzt angezeigt: Die vorangestellte Modulnummer (z. B. „41.00030“) und der Zusatz „, Standardgruppe“ fallen weg; Veranstaltungsart (VO, UE …) und echte Gruppen (z. B. „Tutorium W3“) bleiben. Ein Klick öffnet heute und morgen (weitere Tage mit ‹ ›) mit Raum, Beschreibung, freien Zeitfenstern und abgesagten Terminen. Aktualisierung alle 30 Minuten; bei Fehlern bleiben die zuletzt geladenen Daten sichtbar.

**Sicherheit.** Der iCal-Abo-Link aus RWTHonline enthält einen persönlichen Schlüssel und ist wie ein Passwort zu behandeln. Er liegt **ausschließlich** als Secret `ICAL_URL` in deinem Cloudflare Worker – nicht in Ember, nicht im Gerätespeicher, nicht im Gist, nicht im Repository, nicht in Logs. RWTHonline erlaubt den direkten Abruf aus dem Browser ohnehin nicht (fehlende CORS-Header). Ember kennt nur:

- die **Worker-Adresse** (`timetable.worker`) – öffentlich, wird synchronisiert,
- den **Zugangsschlüssel** (`ACCESS_KEY` des Workers, `local/timetable.key`) – nur auf dem jeweiligen Gerät, maskiert, nie im Sync und nie im Export. Er geht als `Authorization`-Header mit, nicht in der Adresse.

Ein früher in Ember gespeicherter direkter RWTHonline-Link wird beim Start gelöscht (mit Hinweis im Stundenplan); eine alte Worker-Adresse mit `?key=…` wird in Adresse und Schlüssel aufgeteilt. Falls der Link doch einmal öffentlich geworden ist: In RWTHonline einen neuen erzeugen; der alte wird damit ungültig.

**Einrichten unter ⚙︎ → Kalender (RWTH)** (auch über „Einrichten“ im Stundenplan):

1. In RWTHonline im Terminkalender unter Export/Abo (iCal) einen neuen Link erzeugen.
2. Den Link im Cloudflare Worker als Secret `ICAL_URL` eintragen (siehe unten).
3. In Ember die Worker-Adresse und den Zugangsschlüssel eintragen (auf jedem Gerät einmal den Schlüssel, die Adresse kommt per Sync).
4. **Verbindung prüfen** – das Ergebnis ist ehrlich: verbunden mit Anzahl der Termine, Kalender leer, falscher Schlüssel, Worker nicht fertig eingerichtet, RWTHonline nicht erreichbar bzw. Link abgelaufen, Adresse nicht erlaubt (`ALLOWED_ORIGINS`) oder Worker nicht erreichbar.

**Stundenplan neu laden** holt den Kalender sofort. Ohne Worker geht auch **.ics-Datei importieren** (Kalender in RWTHonline herunterladen; nicht automatisch aktuell). **Kalender entfernen** löscht Schlüssel und geladenen Stundenplan auf diesem Gerät und die Worker-Adresse auf allen Geräten.

**Zum Testen ohne echten Link** als Worker-Adresse `examples/stundenplan-beispiel.ics` eintragen. Die Datei enthält erfundene Termine (wöchentliche und 14-tägige Serien, Zeitumstellung, Ausnahme, verlegter und abgesagter Termin, ganztägiger Termin).

### Proxy mit Cloudflare Workers einrichten

Der Worker (`proxy/cloudflare-worker/worker.js`) läuft in deinem eigenen Cloudflare-Konto (kostenloser Plan genügt), ruft den RWTHonline-Link ab und liefert ihn mit CORS-Headern aus. Der RWTHonline-Link liegt dort als Secret – er steht weder im Code noch im Dashboard. Das Dashboard bekommt nur die Worker-Adresse mit einem eigenen Zugriffsschlüssel.

1. **Zugriffsschlüssel erzeugen** (im Terminal auf dem Mac):

   ```bash
   openssl rand -hex 24
   ```

   Die Ausgabe ist dein `ACCESS_KEY`. Wie ein Passwort behandeln.

2. **Worker anlegen:** Auf <https://dash.cloudflare.com> anmelden bzw. kostenloses Konto erstellen → **Workers & Pages** → **Create** → **Create Worker** („Hello World“-Vorlage) → Namen vergeben, z. B. `dashboard-ical` → **Deploy**.
3. **Code einfügen:** Beim neuen Worker **Edit code** → den gesamten Inhalt von `proxy/cloudflare-worker/worker.js` hineinkopieren (vorhandenen Code ersetzen) → **Deploy**.
4. **Secrets setzen:** Worker → **Settings** → **Variables and Secrets** → **Add**:
   - Typ **Secret**, Name `ICAL_URL`, Wert: dein RWTHonline-Abo-Link (`webcal://` vorher durch `https://` ersetzen)
   - Typ **Secret**, Name `ACCESS_KEY`, Wert: der Schlüssel aus Schritt 1
   - optional Typ **Text**, Name `ALLOWED_ORIGINS`, Wert: deine Dashboard-Adressen ohne Pfad, kommagetrennt, z. B. `https://<benutzer>.github.io,http://localhost:8000`

   Speichern bzw. **Deploy** – die Werte gelten ab der nächsten Bereitstellung.
5. **Im Dashboard eintragen:** ⚙︎ → Kalender (RWTH) → Worker-Adresse `https://dashboard-ical.<dein-subdomain>.workers.dev/` und den Schlüssel getrennt eintragen → **Verbindung prüfen**.

Alternative mit der Kommandozeile (benötigt Node.js): im Ordner `proxy/cloudflare-worker` `npx wrangler login`, `npx wrangler deploy`, dann `npx wrangler secret put ICAL_URL` und `npx wrangler secret put ACCESS_KEY` (Werte werden abgefragt, nicht in Dateien geschrieben). `.dev.vars` und `.wrangler/` sind in `.gitignore` eingetragen.

Neuen RWTHonline-Link oder Schlüssel? Einfach das jeweilige Secret im Cloudflare-Dashboard überschreiben. Beim Wechsel des `ACCESS_KEY` auch den Schlüssel unter ⚙︎ → Kalender (RWTH) auf jedem Gerät aktualisieren. Für GitHub Pages in `ALLOWED_ORIGINS` auch `https://<benutzer>.github.io` eintragen. Am Worker-Code selbst ist nichts zu ändern: Er nimmt den Schlüssel schon als `Authorization`-Header an.

## Auf GitHub Pages veröffentlichen

1. Repository auf GitHub anlegen und pushen:

   ```bash
   git remote add origin https://github.com/<benutzer>/<repo>.git
   git push -u origin main
   ```

2. Auf GitHub: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)`, speichern.
3. Nach etwa einer Minute ist die Seite unter `https://<benutzer>.github.io/<repo>/` erreichbar.

Die Datei `.nojekyll` sorgt dafür, dass GitHub Pages die Dateien unverändert ausliefert. Netlify funktioniert genauso: Ordner hochladen bzw. Repository verbinden, ohne Build-Befehl, Publish-Verzeichnis `/`.

## Backlog

- Rezept-Import aus einer URL (schema.org/Recipe aus der Webseite lesen) – braucht einen Proxy wie beim Kalender, weil Rezeptseiten keinen Abruf aus dem Browser erlauben (CORS).

## Datenquellen

- Wetter: [Open-Meteo](https://open-meteo.com) (kein API-Key, CC BY 4.0)
- Mensa: [OpenMensa API v2](https://openmensa.org/api/v2) (kein API-Key, direkt aus dem Browser abrufbar). Die Canteen-IDs der Aachener Mensen stehen in `js/widgets/mensa.js`. Angezeigt wird der Studierendenpreis.
  Öffnungszeiten liefert OpenMensa nicht; sie stehen fest in `js/widgets/mensa.js` (Stand Oktober 2026 laut studierendenwerk-aachen.de, Vorlesungszeit) und müssen bei Änderungen dort angepasst werden. Das Widget zeigt „Geöffnet bis …“ bzw. „öffnet … um …“ und wechselt nach Schluss zum nächsten Öffnungstag.
  Die Mensa Academica (ID 187) liefert bei OpenMensa derzeit keine Speisepläne. Das Widget zeigt dafür einen Hinweis und einen Button „Speiseplan beim Studierendenwerk ↗“, der den Wochenplan auf studierendenwerk-aachen.de öffnet (Eigenschaft `link` in der Mensa-Liste).
  Mögliche spätere Lösung: eine geplante GitHub Action, die den Plan von der Seite des Studierendenwerks ausliest und als JSON ins Repo legt.
