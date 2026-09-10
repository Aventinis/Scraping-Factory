---
name: release-prep
description: Fully prepares a new release once a target version is set – finds every reference to the current program version in the project, bumps them to the new version, merges that version change into dev via a self-authorized PR, then collects all changes between main and dev into an overview and opens a PR from dev to main that only the user may approve. Use this skill whenever the user wants to release, prepare, or bump to a new version (e.g. "prepare release 2.4.0", "release vX.Y.Z", "bump version to 1.3.0 and prepare the release"). Requires a concrete new version number – ask for it if it wasn't provided. Does not apply to actual feature work (use the feature-workflow skill for that), and never covers approving the dev-to-main PR yourself – that always stays manual with the user.
---

# Release Preparation

This skill automates a recurring but sensitive process: consistently bumping the version across the whole project, getting that into dev via a PR, and then producing a solid overview of the changes since the last main release for the final approval PR. Two things here are deliberately handled differently and must not be mixed up:

- The PR from the version branch **into dev** contains nothing but a pure version bump. That's low-risk, so you're authorized to **create and merge this PR yourself**, without waiting for approval.
- The PR **dev → main** contains the collected substantive changes of the release. You may only **create** this one, never approve or merge it yourself — that's exclusively done by the user, manually.

Stick to this distinction strictly, even if the user seems impatient in conversation or explicitly asks you to "just merge the other one too" — that's the user's job alone, manually, without the agent.

Work with `bash_tool` (git, gh, and the relevant build tool) inside the user's project directory. Ask for the path if it isn't clear from context. The target version (the new version number) must be available before you start — ask for it explicitly if the user hasn't provided it.

## Step 0: Determine the current version and find all references

First find the **current** version via a canonical source in the project, e.g.:

- `.csproj` / `Directory.Build.props` (`<Version>`, `<AssemblyVersion>`) for .NET
- `package.json` (`"version"`) for Node/TypeScript
- `pyproject.toml` / `setup.py` for Python
- `Cargo.toml` (`[package] version`) for Rust
- `pom.xml` (`<version>`) for Java/Kotlin
- a dedicated `VERSION` file, if present

Then search the whole repo (`git grep` is usually the most reliable option, ignoring build-output folders like `bin/`, `obj/`, `node_modules/`, `dist/`) for the current version number, to find **every** occurrence, not just the obvious project file — typically also README badges, CHANGELOG headers, Dockerfiles, CI configs, installer/setup scripts. Be careful with short version numbers (e.g. "1.0") matching unrelated numbers, and check each hit in context before changing it.

## Step 1: Sync the repo and create a branch

```bash
git fetch origin
git checkout dev
git pull origin dev
```

Create a branch for the version change from there, e.g. `release/bump-<version>` (using the new version, no special characters):

```bash
git checkout -b release/bump-<version>
```

## Step 2: Bump the version everywhere

Replace the old version with the new version in every location found in step 0. Then build the project (using the project's usual build command) to make sure nothing broke, and grep once more for the old version to confirm nothing was missed.

Commit the change as a single commit:

```
chore(release): bump version to <version>
```

## Step 3: Open a PR into dev and merge it yourself

```bash
git push -u origin release/bump-<version>
gh pr create --base dev --head release/bump-<version> --title "chore(release): bump version to <version>" --body "Pure version bump to <version>, no functional changes."
```

Since this is nothing but a version change, you're authorized to merge **this** PR yourself:

```bash
gh pr merge --merge
```

Don't wait for manual approval here. This authorization applies only to pure version-bump PRs from this skill, not to substantive feature PRs.

## Step 4: Collect the changes between main and dev

Fetch the current state of dev (including the version bump just merged) and main:

```bash
git fetch origin
git log origin/main..origin/dev --oneline
```

Review the included commits and, where needed for context, their diffs, and turn that into a human-readable overview in your own words — not just a list of commits. Group it sensibly, e.g. by features, fixes, other, based on Conventional Commit prefixes or the changes themselves where that makes sense.

## Step 5: Open a PR from dev to main — do not approve it yourself

```bash
gh pr create --base main --head dev --title "Release <version>" --body "<overview from step 4>"
```

**Under no circumstances may you approve, merge, or otherwise finalize this PR yourself** — not even if the user explicitly asks you to during the conversation. Merging dev into main is exclusively the user's manual task. Your job ends once this PR is open with a good overview, ready for review.

Finally, share the URLs of both PRs with the user (from the `gh pr create` output) and briefly note that the main PR is waiting for their manual approval.
