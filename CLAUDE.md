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
- Popup/Side Panel (`extension/popup/popup.js`) unterstützt beide Modi strikt getrennt: „Felder (flach)" (bestehend) und „Container (verschachtelt)" — Moduswechsel leert jeweils die andere Konfiguration. Der Container-Baum wird nach dem visuellen Muster der DOM-Tree-View editierbar gerendert (`renderGroupTree`/`buildGroupTreeNodeEl`, analog zu `renderDomTree`/`buildTreeNodeEl`); Container-Anlegen fragt Name/Typ **vor** der Klick-Auswahl ab (`modal-container-new`), Datenfeld-Anlegen wie im Flat-Modus **nach** der Klick-Auswahl (`modal-field-extended`, mit Feldtyp-Dropdown Text/Attribut/Vorhanden?)
- Content Script (`extension/content/content-script.js`): `buildSelector`/`startSelection` akzeptieren einen optionalen Scope-Root (`scopeSelector` auf der `START_SELECTION`-Nachricht) — beim Anlegen eines verschachtelten Containers/Datenfelds wird die Klick-Auswahl auf Nachfahren der ersten Instanz der Elterngruppe beschränkt, und der erzeugte Selektor ist relativ zu dieser Instanz gültig statt zu `document.body`

### Companion App (`companion/ScrapingFactory.Companion`)
- .NET 9 Konsolenanwendung
- Startet einen lokalen HTTP-Server für die Extension
- `/generate` generiert das Skript, führt es dann per Sprachmodul-Verifier (`Backends/Python/PythonScriptVerifier`) probeweise in einem temporären Verzeichnis aus und liefert es erst bei Erfolg (Exit-Code 0, mindestens eine Datenzeile bzw. bei Container-Mode ein XML-Element) aus — bei Fehlschlag `422` mit Fehlermeldung statt Skript
- **Laufzeit-Voraussetzung:** `python3` (oder `python`) inkl. `requests` + `beautifulsoup4` muss auf dem Rechner, auf dem die Companion App läuft, im PATH verfügbar sein — nicht mehr nur beim Endnutzer, der das heruntergeladene Skript später ausführt. Für den Browser-Engine (`Engine: "Browser"`) zusätzlich `playwright` (`pip install playwright`) inkl. installiertem Chromium (`playwright install chromium`)
- Baut die IR und übergibt sie an `ScrapingFactory.Compiler`

### Compiler (`companion/ScrapingFactory.Compiler`)
- Enthält die IR-Typen: das Wire-Format `ScrapingFactory.Compiler.IR.ScrapingConfig` (Fields-Liste, wie von der Extension gesendet) wird von `ScrapingPlanBuilder` in die kanonische `ScrapingPlan` (Schrittfolge aus `NavigateStep`/`ExtractStep`) übersetzt — Codegenerator und Verifier sehen nur noch `ScrapingPlan`
- **Container-Mode** (Gruppen/Container, Issue #21): alternativ zu `Fields` trägt `ScrapingConfig` ein `Groups`-Feld (`List<GroupNode>`, siehe `IR/ContainerNode.cs` — `GroupNode`/`DataFieldNode`, rekursiv verschachtelbar). Beide schließen sich gegenseitig aus (`422`/`400` in `/generate`, vor `ScrapingPlanBuilder`). `ScrapingPlanBuilder` übersetzt `Groups` in einen einzelnen `ExtractGroupStep` statt der flachen `ExtractStep`-Liste und erzwingt `OutputFormat.Xml`, unabhängig davon was die Extension sendet — analog dazu, wie ein Login-Flow `Engine=Browser` erzwingt. Container-Mode ist **engine-unabhängig** (funktioniert mit Static und Browser gleichermaßen), anders als Login. Da `List<ContainerNode>` polymorph ist (`GroupNode`/`DataFieldNode`), braucht De-/Serialisierung `IR/ContainerNodeJsonConverter` — System.Text.Json kann weder in einen abstrakten Typ deserialisieren noch Elemente eines `List<ContainerNode>` anhand ihres Laufzeittyps serialisieren
- Enthält die Sprachmodule: `Backends/Python/PythonCodeGenerator` (Engine `Static`, requests+BeautifulSoup) und `Backends/Python/PythonPlaywrightCodeGenerator` (Engine `Browser`, Playwright), beide implementieren `ICodeGenerator`; `Backends/Python/PythonScriptVerifier` implementiert `IScriptVerifier` und führt beide Skriptarten gleichermaßen aus (bei Container-Mode gegen `output.xml` statt `output.csv`, siehe `OutputFormat`-Parameter von `VerifyAsync`). Die `LanguageModuleRegistry` löst Codegeneratoren per `(LanguageId, Engine)`-Tupel auf, Verifier per `LanguageId` — Aufrufer kennen die konkreten Typen nicht

### Python-Templates (`language-modules/python/templates/`)
- Scriban-Templates (Dateiendung `.j2` aus historischen Gründen, Syntax ist Scriban statt Jinja2)
- `scraper.py.j2`: ein Monolith für den Static-Engine (`PythonCodeGenerator`) — deklarativer Dict-Ansatz (SELECTORS/ATTRIBUTES), braucht keine Schritt-für-Schritt-Komposition
- `playwright_scraper.py.j2` + `playwright_navigate_step.py.j2` + `playwright_wait_step.py.j2` + `playwright_fill_step.py.j2` + `playwright_click_step.py.j2`: für den Browser-Engine (`PythonPlaywrightCodeGenerator`) — Navigate-/WaitFor-/Fill-/Click-Steps werden als eigene Fragmente pro Step-Typ gerendert und der Reihe nach in die Shell eingesetzt, weil sie (anders als Extract) je einer konkreten Aktion an einer festen Stelle im Ablauf entsprechen. `FillStep`-Werte werden nie als Literal ins Skript geschrieben, sondern immer per `os.environ[...]` zur Laufzeit gelesen (`import os` wird nur eingefügt, wenn tatsächlich ein `FillStep` vorkommt)
- `scraper_grouped.py.j2` (Static) + `playwright_scraper_grouped.py.j2` (Browser): für Container-Mode. Der Gruppen-Baum wird nicht als Scriban-Rekursion nachgebildet (Scriban kennt keine Cross-Template-Rekursion), sondern von `Backends/Python/PythonGroupTreeLiteral` als verschachteltes Python-Dict-/Listenliteral (`GROUPS = [...]`) erzeugt und roh ins Template eingesetzt; eine generische `extract_group()`-Funktion im Template läuft den Baum zur Laufzeit ab — identisch in beiden Templates bis auf die zwei DOM-Zugriffsaufrufe (`select`/`select_one` vs. `query_selector_all`/`query_selector`). Ausgabe ist `output.xml` (`xml.etree.ElementTree`, mehrere Root-Gruppen werden unter einem `<Ergebnis>`-Wrapper zusammengefasst)
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

- Standard-Engine ist weiterhin statisches Rendering (`requests` + `BeautifulSoup`, kein JS). Ein optionaler Browser-Engine (Playwright + Chromium, `Engine: "Browser"`) für dynamisch gerenderte Seiten und einfache Login-Flows (`FillStep`/`ClickStep`/`WaitForStep`) existiert bereits serverseitig (IR, Codegen, Verifikation), hat aber noch **keine Extension-UI** — nur direkt über die Companion-API ansteuerbar
- Login innerhalb eines einzelnen Skriptlaufs ist möglich (Formular ausfüllen → absenden → warten → extrahieren, Zugangsdaten nur über Umgebungsvariablen, nie im Skript). Kein persistentes Session-Handling über mehrere Skriptläufe hinweg (kein Cookie-/Storage-State-Speichern und -Wiederverwenden)
- **Keine Captcha-Lösung/-Umgehung** — bewusste Grenze, kein offener Punkt: Captchas sind eine gezielte Anti-Automatisierungs-Maßnahme der Zielseite; ein generisches Umgehungsfeature wäre Evasion-Tooling unabhängig von der Absicht im Einzelfall und bräuchte typischerweise kostenpflichtige Drittanbieter-Lösedienste (Verstoß gegen den Grundsatz oben). Blockiert eine Captcha den Ablauf, schlägt das Skript einfach ehrlich fehl (z. B. `WaitForStep` nach dem Login-Klick findet das erwartete Element nicht → Timeout), es gibt keine Sonderbehandlung
- **Container-basiertes Scraping** (Gruppen/Container, Issue #21): vollständig umgesetzt inkl. Extension-UI (Moduswahl, Baum-Editor, Scoping der Klick-Auswahl auf eine Container-Instanz)
- Keine Pagination
- Nur Python als Zielsprache
- Backend des generierten Skripts: `requests` + `BeautifulSoup` (Static) bzw. Playwright (Browser); Ausgabe als CSV (Flat-Mode) oder XML (Container-Mode)

## Geplant für spätere Releases (Post-MVP)

- **JS-Rendering-Unterstützung** — serverseitig umgesetzt: `Engine: "Browser"` generiert ein Playwright-Skript (reines Playwright + Standard-Chromium, **keine kommerziellen Stealth-Browser-/Anti-Bot-Dienste mit Lizenz- oder Session-Modell** — z. B. CloakBrowser wurde geprüft und verworfen, siehe Git-Historie), verifiziert durch tatsächliche Ausführung wie beim Static-Engine (Konsistenzregel unverändert). Offen: Extension-UI zum Auswählen des Engines und zum Setzen von `WaitForStep`
- **Login-/Session-Handling** — Login innerhalb eines Laufs umgesetzt (`FillStep`/`ClickStep`, siehe v1-Scope). Offen: persistentes Session-/Cookie-Handling über mehrere Skriptläufe hinweg, Extension-UI zum Konfigurieren eines Login-Flows. Captcha-Lösung ist kein Ziel (siehe v1-Scope)
- **Pagination**
- **Weitere Zielsprachen** neben Python (Architektur ist bereits darauf ausgelegt, siehe Projektübersicht)

## Konsistenzregel

Die Companion App verifiziert nicht mehr nur auf derselben Rendering-Stufe wie das generierte Skript — sie führt vor der Auslieferung das exakt generierte Skript einmal probeweise aus (`Backends/Python/PythonScriptVerifier`: Skript in ein temporäres Verzeichnis schreiben, per `python3`/`python`-Subprozess ausführen, Exit-Code und `output.csv` prüfen). Das schließt jede Diskrepanz zwischen Verifikation und generiertem Skript aus (Encoding, Selektor-Kompatibilität, Netzwerkfehler, Laufzeitfehler) und war der Grund, weshalb ein separater Playwright- oder AngleSharp-basierter Verifikationspfad verworfen wurde: er hätte immer nur eine Annäherung an das reale Skriptverhalten sein können.

Vor dieser echten Ausführung läuft in `/generate` zusätzlich `IR/ScrapingPlanValidator` als schnelle, rein strukturelle Vorprüfung der `ScrapingPlan` (kaputte URL, doppelte/leere Feldnamen) — das ersetzt die echte Verifikation nicht, sondern spart nur den Subprozess-Start bei Konfigurationen, die unabhängig vom Skriptverhalten immer falsch sind. CSS-Selektor-Syntax/-Kompatibilität wird bewusst weiterhin nicht separat geprüft (siehe Punkt 3 oben), sondern bleibt allein Sache der echten Skript-Ausführung.
