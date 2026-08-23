# Scraping Factory — Entwicklerdokumentation

## Projektübersicht

Browser-Plugin, das Nutzern ohne Programmierkenntnisse ermöglicht, Webscraper visuell zu konfigurieren. Ergebnis ist ein eigenständiges, lesbares **Python-Skript** (v1). Die Architektur ist auf spätere Zielsprachen ausgelegt.

Das Projekt befindet sich nicht mehr in der Prototyping-Phase, sondern im aktiven Ausbau des MVP. Grundsatzentscheidungen aus der Prototyping-Phase (IR-Schema, Extension↔Companion-Kommunikation) gelten als getroffen und werden im laufenden Betrieb weiterentwickelt statt neu diskutiert — siehe „Architekturentscheidungen" unten.

**Grundsatz:** Scraping Factory soll ein freies (kostenloses, ohne Abhängigkeit von kostenpflichtigen Drittanbieter-Diensten) Plugin bleiben. Das schließt insbesondere kommerzielle Stealth-Browser-/Anti-Bot-SDKs mit Session- oder Lizenzmodell aus (siehe „Geplant für spätere Releases").

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
    IR/ScrapingConfig.cs     Intermediate Representation
    Backends/Python/         Python-Codegenerator

language-modules/
  python/templates/          Scriban-Templates für generierte Python-Skripte
```

## Komponenten

### Browser Extension
- Manifest V3, kein Node.js-Zugriff im Service Worker
- Enthält **keine** Scraping- oder Codegenerierungslogik
- Kommuniziert mit der Companion App via lokalen HTTP-Server (`http://localhost:5000`)

### Companion App (`companion/ScrapingFactory.Companion`)
- .NET 9 Konsolenanwendung
- Startet einen lokalen HTTP-Server für die Extension
- `/generate` generiert das Skript, führt es dann per Sprachmodul-Verifier (`Backends/Python/PythonScriptVerifier`) probeweise in einem temporären Verzeichnis aus und liefert es erst bei Erfolg (Exit-Code 0, mindestens eine Datenzeile) aus — bei Fehlschlag `422` mit Fehlermeldung statt Skript
- **Laufzeit-Voraussetzung:** `python3` (oder `python`) inkl. `requests` + `beautifulsoup4` muss auf dem Rechner, auf dem die Companion App läuft, im PATH verfügbar sein — nicht mehr nur beim Endnutzer, der das heruntergeladene Skript später ausführt
- Baut die IR und übergibt sie an `ScrapingFactory.Compiler`

### Compiler (`companion/ScrapingFactory.Compiler`)
- Enthält die IR-Typen: das Wire-Format `ScrapingFactory.Compiler.IR.ScrapingConfig` (Fields-Liste, wie von der Extension gesendet) wird von `ScrapingPlanBuilder` in die kanonische `ScrapingPlan` (Schrittfolge aus `NavigateStep`/`ExtractStep`) übersetzt — Codegenerator und Verifier sehen nur noch `ScrapingPlan`
- Enthält die Sprachmodule (`Backends/Python/PythonCodeGenerator`, `Backends/Python/PythonScriptVerifier`), die `ICodeGenerator`/`IScriptVerifier` implementieren; die `LanguageModuleRegistry` löst sie per `LanguageId` auf, ohne dass Aufrufer die konkreten Typen kennen müssen

### Python-Templates (`language-modules/python/templates/`)
- Scriban-Templates (Dateiendung `.j2` aus historischen Gründen, Syntax ist Scriban statt Jinja2), aus denen der `PythonCodeGenerator` das fertige Skript rendert
- Generierter Code soll idiomatisch, kommentiert und für Endnutzer lesbar sein

## Build

```bash
# .NET Solution bauen
dotnet build companion/ScrapingFactory.sln

# Extension laden (Chrome/Edge)
# Erweiterungsverwaltung → "Entpackte Erweiterung laden" → extension/
```

## Architekturentscheidungen

Aus der Prototyping-Phase getroffen und aktiv in Verwendung (nicht mehr offen — Änderungen daran sind normale Weiterentwicklung, keine Grundsatzentscheidung mehr):

1. **IR-Schema** — Wire-Format bleibt `ScrapingFactory.Compiler.IR.ScrapingConfig` (Felder, Selektor als CSS-String, optionales Attribut, `OutputFormat`; camelCase/String-Enum, siehe `CompanionEndpointTests`). Intern übersetzt `ScrapingPlanBuilder` das in die kanonische `ScrapingPlan` (Schrittfolge `NavigateStep`/`ExtractStep`), die Codegenerator und Verifier konsumieren — Grundlage für künftige Schritt-Typen (Login, Warten, Klicks) ohne Bruch des Wire-Formats
2. **Extension ↔ Companion Kommunikation** — lokaler HTTP-Server (`http://localhost:5000`), kein Native Messaging

Weiterhin bestehende, bekannte Einschränkung (kein offener Entscheidungsbedarf, sondern eine Eigenschaft des gewählten Ansatzes):

3. **Selektor-Kompatibilität** — CSS-Selektoren, die sich nicht 1:1 auf BeautifulSoup/soupsieve übertragen (`:contains()`, Shadow DOM, dynamische Klassen). Wird bei der Skript-Verifikation in `/generate` sichtbar (Selektor liefert keine Daten → `422`), nicht separat validiert.

## v1-Scope (MVP)

- Nur statisch gerenderte Seiten (kein JS-Rendering im generierten Skript)
- Kein Login-/Session-Handling
- Keine Pagination
- Nur Python als Zielsprache
- Backend des generierten Skripts: `requests` + `BeautifulSoup`

## Geplant für spätere Releases (Post-MVP)

- **JS-Rendering-Unterstützung** — Skripte sollen auch dynamisch gerenderte Seiten scrapen können. Muss mit einer freien/kostenlosen Lösung umgesetzt werden (z. B. reines Playwright + Standard-Chromium/-Firefox), **keine kommerziellen Stealth-Browser-/Anti-Bot-Dienste mit Lizenz- oder Session-Modell** (z. B. CloakBrowser — geprüft und verworfen: Free-/Pro-Tarife sind session-limitiert und das Binary-Lizenzmodell untersagt Redistribution an Dritte ohne separaten OEM/SaaS-Vertrag, was mit einem frei verteilten Plugin nicht vereinbar ist). Bei Umsetzung ändert sich die Konsistenzregel nicht: die Companion App verifiziert weiterhin durch tatsächliche Ausführung des generierten Skripts.
- **Login-/Session-Handling**
- **Pagination**
- **Weitere Zielsprachen** neben Python (Architektur ist bereits darauf ausgelegt, siehe Projektübersicht)

## Konsistenzregel

Die Companion App verifiziert nicht mehr nur auf derselben Rendering-Stufe wie das generierte Skript — sie führt vor der Auslieferung das exakt generierte Skript einmal probeweise aus (`Backends/Python/PythonScriptVerifier`: Skript in ein temporäres Verzeichnis schreiben, per `python3`/`python`-Subprozess ausführen, Exit-Code und `output.csv` prüfen). Das schließt jede Diskrepanz zwischen Verifikation und generiertem Skript aus (Encoding, Selektor-Kompatibilität, Netzwerkfehler, Laufzeitfehler) und war der Grund, weshalb ein separater Playwright- oder AngleSharp-basierter Verifikationspfad verworfen wurde: er hätte immer nur eine Annäherung an das reale Skriptverhalten sein können.

Vor dieser echten Ausführung läuft in `/generate` zusätzlich `IR/ScrapingPlanValidator` als schnelle, rein strukturelle Vorprüfung der `ScrapingPlan` (kaputte URL, doppelte/leere Feldnamen) — das ersetzt die echte Verifikation nicht, sondern spart nur den Subprozess-Start bei Konfigurationen, die unabhängig vom Skriptverhalten immer falsch sind. CSS-Selektor-Syntax/-Kompatibilität wird bewusst weiterhin nicht separat geprüft (siehe Punkt 3 oben), sondern bleibt allein Sache der echten Skript-Ausführung.
