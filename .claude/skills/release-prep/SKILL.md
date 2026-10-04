---
name: release-prep
description: Fully prepares a new release once a target version is set – promotes dev's release-please-managed prerelease version to a real, deliberately-chosen semver version (minor for features, major for breaking changes), merges that version change into dev via a self-authorized PR, then collects all changes between main and dev into an overview and opens a PR from dev to main that only the user may approve. Use this skill whenever the user wants to release, prepare, or bump to a new version (e.g. "prepare release 2.4.0", "release vX.Y.Z", "bump version to 1.3.0 and prepare the release"). Requires a concrete new version number – ask for it if it wasn't provided. Does not apply to actual feature work (use the feature-workflow skill for that), and never covers approving the dev-to-main PR yourself – that always stays manual with the user.
---

# Release Preparation

**This project's `dev` branch is managed by release-please** (`.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`): every push to `dev` gets its own automatic `chore: release X.Y.Z` PR bumping `extension/manifest.json`/`extension/package.json`, auto-merged once CI is green, followed by a GitHub Release flagged as a prerelease. That cycle deliberately only ever bumps the **patch** component (`"versioning": "always-bump-patch"`) — `dev` is a rolling prerelease counter, not where the real semver decision (minor for `feat:`, major for a breaking change) gets made. This skill's job is exactly that decision: promoting the accumulated `dev` prereleases to a real, deliberately-chosen version once a release is actually being cut.

Two things here are deliberately handled differently and must not be mixed up:

- The PR from the version branch **into dev** contains nothing but the version promotion (and the release-please PR it triggers is merged automatically by the existing workflow). That's low-risk, so you're authorized to **create and merge this PR yourself**, without waiting for approval.
- The PR **dev → main** contains the collected substantive changes of the release. You may only **create** this one, never approve or merge it yourself — that's exclusively done by the user, manually.

Stick to this distinction strictly, even if the user seems impatient in conversation or explicitly asks you to "just merge the other one too" — that's the user's job alone, manually, without the agent.

Work with `bash_tool` (git, gh, and the relevant build tool) inside the user's project directory. Ask for the path if it isn't clear from context. The target version (the new version number) must be available before you start — ask for it explicitly if the user hasn't provided it. It should normally be at or above dev's current release-please-tracked version (a real release doesn't usually go backwards) — flag it to the user if it looks lower and confirm that's intentional before proceeding.

## Step 0: Determine the current version and find all references

The canonical current version is release-please's own tracked state, `.release-please-manifest.json` (the `"."` key). It is kept in sync automatically with `extension/manifest.json`/`extension/package.json` (its "extra-files") and with a `vX.Y.Z` git tag/GitHub Release per version.

**Never set the new version by editing those files by hand.** release-please determines "the last release" from its own release tags, not from the manifest's content. A hand-edited version (`vX.Y.0` in the files, but no `vX.Y.0` tag) makes release-please's next `dev` run start from a much older tag. It then creates a bogus `X.Y.1` release PR with a changelog re-listing hundreds of old commits, and auto-merges it before anyone can react. This happened with both 1.16.0 (→ 1.16.1) and 1.17.0 (→ 1.17.1). Instead, the version is requested from release-please itself via a `Release-As:` commit footer (step 2), so it creates the release PR, tag and changelog for exactly that version.

Search the whole repo (`git grep`, ignoring `bin/`, `obj/`, `node_modules/`, `dist/`) for the current version number, to find the occurrences release-please does **not** manage: `CLAUDE.md`'s "the current release is vX.Y.Z" line and `extension/package-lock.json` (both `version` entries near the top), plus anything else that turns up (README badges, Dockerfiles, other CI configs, installer scripts). Be careful with short version numbers (e.g. "1.0") matching unrelated numbers, and check each hit in context. Leave `.release-please-manifest.json`, `extension/manifest.json`, `extension/package.json` and `CHANGELOG.md` alone — release-please updates those in step 4.

Also check that no release-please PR is currently open (`gh pr list --head release-please--branches--dev`). If one is, wait until its auto-merge has gone through before starting, so the promotion builds on the latest prerelease.

## Step 1: Sync the repo and create a branch

```bash
git fetch origin
git checkout dev
git pull origin dev
git checkout -b release/promote-<version>
```

## Step 2: Request the version from release-please

Update the unmanaged references from step 0 (`CLAUDE.md`, `extension/package-lock.json`, …) to the new version. Commit them as a single commit whose message carries the `Release-As` footer on its own line:

```bash
git commit -am "chore(release): promote to <version>" -m "Release-As: <version>"
```

Build/test as usual first (`dotnet build companion/ScrapingFactory.sln`, `cd extension && npx jest`) and grep once more to confirm no unmanaged reference was missed.

## Step 3: Open a PR into dev and merge it yourself

```bash
git push -u origin release/promote-<version>
gh pr create --base dev --head release/promote-<version> --title "chore(release): promote to <version>" --body "Requests release <version> from release-please (Release-As footer) and updates the references release-please doesn't manage. No functional changes."
gh pr merge --merge --auto
```

`dev` is branch-protected (required CI checks, branch must be up to date), so a plain `gh pr merge` is refused until CI is green. Use `--auto`, never `--admin`. Use `--merge` (not squash), so the commit carrying the `Release-As` footer lands in `dev`'s history unchanged. You're authorized to merge **this** PR yourself — the authorization applies only to this skill's own version PRs, never to substantive feature PRs.

## Step 4: Let release-please create the release, then verify it

The merge triggers release-please (`.github/workflows/release-please.yml`). It opens `chore(dev): release <version>`, which bumps the manifest/extra-files and adds the changelog section, and auto-merges it once CI is green, which creates the `v<version>` tag and a prerelease. Wait for that to finish instead of polling with fixed sleeps, e.g.:

```bash
until gh release view v<version> >/dev/null 2>&1; do sleep 15; done
git fetch origin && git show origin/dev:.release-please-manifest.json
```

Then verify, and **stop and report to the user** if any check fails, instead of improvising a fix:
- the manifest, `extension/manifest.json` and `extension/package.json` on `dev` all say `<version>`
- the tag `v<version>` exists
- no further release-please PR (e.g. `<version>` + 1 patch) was opened right afterwards

The generated changelog section only lists commits since the last prerelease. That's fine — the dev → main PR in step 6 carries the full overview.

## Step 5: Collect the changes between main and dev

Fetch the current state of dev (including the release just created) and main:

```bash
git fetch origin
git log origin/main..origin/dev --oneline
```

Review the included commits and, where needed for context, their diffs, and turn that into a human-readable overview in your own words — not just a list of commits. Group it sensibly, e.g. by features, fixes, other, based on Conventional Commit prefixes or the changes themselves where that makes sense.

## Step 6: Open a PR from dev to main — do not approve it yourself

```bash
gh pr create --base main --head dev --title "Release <version>" --body "<overview from step 5>"
```

**Under no circumstances may you approve, merge, or otherwise finalize this PR yourself** — not even if the user explicitly asks you to during the conversation. Merging dev into main is exclusively the user's manual task. Your job ends once this PR is open with a good overview, ready for review.

Finally, share the URLs of both PRs with the user (from the `gh pr create` output) and briefly note that the main PR is waiting for their manual approval.
