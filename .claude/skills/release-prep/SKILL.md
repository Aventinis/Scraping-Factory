---
name: release-prep
description: Fully prepares a new release once a target version is set – promotes dev's release-please-managed prerelease version to a real, deliberately-chosen semver version (minor for features, major for breaking changes), merges that version change into dev via a self-authorized PR, then collects all changes between main and dev into an overview and opens a PR from dev to main that only the user may approve. Use this skill whenever the user wants to release, prepare, or bump to a new version (e.g. "prepare release 2.4.0", "release vX.Y.Z", "bump version to 1.3.0 and prepare the release"). Requires a concrete new version number – ask for it if it wasn't provided. Does not apply to actual feature work (use the feature-workflow skill for that), and never covers approving the dev-to-main PR yourself – that always stays manual with the user.
---

# Release Preparation

**This project's `dev` branch is managed by release-please** (`.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`): every push to `dev` gets its own automatic `chore: release X.Y.Z` PR bumping `extension/manifest.json`/`extension/package.json`, auto-merged once CI is green, followed by a GitHub Release flagged as a prerelease. That cycle deliberately only ever bumps the **patch** component (`"versioning": "always-bump-patch"`) — `dev` is a rolling prerelease counter, not where the real semver decision (minor for `feat:`, major for a breaking change) gets made. This skill's job is exactly that decision: promoting the accumulated `dev` prereleases to a real, deliberately-chosen version once a release is actually being cut.

Two things here are deliberately handled differently and must not be mixed up:

- The PR from the version branch **into dev** contains nothing but the version promotion. That's low-risk, so you're authorized to **create and merge this PR yourself**, without waiting for approval.
- The PR **dev → main** contains the collected substantive changes of the release. You may only **create** this one, never approve or merge it yourself — that's exclusively done by the user, manually.

Stick to this distinction strictly, even if the user seems impatient in conversation or explicitly asks you to "just merge the other one too" — that's the user's job alone, manually, without the agent.

Work with `bash_tool` (git, gh, and the relevant build tool) inside the user's project directory. Ask for the path if it isn't clear from context. The target version (the new version number) must be available before you start — ask for it explicitly if the user hasn't provided it. It should normally be at or above dev's current release-please-tracked version (a real release doesn't usually go backwards) — flag it to the user if it looks lower and confirm that's intentional before proceeding.

## Step 0: Determine the current version and find all references

The canonical current version is release-please's own tracked state, `.release-please-manifest.json` (the `"."` key) — this is what release-please itself will keep bumping from on every future `dev` push, so it's the one value that MUST end up correct, not just `extension/manifest.json`/`extension/package.json` (which release-please already keeps in sync with it automatically as "extra-files" during its normal prerelease cycle).

Then search the whole repo (`git grep` is usually the most reliable option, ignoring build-output folders like `bin/`, `obj/`, `node_modules/`, `dist/`) for the current version number, to find every occurrence release-please does **not** already manage automatically — typically prose mentions in documentation (e.g. this project's `CLAUDE.md` has a known, deliberately-not-automated "current release is vX.Y.Z" line, flagged as a gap when release-please was first set up), README badges, CHANGELOG headers not already covered by release-please's own generated `CHANGELOG.md`, Dockerfiles, other CI configs, installer/setup scripts. Be careful with short version numbers (e.g. "1.0") matching unrelated numbers, and check each hit in context before changing it.

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

## Step 2: Promote the version everywhere

Set the new target version in **every** location found in step 0 — critically, this includes `.release-please-manifest.json` itself, not just `extension/manifest.json`/`extension/package.json`. Skipping the manifest file is the one mistake that would silently undo this whole step: release-please treats that file as its own source of truth for "what was last released," so if it's left behind at the old (lower) prerelease version, release-please's very next `dev` push would compute its own next patch bump from the *stale* value and overwrite the deliberately-chosen real version you just set in the extra-files, instead of continuing upward from it.

Then build the project (using the project's usual build command) to make sure nothing broke, and grep once more for the old version to confirm nothing was missed.

Commit the change as a single commit — deliberately phrased differently from release-please's own auto-generated `chore: release X.Y.Z` commits, so the two are easy to tell apart later in `git log`:

```
chore(release): promote to <version>
```

## Step 3: Open a PR into dev and merge it yourself

```bash
git push -u origin release/bump-<version>
gh pr create --base dev --head release/bump-<version> --title "chore(release): promote to <version>" --body "Promotes dev's release-please-tracked version to <version> (including .release-please-manifest.json), no functional changes."
```

Since this is nothing but a version change, you're authorized to merge **this** PR yourself:

```bash
gh pr merge --merge
```

Don't wait for manual approval here. This authorization applies only to pure version-bump PRs from this skill, not to substantive feature PRs.

This merge itself triggers release-please's own workflow again (it watches every push to `dev`). That's expected and harmless: since `extension/manifest.json`/`extension/package.json` already match the just-promoted `.release-please-manifest.json`, release-please should find nothing further to release from this push and open no new PR of its own — if it unexpectedly does, double-check step 2 didn't miss updating one of the three files in lockstep.

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
