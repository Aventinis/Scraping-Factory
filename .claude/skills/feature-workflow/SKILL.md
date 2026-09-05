---
name: feature-workflow
description: End-to-end workflow for implementing a new feature in a software project with Git – syncing with origin/dev, creating a feature branch, getting the plan approved, committing incrementally, running the auto-detected test suite, updating docs, and finally opening a pull request via the GitHub CLI. Language/stack-agnostic (e.g. C#/.NET, TypeScript/Node, Python, Java, Go, Rust) – the agent detects build and test tooling from the project files. Always use this skill when the user asks to implement a new feature, capability, or extension in one of their projects – even if they don't explicitly say "skill", "workflow", or "branch", e.g. just "build me feature X" or "implement XY". Does not apply to pure bugfixes without a new feature, pure refactors, or one-line changes, unless the user explicitly refers to this process.
---

# Feature Workflow

This skill captures the fixed process the user relies on for implementing new features in their projects, regardless of language or tech stack. The value of the process comes from every step staying traceable: a clean starting point, an approved plan, small traceable commits, verified tests, up-to-date docs, and a PR a reviewer can understand without follow-up questions. Stick to the order — each step builds on the previous one, and skipping one makes the next unreliable (e.g. tests on unplanned code, or a PR without a traceable history).

Work exclusively with the `bash_tool` (git, the relevant build/test tool, gh) inside the user's project directory. Ask for the path to the project/repo if it isn't clear from context.

## Step 0: Detect project tooling

Before building or testing anything, look at the project structure and identify the language/stack along with the matching commands, instead of guessing or assuming a single tool by default. Typical signals:

- `.csproj` / `.sln` → .NET (`dotnet build`, `dotnet test`)
- `package.json` → Node/TypeScript (check the scripts section, e.g. `npm run build`, `npm test`; test framework is usually in devDependencies, e.g. Jest, Vitest)
- `pom.xml` / `build.gradle` → Java/Kotlin (`mvn test` or `./gradlew test`)
- `requirements.txt` / `pyproject.toml` → Python (`pytest`, possibly `poetry run pytest`)
- `go.mod` → Go (`go build ./...`, `go test ./...`)
- `Cargo.toml` → Rust (`cargo build`, `cargo test`)

If a CI configuration already exists (e.g. `.github/workflows/`), read the actual build/test commands from there instead of reinventing them. If a repo has multiple stacks (e.g. backend + frontend), keep track of which tooling belongs to which part of the feature.

## Step 1: Sync the repo

```bash
git fetch origin
git checkout dev
git pull origin dev
```

Check beforehand (`git status`) whether there are uncommitted local changes that could block the checkout, and flag them to the user instead of silently discarding them (no `git reset --hard` or `git clean` without asking first).

## Step 2: Create the feature branch

Derive a short, descriptive branch name from the feature name, in the format `feature/featurename` (lowercase, hyphens instead of spaces, e.g. `feature/csv-export`). If the user already specified a name, use it instead of inventing your own.

```bash
git checkout -b feature/<featurename>
```

## Step 3: Make sure you understand the feature

Before planning or implementing anything, summarize in your own words what the feature should do, and identify gaps: unclear acceptance criteria, affected components/layers, edge cases, UI vs. pure logic, impact on existing APIs/data models. Take a look at the project structure (similar to step 0, plus the folder layout and any existing similar features) so your questions are concrete rather than generic.

Ask as many follow-up questions as needed, but bundle them into a single message instead of asking one at a time. Only move on to step 4 once the feature is clear enough to write a concrete plan. For a trivial, unambiguously described feature, follow-up questions can be skipped — don't force them artificially.

## Step 4: Write a plan and get it approved

Write a concise, concrete implementation plan — not a wall of prose, but something the user can skim and approve in a minute or two. Useful elements typically include:

- Affected projects/folders/modules/classes (new and changed)
- Rough implementation flow, broken into actionable sub-steps if useful
- Impact on existing interfaces, data models, or behavior
- Any open assumptions you made

**Wait for explicit approval from the user before starting step 5.** This is the most important checkpoint in the whole workflow — a wrong plan that's already been implemented costs far more time than a short question up front. If the user wants changes to the plan, revise it and have them confirm again.

## Step 5: Implement with frequent commits

Implement the feature according to the approved plan. Commit in the smallest logically complete increments possible (e.g. after each new class/function, each working intermediate state) instead of bundling everything into one commit at the end — that's the whole point of this step: a traceable history where individual changes can later be reviewed or rolled back in isolation.

Use Conventional Commits for commit messages, **in English** (even though the conversation with the user is in German) — this keeps the git history consistent for international readers and tooling. Examples:

```
feat(csv-export): add CsvExportService with basic mapping
feat(csv-export): wire export button in UI
refactor(csv-export): extract column mapping into own class
```

Make sure the project still builds after every commit (using the build command identified in step 0) — a broken intermediate state in the history isn't the end of the world, but it should be the exception, not the rule.

## Step 6: Write tests, run them, fix bugs

Write tests for the new behavior (happy path and relevant edge cases) using the test framework already established in the project (see step 0) — don't invent a new test structure or framework when one is already in place. Follow the layout of existing test files/folders in the repo.

Run the tests with the matching command (e.g. `dotnet test`, `npm test`, `pytest`, `go test ./...`, `cargo test`, `mvn test`).

If tests fail: fix the underlying bug in the feature code (don't bend the test to make it pass, unless the test itself was wrong), and commit the fix and the test separately or together — whichever makes the history clearer. Repeat until the test suite passes cleanly.

Commit the tests with Conventional Commits in English too, e.g. `test(csv-export): cover empty dataset edge case`.

## Step 7: Update documentation

Update the documentation relevant to the project — e.g. README, doc comments on new public functions/classes (in the idiom of the respective language, e.g. XML doc comments for C#, JSDoc for TypeScript, docstrings for Python), and the CHANGELOG if one exists. Check which documentation conventions already exist in the project (including the language used) instead of introducing new ones. Commit this separately with an English commit message, e.g. `docs(csv-export): document CsvExportService usage`.

## Step 8: Open a pull request against dev

Push the branch and create the PR automatically via the GitHub CLI. The title and body must be written **in English**, regardless of the language of the conversation with the user — for the same reason as the commits: PRs are often read by a broader, potentially international audience.

```bash
git push -u origin feature/<featurename>
gh pr create --base dev --head feature/<featurename> --title "<short, descriptive title>" --body "<see structure below>"
```

The PR body should consist of exactly two parts:

1. **Short description** of the change — what was built and why, without repeating the individual commits.
2. **Concrete test steps** — a numbered set of instructions a reviewer can follow to manually verify the feature (preconditions, steps, expected result).

Example structure (in English):

```markdown
## Description
Short paragraph on what the feature does and which problem it solves.

## Test steps
1. ...
2. ...
3. Expected result: ...
```

Share the PR URL with the user once it's created (`gh pr create` prints it in its output).
