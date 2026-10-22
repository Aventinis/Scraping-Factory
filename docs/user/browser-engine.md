# Browser engine and actions

By default a script fetches the page with plain HTTP and reads the HTML it gets
back (the **Static** engine). That is fast and light, but it sees only what the
server sends. Pages that build their content with JavaScript, or that need a
login, a click or scrolling first, need the **Browser** engine: the script then
drives a real Chromium through Playwright.

## Switching engine

In the idle screen, the **Engine** row has **Static** and **Browser** (the **?**
next to it says which fits). When a trial run on **Static** finds no data, the
error suggests trying **Browser** — a very common cause is a page that builds its
content with JavaScript. Choosing
**Browser** reveals the **Browser actions** list.

The Browser engine needs extra software on the machine that runs the script
(and on the companion's machine, because of the trial run):

```bash
pip install playwright
playwright install chromium
```

The installer does this for you with `--browser-engine` (`-BrowserEngine` on
Windows).

## Browser actions

Actions run in order, before the data is extracted. There are four kinds:

| Action | What it does |
| --- | --- |
| **Wait** | Waits until an element appears (with a timeout) |
| **Fill** | Types a value into an input |
| **Click** | Clicks an element |
| **Scroll** | Scrolls to load more content |

Choose the element for an action with **Select element** and click it on the
page — you never write a selector by hand.

### A login flow

There is no special "login" feature; you assemble one from the actions:
**Fill** (user name), **Fill** (password), **Click** (the sign-in button),
**Wait** (for something only visible after signing in).

A **Fill** action never stores a secret in the script. You give it the *name of
an environment variable*, and the script reads the value when it runs:

```bash
export SITE_PASSWORD='…'
python scraper.py
```

To let the trial run get past the login, type a **Test value** next to the
action. It is sent to the companion for that one run and is never saved, logged
or written into the script.

**Reuse session between runs** saves the login cookies in a file next to the
output, so later runs skip the login actions. That file holds live session
cookies — treat it like a password and never share or commit it.

### Click: first, last or all

If a selector matches several elements (say, one "Show more" toggle per entry),
**Click which match** chooses **First match**, **Last match** or **All matches,
in order**. For all, you can set how long to wait after each click.

### Scroll

**Scroll** repeats up to **Max. rounds** times, stopping when no new content
appears. You can name a **Container** (a scrollable box instead of the whole
page) and a **"Load more" button** to click each round. By default every round
jumps to the bottom. If a site only loads a section once you scroll *through*
it, set **Scroll step (px)** to scroll that many pixels at a time.

## Things to know

- A page that answers with an HTTP error (for example 403) fails the run with a
  clear message instead of silently scraping the error page.
- CAPTCHAs are not solved or bypassed, by design. If one blocks the flow, the
  script fails honestly.
- Selectors for things inside iframes are supported; the extension records
  which frame an element was in.
