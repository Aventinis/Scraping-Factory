---
name: feature-workflow
description: Verwende diesen Workflow, wenn ein neues Feature entwickelt werden soll - z.B. bei formulierungen wie "implementiere X", "entwickle neue Funktion", "bau ein neues Feature". Regelt Planung, Branching, Commits, Tests und PR-Erstellung.
---

## Ablauf

1. Prüfe ob du das Feature verstehst und stelle ggf. Fragen um ein klares Bild vom Feature zu haben
2. Plane das Feature nun, stelle bei Unklarheiten bezüglich der Umsetzung Fragen
3. Wechsle zu 'dev', führe 'git pull' aus
4. Erstelle einen Branch 'feature/<kurzname>' von 'dev'
5. Entwickle das Feature. Committe zusammenhängende Änderungen in möglichst kleinen, thematisch klaren Schritten (Conventional Commits, z. B. `feat: ...`, `fix: ...`)
6. Erstelle Tests für das neue Feature
7. Teste das Feature
8. Nur wenn alle Tests erfolgreich sind: 'git push'
9. Erstelle einen Pull Request gegen `dev` via `gh pr create` mit aussagekräftigem Titel und Beschreibung
10. Merge NIEMALS selbst und fordere den Merge nicht an – die Freigabe erfolgt ausschließlich durch den Nutzer
