#!/usr/bin/env python3
"""Local test-fixture server for embedded-JSON-source work on Issue #136.

Manual QA fixture only (mirrors test-pages/api-nested-and-post) — not wired
into any automated test suite. Companion tests keep using the in-process C#
LocalTestServer; this script exists so a human can try the extension's
"Search page's own JSON data" flow against two realistic pages that embed
their complete data directly in the initial HTML, with no fetch()/XHR ever
happening — exactly the case the network recorder can't see anything for.

Served over real HTTP (not file://) because the generated script's own
requests.get(url) needs an actual URL to fetch, the same reason
api-nested-and-post is served rather than opened directly.

stdlib-only on purpose: python3 is already a hard runtime requirement for
the companion app (see CLAUDE.md), so this adds no dependency beyond what's
already mandatory.

Usage:
    python3 test-pages/embedded-json-menu/server.py
    -> http://127.0.0.1:8700/            Next.js-style page, id="__NEXT_DATA__",
                                          nested categories[*].items[*] (tree shape)
    -> http://127.0.0.1:8700/generic     generic <script type="application/json">,
                                          flat products[*] array (flat shape)
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8700
STATIC_DIR = Path(__file__).parent


class FixtureRequestHandler(BaseHTTPRequestHandler):
    def _send_html(self, status, html_bytes):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html_bytes)))
        self.end_headers()
        self.wfile.write(html_bytes)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send_html(200, (STATIC_DIR / "index.html").read_bytes())
            return

        if self.path in ("/generic", "/generic.html"):
            self._send_html(200, (STATIC_DIR / "generic.html").read_bytes())
            return

        self._send_html(404, b"<h1>404 Not Found</h1>")

    def log_message(self, format, *args):
        print(f"[embedded-json-menu] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), FixtureRequestHandler)
    print(f"embedded-json-menu fixture server running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    print(f"  -> http://{HOST}:{PORT}/         Next.js-style, nested (#__NEXT_DATA__)")
    print(f"  -> http://{HOST}:{PORT}/generic  generic application/json, flat")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
