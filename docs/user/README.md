# Scraping Factory — user documentation

Scraping Factory is a browser extension that lets you build a web scraper by
clicking on the page. The result is a plain, readable **Python script** you can
run yourself, on a schedule, wherever you like. You do not need to know how to
program.

This documentation is for people *using* the extension. (Developers: see
[`CLAUDE.md`](../../CLAUDE.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md).)

> The documentation is written in English first; a German version will follow.
> The extension itself speaks German, English and Spanish.

## Where to start

| If you want to… | Read |
| --- | --- |
| Install Scraping Factory and build your first scraper | [Getting started](getting-started.md) |
| Scrape lists of items, nested lists, or JSON APIs | [Scraping modes](modes.md) |
| Scrape pages that need JavaScript, a login or scrolling | [Browser engine and actions](browser-engine.md) |
| Follow "next page" links or numbered pages | [Pagination](pagination.md) |
| Clean up values (prices, whitespace, dates) | [Transforms and presets](transforms.md) |
| Get warned when a scheduled scraper breaks | [Hardening and monitoring](monitoring.md) |
| Reuse a setup for a site you scrape repeatedly | [Saved configurations](saved-configurations.md) |
| Choose CSV, JSON, SQLite or Excel, or fix column names | [Output formats and blueprints](output.md) |
| Be polite to a site: pauses, retries, headers, proxies, robots.txt | [Network settings](network-settings.md) |
| Share one companion between several people | [Accounts and access keys](authentication.md) |
| Fix a problem | [Troubleshooting and FAQ](troubleshooting.md) |

## How it works, in one paragraph

The extension has two parts. The **extension** in your browser is where you
click and configure. The **companion** is a small program on your computer that
turns your configuration into a Python script and — before handing it to you —
*runs it once* against the real page. A script that fails or finds no data is
rejected with an explanation instead of being given to you. Everything stays on
your machine; there is no cloud service.

## Conventions used in these pages

- **Bold** names are labels you see in the extension, written the way the
  English interface shows them.
- Most pages have a **Try it yourself** box. It uses a small fixture page from
  the repository's `test-pages/` folder, so you can follow along without
  touching a real website. Start the fixture used on a page with the command
  shown there; the extension is then pointed at the page that opens.
- Screenshots live in [`images/`](images/) and are generated, not hand-made —
  see [Maintaining these docs](#maintaining-these-docs).

## Maintaining these docs

Contributors: a pull request that changes what a user sees or does must update
the matching page here (and its screenshots), the same way it already updates
`CLAUDE.md` and `docs/ARCHITECTURE.md`.

The screenshots are produced by driving the real extension against the
fixtures, so they never go stale by accident:

```bash
cd e2e && npm install            # once
node e2e/screenshots/run.js      # regenerate every screenshot
node e2e/screenshots/run.js --only modes      # just the scenarios whose id contains "modes"
node e2e/screenshots/run.js --theme dark      # same scenes in dark mode
node e2e/screenshots/run.js --list            # list scenario ids
node e2e/screenshots/check-docs.js            # verify every image and link in these pages exists
```

Scenarios live in `e2e/screenshots/scenarios/`; each one names a fixture, the
clicks to reach a screen, and the image to save. To add a screenshot to a page,
add (or extend) a scenario, run it, and reference
`images/<name>.png` from the page. Pages use stable headings, because the
extension will link to them.
