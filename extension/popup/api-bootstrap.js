// @ts-check
/** @import * as SFWire from '../types/wire' */
/** @import * as SFDraft from '../types/drafts' */
// API mode: the token/auth bootstrap — pure data/logic (api-bootstrap-ui.js renders it). A bootstrap is one request the
// script sends at the start of every run, extracting a short-lived value from the JSON response that is spliced into the
// main request's headers ("Bearer {token}") and/or URL.
//
// Draft (apiConfigDraft.bootstrap, null = none):
//   { name, method, url, valuePath, bodyEncoding: 'Json' | 'Form',
//     headers:    [{ name, mode: 'literal' | 'env', value, envName }],
//     bodyFields: [{ name, mode: 'literal' | 'env', value, envName }] }
// A credential row in 'env' mode sends only an environment-variable *name*. A URL part carrying the bootstrap value uses the
// pseudo source kind BOOTSTRAP_SOURCE_KIND; buildApiConfig turns it into a "{<name>}" placeholder, never a declared
// parameter (parameter values become output columns).
const BOOTSTRAP_SOURCE_KIND = 'bootstrap';
const DEFAULT_BOOTSTRAP_NAME = 'token';

// Names that almost certainly carry a credential: a row picked up from a recording defaults to env-var mode instead of
// embedding the recorded literal.
const CREDENTIAL_NAME_PATTERN = /pass(word)?|secret|token|api[-_]?key|credential|authorization|^key$/i;

// Request headers the browser (not the page's own script) sets, or that
// describe the recorded body rather than the credentials — never worth
// adopting into the bootstrap request's own header list.
const IGNORED_HEADER_PATTERN = /^(content-type|content-length|accept|accept-encoding|accept-language|user-agent|origin|referer|cookie|host|connection)$/i;

/**
 * @returns {SFDraft.ApiBootstrap}
 */
function createDefaultBootstrapDraft() {
  return {
    name: DEFAULT_BOOTSTRAP_NAME, method: 'POST', url: '', valuePath: '', bodyEncoding: 'Json',
    headers: [], bodyFields: [],
  };
}

/**
 * @param {'literal' | 'env'} [mode]
 * @returns {SFDraft.ApiBootstrapPair}
 */
function createBootstrapPair(mode = 'literal') {
  return { name: '', mode, value: '', envName: '' };
}

// "client_secret" -> "API_CLIENT_SECRET": a ready-to-use, valid
// environment-variable name (ScrapingPlanValidator's
// EnvironmentVariableNamePattern) the user can keep or rename.
/**
 * @param {string} name
 * @returns {string}
 */
function suggestEnvVarName(name) {
  const base = String(name || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return base ? `API_${base}` : 'API_SECRET';
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {SFDraft.ApiBootstrapPair}
 */
function pairFromRecorded(name, value) {
  return CREDENTIAL_NAME_PATTERN.test(name)
    ? { name, mode: 'env', value: '', envName: suggestEnvVarName(name) }
    : { name, mode: 'literal', value, envName: '' };
}

// A recorded body → bootstrap body fields + encoding. Only a flat JSON object or a form-encoded string (what
// ApiBootstrap.BodyFields models); a nested value is kept as JSON text in a literal field so nothing silently disappears.
/**
 * @param {string | null | undefined} requestBody
 * @param {Array<{name: string, value: string}>} [requestHeaders]
 * @returns {{ bodyFields: SFDraft.ApiBootstrapPair[], bodyEncoding: 'Json' | 'Form' }}
 */
function parseRecordedBody(requestBody, requestHeaders = []) {
  const contentType = (requestHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value || '').toLowerCase();
  const text = (requestBody || '').trim();
  if (!text) return { bodyFields: [], bodyEncoding: contentType.includes('form-urlencoded') ? 'Form' : 'Json' };

  if (!contentType.includes('form-urlencoded')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const bodyFields = Object.entries(parsed).map(([name, value]) =>
          pairFromRecorded(name, typeof value === 'string' ? value : JSON.stringify(value)));
        return { bodyFields, bodyEncoding: 'Json' };
      }
    } catch {
      // not JSON — fall through to the form-encoded attempt below
    }
  }

  if (contentType.includes('form-urlencoded') || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(text)) {
    const bodyFields = Array.from(new URLSearchParams(text).entries()).map(([name, value]) => pairFromRecorded(name, value));
    return { bodyFields, bodyEncoding: 'Form' };
  }
  return { bodyFields: [], bodyEncoding: 'Json' };
}

// Every string leaf of a parsed JSON value, with its path in the same
// minimal dot/[n] DSL the generated script's _resolve_field understands.
/**
 * @param {*} value
 * @param {string} [path]
 * @param {Array<{path: string, value: string}>} [out]
 * @returns {Array<{path: string, value: string}>}
 */
function collectStringLeaves(value, path = '', out = []) {
  if (typeof value === 'string') {
    out.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => collectStringLeaves(item, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => collectStringLeaves(child, path ? `${path}.${key}` : key, out));
  }
  return out;
}

// Finds the token in a recorded response: the string leaf whose value shows up in the main request (headers or URL), else
// the first leaf whose key looks like a token. Values under 8 characters never match the first rule.
/**
 * @param {*} responseJson
 * @param {string[]} mainRequestStrings
 * @returns {{ path: string, value: string } | null}
 */
function detectTokenInResponse(responseJson, mainRequestStrings) {
  const leaves = collectStringLeaves(responseJson);
  const usedInMainRequest = leaves.find(leaf =>
    leaf.value.length >= 8 && mainRequestStrings.some(s => typeof s === 'string' && s.includes(leaf.value)));
  if (usedInMainRequest) return usedInMainRequest;
  return leaves.find(leaf => /(^|[._\[])(access_?token|id_?token|token|jwt|bearer|session_?id|nonce)$/i.test(leaf.path)) || null;
}

// A recorded request → a bootstrap draft plus the detected token value (or null), for auto-wiring the main request.
/**
 * @param {SFDraft.ApiCaptureEntry} entry
 * @param {{ url?: string, capturedHeaders?: Array<{name: string, value: string}> }} mainRequest
 * @param {string} [name]
 * @returns {{ bootstrap: SFDraft.ApiBootstrap, tokenValue: string | null }}
 */
function bootstrapDraftFromCaptureEntry(entry, mainRequest, name = DEFAULT_BOOTSTRAP_NAME) {
  const method = entry.method === 'POST' ? 'POST' : 'GET';
  const requestHeaders = entry.requestHeaders || [];
  const { bodyFields, bodyEncoding } = method === 'POST' && !entry.requestBodySkipped
    ? parseRecordedBody(entry.requestBody, requestHeaders)
    : { bodyFields: [], bodyEncoding: /** @type {'Json'} */ ('Json') };
  const headers = requestHeaders
    .filter(h => !IGNORED_HEADER_PATTERN.test(h.name))
    .map(h => pairFromRecorded(h.name, h.value));

  let detected = null;
  try {
    const mainStrings = [mainRequest.url || '', ...(mainRequest.capturedHeaders || []).map(h => h.value)];
    detected = detectTokenInResponse(JSON.parse(entry.body || ''), mainStrings);
  } catch {
    // not a JSON response — the user has to type the JSON path themselves
  }

  return {
    bootstrap: { name, method, url: entry.url, valuePath: detected?.path || '', bodyEncoding, headers, bodyFields },
    tokenValue: detected?.value || null,
  };
}

// "Bearer eyJ…" + token "eyJ…" → "Bearer {token}" — or null when the
// header doesn't contain the token at all.
/**
 * @param {string} headerValue
 * @param {string} tokenValue
 * @param {string} name
 * @returns {string | null}
 */
function suggestHeaderTemplate(headerValue, tokenValue, name) {
  if (!tokenValue || typeof headerValue !== 'string' || !headerValue.includes(tokenValue)) return null;
  return headerValue.split(tokenValue).join(`{${name}}`);
}

// Auto-wires the main request once the token is known: every header containing it becomes a template ("Bearer {token}"),
// every query parameter whose value is it becomes a bootstrap-sourced part. Returns only the draft keys it changed.
/**
 * @param {*} draft
 * @param {string | null} tokenValue
 * @param {string} name
 * @returns {Record<string, *>}
 */
function wireTokenIntoMainRequest(draft, tokenValue, name) {
  if (!tokenValue) return {};
  const headerDecisions = { ...draft.headerDecisions };
  (draft.capturedHeaders || []).forEach((/** @type {{name: string, value: string}} */ header) => {
    const template = suggestHeaderTemplate(header.value, tokenValue, name);
    if (template) headerDecisions[header.name] = { include: true, mode: 'bootstrap', envName: '', template };
  });
  const parameterSources = { ...draft.parameterSources };
  const queryParams = draft.urlParts.queryParams.map((/** @type {*} */ param) => {
    if (param.value !== tokenValue) return param;
    parameterSources[`query:${param.key}`] = { kind: BOOTSTRAP_SOURCE_KIND };
    return { ...param, variable: true };
  });
  return { headerDecisions, parameterSources, urlParts: { ...draft.urlParts, queryParams } };
}

/**
 * @param {SFDraft.ApiBootstrapPair} pair
 * @returns {boolean}
 */
function pairIsComplete(pair) {
  return !!pair.name?.trim() && (pair.mode === 'env' ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.envName?.trim() || '') : true);
}

// Gates "Apply"; mirrors ScrapingPlanValidator.ValidateApiBootstrap closely enough to avoid a 400.
/**
 * @param {SFDraft.ApiBootstrap | null | undefined} bootstrap
 * @returns {boolean}
 */
function bootstrapDraftIsComplete(bootstrap) {
  if (!bootstrap) return true;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bootstrap.name?.trim() || '')) return false;
  if (!/^https?:\/\/[^\s{}]+$/i.test(bootstrap.url?.trim() || '')) return false;
  if (!bootstrap.valuePath?.trim()) return false;
  if (!bootstrap.headers.every(pairIsComplete)) return false;
  if (bootstrap.method !== 'POST' && bootstrap.bodyFields.length > 0) return false;
  return bootstrap.bodyFields.every(pairIsComplete);
}

/**
 * @param {SFDraft.ApiBootstrapPair} pair
 * @returns {{ name: string, value?: string, environmentVariableName?: string }}
 */
function serializePair(pair) {
  return pair.mode === 'env'
    ? { name: pair.name.trim(), environmentVariableName: pair.envName.trim() }
    : { name: pair.name.trim(), value: pair.value ?? '' };
}

// Draft → wire ApiBootstrap; empty lists and the default method / encoding are sent explicitly (a new object).
/**
 * @param {SFDraft.ApiBootstrap | null | undefined} bootstrap
 * @returns {SFWire.ApiBootstrap | null}
 */
function buildApiBootstrap(bootstrap) {
  if (!bootstrap) return null;
  return {
    name: bootstrap.name.trim(),
    method: bootstrap.method,
    url: bootstrap.url.trim(),
    ...(bootstrap.headers.length > 0 ? { headers: bootstrap.headers.map(serializePair) } : {}),
    ...(bootstrap.method === 'POST' && bootstrap.bodyFields.length > 0
      ? { bodyFields: bootstrap.bodyFields.map(serializePair), bodyEncoding: bootstrap.bodyEncoding }
      : {}),
    valuePath: bootstrap.valuePath.trim(),
  };
}

// A bootstrap-sourced part takes the bootstrap's name as placeholder name, whatever name it carries.
/**
 * @param {*} urlParts
 * @param {Record<string, {kind?: string}>} partSources keyed by part id
 * @param {string} bootstrapName
 * @returns {*}
 */
function resolveBootstrapUrlParts(urlParts, partSources, bootstrapName) {
  const isBootstrap = (/** @type {string} */ id) => partSources[id]?.kind === BOOTSTRAP_SOURCE_KIND;
  return {
    ...urlParts,
    pathSegments: urlParts.pathSegments.map((/** @type {*} */ seg, /** @type {number} */ i) =>
      seg.variable && isBootstrap(`path:${i}`) ? { ...seg, name: bootstrapName } : seg),
    queryParams: urlParts.queryParams.map((/** @type {*} */ param) =>
      param.variable && isBootstrap(`query:${param.key}`) ? { ...param, name: bootstrapName } : param),
  };
}

// Turning the bootstrap off: bootstrap-mode headers fall back to their recorded literal, bootstrap-sourced URL parts lose
// their source. Returns only the draft keys it changed.
/**
 * @param {*} draft
 * @returns {Record<string, *>}
 */
function stripBootstrapReferences(draft) {
  /** @type {Record<string, *>} */
  const headerDecisions = {};
  Object.entries(draft.headerDecisions || {}).forEach(([name, decision]) => {
    headerDecisions[name] = decision.mode === 'bootstrap' ? { ...decision, mode: 'literal', template: '' } : decision;
  });
  /** @type {Record<string, *>} */
  const parameterSources = {};
  Object.entries(draft.parameterSources || {}).forEach(([id, source]) => {
    if (source?.kind !== BOOTSTRAP_SOURCE_KIND) parameterSources[id] = source;
  });
  return { headerDecisions, parameterSources };
}

// One-time test values for the bootstrap's credential env vars, keyed by name and sent only with /generate (mirrors
// buildVerificationValues).
/**
 * @param {SFWire.ApiConfig | null | undefined} apiConfig
 * @param {Record<string, string>} testValues
 * @returns {Record<string, string>}
 */
function buildBootstrapVerificationValues(apiConfig, testValues) {
  /** @type {Record<string, string>} */
  const result = {};
  const bootstrap = apiConfig?.bootstrap;
  if (!bootstrap) return result;
  [...(bootstrap.headers || []), ...(bootstrap.bodyFields || [])].forEach((pair) => {
    const name = pair.environmentVariableName;
    if (name && testValues?.[name]) result[name] = testValues[name];
  });
  return result;
}

module.exports = {
  BOOTSTRAP_SOURCE_KIND, DEFAULT_BOOTSTRAP_NAME,
  createDefaultBootstrapDraft, createBootstrapPair, suggestEnvVarName, parseRecordedBody,
  collectStringLeaves, detectTokenInResponse, bootstrapDraftFromCaptureEntry, suggestHeaderTemplate,
  wireTokenIntoMainRequest, stripBootstrapReferences, bootstrapDraftIsComplete, buildApiBootstrap, resolveBootstrapUrlParts,
  buildBootstrapVerificationValues,
};

