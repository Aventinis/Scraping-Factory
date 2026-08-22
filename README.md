# Scraping-Factory

Eine Lösung, um Webscraping-Skripte einfach im Browser erstellen zu können — ganz ohne Programmierkenntnisse.

Der Nutzer wählt Elemente auf einer Webseite per Klick aus, die Scraping-Factory generiert daraus ein eigenständiges, lesbares **Python-Skript** (`requests` + `BeautifulSoup`).

## Aufbau

Das Projekt besteht aus zwei Teilen, die über einen lokalen HTTP-Server kommunizieren:

- **Browser Extension** (Manifest V3) — läuft im Chrome Side Panel, ermöglicht das Auswählen von Elementen auf der Seite per Hover/Klick
- **Companion App** (.NET 9) — lokaler Server, baut aus der Auswahl die Zwischenrepräsentation (IR) und generiert daraus das Python-Skript

## Features (v1 / MVP)

- Elemente per Hover-Highlighting auf der Zielseite auswählen, CSS-Selektor wird automatisch extrahiert
- Feldverwaltung im Side Panel (hinzufügen, benennen, Selektor per Tooltip einsehen)
- Generierung eines eigenständigen, kommentierten Python-Scraping-Skripts (`requests` + `BeautifulSoup`) und direkter Download
- Zustand von Auswahl und UI bleibt über Session Storage erhalten, auch wenn das Side Panel geschlossen wird
- Strukturiertes Logging in Content Script, Service Worker und Side Panel zur Fehlerdiagnose

**Scope-Grenzen in v1:** nur statisch gerenderte Seiten (kein JS-Rendering im generierten Skript), kein Login-/Session-Handling, keine Pagination, nur Python als Zielsprache.

## Verzeichnisstruktur

```
extension/                  Browser Extension (Manifest V3)
  background/               Service Worker — nur Nachrichtenweiterleitung
  content/                  Content Script — DOM-Highlighting, Selektor-Extraktion
  popup/                    Side-Panel-UI

companion/                  .NET 9 Solution
  ScrapingFactory.Companion/ Einstiegspunkt — lokaler HTTP-Server
  ScrapingFactory.Compiler/  IR-Typen + Sprachmodule
    IR/ScrapingConfig.cs     Intermediate Representation
    Backends/Python/         Python-Codegenerator
  ScrapingFactory.Tests/     Tests für Companion, Compiler und Codegenerator

language-modules/
  python/templates/          Jinja2/Scriban-Templates für generierte Python-Skripte
```

## Build & Test

```bash
# .NET Solution bauen
dotnet build companion/ScrapingFactory.sln

# .NET Tests ausführen
dotnet test companion/ScrapingFactory.sln

# Extension-Tests ausführen
cd extension && npm test

# Extension laden (Chrome/Edge)
# Erweiterungsverwaltung → "Entpackte Erweiterung laden" → extension/
```

Ausführliche Entwicklerdokumentation (Architektur, offene Designentscheidungen): siehe `CLAUDE.md`.
