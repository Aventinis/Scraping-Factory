#!/usr/bin/env python3
"""Local test-fixture server for custom request headers (Issue #226).

Manual QA / e2e-harness fixture only — companion tests keep using the
in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/request-headers/server.py
    -> http://127.0.0.1:8506/

Behaviour: the page echoes the request headers it received (Accept-Language,
X-Api-Key, X-Referral, User-Agent) into the HTML — "-" for a header that
wasn't sent. In a normal browser it shows the browser's own Accept-Language
and no X-Api-Key; a script scraping it with custom headers configured sees
exactly those, which is what the scraped output then proves.
"""

import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8506

PAGE = """<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>Request-Header-Echo (Issue #226)</title></head>
<body>
  <h1>Empfangene Request-Header</h1>
  <p>Diese Seite zeigt die Header, die der Server bei <em>dieser</em> Anfrage erhalten hat.</p>
  <div class="request">
    <p>Accept-Language: <span class="lang">{lang}</span></p>
    <p>X-Api-Key: <span class="key">{key}</span></p>
    <p>X-Referral: <span class="referral">{referral}</span></p>
    <p>User-Agent: <span class="ua">{ua}</span></p>
  </div>
</body>
</html>
"""


class EchoHandler(BaseHTTPRequestHandler):
    def _value(self, name):
        return html.escape(self.headers.get(name, "-"))

    def do_GET(self):
        body = PAGE.format(
            lang=self._value("Accept-Language"),
            key=self._value("X-Api-Key"),
            referral=self._value("X-Referral"),
            ua=self._value("User-Agent"),
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[request-headers] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), EchoHandler)
    print(f"request-headers fixture running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
