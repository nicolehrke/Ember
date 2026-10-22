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
js/main.js              Startpunkt: Theme initialisieren, Widgets einhängen
js/core/storage.js      Speicher-Schicht (einzige Stelle mit localStorage)
js/core/widget-host.js  Baut Kacheln, ruft Widgets auf, fängt Fehler ab
js/core/theme.js        Umschaltung System / Hell / Dunkel
js/core/http.js         fetchJSON() mit Timeout und verständlichen Fehlern
js/core/dom.js          Kleine DOM-Helfer (h(), esc())
js/widgets/index.js     Zentrale Widget-Liste
js/widgets/*.js         Ein Modul pro Widget
```

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
| `ctx.store` | `load(key, fallback)`, `save(key, value)`, `remove(key)`, `subscribe(key, fn)`, automatisch mit der Widget-`id` als Präfix |
| `ctx.addAction(label, onClick, title)` | Kleiner Button oben rechts in der Kachel (nur `grid`) |
| `ctx.every(ms, fn)` | Intervall, z. B. für eine Uhr; wird beim Neuaufbau automatisch beendet |
| `ctx.setStatus(text)` | Fußzeile der Kachel (z. B. „Aktualisiert 13:20 Uhr“), bei kompakten Widgets als Tooltip |
| `ctx.refresh()` | Widget neu laden |
| `ctx.root` | Das äußere Element des Widgets |

Wirft `render()` oder `refresh()` einen Fehler, zeigt das Widget eine Fehlermeldung mit „Erneut versuchen“ (kompakte Widgets als kleinen Button), und der Rest der Seite läuft weiter. Für Netzwerkzugriffe `fetchJSON()` aus `js/core/http.js` verwenden.

## Speicher-Schicht

Alle Daten laufen über `js/core/storage.js`. Die Funktionen sind bewusst asynchron, damit sich später ein Backend mit Sync anbinden lässt, indem man nur diese Datei austauscht. Ist `localStorage` nicht verfügbar (z. B. im privaten Modus), hält das Modul die Daten im Arbeitsspeicher, statt abzustürzen.

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
