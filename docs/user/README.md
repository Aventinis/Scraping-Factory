# Scraping Factory — user documentation

Scraping Factory is a browser extension that lets you build a web scraper by
clicking on the page. The result is a plain, readable **Python script** you can
run yourself, on a schedule, wherever you like. You do not need to know how to
program.

This documentation is for people *using* the extension. (Developers: see
[`CLAUDE.md`](../../CLAUDE.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md).)

> This documentation is available in English (the source) and in German:
> [Deutsche Version](de/README.md). The extension itself speaks German, English
> and Spanish; the **Learn more** links open the German pages when the panel is
> set to German, and the English pages otherwise.

## Where to start

| If you want to… | Read |
| --- | --- |
| Install Scraping Factory and build your first scraper | [Getting started](getting-started.md) |
| Scrape lists of items, nested lists, or JSON APIs | [Scraping modes](modes.md) |
| Scrape pages that need JavaScript, a login or scrolling | [Browser engine and actions](browser-engine.md) |
| Follow "next page" links or numbered pages | [Pagination](pagination.md) |
| Clean up values (prices, whitespace, dates) | [Transforms and presets](transforms.md) |
| Get warned when a scheduled scraper breaks | [Safety checks and alerts](monitoring.md) |
| Reuse a setup for a site you scrape repeatedly | [Saved configurations](saved-configurations.md) |
| Choose CSV, JSON, SQLite or Excel, or fix column names | [Output formats and output layouts](output.md) |
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

## Where these pages live

On GitHub they are rendered from `docs/user/` (English) and `docs/user/de/`
(German). Inside the extension they ship as HTML pages (built from these same
files when the extension is built) that the **Learn more** links in the side panel
open in a browser tab — offline, no external address involved. Each page links to
its twin in the other language. The release bundles also contain the Markdown files
and images in their `docs/` folder.

## Maintaining these docs

Contributors: a pull request that changes what a user sees or does must update
the matching page here (and its screenshots), the same way it already updates
`CLAUDE.md` and `docs/ARCHITECTURE.md`.

**Translations.** The English pages are the source. `docs/user/de/<page>.md` is the
German version with the same file name and **the same heading structure** (the panel
finds the German heading of a "Learn more" link by position, so a page must not gain
or lose a heading in only one language). Use the German labels from
`extension/i18n/de.json` for everything the extension shows, and address the reader
as *du*, like the interface. After translating or updating a page, stamp it with the
hash of its English source, so a later change to the English page shows up as stale:

```bash
node extension/docs-build.js --stamp monitoring      # writes <!-- source: … --> into de/monitoring.md
node e2e/screenshots/run.js --language de            # German screenshots into de/images/
node e2e/screenshots/check-docs.js                   # lists missing, unstamped and stale translations
```

`check-docs.js` reports a German page whose English source changed since it was
stamped (`--strict` turns that into a failure) and fails on a different heading
structure. A page without a German version is fine — the panel falls back to English.

The screenshots are produced by driving the real extension against the
fixtures, so they never go stale by accident:

```bash
cd e2e && npm install            # once
node e2e/screenshots/run.js      # regenerate every screenshot
node e2e/screenshots/run.js --only modes      # just the scenarios whose id contains "modes"
node e2e/screenshots/run.js --theme dark      # same scenes in dark mode
node e2e/screenshots/run.js --language de     # the German interface (images go to de/images/)
node e2e/screenshots/run.js --list            # list scenario ids
node e2e/screenshots/check-docs.js            # verify every image and link in both languages
```

A new **Learn more** link in the extension needs a key in
`extension/popup/docs-links.ts` that points at a page and heading here — renaming
a heading that a link uses makes that file's test fail until the key is updated.
Keep the extension itself to one title per control: the explanation goes behind its **?**
(a `help.<area>.<field>` text with `data-doc` for the link), the details on the page.

Scenarios live in `e2e/screenshots/scenarios/`; each one names a fixture, the
clicks to reach a screen, and the image to save. To add a screenshot to a page,
add (or extend) a scenario, run it, and reference
`images/<name>.png` from the page. Pages use stable headings, because the
extension links to them.
