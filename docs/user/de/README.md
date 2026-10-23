<!-- source: 956d7a22817f -->
# Scraping Factory — Benutzerdokumentation

Scraping Factory ist eine Browser-Erweiterung, mit der du einen Web-Scraper
zusammenklickst: Du klickst auf der Seite die gewünschten Daten an. Das Ergebnis
ist ein schlichtes, lesbares **Python-Skript**, das du selbst ausführen kannst —
einmalig, nach Zeitplan, wo immer du möchtest. Du musst nicht programmieren
können.

Diese Dokumentation richtet sich an Menschen, die die Erweiterung *benutzen*.
(Entwickler: siehe [`CLAUDE.md`](../../../CLAUDE.md) und
[`ARCHITECTURE.md`](../../ARCHITECTURE.md).)

> Diese Dokumentation gibt es auf Englisch (die Quelle) und auf Deutsch:
> [English version](../README.md). Die Erweiterung selbst spricht Deutsch,
> Englisch und Spanisch; die Links **Mehr erfahren** öffnen die deutschen Seiten,
> wenn das Panel auf Deutsch steht, sonst die englischen.

## Wo du anfängst

| Wenn du … | Lies |
| --- | --- |
| Scraping Factory installieren und deinen ersten Scraper bauen willst | [Erste Schritte](getting-started.md) |
| Listen von Einträgen, verschachtelte Listen oder JSON-APIs auslesen willst | [Scraping-Modi](modes.md) |
| Seiten auslesen willst, die JavaScript, eine Anmeldung oder Scrollen brauchen | [Browser-Engine und Aktionen](browser-engine.md) |
| „Weiter“-Links oder nummerierten Seiten folgen willst | [Pagination](pagination.md) |
| Werte aufräumen willst (Preise, Leerzeichen, Datumsangaben) | [Transformationen und Vorlagen](transforms.md) |
| gewarnt werden willst, wenn ein geplanter Scraper kaputtgeht | [Sicherheitsprüfungen und Benachrichtigungen](monitoring.md) |
| eine Einrichtung für eine Seite wiederverwenden willst, die du regelmäßig ausliest | [Gespeicherte Konfigurationen](saved-configurations.md) |
| CSV, JSON, SQLite oder Excel wählen oder Spaltennamen korrigieren willst | [Ausgabeformate und Ausgabe-Layouts](output.md) |
| rücksichtsvoll zu einer Seite sein willst: Pausen, Wiederholungen, Header, Proxys, robots.txt | [Netzwerk-Einstellungen](network-settings.md) |
| einen Companion mit mehreren Personen teilen willst | [Konten und Zugangsschlüssel](authentication.md) |
| ein Problem lösen willst | [Fehlersuche und FAQ](troubleshooting.md) |

## Wie es funktioniert, in einem Absatz

Die Erweiterung hat zwei Teile. Die **Erweiterung** in deinem Browser ist der Ort,
an dem du klickst und einrichtest. Der **Companion** ist ein kleines Programm auf
deinem Computer, das deine Einrichtung in ein Python-Skript verwandelt und es —
bevor du es bekommst — *einmal ausführt*, und zwar gegen die echte Seite. Ein
Skript, das fehlschlägt oder keine Daten findet, wird mit einer Erklärung
abgelehnt, statt dir übergeben zu werden. Alles bleibt auf deinem Rechner; es gibt
keinen Cloud-Dienst.

## Konventionen auf diesen Seiten

- **Fett** gesetzte Namen sind Beschriftungen, die du in der Erweiterung siehst,
  so geschrieben, wie die deutsche Oberfläche sie zeigt.
- Die meisten Seiten haben einen Kasten **Probier es selbst aus**. Er nutzt eine
  kleine Beispielseite aus dem Ordner `test-pages/` des Repositorys, sodass du
  mitmachen kannst, ohne eine echte Website anzufassen. Starte die Beispielseite
  einer Seite mit dem dort genannten Befehl; die Erweiterung zeigst du dann auf die
  Seite, die sich öffnet.
- Screenshots liegen in [`images/`](images/) und werden erzeugt, nicht von Hand
  gemacht — siehe [Diese Dokumentation pflegen](#diese-dokumentation-pflegen).

## Wo diese Seiten liegen

Auf GitHub werden sie aus `docs/user/` (Englisch) und `docs/user/de/` (Deutsch)
dargestellt. In der Erweiterung sind sie als HTML-Seiten gebündelt (beim Bauen der
Erweiterung aus denselben Dateien erzeugt), die die Links **Mehr erfahren** im
Seitenpanel in einem Browser-Tab öffnen — offline, ohne externe Adresse. Jede Seite
verlinkt auf ihr Gegenstück in der anderen Sprache. Die Release-Pakete enthalten
die Markdown-Dateien und Bilder außerdem in ihrem Ordner `docs/`.

## Diese Dokumentation pflegen

Für Mitwirkende: Ein Pull Request, der ändert, was Nutzer sehen oder tun, muss die
passende Seite hier (und ihre Screenshots) mitaktualisieren, genauso wie er bereits
`CLAUDE.md` und `docs/ARCHITECTURE.md` aktualisiert.

**Übersetzungen.** Die englischen Seiten sind die Quelle. `docs/user/de/<seite>.md`
ist die deutsche Fassung mit demselben Dateinamen und **derselben Überschriften-
Struktur** (das Panel findet die deutsche Überschrift eines Links „Mehr erfahren“
über ihre Position, deshalb darf eine Seite nicht in nur einer Sprache eine
Überschrift gewinnen oder verlieren). Verwende für alles, was die Erweiterung
anzeigt, die deutschen Beschriftungen aus `extension/i18n/de.json`, und sprich die
Leserin oder den Leser mit *du* an, wie die Oberfläche. Nach dem Übersetzen oder
Aktualisieren einer Seite stempelst du sie mit dem Hash ihrer englischen Quelle,
damit eine spätere Änderung der englischen Seite als veraltet auffällt:

```bash
node extension/docs-build.js --stamp monitoring      # schreibt <!-- source: … --> in de/monitoring.md
node e2e/screenshots/run.js --language de            # deutsche Screenshots nach de/images/
node e2e/screenshots/check-docs.js                   # listet fehlende, ungestempelte und veraltete Übersetzungen
```

`check-docs.js` meldet eine deutsche Seite, deren englische Quelle sich seit dem
Stempeln geändert hat (`--strict` macht daraus einen Fehler), und schlägt bei einer
abweichenden Überschriften-Struktur fehl. Eine Seite ohne deutsche Fassung ist in
Ordnung — das Panel fällt dann auf Englisch zurück.

Die Screenshots entstehen, indem die echte Erweiterung gegen die Beispielseiten
gesteuert wird, sodass sie nicht versehentlich veralten:

```bash
cd e2e && npm install            # einmalig
node e2e/screenshots/run.js      # jeden Screenshot neu erzeugen
node e2e/screenshots/run.js --only modes      # nur die Szenarien, deren ID "modes" enthält
node e2e/screenshots/run.js --theme dark      # dieselben Szenen im dunklen Modus
node e2e/screenshots/run.js --language de     # die deutsche Oberfläche (Bilder landen in de/images/)
node e2e/screenshots/run.js --list            # Szenario-IDs auflisten
node e2e/screenshots/check-docs.js            # prüfen, dass jedes Bild und jeder Link in beiden Sprachen existiert
```

Ein neuer Link **Mehr erfahren** in der Erweiterung braucht einen Schlüssel in
`extension/popup/docs-links.js`, der auf eine Seite und Überschrift hier zeigt —
wer eine Überschrift umbenennt, die ein Link benutzt, lässt den Test dieser Datei
fehlschlagen, bis der Schlüssel angepasst ist. Halte die Erweiterung selbst bei
einem Titel pro Bedienelement: Die Erklärung gehört hinter sein **?** (ein Text
`help.<bereich>.<feld>` mit `data-doc` für den Link), die Details auf die Seite.

Die Szenarien liegen in `e2e/screenshots/scenarios/`; jedes nennt eine Beispielseite,
die Klicks bis zu einem Bildschirm und das zu speichernde Bild. Um einer Seite einen
Screenshot hinzuzufügen, ergänzt (oder erweiterst) du ein Szenario, führst es aus
und verweist von der Seite auf `images/<name>.png`. Die Seiten verwenden stabile
Überschriften, weil die Erweiterung auf sie verlinkt.
