#!/usr/bin/env python3
"""Local test-fixture server for API mode's cursor/token pagination (Issue #224).

Manual QA / e2e-harness fixture only (mirrors test-pages/api-token-bootstrap)
— companion tests keep using the in-process C# LocalTestServer.

stdlib-only on purpose: python3 is already a hard runtime requirement for the
companion app (see CLAUDE.md).

Usage:
    python3 test-pages/api-cursor-pagination/server.py
    -> http://127.0.0.1:9000/

Endpoints:
    GET  /                 index.html ("Laden" = page 1, "Mehr laden" = next page)
    GET  /api/items        REST style: ?cursor=<opaque> -> 2 items per page and
                           {"data": {"items": [...]}, "pageInfo": {"endCursor", "hasNextPage"}}
    POST /graphql          GraphQL/Relay style: {"query": "...", "variables": {"after": <cursor|null>}}
                           -> {"data": {"items": {"nodes": [...], "pageInfo": {...}}}}

Seven items, two per page, so a complete run is four pages. Cursors are opaque
(base64 of the offset), so a script can only get past page 1 by reading each
response's own cursor — a hard-coded value from the recording would just
replay the same page.
"""

import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 9000
STATIC_DIR = Path(__file__).parent
PAGE_SIZE = 2

ITEMS = [{"title": f"Artikel {n}", "price": f"{n}.99"} for n in range(1, 8)]


def encode_cursor(offset):
    return base64.urlsafe_b64encode(f"offset:{offset}".encode()).decode()


def decode_cursor(cursor):
    try:
        return int(base64.urlsafe_b64decode(cursor.encode()).decode().split(":")[1])
    except Exception:
        return 0


def page(cursor):
    offset = decode_cursor(cursor) if cursor else 0
    nodes = ITEMS[offset:offset + PAGE_SIZE]
    has_next = offset + PAGE_SIZE < len(ITEMS)
    return nodes, {"endCursor": encode_cursor(offset + PAGE_SIZE) if has_next else None, "hasNextPage": has_next}


class FixtureRequestHandler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, payload):
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self._send(200, (STATIC_DIR / "index.html").read_bytes(), "text/html; charset=utf-8")
            return
        if parsed.path == "/api/items":
            nodes, page_info = page(parse_qs(parsed.query).get("cursor", [None])[0])
            self._send_json(200, {"data": {"items": nodes}, "pageInfo": page_info})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/graphql":
            self._send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            body = {}
        nodes, page_info = page((body.get("variables") or {}).get("after"))
        self._send_json(200, {"data": {"items": {"nodes": nodes, "pageInfo": page_info}}})

    def log_message(self, format, *args):
        print(f"[api-cursor-pagination] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), FixtureRequestHandler)
    print(f"api-cursor-pagination fixture server running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
