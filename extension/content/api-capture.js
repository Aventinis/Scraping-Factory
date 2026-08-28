// Injected in the MAIN world (unlike content-script.js, which runs isolated)
// so it can patch window.fetch/XMLHttpRequest before the page's own scripts
// get a chance to call them — see manifest.json's second content_scripts
// entry (world: "MAIN", run_at: "document_start"). MAIN-world scripts have
// no chrome.runtime access, so everything here talks to the isolated
// content-script.js via window.postMessage instead (see the bridge at the
// bottom of content-script.js).
//
// API-Mode (Issue #53, Phase 3): records fetch/XHR request+response pairs
// while recording is active, so Phase 4 can later search their JSON bodies
// for a user-clicked value.
//
// Known limitations (not solved here):
// - Requests that don't go through fetch/XHR (navigator.sendBeacon,
//   WebSocket) aren't captured.
// - The control/entry channel is window.postMessage(..., '*'), which the
//   hosting page's own scripts can also observe or forge (both worlds share
//   the same `window`). Accepted for now — there is no unforgeable channel
//   between the MAIN and ISOLATED worlds without a shared secret neither
//   side can currently obtain, and the data only ever leaves the page via
//   this extension's own UI.
// - Recording survives same-origin navigation (see RESUME_KEY below via
//   sessionStorage, which both worlds and the page share per tab+origin),
//   but not a navigation to a different origin — sessionStorage doesn't
//   carry over, so recording silently stops there until the user restarts
//   it from the popup.

const MAX_CAPTURED_ENTRIES = 200; // caps buffered requests on a long recording of a request-heavy page
const MAX_BODY_CHARS = 200000; // ~200 KB of text per response — generous for JSON, small enough to stay message-safe
const SKIP_BODY_CONTENT_TYPE_RE = /^(image|audio|video|font)\//i; // never useful for JSON-API discovery
const MAX_BODY_BYTES_TO_READ = MAX_BODY_CHARS * 4; // UTF-8 worst case ~4 bytes/char; cutoff before even reading the body
const RESUME_KEY = 'sf-api-capture-recording';

let _recording = false;
let _entries = [];
let _nextId = 1;

// Character-count truncation (not exact byte-count) — good enough as a size
// guard, doesn't need TextEncoder precision.
function truncateBody(text) {
  if (typeof text !== 'string' || text.length <= MAX_BODY_CHARS) {
    return { body: text ?? '', truncated: false };
  }
  return { body: text.slice(0, MAX_BODY_CHARS), truncated: true };
}

// Whether a response's body isn't worth reading at all — checked from
// headers alone, before any body-reading happens, so a huge or binary
// response never gets materialized into a JS string just to truncate it
// afterwards.
function shouldSkipBody(contentType, contentLengthHeader) {
  if (contentType && SKIP_BODY_CONTENT_TYPE_RE.test(contentType)) return true;
  const len = contentLengthHeader != null ? parseInt(contentLengthHeader, 10) : NaN;
  if (!Number.isNaN(len) && len > MAX_BODY_BYTES_TO_READ) return true;
  return false;
}

// Pure construction of one capture entry — kept separate from the
// fetch/XHR interception glue below so it's testable without mocking those.
function buildEntry(url, method, status, contentType, bodyText, bodySkipped) {
  const { body, truncated } = bodySkipped ? { body: '', truncated: false } : truncateBody(bodyText);
  return {
    id: _nextId++,
    url,
    method: (method || 'GET').toUpperCase(),
    status,
    contentType: contentType || null,
    body,
    bodyTruncated: truncated,
    bodySkipped: !!bodySkipped,
  };
}

function recordEntry(url, method, status, contentType, bodyText, bodySkipped) {
  if (!_recording) return;
  if (_entries.length >= MAX_CAPTURED_ENTRIES) return; // silently drop — buffer already at cap

  const entry = buildEntry(url, method, status, contentType, bodyText, bodySkipped);
  _entries.push(entry);
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'sf-api-capture', type: 'API_CAPTURE_ENTRY', entry }, '*');
  }
}

// Persists the on/off flag in sessionStorage (shared by the MAIN world, the
// isolated content-script.js and the page itself — it's per tab+origin, not
// per JS realm) so a same-origin navigation, which fully re-runs this
// script and resets all module state above, can resume recording on the
// new page instead of silently going quiet. See the known-limitations note
// at the top of the file for what this doesn't cover.
function persistRecordingFlag(active) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (active) sessionStorage.setItem(RESUME_KEY, '1');
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Thrown in sandboxed/opaque-origin contexts (e.g. sandboxed iframes) —
    // recording still works, it just won't resume across navigation there.
  }
}

function shouldResumeRecording() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(RESUME_KEY) === '1';
  } catch {
    return false;
  }
}

function startRecording() {
  _recording = true;
  _entries = [];
  _nextId = 1;
  persistRecordingFlag(true);
}

function stopRecording() {
  _recording = false;
  persistRecordingFlag(false);
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildEntry,
    truncateBody,
    shouldSkipBody,
    recordEntry,
    startRecording,
    stopRecording,
    shouldResumeRecording,
    MAX_CAPTURED_ENTRIES,
    MAX_BODY_CHARS,
    MAX_BODY_BYTES_TO_READ,
  };
}

// ── fetch/XHR interception ──────────────────────────────────────────────────
// Only patches real browser globals — guarded so requiring this file under
// Jest (no `window.fetch`/`XMLHttpRequest` patch target worth installing,
// and no real page traffic to intercept anyway) doesn't install patches that
// would leak into unrelated tests.

if (typeof window !== 'undefined' && typeof module === 'undefined') {
  if (shouldResumeRecording()) startRecording(); // same-origin navigation mid-recording — see known limitations above

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'sf-api-capture-control') return;
    if (data.type === 'API_CAPTURE_START') startRecording();
    if (data.type === 'API_CAPTURE_STOP') stopRecording();
  });

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const request = args[0] instanceof Request ? args[0] : null;
      const url = request ? request.url : String(args[0]);
      const method = (request && request.method) || (args[1] && args[1].method) || 'GET';

      return originalFetch.apply(this, args).then((response) => {
        if (_recording) {
          const contentType = response.headers.get('content-type');
          if (shouldSkipBody(contentType, response.headers.get('content-length'))) {
            recordEntry(url, method, response.status, contentType, '', true);
          } else {
            response.clone().text()
              .then((bodyText) => recordEntry(url, method, response.status, contentType, bodyText))
              .catch(() => {}); // unreadable body (e.g. opaque cross-origin response) — just skip capturing it
          }
        }
        return response;
      });
    };
  }

  if (typeof XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._sfMethod = method;
      this._sfUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (_recording) {
        this.addEventListener('load', () => {
          if (!_recording) return;
          const contentType = this.getResponseHeader('content-type');
          // The browser already buffers the whole response internally for
          // XHR regardless (unlike fetch, there's no lazy body stream to
          // avoid touching) — this at least skips copying it into our own
          // capture entry.
          if (shouldSkipBody(contentType, this.getResponseHeader('content-length'))) {
            recordEntry(this._sfUrl, this._sfMethod, this.status, contentType, '', true);
            return;
          }
          let bodyText = '';
          try {
            bodyText = this.responseText; // throws for responseType 'blob'/'arraybuffer'/'document'
          } catch {
            // Not a text-ish response — capture the entry without a body.
          }
          recordEntry(this._sfUrl, this._sfMethod, this.status, contentType, bodyText);
        });
      }
      return originalSend.apply(this, args);
    };
  }
}
