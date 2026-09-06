# Security Policy

Scraping Factory is a free, hobby-maintained open-source project (see `LICENSE`).
There is no dedicated security team and no guaranteed response time, but
security reports are taken seriously and will be looked at as soon as possible.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Instead, report it privately via **[GitHub Security Advisories](../../security/advisories/new)**
for this repository ("Report a vulnerability" under the Security tab). This
keeps the report private until a fix is available, avoiding a public
zero-day window.

If you're unable to use GitHub Security Advisories, you can instead open a
regular GitHub issue titled only "Security issue — details sent privately"
with no technical details in it, and a maintainer will follow up to arrange a
private channel.

When reporting, please include:

- What component is affected (browser extension, companion app, or a specific
  generated script pattern)
- Steps to reproduce, or a minimal example configuration
- What you'd expect to happen vs. what actually happens
- Impact, as far as you can assess it (e.g. arbitrary code execution, data
  exfiltration, information disclosure)

## Scope

Roughly, in order of how seriously an issue in that area would be taken:

- The companion app's local HTTP server (`companion/`) — it's meant to only
  ever be reached from `localhost`/the same machine's browser, but binds to a
  configurable host/port (see `docs/ARCHITECTURE.md`), so anything that lets a
  *remote* origin trigger unintended behavior is a real concern.
- Code generation and the trial-run verifier (`PythonScriptVerifier`) — this
  runs a generated script as a real subprocess; anything that lets an
  attacker-controlled configuration escape the intended sandboxing (e.g.
  arbitrary command execution beyond running the generated script itself, or
  path traversal via the script/output filename) is high-severity.
- The browser extension's content script / MAIN-world network recorder — runs
  on every page the user visits; anything that lets a malicious *web page*
  read/write extension state it shouldn't be able to reach is a real concern.
- Generated scripts themselves running with unexpected side effects beyond
  what the user configured.

Out of scope: the fact that a *user* can configure Scraping Factory to scrape a
site they're not authorized to scrape, or that a generated script makes real
HTTP requests to arbitrary URLs the user typed in — that's the tool doing what
it's designed to do, not a vulnerability in it. See the "Legal / Disclaimer"
section in `README.md`.

## Supported versions

This project does not currently maintain multiple release branches — only the
latest released version (`main`/the most recent tag) receives fixes.
