# Scraping Factory

A browser extension that lets you build web scraping scripts visually — no
programming knowledge required. Click the data you want on a real web page, and
Scraping Factory generates a standalone, readable **Python script** for it
(`requests` + `BeautifulSoup`, or Playwright for pages that need real
JavaScript rendering). The generated script is actually run once against the
live page before it's handed to you, so what you download is proven to work,
not just plausible-looking generated code.

It's a free, non-commercial hobby project — no account, no paid third-party
services, no data collection.

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started)
- [Architecture, in brief](#architecture-in-brief)
- [Features](#features)
- [Build & test](#build--test)
- [Known issues](#known-issues)
- [Legal / disclaimer](#legal--disclaimer)
- [License](#license)

## What it does

The project has two parts that only ever talk to each other over a local HTTP
connection:

- **Browser extension** (Manifest V3, Chrome/Edge/Opera) — runs in the
  browser's side panel/sidebar. Hover and click elements on the page to select
  them; the extension figures out how to identify the same data again (a CSS
  selector, or a JSON path into a background API response it recorded).
- **Companion app** (.NET 10) — a small local server that turns your selection
  into a script, actually runs that script once as a trial against the live
  page/API, and only hands it back to you if that trial run succeeds and
  produces real data.

Three configuration modes cover different kinds of pages: flat fields, nested
repeating containers (e.g. a list of product cards), and an API mode that finds
the matching background JSON request for a value instead of scraping HTML at
all. See [Features](#features) below for what each of these — and everything
else the extension can do — actually covers.

## Getting started

You need two things running: the companion app (once, on your machine) and the
extension (loaded into your browser). They only need to be reachable from each
other over `localhost` — no account, no internet-facing service, nothing to
deploy.

> [!NOTE]
> Developed and tested on **Linux**. The stack itself (.NET 10, Python, a
> Chromium-based browser) is cross-platform, so **Windows and macOS are
> expected to work**, but neither has actually been verified yet — if you try
> it there, feedback (or a bug report) via GitHub issues is very welcome.

### 1. Run the companion app

Requirements:

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- Python 3 with `requests` and `beautifulsoup4` installed
  (`pip install requests beautifulsoup4`) — needed on whatever machine runs
  the companion app, since it actually executes the generated script as a
  trial run before handing it out
- Optional, only if you plan to use the **browser engine** (for dynamically
  rendered pages or login flows): `pip install playwright` followed by
  `playwright install chromium`

Then, from the repository root:

```bash
dotnet run --project companion/ScrapingFactory.Companion
```

By default it listens on `http://localhost:5000`. If that port is already
taken, or the companion runs on a different machine than the browser, see
`companion/ScrapingFactory.Companion/appsettings.json` (`Companion:Host`/
`Companion:Port`, also overridable via e.g. a `Companion__Port=5050`
environment variable) — the extension has a matching "point me at a different
address" screen if the default isn't reachable.

### 2. Load the browser extension

1. Open your browser's extension management page
   (`chrome://extensions`, `edge://extensions`, or Opera's equivalent).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory.
4. Click the extension's toolbar icon to open the side panel (Chrome/Edge) or
   sidebar (Opera).

The panel will check that it can reach the companion app on startup; if it
can't, it shows a screen to retry or enter a custom companion address.

Firefox was evaluated as a target but isn't currently supported (its
content-script injection and network-recording model didn't work as expected
for this extension's needs) — Chrome, Edge, and Opera are the supported
browsers.

## Architecture, in brief

```
extension/                  Browser extension (Manifest V3)
  background/               Service worker — message relay only
  content/                  Content script — DOM highlighting, selector/API extraction
  popup/                    Side panel UI (the actual state machine)

companion/                  .NET 10 solution
  ScrapingFactory.Companion/ Entry point — local HTTP server
  ScrapingFactory.Compiler/  IR types + language modules (code generation, verification)
  ScrapingFactory.Tests/     Tests for the companion, compiler, and code generator

language-modules/
  python/templates/          Scriban templates for generated Python scripts
```

The extension has three separate JavaScript execution contexts (a content
script on the page, a background service worker that's a pure message relay,
and the side panel UI itself), which only ever reach the companion app over a
plain `fetch()` call — `GET /health` on startup, `POST /generate` to turn a
configuration into a script.

On the companion side, every request goes through a fixed pipeline: the
extension's JSON payload is translated into a canonical internal representation
(a sequence of steps — navigate, extract, wait, fill, click, …), checked for
structural validity, turned into Python source by a code generator, and then —
this is the important part — **actually run once as a real subprocess** against
the live page/API before being returned. A run that errors, times out, or
produces no data is rejected with an explanation instead of being handed to you
as a script that might not work.

For the full system diagrams, a feature-to-file index, and the class/wire-format
relationships between the extension and the companion, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). For the reasoning behind
individual design decisions and edge cases, see [`CLAUDE.md`](CLAUDE.md).

## Features

### Flat field scraping

Click an element on the page, get a CSS selector automatically, name it, and
repeat — the original, simplest mode. Generates a CSV-producing script.

### Container mode (nested, repeating groups)

Lets you model repeating, nested structures on a page — e.g. a list of product
cards, each with its own sub-fields, possibly containing further nested lists —
as a tree of named "container" and "field" nodes, instead of one flat list of
fields. The generated script walks the same tree at runtime and writes the
result as XML instead of CSV, since a tree doesn't fit CSV's flat column model.

### API mode

Instead of scraping rendered HTML, records the page's own background JSON API
calls while you browse, lets you click a value you want and matches it against
the recorded responses to find which request produced it, then turns the
varying parts of that request's URL (query parameters, path segments) into
configurable parameters — each backed by a fixed value, a manually entered
list, a second "discovery" request, or a computed range (e.g. the last N ISO
weeks). The generated script calls the API directly, once per parameter
combination, without ever touching the HTML.

API mode also supports responses that nest more than one repeating level (e.g.
`categories → subcategories → products`, modeled as a tree the same way
Container mode is) and POST requests, including GraphQL — the outgoing request
body is captured and shown as an editable tree, where any value can be marked
"fixed" or "variable" and bound to a parameter, the same mechanism a URL
placeholder already uses. GraphQL needs no special handling of its own; its
`query`/`variables` body is just an ordinary nested object.

### Browser engine, browser actions & login flows

An optional Playwright-based rendering engine (real Chromium, executes the
page's own JavaScript) is available as an alternative to the default,
JS-free static engine, for pages whose content only appears after client-side
rendering. On top of that, a generic, ordered list of "browser actions" — wait
for an element, fill a form field, click, or scroll/click a "load more" button —
lets you assemble things like a login flow (fill username/password → click
submit → wait for the result) or trigger lazy-loaded content, all executed
once before extraction runs. Login credentials are only ever read from
environment variables at script runtime, never embedded in the generated
script.

### Trial-run verification

Before handing a generated script to you, the companion actually runs it once
for real — as a subprocess, against the live page/API, in a throwaway
directory — and only returns it if it exits cleanly and produces at least one
row (or XML element). This is the core guarantee of the whole tool: what you
download is proven to work right now, not just generated code that looks
plausible.

### Trial-run data preview

An opt-in checkbox that lets you see a capped sample (up to 50 rows/elements)
of what the trial run above actually scraped — a table for flat/CSV output, a
read-only XML snippet for tree output — directly in the popup, before ever
downloading or running the script yourself.

### robots.txt check

A one-click check of whether the currently inspected page is allowed or
disallowed for generic crawlers according to the target site's own robots.txt —
shown directly in the popup so you can make an informed decision before
scraping a site, without having to go look the file up yourself.

### Companion URL configuration

Lets the extension find, and if needed be manually pointed at, the companion
app's local HTTP server address — needed when the default `localhost:5000` is
already taken on your machine, or when the companion runs on a different port
or even a different host than the browser.

### Multi-language UI

The popup's own display language (German/English/Spanish) can be switched from
a dropdown, independently of the browser's own UI language.

### Bug reporting / structured logging

Collects the recent activity log kept by all three extension contexts (content
script, service worker, popup) into one downloadable and shareable report, and
can pre-fill a GitHub issue with it — so a bug can be diagnosed from what
actually happened, without you needing to reproduce it live or describe it
from memory.

### DOM tree view & live selection preview

Two related, optional aids for building a configuration: an expandable tree
view of the page's own DOM shown inside the popup (helps locate an element
without hunting through devtools), and a "preview" toggle that highlights,
directly on the live page, every element the *current* configuration actually
matches right now — so a wrong or too-broad selector is visible immediately,
without running a full trial.

### Configuration export

Downloads the current configuration as a JSON file — byte-for-byte the same
request body the companion app would receive — so you can attach your exact
setup to a bug/selector report instead of describing it by hand.

### Configurable script/output filenames

Lets you choose the downloaded script's filename and the name of the data file
the generated script writes (instead of always `scraper.py`/`output.csv`).

### Cross-frame (iframe) selector support

Lets a selector target an element that lives inside a (possibly cross-origin)
iframe — e.g. a cookie-consent button or an SSO login widget — by recording the
chain of iframe selectors from the top document down to the target frame, so
the generated Playwright script can reach the same element later. Only applies
to the browser engine; the static engine has no concept of frames at all.

### Current scope limits

No pagination, no persistent session/cookie handling across multiple runs (each
run starts fresh), no CAPTCHA solving (a deliberate boundary, not a gap — see
[`CLAUDE.md`](CLAUDE.md)), and Python as the only target language for now (the
architecture is designed to support more later).

## Build & test

```bash
# Build the .NET solution
dotnet build companion/ScrapingFactory.sln

# Run the .NET tests
dotnet test companion/ScrapingFactory.sln

# Run the extension tests
cd extension && npm install && npm test
```

## Known issues

**Chrome/Chromium on Linux, under tiling Wayland compositors** (observed on
Hyprland): native `<select>` dropdowns in the side panel can render
mispositioned, off-screen. This looks like an upstream Chromium/Ozone-Wayland
popup-positioning quirk rather than a bug in Scraping Factory — it wasn't
reproducible in Opera on the same setup. If you hit this, Opera is a working
alternative that needs no extra setup.

## Legal / disclaimer

Scraping Factory is a free, general-purpose tool for extracting data from web
pages and JSON APIs you point it at. Like any such tool, **what you do with it
is your responsibility, not the project's**:

- You are responsible for complying with the target site's terms of service,
  robots.txt (the extension can check this for you — see
  [Features](#features) — but doesn't enforce it), and any applicable law in
  your jurisdiction (e.g. data-protection law such as the GDPR, if the data
  you scrape includes personal data).
- The generated scripts make real HTTP requests to whatever URL you configure.
  Neither the extension nor the companion app validate that you're authorized
  to access that URL, or that doing so is legal — that's not something a
  generic tool can determine on your behalf.
- The software is provided **as-is, with no warranty of any kind** — see
  `LICENSE` (MIT) for the full, legally-binding text. In particular, there is
  no guarantee that a generated script will keep working if the target site
  changes, and no liability for any consequences of using this project or
  scripts it generates.

If you find a security vulnerability in the extension or companion app itself
(as opposed to "a website's terms of service disagree with scraping it"), see
[`SECURITY.md`](SECURITY.md) for how to report it responsibly.

## License

[MIT](LICENSE). Third-party components and their licenses are listed in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
