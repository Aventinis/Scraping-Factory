// @ts-check
// API mode: token/auth bootstrap value (Issue #220) — pure data/logic only,
// no DOM (see api-bootstrap-ui.js for rendering/event wiring, the same
// <feature>.js/<feature>-ui.js split api-config.js/api-config-ui.js already
// use). A bootstrap is one extra request the generated script sends once at
// the start of every run (e.g. a POST to a login/token endpoint), extracting
// a single short-lived value from its JSON response via a JSON path; that
// value is then spliced into the main request's headers ("Bearer {token}")
// and/or URL.
//
// Draft shape (apiConfigDraft.bootstrap, null = no bootstrap):
//   { name, method, url, valuePath, bodyEncoding: 'Json' | 'Form',
//     headers:    [{ name, mode: 'literal' | 'env', value, envName }],
//     bodyFields: [{ name, mode: 'literal' | 'env', value, envName }] }
// A credential row in 'env' mode is sent as an environment-variable *name*
// only — the same FillAction/ApiHeader convention that keeps a password out
// of the generated script.
//
// A URL part that should carry the bootstrap value uses the pseudo source
// kind BOOTSTRAP_SOURCE_KIND in apiConfigDraft.parameterSources — it renders
// like any other value-source option, but resolveBootstrapUrlParts/
// buildApiConfig turn it into a "{<bootstrap name>}" placeholder instead of
// a declared ApiParameter (the bootstrap value must never become one: a
// parameter's value ends up as an output column).
const SFApiBootstrap = (function () {
  const BOOTSTRAP_SOURCE_KIND = 'bootstrap';
  const DEFAULT_BOOTSTRAP_NAME = 'token';

  // Body-field/header names that almost certainly carry a credential — a
  // row picked up from a recorded request with one of these names defaults
  // to environment-variable mode instead of embedding the recorded literal
  // (which would otherwise put e.g. a real password into the script).
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

  // A recorded request body → bootstrap body fields + encoding. Only a flat
  // JSON object or a form-encoded string is supported (the narrow shape
  // ApiBootstrap.BodyFields models) — a nested JSON value is kept as its
  // JSON text in a literal field rather than dropped, so nothing the token
  // endpoint expects silently disappears. Anything unparseable yields no
  // fields at all.
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

  // Finds the token within a recorded bootstrap response: preferably the
  // string leaf whose value actually shows up in the main request (its
  // headers or URL — e.g. "Authorization: Bearer <that value>"), the one
  // signal that proves it's really the value the API wants; otherwise the
  // first leaf whose key looks like a token. Short values (< 8 chars) are
  // never matched by the first rule, so an incidental "ok"/"en" can't
  // masquerade as a token just because it also appears in a URL.
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

  // A recorded request (a GET_API_CAPTURE_ENTRIES entry) → a ready bootstrap
  // draft, plus the detected token value (or null) the caller can use to
  // auto-wire the main request's own headers/URL. `mainRequest` is the
  // already-confirmed main request: its captured headers and URL are where
  // detectTokenInResponse looks for the token's actual use.
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

  // Auto-wires the main request once a recorded bootstrap's token is known:
  // every captured header containing it switches to template mode (e.g.
  // "Authorization: Bearer {token}"), every URL query parameter whose value
  // *is* it becomes a bootstrap-sourced variable part. Returns only the
  // draft keys it changed (headerDecisions/urlParts/parameterSources), for
  // the caller to merge into apiConfigDraft.
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

  // Gates the API_CONFIG screen's "Apply" alongside
  // apiConfigDraftHasAllSourcesChosen — mirrors ScrapingPlanValidator's own
  // ValidateApiBootstrap closely enough that a draft passing here won't get
  // a 400 back from /generate for a structural bootstrap problem.
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

  // Draft → wire ApiBootstrap (companion/.../IR/ApiConfig.cs). Empty lists
  // and the default method/encoding are still sent explicitly — unlike most
  // optional wire keys, there's no "omitted = today's behavior" concern for
  // a brand-new object.
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

  // Every URL part whose value source is BOOTSTRAP_SOURCE_KIND gets the
  // bootstrap's own name as its placeholder name (so buildUrlTemplate
  // renders "{token}"), regardless of whatever (possibly blank) name the
  // part itself carries.
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

  // Turning the bootstrap off must not leave the main request pointing at a
  // value that no longer exists: every header in bootstrap mode falls back
  // to its recorded literal value, every bootstrap-sourced URL part loses
  // its (now meaningless) source and must be given a real one again. Returns
  // only the draft keys it changed, like wireTokenIntoMainRequest.
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

  // Issue #43's verification-value convention, extended to the bootstrap:
  // one-time test values for its credential env vars, keyed by env-var
  // name, sent only with the /generate request so a token flow can be
  // verified without the credential being an OS env var on the companion
  // host. Mirrors buildVerificationValues (scraping-config-builder.js).
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

  return {
    BOOTSTRAP_SOURCE_KIND, DEFAULT_BOOTSTRAP_NAME,
    createDefaultBootstrapDraft, createBootstrapPair, suggestEnvVarName, parseRecordedBody,
    collectStringLeaves, detectTokenInResponse, bootstrapDraftFromCaptureEntry, suggestHeaderTemplate,
    wireTokenIntoMainRequest, stripBootstrapReferences, bootstrapDraftIsComplete, buildApiBootstrap, resolveBootstrapUrlParts,
    buildBootstrapVerificationValues,
  };
})();

if (typeof module !== 'undefined') module.exports = SFApiBootstrap;
if (typeof self !== 'undefined') self.SFApiBootstrap = SFApiBootstrap;
