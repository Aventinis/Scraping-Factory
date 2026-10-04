#!/usr/bin/env python3
"""Local test-fixture server for API mode's token/auth bootstrap (Issue #220).

Manual QA / e2e-harness fixture only (mirrors test-pages/api-nested-and-post)
— companion tests keep using the in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/api-token-bootstrap/server.py
    -> http://127.0.0.1:8800/

Endpoints:
    GET  /                 index.html (logs in via fetch(), then lists items)
    POST /auth/token       JSON body {"username": "alice", "password": "s3cret"}
                           -> {"data": {"access_token": "<fresh random token>"}}
    GET  /api/items        requires "Authorization: Bearer <issued token>",
                           otherwise 401 — optional ?category= filter

Every token is random and issued fresh per login, so a generated script can
only ever succeed by running the bootstrap request itself — a token pasted in
as a static literal from the recording would fail on the next server start.
"""

import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 8800
STATIC_DIR = Path(__file__).parent
USERNAME = "alice"
PASSWORD = "s3cret"

ITEMS = [
    {"title": "Kaffee Crema", "category": "getraenke", "price": 12.99},
    {"title": "Grüner Tee", "category": "getraenke", "price": 4.49},
    {"title": "Vollkornbrot", "category": "backwaren", "price": 2.79},
]

ISSUED_TOKENS = set()


class FixtureRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            body = (STATIC_DIR / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/items":
            auth = self.headers.get("Authorization", "")
            token = auth[len("Bearer "):] if auth.startswith("Bearer ") else ""
            if token not in ISSUED_TOKENS:
                self._send_json(401, {"error": "missing or invalid token"})
                return
            category = parse_qs(parsed.query).get("category", [None])[0]
            items = [item for item in ITEMS if category in (None, item["category"])]
            self._send_json(200, {"data": {"items": items}})
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/auth/token":
            self._send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            credentials = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            credentials = {}
        if credentials.get("username") != USERNAME or credentials.get("password") != PASSWORD:
            self._send_json(401, {"error": "bad credentials"})
            return
        token = secrets.token_urlsafe(24)
        ISSUED_TOKENS.add(token)
        self._send_json(200, {"data": {"access_token": token, "expires_in": 300}})

    def log_message(self, format, *args):
        print(f"[api-token-bootstrap] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), FixtureRequestHandler)
    print(f"api-token-bootstrap fixture server running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
