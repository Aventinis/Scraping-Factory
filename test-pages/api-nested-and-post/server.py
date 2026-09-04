#!/usr/bin/env python3
"""Local test-fixture server for API-mode work on Issues #54/#55.

Manual QA fixture only (mirrors test-pages/login-flow) — not wired into any
automated test suite. Companion tests keep using the in-process C#
LocalTestServer; this script exists so a human can record real network
traffic against a realistic nested-JSON / POST / GraphQL API with the
extension.

stdlib-only on purpose: python3 is already a hard runtime requirement for
the companion app (see CLAUDE.md), so this adds no dependency beyond what's
already mandatory.

Usage:
    python3 test-pages/api-nested-and-post/server.py
    -> http://127.0.0.1:8600/

Endpoints:
    GET  /                       index.html (same-origin page that calls
                                  the endpoints below via fetch())
    GET  /api/catalog            optional ?category=&maxPrice= filtering
    POST /api/search             JSON body {"category": ..., "maxPrice": ...}
    POST /graphql                JSON body {"query": ..., "variables": {...}}

All three endpoints share one in-memory catalog and one filter function, so
GET-query-param, POST-body, and GraphQL-variables filtering exercise
identical server logic instead of three copies that could drift. An unknown
`category` value yields a real 404 on all three endpoints, so the fixture
can also be used to manually re-confirm API-mode's existing "404 = skip
this combination" behavior once nested/POST codegen changes the request
path.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 8600
STATIC_DIR = Path(__file__).parent

CATALOG = [
    {
        "id": "electronics",
        "name": "Elektronik",
        "subcategories": [
            {
                "id": "phones",
                "name": "Telefone",
                "products": [
                    {"sku": "P-100", "title": "Smartphone X", "price": 499.0, "tags": ["neu", "bestseller"]},
                    {"sku": "P-101", "title": "Smartphone Y", "price": 299.0, "tags": ["sale"]},
                ],
            },
            {
                "id": "laptops",
                "name": "Laptops",
                "products": [
                    {"sku": "P-200", "title": "Laptop Alpha", "price": 999.0, "tags": ["neu"]},
                    {"sku": "P-201", "title": "Laptop Beta", "price": 799.0, "tags": ["sale", "bestseller"]},
                ],
            },
        ],
    },
    {
        "id": "books",
        "name": "Bücher",
        "subcategories": [
            {
                "id": "fiction",
                "name": "Romane",
                "products": [
                    {"sku": "P-300", "title": "Der Nordwind", "price": 19.99, "tags": ["neu"]},
                    {"sku": "P-301", "title": "Sommerlicht", "price": 14.99, "tags": ["sale"]},
                ],
            },
            {
                "id": "nonfiction",
                "name": "Sachbücher",
                "products": [
                    {"sku": "P-400", "title": "Geschichte der Fjorde", "price": 29.99, "tags": ["bestseller"]},
                ],
            },
        ],
    },
]


def _filter_catalog(category=None, max_price=None):
    """Filter CATALOG by top-level category id and/or a product max price.

    Returns None if `category` is given but matches no category (the
    caller turns that into a 404), otherwise the filtered category list —
    shared by GET /api/catalog, POST /api/search, and POST /graphql so all
    three filter identically.
    """
    categories = CATALOG
    if category:
        categories = [c for c in categories if c["id"] == category]
        if not categories:
            return None

    if max_price is not None:
        filtered = []
        for c in categories:
            new_subcategories = []
            for sc in c["subcategories"]:
                new_products = [p for p in sc["products"] if p["price"] <= max_price]
                new_subcategories.append({**sc, "products": new_products})
            filtered.append({**c, "subcategories": new_subcategories})
        categories = filtered

    return categories


class FixtureRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status, html_bytes):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html_bytes)))
        self.end_headers()
        self.wfile.write(html_bytes)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(content_length) if content_length else b""
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path in ("/", "/index.html"):
            html_bytes = (STATIC_DIR / "index.html").read_bytes()
            self._send_html(200, html_bytes)
            return

        if parsed.path == "/api/catalog":
            query = parse_qs(parsed.query)
            category = query.get("category", [None])[0]
            max_price_raw = query.get("maxPrice", [None])[0]
            max_price = float(max_price_raw) if max_price_raw is not None else None

            categories = _filter_catalog(category, max_price)
            if categories is None:
                self._send_json(404, {"error": f"Unbekannte Kategorie: {category}"})
                return

            self._send_json(200, {"meta": {"generatedAt": "2026-09-04T00:00:00Z"}, "categories": categories})
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            data = self._read_json_body()
        except ValueError:
            self._send_json(400, {"error": "invalid JSON body"})
            return

        if self.path == "/api/search":
            category = data.get("category")
            max_price = data.get("maxPrice")

            categories = _filter_catalog(category, max_price)
            if categories is None:
                self._send_json(404, {"error": f"Unbekannte Kategorie: {category}"})
                return

            self._send_json(200, {"meta": {"generatedAt": "2026-09-04T00:00:00Z"}, "categories": categories})
            return

        if self.path == "/graphql":
            variables = data.get("variables", {}) or {}
            category = variables.get("category")
            max_price = variables.get("maxPrice")

            categories = _filter_catalog(category, max_price)
            if categories is None:
                self._send_json(404, {"error": f"Unbekannte Kategorie: {category}"})
                return

            self._send_json(200, {"data": {"categoryProducts": categories}})
            return

        self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        print(f"[api-nested-and-post] {self.address_string()} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), FixtureRequestHandler)
    print(f"api-nested-and-post fixture server running at http://{HOST}:{PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
