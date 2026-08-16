# Scraping Factory — Entwicklerdokumentation

## Projektübersicht

Browser-Plugin, das Nutzern ohne Programmierkenntnisse ermöglicht, Webscraper visuell zu konfigurieren. Ergebnis ist ein eigenständiges, lesbares **Python-Skript** (v1). Die Architektur ist auf spätere Zielsprachen ausgelegt.

Vollständiges Architekturkonzept: `architekturkonzept.md` (im Repo-Root, nicht eingecheckt / separat).

## Verzeichnisstruktur

```
extension/                  Browser Extension (Manifest V3)
  background/               Service Worker — nur Nachrichtenweiterleitung
  content/                  Content Script — DOM-Highlighting, Selektor-Extraktion
  popup/                    Popup-UI

companion/                  .NET 9 Solution
  ScrapingFactory.Companion/ Einstiegspunkt — lokaler HTTP-Server
  ScrapingFactory.Compiler/  IR-Typen + Sprachmodule
    IR/ScrapingConfig.cs     Intermediate Representation (JSON-Schema, noch offen)
    Backends/Python/         Python-Codegenerator

language-modules/
  python/templates/          Jinja2-Templates für generierte Python-Skripte
```

## Komponenten

### Browser Extension
- Manifest V3, kein Node.js-Zugriff im Service Worker
- Enthält **keine** Scraping- oder Codegenerierungslogik
- Kommuniziert mit der Companion App via lokalen HTTP-Server (Implementierung steht noch aus; Native Messaging wäre Alternative)

### Companion App (`companion/ScrapingFactory.Companion`)
- .NET 9 Konsolenanwendung
- Startet einen lokalen HTTP-Server für die Extension
- Startet bei Bedarf eine automatisierte Browser-Session (Playwright für .NET geplant) zur Verifikation der Konfiguration
- Baut die IR und übergibt sie an `ScrapingFactory.Compiler`

### Compiler (`companion/ScrapingFactory.Compiler`)
- Enthält die IR-Typen (`ScrapingFactory.Compiler.IR.ScrapingConfig`)
- Enthält die Sprachmodule (`Backends/Python/PythonCodeGenerator`)
- **Wichtig:** IR-Schema muss vor Implementierung des Python-Backends fixiert werden

### Python-Templates (`language-modules/python/templates/`)
- Jinja2-Templates, aus denen der `PythonCodeGenerator` das fertige Skript rendert
- Generierter Code soll idiomatisch, kommentiert und für Endnutzer lesbar sein

## Build

```bash
# .NET Solution bauen
dotnet build companion/ScrapingFactory.sln

# Extension laden (Chrome/Edge)
# Erweiterungsverwaltung → "Entpackte Erweiterung laden" → extension/
```

## Offene Designentscheidungen (vor Implementierung fixieren)

1. **IR-Schema** — Felder, Selektor-Format, Ausgabeformat (CSV/JSON), Feldtypen
2. **Extension ↔ Companion Kommunikation** — lokaler HTTP-Server (aktuell geplant) vs. Native Messaging API
3. **Selektor-Kompatibilität** — CSS-Selektoren die sich nicht 1:1 auf BeautifulSoup übertragen (`:contains()`, Shadow DOM, dynamische Klassen)

## v1-Scope (MVP)

- Nur statisch gerenderte Seiten (kein JS-Rendering im generierten Skript)
- Kein Login-/Session-Handling
- Keine Pagination
- Nur Python als Zielsprache
- Backend des generierten Skripts: `requests` + `BeautifulSoup`

## Konsistenzregel

Die Companion App nutzt zur Verifikation dieselbe Rendering-Stufe wie das generierte Skript. In v1 bedeutet das: die Companion App prüft ebenfalls nur statisches HTML (kein Playwright-Rendering zur Verifikation), damit Live-Vorschau und generiertes Skript identische Ergebnisse liefern.
