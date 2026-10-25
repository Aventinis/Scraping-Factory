<!-- source: c7698bcebc0f -->
# Ausgabeformate und Ausgabe-Layouts

## Ausgabeformat

Wähle das Format unter **Einstellungen** (das Zahnrad) → **Ausgabeformat**. Es gilt für
jeden Scraper, den du baust.

| Format | Geschrieben als |
| --- | --- |
| **Standard (CSV, XML bei verschachtelten Ergebnissen)** | `output.csv` für flache Daten, `output.xml` für verschachtelte |
| **JSON** | `output.json`: eine Liste von Datensätzen oder bei verschachtelten Daten ein verschachteltes Objekt |
| **SQLite-Datenbank** | `output.sqlite`, eine Tabelle `data` |
| **Excel (.xlsx)** | `output.xlsx`, ein Blatt `Data` |

Hinweise:

- SQLite und Excel sind Tabellen. Ein verschachteltes Ergebnis (Container oder
  verschachtelte API-Daten) wird zu einer Zeile pro innerstem Eintrag *flachgezogen*,
  wobei Werte höherer Ebenen in jeder Zeile wiederholt werden; die Erweiterung sagt dir,
  wenn das passiert.
- Excel braucht `pip install openpyxl` auf dem Computer, auf dem das Skript läuft — und
  auf dem, der den Companion betreibt, weil der Testlauf das Skript ausführt.
- SQLite und Excel gibt es nicht für den Blöcke- und den Kombiniert-Modus, und sie lassen
  sich nicht mit der Änderungserkennung kombinieren.
- Die Namen von Skript und Ausgabedatei kommen aus **Skriptname** und **Name der
  Ausgabedatei** unten auf dem Startbildschirm. Unter **Einstellungen** kann der
  **Standard-Skriptname** ein fester Name sein oder aus dem Hostnamen der Website
  abgeleitet werden.

Weitere ausgabebezogene Einstellungen unter **Einstellungen**: **Testlauf-Datenvorschau
anzeigen**, **Vollständige Scraping-Datei herunterladen** (die vollständige Ausgabe des
Testlaufs, vom Fertig-Bildschirm), **Bearbeitbare Konfigurationsdatei (XML)** (siehe
unten) und **Testlauf überspringen** (siehe unten).

## Den Testlauf überspringen

Normalerweise führt der Companion das generierte Skript einmal gegen die echte Seite
aus, bevor er es herausgibt. Das beweist, dass es funktioniert, kostet aber Zeit. Mit
**Testlauf überspringen (Skript sofort ausgeben)** wird das Skript sofort zurückgegeben,
ohne ausgeführt zu werden. Es wird weiterhin auf strukturelle Fehler geprüft (eine
kaputte URL, doppelte oder leere Feldnamen), aber ein falscher Selektor oder eine
blockierte Anfrage zeigt sich erst, wenn du das Skript selbst ausführst. Eine
Datenvorschau oder eine vollständige Ausgabedatei gibt es dabei nicht.

## Bearbeitbare Konfigurationsdatei

Mit **Bearbeitbare Konfigurationsdatei (XML)** kannst du einiges *nach* dem Generieren
ändern, ohne die `.py`-Datei anzufassen oder die Erweiterung erneut zu öffnen: die
Start-URL(s), den Namen der Ausgabedatei, den Ausgabenamen eines Feldes (flacher Modus)
und die Werte eines API-Parameters mit fester Werteliste. Die Datei gibt es noch nicht,
wenn du das Skript herunterlädst — das Skript legt sie beim ersten Lauf neben sich an und
liest sie bei jedem weiteren Lauf. Eine ungültige Datei stoppt den Lauf mit einer klaren
Meldung (Exit-Code 3).

## Anhängen statt ersetzen

**An die vorhandene Ausgabedatei anhängen statt sie zu ersetzen** lässt jeden Lauf zu der
Datei hinzufügen, die die früheren Läufe hinterlassen haben, für jedes Format — nützlich
für eine Preishistorie. Hat die vorhandene Datei andere Spalten, behält sie ihre eigenen,
ergänzt neue und lässt Lücken leer. Eine Datei, die sich nicht lesen lässt, stoppt den
Lauf (Exit-Code **10**), ohne sie anzufassen.

## Duplikate entfernen

**Duplikate entfernen** verwirft eine spätere Zeile, deren Schlüssel (ein Feld oder
mehrere) schon vorkam. Mit **Nur neue Einträge seit dem letzten Lauf schreiben** merkt
sich das Skript die gesehenen Schlüssel in einer kleinen Datei und schreibt nur neue
Einträge — entweder nur die neuen oder angehängt an die wachsende Datei. Wähle das
Feld oder die Felder, die einen Eintrag kennzeichnen (zusammen bilden sie seinen
Schlüssel); Einträge, deren Schlüsselfelder alle leer sind, werden nie entfernt. Das
hilft auch bei überlappenden Seiten und bei Einträgen, die über mehrere Start-URLs
erreichbar sind.

Die gemerkten Schlüssel liegen in einer kleinen Datei neben der Ausgabe (der Name der
Ausgabedatei plus `.dedup-seen.json`); lösche sie, um von vorn zu beginnen. Wie lange
Einträge gemerkt werden (nach Anzahl oder nach Tagen), steht unter **Erweitert**; der
Standard passt für fast jeden Scraper. Die Datei wird nur nach einem Lauf aktualisiert,
der keine Sicherheitsprüfung verletzt hat.

## Ausgabe-Layouts

Ein **Ausgabe-Layout** ist eine gespeicherte Liste von Zielfeldnamen in fester
Reihenfolge — der Spaltensatz, den dein nachgelagerter Import erwartet. Bei gewähltem
Layout (**Ausgabe-Layout** in den Einstellungen des Startbildschirms) ordnest du jedes
Zielfeld einem Feld deines Scrapers zu, und die Ausgabe hat immer genau diese Namen in
genau dieser Reihenfolge, egal welcher Scraper sie erzeugt hat.

Layouts legst du unter **Einstellungen → Ausgabe-Layouts** an und bearbeitest sie dort.
Du kannst die Felder tippen oder **ein Beispiel einfügen oder hochladen** (ein
JSON-Objekt, eine CSV-Kopfzeile oder eine Liste von Namen) und **Analysieren & Felder
befüllen**.

Ein Layout kann **Flach** oder **Baum** sein (verschachtelte Zielstruktur).
Verschachtelte Scraper-Ausgabe lässt sich auf ein flaches Layout abbilden — sie wird zu
Zeilen flachgezogen — oder auf ein Baum-Layout, in dem jede Zielgruppe aus ihrer eigenen
Quellgruppe schöpft.

Ausgabe-Layouts gibt es nicht für den Kombiniert- und den Blöcke-Modus.
