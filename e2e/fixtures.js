// Issue #180: registry of test-pages/* fixtures this harness knows how to
// serve. Two fixtures (api-nested-and-post, embedded-json-menu) already had
// their own small Python stdlib HTTP servers (server.py) with their own
// fixed port baked in for manual QA — this registry reuses those verbatim
// rather than duplicating their logic. The remaining four are plain static
// HTML with no server of their own; those are served generically via
// `python3 -m http.server` (python3 is already a hard runtime requirement
// for the companion app, see CLAUDE.md, so this adds no new dependency).
//
// Ports are fixed and non-overlapping so more than one fixture could
// theoretically run at once, though harness.js only ever starts one at a
// time per call — a fixed port also means a stale server left running from
// a previous crashed run is easy to spot/kill by port instead of guessing.
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const FIXTURES = {
  'iframe-shadow-dom': { dir: path.join(REPO_ROOT, 'test-pages/iframe-shadow-dom'), port: 8501, kind: 'static' },
  'infinite-scroll': { dir: path.join(REPO_ROOT, 'test-pages/infinite-scroll'), port: 8502, kind: 'static' },
  'login-flow': { dir: path.join(REPO_ROOT, 'test-pages/login-flow'), port: 8503, kind: 'static' },
  'speisekarte': { dir: path.join(REPO_ROOT, 'test-pages/speisekarte'), port: 8504, kind: 'static' },
  'dedup-listing': { dir: path.join(REPO_ROOT, 'test-pages/dedup-listing'), port: 8505, kind: 'static' },
  'click-targets': { dir: path.join(REPO_ROOT, 'test-pages/click-targets'), port: 8509, kind: 'static' },
  'transform-helpers': { dir: path.join(REPO_ROOT, 'test-pages/transform-helpers'), port: 8511, kind: 'static' },
  'text-selector': { dir: path.join(REPO_ROOT, 'test-pages/text-selector'), port: 8507, kind: 'static' },
  'api-nested-and-post': { dir: path.join(REPO_ROOT, 'test-pages/api-nested-and-post'), port: 8600, kind: 'script', script: 'server.py' },
  'embedded-json-menu': { dir: path.join(REPO_ROOT, 'test-pages/embedded-json-menu'), port: 8700, kind: 'script', script: 'server.py' },
  'api-token-bootstrap': { dir: path.join(REPO_ROOT, 'test-pages/api-token-bootstrap'), port: 8800, kind: 'script', script: 'server.py' },
  'api-cursor-pagination': { dir: path.join(REPO_ROOT, 'test-pages/api-cursor-pagination'), port: 9000, kind: 'script', script: 'server.py' },
  'api-link-pagination': { dir: path.join(REPO_ROOT, 'test-pages/api-link-pagination'), port: 9100, kind: 'script', script: 'server.py' },
  'robots-disallow': { dir: path.join(REPO_ROOT, 'test-pages/robots-disallow'), port: 8510, kind: 'script', script: 'server.py' },
  'crawl-delay': { dir: path.join(REPO_ROOT, 'test-pages/crawl-delay'), port: 8508, kind: 'script', script: 'server.py' },
  'flaky-server': { dir: path.join(REPO_ROOT, 'test-pages/flaky-server'), port: 8900, kind: 'script', script: 'server.py' },
  'request-headers': { dir: path.join(REPO_ROOT, 'test-pages/request-headers'), port: 8506, kind: 'script', script: 'server.py' },
};

function resolveFixture(name) {
  const fixture = FIXTURES[name];
  if (!fixture) {
    throw new Error(`Unknown fixture "${name}". Known fixtures: ${Object.keys(FIXTURES).join(', ')}`);
  }
  return fixture;
}

module.exports = { FIXTURES, resolveFixture, REPO_ROOT };
