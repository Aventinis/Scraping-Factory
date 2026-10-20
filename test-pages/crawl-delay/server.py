#!/usr/bin/env python3
"""Local test-fixture server for honoring robots.txt Crawl-delay (Issue #228).

Manual QA / e2e-harness fixture only — companion tests keep using the
in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/crawl-delay/server.py
    -> http://127.0.0.1:8508/

Behaviour: a paginated listing (/, then /?page=2, /?page=3; a 4th page is
empty) and a robots.txt asking for "Crawl-delay: 2". Requests made by a
*generated script* (recognised by its "ScrapingFactory" User-Agent) are
logged with a timestamp; GET /__log returns them as JSON so the gap between
two page requests can be checked, GET /__reset clears the log.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

HOST = "127.0.0.1"
PORT = 8508

ROBOTS = b"User-agent: *\nCrawl-delay: 2\n"

PAGES = {
    1: ["Kaffee Crema", "Gruener Tee"],
    2: ["Vollkornbrot", "Butterkeks"],
    3: ["Haferflocken", "Erdnussbutter"],
}

_lock = threading.Lock()
_log = {"pages": [], "robots": 0}


def render(page):
    items = "".join(f'<li class="offer"><span class="name">{name}</span></li>' for name in PAGES.get(page, []))
    return (
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Crawl-delay (Issue #228)</title></head>'
        f"<body><h1>Seite {page}</h1><p>robots.txt: Crawl-delay 2 s.</p><ul>{items}</ul></body></html>"
    ).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urlsplit(self.path)
        from_script = "ScrapingFactory" in self.headers.get("User-Agent", "")
        if parts.path == "/__log":
            with _lock:
                self._send(200, json.dumps(_log).encode(), "application/json")
        elif parts.path == "/__reset":
            with _lock:
                _log["pages"].clear()
                _log["robots"] = 0
            self._send(200, b"{}", "application/json")
        elif parts.path == "/robots.txt":
            if from_script:
                with _lock:
                    _log["robots"] += 1
            self._send(200, ROBOTS, "text/plain; charset=utf-8")
        else:
            query = parse_qs(parts.query)
            try:
                page = int(query.get("page", ["1"])[0])
            except ValueError:
                page = 1
            if from_script:
                with _lock:
                    _log["pages"].append(time.time())
            self._send(200, render(page), "text/html; charset=utf-8")

    def log_message(self, format, *args):
        print(f"[crawl-delay] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"crawl-delay fixture running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
