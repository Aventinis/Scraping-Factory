#!/usr/bin/env python3
"""Local test-fixture server for the run-time robots.txt Disallow check (Issue #333).

Manual QA / e2e-harness fixture only — companion tests keep using the
in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/robots-disallow/server.py
    -> http://127.0.0.1:8510/

Behaviour: two listings — "/" (public) and "/private/" — and a robots.txt that
says "Disallow: /private/". Requests made by a *generated script* (recognised by
its "ScrapingFactory" User-Agent) are logged; GET /__log returns the requested
paths as JSON so a check can see whether a disallowed page was ever fetched,
GET /__reset clears the log.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HOST = "127.0.0.1"
PORT = 8510

ROBOTS = b"User-agent: *\nDisallow: /private/\n"

LISTINGS = {
    "/": ("Oeffentlich", ["Kaffee Crema", "Gruener Tee"]),
    "/private/": ("Intern", ["Geheimrezept", "Hausmischung"]),
}

_lock = threading.Lock()
_log = []


def render(title, names):
    items = "".join(f'<li class="offer"><span class="name">{name}</span></li>' for name in names)
    return (
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>robots.txt Disallow (Issue #333)</title></head>'
        f"<body><h1>{title}</h1><p>robots.txt: Disallow /private/.</p><ul>{items}</ul></body></html>"
    ).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        from_script = "ScrapingFactory" in self.headers.get("User-Agent", "")
        if path == "/__log":
            with _lock:
                self._send(200, json.dumps(_log).encode(), "application/json")
        elif path == "/__reset":
            with _lock:
                _log.clear()
            self._send(200, b"[]", "application/json")
        elif path == "/robots.txt":
            self._send(200, ROBOTS, "text/plain; charset=utf-8")
        elif path in LISTINGS:
            if from_script:
                with _lock:
                    _log.append(path)
            self._send(200, render(*LISTINGS[path]), "text/html; charset=utf-8")
        else:
            self._send(404, b"not found", "text/plain")

    def log_message(self, format, *args):
        print(f"[robots-disallow] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"robots-disallow fixture running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
