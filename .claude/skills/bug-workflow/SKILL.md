---
name: bug-workflow
description: For bug fixes. Triggers regardless of the request's language, e.g. "behebe Bug X", "Fehler XY tritt auf" (German) or "fix bug X", "error XY occurs", "fix issue" (English).
---

## Preparation
1. Switch to `dev`, `git pull`
2. First analyze the root cause: relevant code paths,
   recent changes (`git log -p`), stack traces.
   If the cause is unclear: actively ask for logs,
   error messages, or reproduction steps before
   changing any code.
3. Create branch `bug/<short-name>`

@../_shared/workflow-base.md
