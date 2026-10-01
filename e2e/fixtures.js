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
  'api-nested-and-post': { dir: path.join(REPO_ROOT, 'test-pages/api-nested-and-post'), port: 8600, kind: 'script', script: 'server.py' },
  'embedded-json-menu': { dir: path.join(REPO_ROOT, 'test-pages/embedded-json-menu'), port: 8700, kind: 'script', script: 'server.py' },
};

function resolveFixture(name) {
  const fixture = FIXTURES[name];
  if (!fixture) {
    throw new Error(`Unknown fixture "${name}". Known fixtures: ${Object.keys(FIXTURES).join(', ')}`);
  }
  return fixture;
}

module.exports = { FIXTURES, resolveFixture, REPO_ROOT };
