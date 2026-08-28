## Shared process (after branch creation)

1. Develop the feature. Commit related changes in small, thematically clear steps (Conventional Commits, e.g. `feat: ...`, `fix: ...`)
2. Write tests for the new feature
3. Test the feature
4. Only if all tests pass: `git push`
5. Open a pull request against `dev` via `gh pr create` with a meaningful title and description
6. NEVER merge it yourself and do not request the merge — approval is the user's decision alone
