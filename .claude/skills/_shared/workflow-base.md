## Gemeinsamer Ablauf (nach Branch-Erstellung)

1. Entwickle das Feature. Committe zusammenhängende Änderungen in möglichst kleinen, thematisch klaren Schritten (Conventional Commits, z. B. `feat: ...`, `fix: ...`)
2. Erstelle Tests für das neue Feature
3. Teste das Feature
4. Nur wenn alle Tests erfolgreich sind: 'git push'
5. Erstelle einen Pull Request gegen `dev` via `gh pr create` mit aussagekräftigem Titel und Beschreibung
6. Merge NIEMALS selbst und fordere den Merge nicht an – die Freigabe erfolgt ausschließlich durch den Nutzer
