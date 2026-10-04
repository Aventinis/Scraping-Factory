#!/usr/bin/env python3
"""Local test-fixture server for retry with backoff (Issue #223).

Manual QA / e2e-harness fixture only — companion tests keep using the
in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/flaky-server/server.py
    -> http://127.0.0.1:8900/

Behaviour: a normal browser always gets the page. A *generated script*
(recognised by its "ScrapingFactory" User-Agent) gets "503 Service
Unavailable" on every other request — so a script without retries fails on
its first request, while one with retries succeeds on the second attempt.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

HOST = "127.0.0.1"
PORT = 8900

PAGE = """<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>Wackeliger Server (Issue #223)</title></head>
<body>
  <h1>Angebote</h1>
  <p>Generierte Skripte bekommen hier bei jeder zweiten Anfrage "503 Service Unavailable".</p>
  <ul>
    <li class="offer"><span class="name">Kaffee Crema</span> – <span class="price">12,99 €</span></li>
    <li class="offer"><span class="name">Grüner Tee</span> – <span class="price">4,49 €</span></li>
    <li class="offer"><span class="name">Vollkornbrot</span> – <span class="price">2,79 €</span></li>
  </ul>
</body>
</html>
""".encode("utf-8")

_lock = threading.Lock()
_script_requests = 0


class FlakyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _script_requests
        if "ScrapingFactory" in self.headers.get("User-Agent", ""):
            with _lock:
                _script_requests += 1
                fail = _script_requests % 2 == 1
            if fail:
                body = b"Service temporarily unavailable"
                self.send_response(503)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, format, *args):
        print(f"[flaky-server] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), FlakyHandler)
    print(f"flaky-server fixture running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
