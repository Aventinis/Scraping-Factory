<!-- source: 8e117c4fe3a3 -->
# Gespeicherte Konfigurationen

Wenn du dieselbe Seite immer wieder ausliest, baue die Einrichtung nicht jedes Mal neu.
**Konfiguration speichern** (neben **Konfiguration exportieren** unten auf dem
Startbildschirm) legt die aktuellen Felder, Container oder die API-Einrichtung zusammen
mit Engine, Pagination und den übrigen Einstellungen in einer kleinen Datenbank auf
deinem Rechner ab. Es wird nichts irgendwohin gesendet.

## Speichern und laden

1. Baue deinen Scraper wie gewohnt.
2. Klicke auf **Konfiguration speichern** und gib ihr einen Namen (der Name der Seite
   ist vorausgefüllt).
3. Wenn du diese Seite das nächste Mal öffnest, listet der Bereich **Gespeicherte
   Konfigurationen** unten auf, was du dafür gespeichert hast. Klicke auf **Laden**, um
   die Einrichtung wiederherzustellen.

Das Laden ändert nie die Adresse: Die Seite, die in deinem Browser geöffnet ist,
bleibt die Seite, die ausgelesen wird. Deine persönlichen Einstellungen (Ausgabeformat,
Vorschau und so weiter) werden ebenfalls nicht überschrieben — das Laden der
Konfiguration eines anderen kann sie nicht ändern.

**Löschen** fragt direkt in der Zeile nach (**Ja** / **Nein**), weil es die einzige
Aktion ist, die etwas Gespeichertes entfernt.

Alle deine gespeicherten Konfigurationen, für jede Seite, stehen unter
**Einstellungen → Alle gespeicherten Konfigurationen**.

## Exportieren

**Konfiguration exportieren** lädt die aktuelle Einrichtung stattdessen als JSON-Datei
herunter. Es sind dieselben Daten, die der Companion erhält, und sie lassen sich gut an
einen Fehlerbericht anhängen.

## Die Ausgabe eines Laufs speichern

Nach einem erfolgreichen Lauf legt **Output speichern** auf dem Fertig-Bildschirm die
ausgelesenen Daten ab und verknüpft sie mit einer gespeicherten Konfiguration. Hat die
Seite noch keine, lässt dich derselbe Dialog in einem Schritt eine anlegen. Jede
gespeicherte Konfiguration hat dann eine Liste **Outputs**, in der du frühere Ausgaben
**Herunterladen** oder **Löschen** kannst und gegen die du **Sicherheitsprüfungen
testen** kannst (siehe [Überwachung](monitoring.md)).

## Konfigurationen kombinieren

Gespeicherte Konfigurationen sind auch die Bausteine des
[Kombiniert-Modus](modes.md#kombiniert): Wähle mehrere, von beliebigen Seiten, für ein
Skript.
