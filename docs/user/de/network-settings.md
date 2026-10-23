<!-- source: 72b0c9908631 -->
# Netzwerk-Einstellungen: rücksichtsvoll sein und durchkommen

Diese Optionen stehen im Bereich **Einstellungen** des Startbildschirms. Sie ändern, wie
das *generierte Skript* mit der Seite spricht. Sie funktionieren in jedem Modus und mit
beiden Engines, sofern nicht anders angegeben.

## Pause zwischen Anfragen

**Pause zwischen Anfragen** lässt das Skript vor jeder Anfrage warten: eine feste Zeit
oder zufällig in einem Bereich (**von … bis … Sekunden**, z. B. 1 bis 3). Eine Pause
gilt vor jeder Pagination-Seite, jeder Start-URL, jedem API-Aufruf und jedem Download —
aber nicht zwischen Lesezugriffen auf eine bereits geladene Seite.

Eine Pause schützt dich vor Sperren und Ratenbegrenzungen, aber der Lauf dauert
entsprechend länger: 50 Seiten mit 2 Sekunden Pause kosten etwa anderthalb Minuten mehr.
Der Testlauf rechnet diese Pausen nicht auf sein Zeitlimit an, sodass sich auch ein langer,
höflicher Scrape verifizieren lässt.

## Bei vorübergehenden Fehlern erneut versuchen

**Bei vorübergehenden Fehlern erneut versuchen** wiederholt eine Anfrage, die mit einem
Verbindungsfehler, einem Timeout oder einem der **Statuscodes** fehlgeschlagen ist, die du
auflistest (Standard 429, 502, 503, 504; die Liste steht unter **Erweitert**). Wähle
**Versuche** (Standard 3), die **Wartezeit (s)** (Standard 2) und ob die **Wartezeit jedes
Mal verdoppelt** wird. Sendet die Seite `Retry-After`, wird stattdessen diese Wartezeit
verwendet (höchstens 60 Sekunden). Fehler wie 404, 401 oder 403 werden nicht wiederholt.
Scheitern alle Versuche, stoppt der Lauf mit einer klaren Meldung.

## robots.txt

- **robots.txt der Seite beachten (Crawl-delay)**: Verlangt die robots.txt ein Tempo
  (`Crawl-delay` oder `Request-rate`), wartet das Skript mindestens so lange zwischen
  zwei Anfragen, zusätzlich zu deiner eigenen Pause (die längere Wartezeit gewinnt).
  Seiten, die nichts veröffentlichen, sind nicht betroffen.
- **robots.txt der Seite vor jeder Anfrage prüfen**: Beim Laufen prüft das Skript jede
  Anfrage — Seiten, weitere Seiten, Downloads und API-Aufrufe — gegen die
  `Disallow`-Regeln der Seite, falls die Seite sie nach dem Erstellen des Skripts
  geändert hat. Ist eine Anfrage nicht erlaubt, kann es **Überspringen und
  weitermachen**, **Warnen, aber trotzdem anfragen** oder **Lauf abbrechen**. Eine
  fehlende robots.txt bedeutet, dass alles erlaubt ist, und eine robots.txt, die sich nicht
  lesen lässt, blockiert nie etwas.

Die robots.txt wird einmal pro Lauf gelesen.

Die Schaltfläche **robots.txt prüfen** neben der Seitenadresse ist ein eigener, einmaliger
Blick darauf, ob die aktuelle Seite erlaubt ist.

## Eigene Request-Header

**Eigene Request-Header senden** fügt Header hinzu, die das Skript mit seinen Anfragen
sendet, etwa eine bevorzugte Sprache, die Seite, von der du kommst, oder einen API-Schlüssel.
Du musst keine Header-Namen kennen: Öffne **Header hinzufügen…** und wähle, was du brauchst.

![Aus der Liste gewählte Request-Header, mit der Warnung für ein Geheimnis als fester Wert](images/network-request-headers.png)

| Auswahl | Wofür |
| --- | --- |
| **Accept-Language** | Bittet die Seite um ihre Seiten in einer Sprache, z. B. `de-CH` |
| **Referer** | Die Seite, von der du kommst; manche Seiten antworten nur, wenn er gesetzt ist |
| **User-Agent** | Wer das Skript vorgibt zu sein — ersetzt den Standard; nur nötig, wenn die Seite ihn ablehnt |
| **Cookie** | Ein Login-Cookie, aus deinem Browser kopiert |
| **Authorization** | Ein Token oder Passwort, das die Seite verlangt (z. B. `Bearer …`) |
| **X-Api-Key** | Der API-Schlüssel, den manche Seiten verlangen |
| **Anderer Header** | Ein beliebiger Header — du tippst den Namen |

Die Auswahl eines Headers trägt seinen Namen und einen Vorschlag ein, und eine kurze
Beschreibung steht unter der Zeile. Jeder Header ist ein **Fester Wert** oder eine
**Umgebungsvariable** (der *Name* der Variable — das Geheimnis selbst gelangt nie ins
Skript). **Cookie, Authorization und X-Api-Key beginnen als Umgebungsvariable**, weil sie
Geheimnisse sind. Tippst du einen Header ein, der nach Geheimnis aussieht (ein Name mit
`token`, `secret`, `auth`, `key`, …), und behältst ihn als festen Wert, bekommst du eine
Warnung, dass der Wert im Klartext ins Skript geschrieben würde; **Umgebungsvariable
verwenden** behebt das mit einem Klick. Für einen Header mit Umgebungsvariable tippst du
einen **Testwert für den Testlauf** ein (wird nicht gespeichert), damit der Companion eine
geschützte Seite prüfen kann.

Mit der Browser-Engine gehen die Header an jede Anfrage, die die Seite stellt, auch an
Bilder und Skripte. Der Standard-`User-Agent` des Skripts wird ersetzt, wenn du einen setzt.

## Proxy verwenden

**Proxy verwenden** leitet Anfragen über Proxys, die du schon hast. Du gibst den *Namen
einer Umgebungsvariable* an, die eine kommagetrennte Liste von Proxy-URLs enthält
(`http://user:pass@host:port`); bei mehreren werden sie abwechselnd benutzt. Ist die
Variable nicht gesetzt, warnt das Skript, verbindet sich direkt und beendet sich mit dem
Code 78, damit du es bemerkst.

## Umgebungsvariablen in der Praxis

Mehrere Optionen fragen nach dem *Namen* einer Umgebungsvariable — Änderungserkennung
(E-Mail-Host, Benutzer, Passwort, Absender, Empfänger, Webhook), die Proxy-Liste, eine
Login-Aktion **Ausfüllen**, eigene Request-Header, API-Header und die API-Token-Anfrage.
Überall, wo eine verlangt wird, erklärt das **?** neben **Was ist eine Umgebungsvariable?**
sie in wenigen Zeilen. Die Kurzfassung: Es ist ein benannter Wert auf dem Computer, der das
*Skript ausführt* (nicht der Browser), ein sicherer Ort für Passwörter und Schlüssel. Du
tippst in der Erweiterung nur ihren **Namen** ein (zum Beispiel `SMTP_PASSWORD`); das
Skript liest den Wert, wenn es läuft.

Ein Name darf Buchstaben, Ziffern und Unterstriche enthalten und nicht mit einer Ziffer
beginnen (`API_KEY` und `PROXY_LIST` sind typisch). Ein Name, der nicht passt, wird direkt
unter dem Eingabefeld markiert, und **Skript generieren** wird mit einem Hinweis gestoppt,
bis es behoben ist. Wo es ein Feld für einen einmaligen **Testwert** gibt (Ausfüllen,
Header, die Token-Anfrage), wird der Wert nur für den Testlauf benutzt und nie gespeichert.

Setze die Variable dort, wo das Skript läuft:

```bash
export API_KEY='…'          # Linux / macOS
python scraper.py
```

```powershell
$env:API_KEY = '…'          # Windows PowerShell
python scraper.py
```
