# Scraping-Factory

A tool for building web scraping scripts right in your browser — no programming knowledge required.

The user selects elements on a web page by clicking, and Scraping Factory generates a standalone, readable **Python script** (`requests` + `BeautifulSoup`, or Playwright for dynamic pages) from that selection.

## Architecture

The project consists of two parts that communicate over a local HTTP server:

- **Browser extension** (Manifest V3) — runs in the browser's side panel (Chrome/Edge) or sidebar (Opera), lets you select elements on the page via hover/click
- **Companion app** (.NET 10) — a local server that builds an intermediate representation (IR) from the selection and generates the Python script from it

## Features (as of v1.5.0)

- Select elements via hover highlighting on the target page; the CSS selector is extracted automatically
- Field management in the side panel (add, name, inspect the selector via tooltip)
- Three configuration modes: flat fields, nested containers (repeating groups), and an API mode that finds the matching JSON API request for a clicked data point instead of scraping HTML
- Optional browser engine (Playwright + Chromium) for dynamically rendered pages and simple login flows, currently reachable only via the companion API (no extension UI yet)
- Generation of a standalone, commented Python scraping script and direct download — the companion app actually runs the generated script once as a trial before handing it out, so what you download is guaranteed to work against the page as configured
- Selection and UI state persist via session storage, even if the side panel is closed
- Structured logging in the content script, service worker, and side panel for troubleshooting

**Current scope limits:** no pagination, no persistent session/cookie handling across multiple runs, no CAPTCHA solving (a deliberate boundary, not a gap), and Python as the only target language. See `CLAUDE.md` for the full, up-to-date feature scope and known limitations.

## Directory Structure

```
extension/                  Browser extension (Manifest V3)
  background/               Service worker — message relay only
  content/                  Content script — DOM highlighting, selector extraction
  popup/                    Side panel UI

companion/                  .NET 10 solution
  ScrapingFactory.Companion/ Entry point — local HTTP server
  ScrapingFactory.Compiler/  IR types + language modules
    IR/ScrapingConfig.cs     Intermediate representation
    Backends/Python/         Python code generator
  ScrapingFactory.Tests/     Tests for the companion, compiler, and code generator

language-modules/
  python/templates/          Scriban templates for generated Python scripts
```

## Build & Test

```bash
# Build the .NET solution
dotnet build companion/ScrapingFactory.sln

# Run the .NET tests
dotnet test companion/ScrapingFactory.sln

# Run the extension tests
cd extension && npm test

# Load the extension (Chrome/Edge/Opera)
# Extension management → "Load unpacked" → extension/
```

**Known issue (Chrome/Chromium on Linux):** under tiling Wayland compositors (observed on Hyprland), native `<select>` dropdowns in the side panel can render mispositioned, off-screen. This looks like an upstream Chromium/Ozone-Wayland popup-positioning quirk rather than a bug in Scraping Factory — it wasn't reproducible in Opera on the same setup (possibly different Ozone/XWayland defaults, not confirmed). If you hit this, Opera is a working alternative that needs no extra setup.

For the full architecture map (system diagrams, feature → file index, cross-boundary
class relationships), see `docs/ARCHITECTURE.md`. For behavioral detail, edge cases,
and the reasoning behind design decisions, see `CLAUDE.md`.
