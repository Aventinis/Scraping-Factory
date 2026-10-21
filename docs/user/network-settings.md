# Network settings: being polite and getting through

These options live in the **Settings** section of the idle screen. They change
how the *generated script* talks to the site. They work in every mode and with
both engines unless noted.

## Pause between requests

**Pause between requests** makes the script wait before each request: a fixed
time, or random within a range (**from … to … seconds**, e.g. 1 to 3). A pause
applies before every page of pagination, every start URL, every API call and
every download — but not between reads on a page that is already loaded.

The trial run doesn't count these pauses against its time limit, so a long,
polite scrape can still be verified.

## Retry on transient errors

**Retry on transient errors** retries a request that failed with a connection
error, a timeout, or one of the **status codes** you list (default 429, 502,
503, 504). Choose **Attempts** (default 3), the **Wait (s)** (default 2) and
whether to **Double the wait after every retry**. If the site sends
`Retry-After`, that wait is used instead (at most 60 seconds). Errors such as
404, 401 or 403 are not retried. If every attempt fails the run stops with a
clear message.

## robots.txt

- **Respect the site's robots.txt (Crawl-delay)**: the script waits at least the
  `Crawl-delay` the site asks for, in addition to your own pause (the longer wait
  wins).
- **Check the site's robots.txt before every request**: the script checks each
  request against the site's `Disallow` rules and, when one is disallowed,
  **Skip it and carry on**, **Warn, but request it anyway**, or **Stop the run**.
  A missing robots.txt means everything is allowed.

The **Check robots.txt** button next to the page address is a separate, one-off
look at whether the current page is allowed.

## Custom request headers

**Send custom request headers** adds headers such as `Accept-Language`,
`Referer` or an API key. Each is a **Fixed value** or an **Environment
variable** (the variable's *name* — the secret itself never enters the script).
For an environment-variable header, type a **Test value for the trial run** (not
saved) so the companion can verify a protected page.

With the Browser engine, the headers go to every request the page makes,
including images and scripts. The script's default `User-Agent` is replaced if
you set one.

## Use a proxy

**Use a proxy** routes requests through proxies you already have. You enter the
*name of an environment variable* holding a comma-separated list of proxy
URLs (`http://user:pass@host:port`); with several, they are used in turn. If
the variable is not set the script warns, connects directly and exits with code
78 so you can notice.

## Environment variables, in practice

Several options ask for an environment variable *name*. Set it in the place
where the script runs:

```bash
export API_KEY='…'          # Linux / macOS
python scraper.py
```

```powershell
$env:API_KEY = '…'          # Windows PowerShell
python scraper.py
```
