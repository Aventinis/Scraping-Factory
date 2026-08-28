# Scraping Factory — Entwicklerdokumentation

## Projektübersicht

Browser-Plugin, das Nutzern ohne Programmierkenntnisse ermöglicht, Webscraper visuell zu konfigurieren. Ergebnis ist ein eigenständiges, lesbares **Python-Skript** (v1). Die Architektur ist auf spätere Zielsprachen ausgelegt.

Das MVP (v1.0.0) ist erreicht und liegt hinter uns — aktueller Stand ist v1.4.1, in Arbeit befindet sich v1.5.0. Das Projekt befindet sich damit nicht mehr im MVP-Ausbau, sondern in normaler Feature-Weiterentwicklung darüber hinaus, auch über den ursprünglich für v1 geplanten Funktionsumfang hinaus. Grundsatzentscheidungen aus der Prototyping-Phase (IR-Schema, Extension↔Companion-Kommunikation) gelten als getroffen und werden im laufenden Betrieb weiterentwickelt statt neu diskutiert — siehe „Architekturentscheidungen" unten.

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
- Popup/Side Panel (`extension/popup/popup.js`) unterstützt drei Modi strikt getrennt: „Felder (flach)" (bestehend), „Container (verschachtelt)" und „API" — Moduswechsel leert jeweils die Konfiguration der beiden anderen Modi (`switchMode`/`MODE_SWITCH_CLEARS`). Der Container-Baum wird nach dem visuellen Muster der DOM-Tree-View editierbar gerendert (`renderGroupTree`/`buildGroupTreeNodeEl`, analog zu `renderDomTree`/`buildTreeNodeEl`); Container-Anlegen fragt Name/Typ **vor** der Klick-Auswahl ab (`modal-container-new`), Datenfeld-Anlegen wie im Flat-Modus **nach** der Klick-Auswahl (`modal-field-extended`, mit Feldtyp-Dropdown Text/Attribut/Vorhanden?)
- Content Script (`extension/content/content-script.js`): `buildSelector`/`startSelection` akzeptieren einen optionalen Scope-Root (`scopeSelector` auf der `START_SELECTION`-Nachricht) — beim Anlegen eines verschachtelten Containers/Datenfelds wird die Klick-Auswahl auf Nachfahren der ersten Instanz der Elterngruppe beschränkt, und der erzeugte Selektor ist relativ zu dieser Instanz gültig statt zu `document.body`
- „Konfiguration exportieren" (`btn-export-config`, `buildConfigExport`/`downloadConfigExport` in `popup.js`) lädt die aktuelle Fields-/Groups-/Api-Konfiguration als JSON herunter — `config` darin ist wortgleich der Request-Body, den `/generate` bekäme (wiederverwendet `buildScrapingConfig`), plus `exportedAt`/`extensionVersion`. Gedacht zum Beilegen bei Selektor-/Bug-Reports, unabhängig vom bestehenden „Fehler melden"-Log-Export
- **API-Modus** (Issue #53): findet die passende JSON-API-Anfrage für einen angeklickten Datenpunkt automatisch, statt HTML zu scrapen. Netzwerk-Aufzeichnung (`extension/content/api-capture.js`, im MAIN-World injiziert, `document_start`) patcht `fetch`/`XMLHttpRequest.prototype.open`/`send` und puffert Request/Response-Paare während eine Aufzeichnung läuft; Kommunikation zum Isolated-World-`content-script.js` läuft über `window.postMessage`, von dort per `chrome.runtime.sendMessage` weiter zum Popup (`API_CAPTURE_START`/`_STOP`/`_ENTRY`, `FORWARD_TO_TAB` im Service Worker)
- Klick-Auswahl im API-Modus sucht (statt eines CSS-Selektors) den angeklickten Wert rekursiv in den aufgezeichneten JSON-Antworten (`findApiCandidates` in `content-script.js`) und liefert Kandidaten (Anfrage + JSON-Pfad zum Treffer); bei einem Treffer innerhalb eines Array-Elements werden Geschwister-Keys des Objekts als Ein-Klick-Vorschläge für weitere Felder angeboten
- Ein bestätigter API-Kandidat wird auf dem `API_CONFIG`-Screen in eine parametrisierte `ApiConfig` überführt (`buildApiConfig`/`confirmApiConfig` in `popup.js`): die URL wird in Pfadsegmente/Query-Parameter zerlegt, jeder Teil einzeln zwischen „fest" und „variabel" umschaltbar; für jeden variablen Teil eine Werte-Quelle — Werteliste, ein zweiter per Aufzeichnen-und-Korrelieren gefundener Discovery-Endpunkt, oder ein lokal berechenbarer Bereich (ISO-Woche/Zahl/Datum). Für Bereichs-Quellen wird das Datums-/Wochenformat aus dem aufgezeichneten Rohwert des URL-Teils automatisch erkannt (Presets wie „ISO-Standard"/„Jahr-Woche ohne Trennzeichen" plus „Eigenes Format…", `detectRangeFormat`/`RANGE_FORMAT_PRESETS` in `popup.js`) — nötig, weil Zielseiten Wochen/Daten uneinheitlich kodieren (z. B. `2026-W35` vs. `2026-35`). Erfasste Request-Header werden angezeigt und pro Header optional übernommen, als Literal oder über eine Umgebungsvariable (analog zum Zugangsdaten-Muster bei `FillStep`)

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
- **API-Modus** (Issue #53): dritte, zu `Fields`/`Groups` exklusive Alternative — `ScrapingConfig.Api` (`IR/ApiConfig.cs`: `ApiConfig` mit `UrlTemplate`, optionalen `Headers`, `Parameters`, `ItemsPath`, `Fields`). `ScrapingPlanBuilder` übersetzt `Api` in einen einzelnen `ApiCallStep` und erzwingt `OutputFormat.Csv` sowie einen dritten `ScrapingEngine.Api`-Wert, unabhängig davon was die Extension sendet — analog zu Container-Mode/Login oben. `Engine.Api` ist eine bewusste Kompromiss-Entscheidung, um `LanguageModuleRegistry`s bestehenden `(LanguageId, Engine)`-Mechanismus wiederzuverwenden, obwohl „Engine" eigentlich Rendering-Verhalten meint (siehe „Architekturentscheidungen"). `ApiParameter.Source` (drei Varianten `StaticListSource`/`DiscoverySource`/`RangeSource`) ist polymorph, diskriminiert über System.Text.Json's `[JsonPolymorphic]`/`[JsonDerivedType]` mit explizitem `"kind"`-Feld — anders als `ContainerNode`, das strukturell erkannt wird, gibt es hier kein natürliches Unterscheidungsmerkmal
- `RangeSource` (ISO-Woche/Zahl/Datum) trägt ein optionales `Format` (`Backends/Python/RangeFormat`, Mini-Template aus `{yyyy}`/`{ww}`/`{mm}`/`{dd}`-Platzhaltern), weil Zielseiten Wochen/Daten uneinheitlich kodieren (z. B. `2026-W35` vs. `2026-35`) — fehlt `Format`, gilt ISO-8601 als Default. `RangeFormat` kompiliert das Format in eine Regex und wird von `ScrapingPlanValidator` genutzt, um `From`/`To` schon vor dem echten Skriptlauf dagegen zu prüfen, statt einen Format-Mismatch erst als rohen Python-Traceback sichtbar werden zu lassen
- `Backends/Python/PythonApiCodeGenerator` (`LanguageId="python"`, `Engine=ScrapingEngine.Api`) generiert reines `requests`+`itertools.product`-Python (kein BeautifulSoup/Playwright nötig), von `LanguageModuleRegistry`s Reflection-Scan automatisch gefunden. `PythonScriptVerifier` führt es wie jedes andere Skript real aus, gegen `output.csv`. Das generierte Skript probiert das volle kartesische Produkt aller Parameter-Wertelisten durch (keine Abhängigkeiten zwischen Parametern ausdrückbar, bewusste Grenze, siehe Issue #53); eine einzelne `404`-Antwort pro Kombination gilt als „diese Kombination existiert nicht" und wird übersprungen statt den ganzen Lauf abzubrechen — jeder andere Fehlerstatus bricht weiterhin sofort ab, und die bestehende „mindestens eine Datenzeile"-Erfolgsprüfung bleibt das Sicherheitsnetz gegen durchgängig fehlschlagende Konfigurationen

### Python-Templates (`language-modules/python/templates/`)
- Scriban-Templates (Dateiendung `.j2` aus historischen Gründen, Syntax ist Scriban statt Jinja2)
- `scraper.py.j2`: ein Monolith für den Static-Engine (`PythonCodeGenerator`) — deklarativer Dict-Ansatz (SELECTORS/ATTRIBUTES), braucht keine Schritt-für-Schritt-Komposition
- `playwright_scraper.py.j2` + `playwright_navigate_step.py.j2` + `playwright_wait_step.py.j2` + `playwright_fill_step.py.j2` + `playwright_click_step.py.j2`: für den Browser-Engine (`PythonPlaywrightCodeGenerator`) — Navigate-/WaitFor-/Fill-/Click-Steps werden als eigene Fragmente pro Step-Typ gerendert und der Reihe nach in die Shell eingesetzt, weil sie (anders als Extract) je einer konkreten Aktion an einer festen Stelle im Ablauf entsprechen. `FillStep`-Werte werden nie als Literal ins Skript geschrieben, sondern immer per `os.environ[...]` zur Laufzeit gelesen (`import os` wird nur eingefügt, wenn tatsächlich ein `FillStep` vorkommt)
- `scraper_grouped.py.j2` (Static) + `playwright_scraper_grouped.py.j2` (Browser): für Container-Mode. Der Gruppen-Baum wird nicht als Scriban-Rekursion nachgebildet (Scriban kennt keine Cross-Template-Rekursion), sondern von `Backends/Python/PythonGroupTreeLiteral` als verschachteltes Python-Dict-/Listenliteral (`GROUPS = [...]`) erzeugt und roh ins Template eingesetzt; eine generische `extract_group()`-Funktion im Template läuft den Baum zur Laufzeit ab — identisch in beiden Templates bis auf die zwei DOM-Zugriffsaufrufe (`select`/`select_one` vs. `query_selector_all`/`query_selector`). Ausgabe ist `output.xml` (`xml.etree.ElementTree`, mehrere Root-Gruppen werden unter einem `<Ergebnis>`-Wrapper zusammengefasst)
- `scraper_api.py.j2` (API-Modus, `PythonApiCodeGenerator`): kein BeautifulSoup nötig, nur `requests` + `itertools.product` + eine minimale JSON-Pfad-DSL (Punkt-Notation für Objekt-Keys, `[*]`/`[n]` für Arrays) zur Feld-Extraktion pro Datensatz. Discovery-Quellen lösen ihre Werte per zusätzlichem Request auf, Bereichs-Quellen (ISO-Woche/Zahl/Datum) werden anhand des `Format`-Mini-Templates geparst/gerendert (`_parse_range_value`/`_render_range_value`, spiegelt `RangeFormat` auf der Companion-Seite). Eine `404`-Antwort für eine einzelne Parameter-Kombination wird übersprungen statt den Lauf abzubrechen. Auth-Header über `EnvironmentVariableName` werden wie bei `FillStep` nie als Literal geschrieben, sondern per `os.environ[...]` gelesen. Ausgabe ist `output.csv`, Parameterwerte als Zusatzspalten
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
4. **`ScrapingEngine.Api` als dritter Engine-Wert** — konzeptionell passt „Engine" (wie wird die Seite gerendert) nicht ganz auf einen reinen JSON-Call, aber es ist die günstigste Anbindung an den bestehenden `LanguageModuleRegistry`-Mechanismus. Bewusste Kompromiss-Entscheidung, keine zwingende Vorgabe — eine spätere eigene Achse wäre sauberer, aber deutlich mehr Umbau für wenig Zusatznutzen im aktuellen Schnitt (siehe Issue #53).
5. **API-Modus: keine Abhängigkeiten zwischen Parametern** — es wird immer das volle kartesische Produkt aller Parameter-Wertelisten durchprobiert, genau wie beim ursprünglichen manuellen Vorgehen (z. B. „Woche X existiert nur für Kategorie Y" lässt sich nicht ausdrücken). Eine `404`-Antwort pro Kombination wird deshalb als erwartbar behandelt und übersprungen, nicht als Fehler.

## Funktionsumfang (Stand v1.4.1)

Ursprünglich als "v1-Scope (MVP)" geführt — das MVP ist seit v1.0.0 erreicht, dieser Abschnitt fasst seitdem laufend den aktuellen Gesamtumfang zusammen (zuletzt u. a. um Container-basiertes Scraping erweitert). Einzelne Punkte wandern von „Geplant für spätere Releases" hierher, sobald sie umgesetzt sind.

- Standard-Engine ist weiterhin statisches Rendering (`requests` + `BeautifulSoup`, kein JS). Ein optionaler Browser-Engine (Playwright + Chromium, `Engine: "Browser"`) für dynamisch gerenderte Seiten und einfache Login-Flows (`FillStep`/`ClickStep`/`WaitForStep`) existiert bereits serverseitig (IR, Codegen, Verifikation), hat aber noch **keine Extension-UI** — nur direkt über die Companion-API ansteuerbar
- Login innerhalb eines einzelnen Skriptlaufs ist möglich (Formular ausfüllen → absenden → warten → extrahieren, Zugangsdaten nur über Umgebungsvariablen, nie im Skript). Kein persistentes Session-Handling über mehrere Skriptläufe hinweg (kein Cookie-/Storage-State-Speichern und -Wiederverwenden)
- **Keine Captcha-Lösung/-Umgehung** — bewusste Grenze, kein offener Punkt: Captchas sind eine gezielte Anti-Automatisierungs-Maßnahme der Zielseite; ein generisches Umgehungsfeature wäre Evasion-Tooling unabhängig von der Absicht im Einzelfall und bräuchte typischerweise kostenpflichtige Drittanbieter-Lösedienste (Verstoß gegen den Grundsatz oben). Blockiert eine Captcha den Ablauf, schlägt das Skript einfach ehrlich fehl (z. B. `WaitForStep` nach dem Login-Klick findet das erwartete Element nicht → Timeout), es gibt keine Sonderbehandlung
- **Container-basiertes Scraping** (Gruppen/Container, Issue #21): vollständig umgesetzt inkl. Extension-UI (Moduswahl, Baum-Editor, Scoping der Klick-Auswahl auf eine Container-Instanz)
- **API-basierte Extraktion** (API-Modus, Issue #53): vollständig umgesetzt inkl. Extension-UI — Netzwerk-Aufzeichnung, Klick-Korrelation gegen aufgezeichnete JSON-Antworten, Parameter-Konfiguration mit Werteliste/Discovery-Endpunkt/Bereich als Werte-Quellen (inkl. automatischer Formaterkennung für ISO-Woche/Datum). Nur GET-Requests, kein Request-Body; nur ein Wiederholungslevel pro Antwort (flache Datensatz-Liste, kein verschachtelter Baum wie im Container-Modus); keine Abhängigkeiten zwischen Parametern (siehe „Architekturentscheidungen")
- Keine Pagination
- Nur Python als Zielsprache
- Backend des generierten Skripts: `requests` + `BeautifulSoup` (Static), Playwright (Browser) bzw. nur `requests` (API-Modus); Ausgabe als CSV (Flat-Mode, API-Modus) oder XML (Container-Mode)

## Geplant für spätere Releases

- **JS-Rendering-Unterstützung** — serverseitig umgesetzt: `Engine: "Browser"` generiert ein Playwright-Skript (reines Playwright + Standard-Chromium, **keine kommerziellen Stealth-Browser-/Anti-Bot-Dienste mit Lizenz- oder Session-Modell** — z. B. CloakBrowser wurde geprüft und verworfen, siehe Git-Historie), verifiziert durch tatsächliche Ausführung wie beim Static-Engine (Konsistenzregel unverändert). Offen: Extension-UI zum Auswählen des Engines und zum Setzen von `WaitForStep`
- **Login-/Session-Handling** — Login innerhalb eines Laufs umgesetzt (`FillStep`/`ClickStep`, siehe „Funktionsumfang"). Offen: persistentes Session-/Cookie-Handling über mehrere Skriptläufe hinweg, Extension-UI zum Konfigurieren eines Login-Flows. Captcha-Lösung ist kein Ziel (siehe „Funktionsumfang")
- **Pagination**
- **Weitere Zielsprachen** neben Python (Architektur ist bereits darauf ausgelegt, siehe Projektübersicht)
- **API-Modus: POST/GraphQL-Requests und verschachtelte JSON-Antworten** — Issue #53 deckt nur GET ohne Request-Body und flache Datensatz-Listen ab; Request-Body-Unterstützung (Folge-Issue „POST-Requests / Request-Body-Unterstützung") und ein rekursiver Baum wie im Container-Modus (Folge-Issue „verschachtelte JSON-Antworten") sind bewusst zurückgestellt

## Konsistenzregel

Die Companion App verifiziert nicht mehr nur auf derselben Rendering-Stufe wie das generierte Skript — sie führt vor der Auslieferung das exakt generierte Skript einmal probeweise aus (`Backends/Python/PythonScriptVerifier`: Skript in ein temporäres Verzeichnis schreiben, per `python3`/`python`-Subprozess ausführen, Exit-Code und `output.csv` prüfen). Das schließt jede Diskrepanz zwischen Verifikation und generiertem Skript aus (Encoding, Selektor-Kompatibilität, Netzwerkfehler, Laufzeitfehler) und war der Grund, weshalb ein separater Playwright- oder AngleSharp-basierter Verifikationspfad verworfen wurde: er hätte immer nur eine Annäherung an das reale Skriptverhalten sein können.

Vor dieser echten Ausführung läuft in `/generate` zusätzlich `IR/ScrapingPlanValidator` als schnelle, rein strukturelle Vorprüfung der `ScrapingPlan` (kaputte URL, doppelte/leere Feldnamen) — das ersetzt die echte Verifikation nicht, sondern spart nur den Subprozess-Start bei Konfigurationen, die unabhängig vom Skriptverhalten immer falsch sind. CSS-Selektor-Syntax/-Kompatibilität wird bewusst weiterhin nicht separat geprüft (siehe Punkt 3 oben), sondern bleibt allein Sache der echten Skript-Ausführung.
