#!/usr/bin/env python3
"""Local test-fixture server for API mode's Link-header pagination (Issue #321).

Manual QA / e2e-harness fixture only (mirrors test-pages/api-cursor-pagination)
— companion tests keep using the in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/api-link-pagination/server.py
    -> http://127.0.0.1:9100/

Endpoints:
    GET  /            index.html ("Laden" = page 1, "Mehr laden" = next page)
    GET  /api/items   ?page=N -> {"items": [...]} with two items per page, and —
                      like GitHub/GitLab/WordPress — the next page announced
                      only in the response header:
                          Link: <http://127.0.0.1:9100/api/items?page=2>; rel="next",
                                <http://127.0.0.1:9100/api/items?page=4>; rel="last"
                      (the last page carries no rel="next")

Seven items, two per page, so a complete run is four pages. The body has no
cursor or page number at all, so a script can only get past page 1 by
following the Link header.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 9100
STATIC_DIR = Path(__file__).parent
PAGE_SIZE = 2
ITEMS = [{"title": f"Artikel {n}", "price": f"{n}.99"} for n in range(1, 8)]
LAST_PAGE = (len(ITEMS) + PAGE_SIZE - 1) // PAGE_SIZE


class FixtureRequestHandler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self._send(200, (STATIC_DIR / "index.html").read_bytes(), "text/html; charset=utf-8")
            return
        if parsed.path == "/api/items":
            try:
                page = max(1, int(parse_qs(parsed.query).get("page", ["1"])[0]))
            except ValueError:
                page = 1
            start = (page - 1) * PAGE_SIZE
            base = f"http://{HOST}:{PORT}/api/items"
            links = []
            if page < LAST_PAGE:
                links.append(f'<{base}?page={page + 1}>; rel="next"')
            links.append(f'<{base}?page={LAST_PAGE}>; rel="last"')
            body = json.dumps({"items": ITEMS[start:start + PAGE_SIZE]}, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8", {"Link": ", ".join(links)})
            return
        self._send(404, b'{"error": "not found"}', "application/json")

    def log_message(self, format, *args):
        print(f"[api-link-pagination] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), FixtureRequestHandler)
    print(f"api-link-pagination fixture server running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
