# Troubleshooting and FAQ

## The panel says "Companion app unreachable"

![The companion-unreachable screen](images/troubleshooting-companion-unreachable.png)

The extension can't reach the companion. Until a companion has answered once on
this browser, the screen explains what it is and shows the three usual situations,
each with its next step (the installer command and program path are the ones for
your operating system); the situation that fits the failure best is marked
**Most likely**. Afterwards only a one-line hint is shown — the **?** next to
**Why can't it connect?** lists the usual causes in either case. In order:

1. Is the companion running? Open <http://localhost:5000/health> — you should
   see JSON. If not, start it (the installer's `--autostart` does this at login),
   or from a checkout: `dotnet run --project companion/ScrapingFactory.Companion`.
2. Is it on another port or machine? Enter its address under **Is the companion
   app running at a different address?** and click **Use this address**; **Reset
   to default address** goes back to `http://localhost:5000`.
3. Plain `http://` is only accepted for this machine; an address on another
   machine must use `https://`.

## "This companion requires an access key" / "access key is not valid"

The companion has authentication turned on. Open **Settings** and sign in, or
paste your key under **Access key** and **Save and test**. See
[Accounts and access keys](authentication.md).

![The Settings screen](images/troubleshooting-settings.png)

## Generate fails

The companion runs your script once before giving it to you, so a failure comes
from the real script. The panel shows a plain-language **title** and a **hint**
for what to try — and keeps the original text behind **Details** (with a **Copy**
button). The message stays until you close it with **×**; **Report bug** sends the
original text. The common ones:

| The panel says | Usually means | Try |
| --- | --- | --- |
| No data was found | A selector matches nothing on the page the script fetches | Use **Show preview**; for pages that build their content with JavaScript, switch to the [Browser engine](browser-engine.md) |
| The site refuses the script (HTTP 401 / 403) | The site needs a login or blocks scripts | A [login flow](browser-engine.md#a-login-flow), or a [custom header](network-settings.md#custom-request-headers) such as a cookie |
| The site says: too many requests (HTTP 429) | Rate limited | [Pause between requests](network-settings.md#pause-between-requests) and [retries](network-settings.md#retry-on-transient-errors) |
| The page was not found (HTTP 404) | Wrong start URL | Check the address at the top of the panel |
| The site reported an error (HTTP 5xx) | Usually temporary | Try again, or turn on [retries](network-settings.md#retry-on-transient-errors) |
| The site can't be reached / the page took too long to load | No connection, a wrong address, or a slow page | Check the address and your connection (and proxy) |
| The script needs the variable … | A **Fill** action or header reads an environment variable | Type a **Test value** for the trial run and set the variable where the script runs |
| The trial run took too long | Too many pages or requests | Fewer pages/requests, or **Skip the trial run** in Settings |
| The site's robots.txt forbids this request | The run-time robots.txt check is on | Choose **Skip it and carry on** or **Warn** in Settings |
| Python was not found / A Python package is missing | The companion's machine lacks Python 3.9+ or a package | Install it (or run the installer again); the message names the package |
| The page address isn't valid, A field has no name, Two fields have the same name, An element has no selector, … | The configuration has a mistake the panel names | Fix what the hint says — no bug report needed |
| The companion app can't be reached | It stopped running | Start it again, then **Try again** |

An error the panel doesn't recognise is shown as "Error: …" with the original
text, and **Report bug** is offered.

A **warning toast** that verification was skipped means the estimated trial run
was too long (over ten minutes) or you chose to skip it. The script was
validated but not run.

## Why did I get a different page than the one I clicked on?

The panel scrapes the address shown at the top. If you navigate the tab while
the panel is open, it corrects itself the next time you pick an element and
tells you so.

## The selector works in my browser but not in the script

The script's HTML parser doesn't run JavaScript. If the element only exists
after scripts run, use the Browser engine. To tell identical buttons or links
apart by their label, use **Only the element whose text contains** in the field
dialog.

## The data preview or Show preview shows nothing

**Show preview** highlights matches on the live page; an element only present
after a hover or a click won't be found. For container mode, field picks are
limited to the container you clicked in.

## Script exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unhandled error (a bug or unexpected failure) |
| 2 | A hardening check with severity Error failed |
| 3 | The editable config file is invalid |
| 4 / 5 | Preflight: page unchanged / not reachable |
| 6 | Auth bootstrap request failed (API mode) |
| 7 | A page or API request failed (HTTP error, unreachable) |
| 8 | A needed Python package (e.g. `openpyxl`) is missing |
| 9 | robots.txt disallowed a request and the action is **Stop the run** |
| 10 | The existing output file can't be appended to |
| 78 | A required environment variable is not set |

## Reporting a bug

On an error toast, **Report bug** collects the extension's log and pre-fills a
GitHub issue. **Export configuration** gives you a JSON of your setup to attach.
Please remove any secret before posting.
