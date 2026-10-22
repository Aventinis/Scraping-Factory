#!/usr/bin/env python3
"""Local test-fixture server for the pagination helpers (Issue #405).

Manual QA / e2e-harness fixture only — companion tests keep using the
in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/paginated-listing/server.py
    -> http://127.0.0.1:8512/

Two listings of three pages with three items each, in the two common URL shapes:

    /              ?page=N        "Artikel 1" … "Artikel 9"   (page 1 is the plain URL)
    /blog/         /blog/page/N/  "Beitrag 1" … "Beitrag 9"   (page 1 is /blog/)

Every page has a "Next »" link (a.next, missing on the last page) and a pager
with numbered links, so the extension can learn the URL pattern from a clicked
link. Page 1 is also reachable as /?page=1 and /blog/page/1/; a page past the last
one is an empty page (HTTP 200), which is what ends a page-number pagination.
"""

import html
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8512
PAGES = 3
PER_PAGE = 3

PAGE = """<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>{title} — Seite {page} (Issue #405)</title></head>
<body>
  <h1>{title}</h1>
  <ul class="items">
{items}
  </ul>
  <nav class="pager">
{pager}
  </nav>
</body>
</html>"""


def render(title, noun, page, url_for):
    # A page past the last one is an ordinary, empty page (HTTP 200) — that is
    # what ends a page-number pagination (a 404 would fail the run instead).
    first = (page - 1) * PER_PAGE + 1
    items = "\n".join(f'    <li class="item">{noun} {n}</li>' for n in range(first, first + PER_PAGE)) if page <= PAGES else ""
    links = [f'    <a class="page-link" href="{url_for(n)}">{n}</a>' for n in range(1, PAGES + 1)]
    if page < PAGES:
        links.append(f'    <a class="next" href="{url_for(page + 1)}">Next »</a>')
    return PAGE.format(title=html.escape(title), page=page, items=items, pager="\n".join(links)).encode("utf-8")


def query_url(n):
    return "/" if n == 1 else f"/?page={n}"


def path_url(n):
    return "/blog/" if n == 1 else f"/blog/page/{n}/"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        body = None
        if parsed.path == "/":
            raw = parse_qs(parsed.query).get("page", ["1"])[0]
            page = int(raw) if raw.isdigit() else 1
            body = render("Artikelliste", "Artikel", max(page, 1), query_url)
        elif parsed.path == "/blog/" or re.fullmatch(r"/blog/page/\d+/?", parsed.path):
            match = re.search(r"/page/(\d+)", parsed.path)
            page = int(match.group(1)) if match else 1
            body = render("Blog", "Beitrag", max(page, 1), path_url)
        if body is None:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print(f"Serving paginated-listing fixture on http://{HOST}:{PORT}/")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
