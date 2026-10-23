// Injected in the MAIN world (unlike the isolated content-script.js) to patch window.fetch / XMLHttpRequest before the page's scripts
// call them (manifest: world "MAIN", document_start). MAIN-world scripts have no chrome.runtime, so everything goes through
// window.postMessage to content-script.js.
//
// Records fetch / XHR request-response pairs (and each request's headers, for the header-adoption step) while recording is active, so
// a clicked value can later be searched in their JSON bodies.
//
// Known limitations:
// - Requests that do not use fetch / XHR (sendBeacon, WebSocket) are not captured.
// - Only string request bodies are captured as `requestBody`; FormData / Blob / ArrayBuffer / URLSearchParams are flagged via
//   `requestBodySkipped`.
// - window.postMessage(..., '*') can be observed or forged by the page's own scripts (both worlds share `window`). Accepted: there
//   is no unforgeable channel between the worlds, and the data only leaves the page through this extension's UI.
// - Recording survives a same-origin navigation (via sessionStorage, shared per tab and origin) but not a cross-origin one.

const MAX_CAPTURED_ENTRIES = 200; // caps buffered requests on a long recording of a request-heavy page
const MAX_BODY_CHARS = 200000; // ~200 KB of text per response — generous for JSON, small enough to stay message-safe
const SKIP_BODY_CONTENT_TYPE_RE = /^(image|audio|video|font)\//i; // never useful for JSON-API discovery
const MAX_BODY_BYTES_TO_READ = MAX_BODY_CHARS * 4; // UTF-8 worst case ~4 bytes/char; cutoff before even reading the body
const RESUME_KEY = 'sf-api-capture-recording';
const MAX_REQUEST_HEADERS = 40; // pathological-header-count guard, same spirit as the other caps above
const MAX_HEADER_VALUE_CHARS = 500; // headers are short by nature — generous but bounded (an auth token still fits many times over)

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

// Resolves a possibly-relative URL (XHR open(), a bare fetch() string) against the page's location so an entry's `url` is absolute, as
// parseUrlTemplateParts' `new URL(...)` requires.
function resolveUrl(url) {
  try {
    return new URL(url, location.href).href;
  } catch {
    return String(url); // malformed — leave as-is rather than throw from inside a patched fetch/XHR call
  }
}

function truncateHeaderValue(value) {
  const str = String(value);
  return str.length > MAX_HEADER_VALUE_CHARS ? str.slice(0, MAX_HEADER_VALUE_CHARS) : str;
}

// Normalizes the shapes fetch's `headers` can take (Headers, plain object, [name, value] pairs), and XHR's pair list, into one capped
// array, for the header-adoption step (literal or environment variable, like FillStep).
function normalizeHeaders(headersLike) {
  if (!headersLike) return [];
  let pairs;
  if (Array.isArray(headersLike)) {
    pairs = headersLike;
  } else if (typeof headersLike.entries === 'function') {
    pairs = Array.from(headersLike.entries()); // Headers instance
  } else {
    pairs = Object.entries(headersLike); // plain {name: value} object
  }
  return pairs.slice(0, MAX_REQUEST_HEADERS).map(([name, value]) => ({ name: String(name), value: truncateHeaderValue(value) }));
}

// Builds one capture entry (separate from the interception glue, so it is testable). Only whether the `Link` header names a
// rel="next" page is kept, so the API config screen can offer Link-header pagination; a cross-origin response exposes `Link` only if
// the server lists it in Access-Control-Expose-Headers.
function hasNextLinkRel(linkHeader) {
  if (typeof linkHeader !== 'string' || !linkHeader) return false;
  return linkHeader.split(/,(?=\s*<)/).some((part) => {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(part);
    return !!rel && (rel[1] ?? rel[2]).toLowerCase().split(/\s+/).includes('next');
  });
}

function buildEntry(url, method, status, contentType, bodyText, bodySkipped, requestHeaders, requestBodyText, requestBodySkipped, linkHeader) {
  const { body, truncated } = bodySkipped ? { body: '', truncated: false } : truncateBody(bodyText);
  const { body: requestBody, truncated: requestBodyTruncated } = requestBodySkipped ? { body: '', truncated: false } : truncateBody(requestBodyText);
  return {
    id: _nextId++,
    url,
    method: (method || 'GET').toUpperCase(),
    status,
    contentType: contentType || null,
    body,
    bodyTruncated: truncated,
    bodySkipped: !!bodySkipped,
    requestHeaders: requestHeaders || [],
    requestBody,
    requestBodyTruncated,
    requestBodySkipped: !!requestBodySkipped,
    hasNextLink: hasNextLinkRel(linkHeader),
  };
}

function recordEntry(url, method, status, contentType, bodyText, bodySkipped, requestHeaders, requestBodyText, requestBodySkipped, linkHeader) {
  if (!_recording) return;
  if (_entries.length >= MAX_CAPTURED_ENTRIES) return; // silently drop — buffer already at cap

  const entry = buildEntry(url, method, status, contentType, bodyText, bodySkipped, requestHeaders, requestBodyText, requestBodySkipped, linkHeader);
  _entries.push(entry);
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'sf-api-capture', type: 'API_CAPTURE_ENTRY', entry }, '*');
  }
}

// Classifies a request-body value synchronously: a string is captured, anything else is flagged as not capturable.
function classifyRequestBody(body) {
  if (body == null) return { text: '', skipped: false };
  return typeof body === 'string' ? { text: body, skipped: false } : { text: '', skipped: true };
}

// fetch only: init.body takes precedence over a Request's body (as for headers / method). A Request's body is only readable
// asynchronously (.clone().text()), so the Request-object fallback returns a Promise.
function readFetchRequestBody(initBody, request) {
  if (initBody != null) return Promise.resolve(classifyRequestBody(initBody));
  if (request && typeof request.clone === 'function') {
    return request.clone().text()
      .then((text) => ({ text, skipped: false }))
      .catch(() => ({ text: '', skipped: true }));
  }
  return Promise.resolve({ text: '', skipped: false });
}

// Persists the on / off flag in sessionStorage (per tab and origin, shared by both worlds) so a same-origin navigation, which re-runs
// this script and resets its state, can resume recording.
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

module.exports = {
  buildEntry,
  hasNextLinkRel,
  truncateBody,
  shouldSkipBody,
  normalizeHeaders,
  resolveUrl,
  classifyRequestBody,
  readFetchRequestBody,
  recordEntry,
  startRecording,
  stopRecording,
  shouldResumeRecording,
  MAX_CAPTURED_ENTRIES,
  MAX_BODY_CHARS,
  MAX_BODY_BYTES_TO_READ,
  MAX_REQUEST_HEADERS,
  MAX_HEADER_VALUE_CHARS,
};

// ── fetch / XHR interception ──
// Patches only real browser globals, so requiring this file under Jest installs nothing that would leak into other tests.

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
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
      const url = request ? request.url : resolveUrl(args[0]); // request.url is already absolute; a bare string arg may not be
      const method = (request && request.method) || (args[1] && args[1].method) || 'GET';
      // init.headers (2nd arg) takes precedence over a Request's own headers
      // — matches fetch's own override semantics when both are given.
      const headersLike = (args[1] && args[1].headers) || (request && request.headers) || null;
      const requestHeaders = normalizeHeaders(headersLike);
      const requestBodyPromise = readFetchRequestBody(args[1] && args[1].body, request);

      return originalFetch.apply(this, args).then((response) => {
        if (_recording) {
          const contentType = response.headers.get('content-type');
          const linkHeader = response.headers.get('link');
          requestBodyPromise.then(({ text: requestBodyText, skipped: requestBodySkipped }) => {
            if (shouldSkipBody(contentType, response.headers.get('content-length'))) {
              recordEntry(url, method, response.status, contentType, '', true, requestHeaders, requestBodyText, requestBodySkipped, linkHeader);
            } else {
              response.clone().text()
                .then((bodyText) => recordEntry(url, method, response.status, contentType, bodyText, false, requestHeaders, requestBodyText, requestBodySkipped, linkHeader))
                .catch(() => {}); // unreadable body (e.g. opaque cross-origin response) — just skip capturing it
            }
          });
        }
        return response;
      });
    };
  }

  if (typeof XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._sfMethod = method;
      this._sfUrl = resolveUrl(url);
      this._sfRequestHeaders = []; // reset — the same instance can be open()'d more than once
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      (this._sfRequestHeaders || (this._sfRequestHeaders = [])).push([name, value]);
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (_recording) {
        const requestHeaders = normalizeHeaders(this._sfRequestHeaders);
        const { text: requestBodyText, skipped: requestBodySkipped } = classifyRequestBody(args[0]);
        this.addEventListener('load', () => {
          if (!_recording) return;
          const contentType = this.getResponseHeader('content-type');
          const linkHeader = this.getResponseHeader('link');
          // The browser already buffers the whole response internally for
          // XHR regardless (unlike fetch, there's no lazy body stream to
          // avoid touching) — this at least skips copying it into our own
          // capture entry.
          if (shouldSkipBody(contentType, this.getResponseHeader('content-length'))) {
            recordEntry(this._sfUrl, this._sfMethod, this.status, contentType, '', true, requestHeaders, requestBodyText, requestBodySkipped, linkHeader);
            return;
          }
          let bodyText = '';
          try {
            bodyText = this.responseText; // throws for responseType 'blob'/'arraybuffer'/'document'
          } catch {
            // Not a text-ish response — capture the entry without a body.
          }
          recordEntry(this._sfUrl, this._sfMethod, this.status, contentType, bodyText, false, requestHeaders, requestBodyText, requestBodySkipped, linkHeader);
        });
      }
      return originalSend.apply(this, args);
    };
  }
}
