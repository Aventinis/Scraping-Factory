<!-- source: 80d46ab74abd -->
# Konten und Zugangsschlüssel

Standardmäßig hat der Companion keine Anmeldung: Er ist für eine Person auf einem Rechner
gedacht. Teilen sich mehrere Personen einen Companion (typischerweise auf einem Server,
mit einer gemeinsamen Datenbank), kann der Betreiber die Authentifizierung einschalten,
sodass jede und jeder nur die eigenen gespeicherten Konfigurationen, Ausgaben,
Ausgabe-Layouts und Vorlagen sieht.

Du brauchst hier nichts, wenn du Scraping Factory für dich allein betreibst.

## Einen gemeinsamen Companion benutzen

Öffne **Einstellungen** (das Zahnrad). Je nachdem, wie der Betreiber alles eingerichtet
hat, siehst du einen oder beide dieser Bereiche:

- **Konto**: **Anmelden**, oder **Registrieren**, wenn der Betreiber es erlaubt. Dein
  Passwort geht nur an deinen Companion — dieser Browser behält nur ein widerrufbares
  Token für das Gerät; nutze also einen Companion über `https://` oder einen auf diesem
  Computer. Passwörter müssen mindestens 10 Zeichen lang sein. Die Anmeldung gibt diesem
  Browser ein eigenes Token, sodass **Abmelden** nur dieses Gerät betrifft; **Überall
  abmelden** beendet die Sitzung jedes Geräts.
- **Zugangsschlüssel (gemeinsamer Companion)**: Füge einen Schlüssel ein, den dir der
  Betreiber gegeben hat (`sf_…`), und klicke auf **Speichern und testen**. Die Antwort
  lautet *Verbunden als <Name>*. Der Schlüssel wird nur gebraucht, wenn dein Companion
  einen verlangt, und er wird in diesem Browser gespeichert.

Verlangt der Betreiber eine bestätigte E-Mail-Adresse, gib die Adresse bei der
Registrierung ein und tippe den 8-stelligen Code ein, der dir per Mail geschickt wird.
**Passwort vergessen?** sendet einen Code an deine *bestätigte* Adresse.

## Für Betreiber

Das Installationsprogramm und die Kommandozeile des Companions richten das ein — siehe die
`INSTALL.md` im Paket (`--enable-auth`, `--registration open`, `--tls-cert`, `--smtp-host`
und die Befehle `user add|list|rotate|remove|disable|enable|set-password|adopt`).
Passwörter und Zugangsschlüssel werden nur als Hashes gespeichert; ein Companion, der von
anderen Rechnern erreichbar ist, muss HTTPS verwenden.
