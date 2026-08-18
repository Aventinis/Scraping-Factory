---
name: bug-workflow
description: Für Bugfixes, z.B. "behebe Bug X", "Fehler XY tritt auf", "fix issue".
---

## Vorbereitung
1. Wechsle zu `dev`, `git pull`
2. Analysiere zunächst die Ursache: relevante Codepfade,
   letzte Änderungen (`git log -p`), Stacktraces.
   Wenn die Ursache unklar ist: frage aktiv nach Logs,
   Fehlermeldungen oder Reproduktionsschritten, bevor du
   Code änderst.
3. Erstelle Branch `bug/<kurzname>`

@../_shared/workflow-base.md
