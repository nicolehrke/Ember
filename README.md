# Mein Dashboard

Persönliches Dashboard für das Studium an der RWTH Aachen: reine statische Seite aus HTML, CSS und Vanilla-JavaScript (ES-Module), ohne Build-Step und ohne Abhängigkeiten.

## Lokal starten

ES-Module funktionieren nicht über `file://`, deshalb braucht es einen kleinen lokalen Webserver. Im Projektordner:

```bash
python3 -m http.server 8000
```

Danach <http://localhost:8000> öffnen. Jeder andere statische Server (z. B. `npx serve`) funktioniert genauso.

## Ordnerstruktur

```
index.html              Einstiegsseite
css/style.css           Gesamtes Styling inkl. Hell/Dunkel-Modus
js/main.js              Startpunkt: Migrationen, Theme, Einstellungen, Widgets, Sync
js/core/storage.js      Speicher-Schicht (einzige Stelle mit localStorage)
js/core/sync.js         Sync zwischen Geräten über ein GitHub Gist
js/core/settings.js     Einstellungs-Panel (⚙︎) zum Verbinden des Syncs
js/core/migrations.js   Einmalige Aufräumarbeiten nach Umbauten
js/core/widget-host.js  Baut Kacheln, ruft Widgets auf, fängt Fehler ab
js/core/theme.js        Umschaltung System / Hell / Dunkel
js/core/popover.js      Aufklapp-Panels (Wetter, Stundenplan, Einstellungen)
js/core/http.js         fetchJSON()/fetchText() mit Timeout und verständlichen Fehlern
js/core/ical.js         Schlanker iCal-Parser inkl. Wiederholungen und Zeitzonen
js/core/dom.js          Kleine DOM-Helfer (h(), esc(), confirmButton())
js/core/backup.js       Gemeinsamer Export/Import aller Sammlungen
js/widgets/index.js     Zentrale Widget-Liste
js/widgets/*.js         Ein Modul pro Widget
examples/               Beispiel-Stundenplan (.ics) mit erfundenen Terminen
proxy/cloudflare-worker Optionaler eigener Proxy für den RWTHonline-Kalender
```

## Bedienung: Dock

Lernzeit, Klausuren, Gewohnheiten, Mensa und Notizen sind gleichartige Kacheln im Hauptbereich. Geöffnet und geschlossen werden sie über das Dock, die Leiste mit vier Symbol-Buttons unter der Uhr (⏱ Lernzeit, 🎓 Klausuren, ✅ Gewohnheiten, 🍽 Mensa, 📝 Notizen; der Name steht im Tooltip), oder über das × in der Kachel. Geschlossene Kacheln verschwinden vollständig, laufen aber unsichtbar weiter – ein Lerntimer oder Pomodoro zählt also weiter. Mehrere Kacheln können gleichzeitig offen sein und ordnen sich in der Reihenfolge des Docks an; sind alle geschlossen, bleibt der Hauptbereich leer.

Neben dem Symbol zeigen die Dock-Buttons – auch bei geschlossener Kachel – ihren Stand: Lernzeit den laufenden Timer („● 12:34 Fokus“, „☕ 3:10 Kurze Pause“), Klausuren die Tage bis zur nächsten Klausur (falls eingeschaltet, 14 Tage vorher hervorgehoben). Gewohnheiten und Mensa zeigen nur ihr Symbol.

Welche Kacheln offen sind, speichert jedes Gerät für sich in `local/open` (wird nicht synchronisiert), damit Mac und iPad unterschiedliche Ansichten haben können. Ohne gespeicherten Zustand sind Mensa und Gewohnheiten offen.

## Neues Widget hinzufügen

1. Datei `js/widgets/mein-widget.js` anlegen:

   ```js
   export default {
     id: 'mein-widget',          // eindeutig, dient auch als Speicher-Namespace
     title: 'Mein Widget',
     icon: '✨',                  // optional
     placement: 'grid',          // optional: 'grid' (Kachel), 'hero' (Kopfbereich links)
                                 //           oder 'header' (kompakt oben rechts)
     size: 'normal',             // optional, nur für 'grid': 'normal' oder 'wide' (2 Spalten)
     dock: { icon: '✨', label: 'Mein Widget' }, // optional: Button im Dock öffnet/schließt die Kachel
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
| `ctx.onCleanup(fn)` | Funktion, die beim Neuaufbau des Widgets aufgerufen wird (z. B. Abo auf Schlüssel eines anderen Widgets abmelden) |

Wirft `render()` oder `refresh()` einen Fehler, zeigt das Widget eine Fehlermeldung mit „Erneut versuchen“ (kompakte Widgets als kleinen Button), und der Rest der Seite läuft weiter. Für Netzwerkzugriffe `fetchJSON()` aus `js/core/http.js` verwenden.

## Speicher-Schicht und Sync

Alle Daten laufen über `js/core/storage.js`. Die Funktionen sind bewusst asynchron, damit sich die Ablage austauschen lässt, ohne Widgets anzupassen. Ist `localStorage` nicht verfügbar (z. B. im privaten Modus), hält das Modul die Daten im Arbeitsspeicher, statt abzustürzen.

Schlüssel, die mit `local/` beginnen (Caches, Design, Sync-Zugangsdaten), bleiben immer auf dem Gerät. Alle anderen bekommen einen Änderungszeitstempel und werden von `js/core/sync.js` abgeglichen:

- **Einrichten:** ⚙︎ oben rechts → Token auf GitHub erstellen (klassischer Token, nur Häkchen „gist“) → einfügen → Verbinden. Auf jedem weiteren Gerät denselben Token eintragen. Beim ersten Verbinden legt das Dashboard ein geheimes Gist `dashboard-sync.json` an bzw. findet das vorhandene.
- **Wann:** beim Start, etwa 2 Sekunden nach jeder Änderung, beim Zurückkehren in den Tab, wenn das Gerät wieder online ist und alle 5 Minuten.
- **Zusammenführen:** Pro Schlüssel gewinnt die neuere Änderung. Sammlungen von Einträgen mit eigenem `updatedAt` (z. B. Lernzeiten) werden Eintrag für Eintrag zusammengeführt. Gelöschte Einträge bleiben als `deleted: true` stehen, damit das Löschen auf allen Geräten ankommt.
- **Hinweis:** Ein geheimes Gist ist nicht öffentlich auffindbar, aber für jeden lesbar, der den Link kennt. Der Token wird nur im Browser des jeweiligen Geräts gespeichert.

## Lernzeit-Tracker

Die Lernzeit öffnest du über den Dock-Button „Lernzeit“. Läuft ein Timer, zeigt der Button den Stand, z. B. „● 12:34 Fokus“ – auch bei geschlossener Kachel.

- Start, Pause/Weiter und Stopp mit Fachauswahl. Die Startzeit wird gespeichert, der Timer läuft also über Neuladen und Geräte hinweg weiter. Pausen werden von der Lernzeit abgezogen und am Eintrag gespeichert. Sitzungen unter einer Minute werden verworfen.
- Löschen per Doppelklick-Bestätigung am Button („×“ → „Löschen?“) statt Browser-Dialog, weil `confirm()` in eingebetteten Ansichten oft blockiert ist.
- **Pomodoro-Modus:** Umschalter „Frei“/„Pomodoro“ über dem Timer (wird gespeichert). Fokus, kurze und lange Pause sowie die Runden bis zur langen Pause sind unter „Pomodoro-Einstellungen“ einstellbar (Standard 25/5/15 min, 4 Runden), ebenso der automatische Start der nächsten Phase. Bedienung: Start, Pause/Weiter, Überspringen, Abbrechen.
  - Gerechnet wird nur mit gespeicherten Zeitstempeln (Start, Ende, Pausen) – die Restzeit stimmt daher auch nach Neuladen, in Hintergrund-Tabs und auf dem iPad.
  - Nur Fokusphasen werden als normale Lerneinträge gespeichert (Pausen nicht); abgebrochene oder übersprungene Fokusphasen zählen mit der tatsächlich gelaufenen Zeit. Sie erscheinen in derselben Wochenübersicht.
  - Lief eine Fokusphase ab, während das Dashboard nicht offen war, fragt das Widget, ob sie gezählt werden soll.
  - Ton und Benachrichtigung beim Phasenwechsel sind standardmäßig aus und werden pro Gerät eingeschaltet (Benachrichtigungen erst nach Zustimmung im Browser). Beides funktioniert nur, solange das Dashboard geöffnet ist; auf dem iPad gibt es Benachrichtigungen nur für Web-Apps auf dem Home-Bildschirm. Den Stand zeigen immer der Tab-Titel (z. B. „🍅 12:34 Fokus“) und der Kopf der Lernzeit-Kachel.
  - Daten: `study.pomodoro` (aktuelle Phase) und `study.pomodoroSettings` werden synchronisiert, `local/cache/study.pomodoroAlerts` (Ton/Benachrichtigung) bleibt auf dem Gerät.
- Fächer anlegen, umbenennen, Farbe wechseln und löschen über „Fächer“.
- Übersicht über heute und die Woche, Balkendiagramm Mo–So nach Fach, Wochen mit ‹ › durchblättern.
- Unter „Einträge dieser Woche“ Einträge bearbeiten, löschen oder nachtragen.
- Über „Daten“ als JSON exportieren und importieren (zentral über `js/core/backup.js`, enthält auch die Gewohnheiten). Ein Import führt zusammen, statt zu überschreiben, und erzeugt keine Duplikate. Ältere Lernzeit-Exporte lassen sich weiter importieren.

## Gewohnheiten

- Über „Bearbeiten“ Gewohnheiten anlegen (Name, optional Emoji), umbenennen, Farbe wechseln, umsortieren (↑/↓), archivieren und löschen. Archivierte lassen sich wiederherstellen.
- Großer Knopf pro Gewohnheit: heute erledigt; erneuter Klick macht es rückgängig. Die Punkte Mo–So tragen Tage rückwirkend nach (nicht in der Zukunft), ‹ › blättert zu früheren Wochen.
- **Ohne Ziel:** Serie und Rekord in Tagen sowie „15× in den letzten 23 Tagen“ (Zeitraum seit dem Anlegen, höchstens 30 Tage).
- **Mit Wochenziel** (1–7× pro Woche): „2/3 diese Woche“ bzw. „Ziel erreicht“; Serie und Rekord zählen Wochen mit erreichtem Ziel.
- Daten: `habits.list` (Gewohnheiten) und `habits.days` mit einem Eintrag pro Gewohnheit und Tag (`<id>|JJJJ-MM-TT`, Tagesgrenze Europe/Berlin) inklusive Zeitstempel. Streaks werden immer daraus berechnet. Weil jeder Tag ein eigener Eintrag ist, führt der Gist-Sync Abhaken auf mehreren Geräten tageweise zusammen; auch ein Rückgängigmachen (`done: false`) kommt auf allen Geräten an.

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

## Stundenplan (RWTHonline)

Das Widget oben in der Kopfleiste zeigt den laufenden bzw. nächsten Termin mit Countdown. Titel werden gekürzt angezeigt: Die vorangestellte Modulnummer (z. B. „41.00030“) und der Zusatz „, Standardgruppe“ fallen weg; Veranstaltungsart (VO, UE …) und echte Gruppen (z. B. „Tutorium W3“) bleiben. Ein Klick öffnet heute und morgen (weitere Tage mit ‹ ›) mit Raum, Beschreibung, freien Zeitfenstern und abgesagten Terminen. Aktualisierung alle 30 Minuten; bei Fehlern bleiben die zuletzt geladenen Daten sichtbar.

### iCal-Link in RWTHonline finden

In RWTHonline deinen Terminkalender öffnen und dort die Export- bzw. Abo-Funktion (iCal) wählen. Den angebotenen Abo-Link kopieren (beginnt mit `https://` oder `webcal://`). Die genaue Bezeichnung des Menüpunkts kann sich je nach RWTHonline-Version unterscheiden.

**Der Link enthält einen persönlichen Schlüssel und ist wie ein Passwort zu behandeln.** Nicht in Code, Commits, Issues oder Chats einfügen. Falls er doch einmal öffentlich geworden ist: In RWTHonline beim Kalender-Export einen neuen Link erzeugen; der alte wird damit ungültig.

### Im Dashboard eintragen

Auf das Stundenplan-Feld oben klicken → Link einfügen → Speichern. Der Link wird nur im Gerätespeicher des Browsers abgelegt (`local/`), nie im Gist-Sync; auf jedem Gerät also einmal eintragen.

**Wichtig:** RWTHonline erlaubt den direkten Abruf des Abo-Links aus dem Browser nicht (fehlende CORS-Header). Es gibt zwei Wege:

1. **Datei-Import** (ohne Einrichtung): Kalender in RWTHonline als `.ics` herunterladen und im Widget über „.ics-Datei importieren“ laden. Ist nicht automatisch aktuell, bei Änderungen erneut importieren.
2. **Eigener Proxy** (automatisch aktuell): siehe nächster Abschnitt. Im Dashboard trägst du dann statt des RWTHonline-Links die Worker-Adresse ein.

**Zum Testen ohne echten Link** als Link `examples/stundenplan-beispiel.ics` eintragen. Die Datei enthält erfundene Termine (wöchentliche und 14-tägige Serien, Zeitumstellung, Ausnahme, verlegter und abgesagter Termin, ganztägiger Termin).

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
5. **Testen:** Im Browser `https://dashboard-ical.<dein-subdomain>.workers.dev/?key=<ACCESS_KEY>` öffnen. Es sollte Text erscheinen, der mit `BEGIN:VCALENDAR` beginnt. Mögliche Antworten sonst: „Zugriff verweigert“ (Schlüssel falsch), „RWTHonline antwortet mit Fehler …“ bzw. „liefert keinen iCal-Kalender“ (Link falsch oder abgelaufen).
6. **Im Dashboard eintragen:** Stundenplan → Einrichtung → genau diese Adresse inklusive `?key=…` als Link speichern.

Alternative mit der Kommandozeile (benötigt Node.js): im Ordner `proxy/cloudflare-worker` `npx wrangler login`, `npx wrangler deploy`, dann `npx wrangler secret put ICAL_URL` und `npx wrangler secret put ACCESS_KEY` (Werte werden abgefragt, nicht in Dateien geschrieben). `.dev.vars` und `.wrangler/` sind in `.gitignore` eingetragen.

Neuen RWTHonline-Link oder Schlüssel? Einfach das jeweilige Secret im Cloudflare-Dashboard überschreiben. Beim Wechsel des `ACCESS_KEY` auch den Link im Dashboard aktualisieren.

## Auf GitHub Pages veröffentlichen

1. Repository auf GitHub anlegen und pushen:

   ```bash
   git remote add origin https://github.com/<benutzer>/<repo>.git
   git push -u origin main
   ```

2. Auf GitHub: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)`, speichern.
3. Nach etwa einer Minute ist die Seite unter `https://<benutzer>.github.io/<repo>/` erreichbar.

Die Datei `.nojekyll` sorgt dafür, dass GitHub Pages die Dateien unverändert ausliefert. Netlify funktioniert genauso: Ordner hochladen bzw. Repository verbinden, ohne Build-Befehl, Publish-Verzeichnis `/`.

## Datenquellen

- Wetter: [Open-Meteo](https://open-meteo.com) (kein API-Key, CC BY 4.0)
- Mensa: [OpenMensa API v2](https://openmensa.org/api/v2) (kein API-Key, direkt aus dem Browser abrufbar). Die Canteen-IDs der Aachener Mensen stehen in `js/widgets/mensa.js`. Angezeigt wird der Studierendenpreis.
  Öffnungszeiten liefert OpenMensa nicht; sie stehen fest in `js/widgets/mensa.js` (Stand Oktober 2026 laut studierendenwerk-aachen.de, Vorlesungszeit) und müssen bei Änderungen dort angepasst werden. Das Widget zeigt „Geöffnet bis …“ bzw. „öffnet … um …“ und wechselt nach Schluss zum nächsten Öffnungstag.
  Die Mensa Academica (ID 187) liefert bei OpenMensa derzeit keine Speisepläne. Das Widget zeigt dafür einen Hinweis und einen Button „Speiseplan beim Studierendenwerk ↗“, der den Wochenplan auf studierendenwerk-aachen.de öffnet (Eigenschaft `link` in der Mensa-Liste).
  Mögliche spätere Lösung: eine geplante GitHub Action, die den Plan von der Seite des Studierendenwerks ausliest und als JSON ins Repo legt.
