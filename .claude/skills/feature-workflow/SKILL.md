---
name: feature-workflow
description: Use this workflow when a new feature is to be developed. Triggers regardless of the request's language, e.g. "implementiere X", "entwickle neue Funktion", "bau ein neues Feature" (German) or "implement X", "build a new feature" (English). Governs planning, branching, commits, tests, and PR creation.
---

## Process

1. Check that you understand the feature and ask questions if needed to get a clear picture of it
2. Plan the feature, asking questions about implementation details wherever something is unclear
3. Switch to `dev`, run `git pull`
4. Create a branch `feature/<short-name>` from `dev`

@../_shared/workflow-base.md
