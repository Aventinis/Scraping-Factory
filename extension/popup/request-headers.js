// @ts-check
// Custom request headers for flat/container/Blocks mode (Issue #226) — pure
// data/logic only, no DOM (see request-headers-ui.js for rendering/event
// wiring, the same <feature>.js/<feature>-ui.js split every other popup
// feature uses). API mode keeps its own header editor on the API_CONFIG
// screen (adopted from the recorded request); this is the DOM-mode
// counterpart, written by hand because there's no recorded request to adopt
// from.
//
// Draft shape (_state.requestHeaders), kept as typed so a half-edited row
// never blocks anything:
//   { enabled, rows: [{ name, kind: 'value' | 'env', value }] }
// `value` is the header's literal value for kind 'value', or the *name* of an
// environment variable for kind 'env' — never a secret literal, the same
// credentials convention FillAction/ApiHeader already follow.
/** @returns {SFDraft.RequestHeadersState} */
function createDefaultRequestHeaders() {
  return { enabled: false, rows: [] };
}

/**
 * @param {SFDraft.RequestHeadersState} state
 * @returns {SFDraft.RequestHeadersState}
 */
function addHeaderRow(state) {
  return { ...state, rows: [...state.rows, { name: '', kind: 'value', value: '' }] };
}

/**
 * @param {SFDraft.RequestHeadersState} state
 * @param {number} index
 * @returns {SFDraft.RequestHeadersState}
 */
function removeHeaderRow(state, index) {
  return { ...state, rows: state.rows.filter((_, i) => i !== index) };
}

/**
 * @param {SFDraft.RequestHeadersState} state
 * @param {number} index
 * @param {Partial<SFDraft.RequestHeaderRow>} patch
 * @returns {SFDraft.RequestHeadersState}
 */
function updateHeaderRow(state, index, patch) {
  return { ...state, rows: state.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) };
}

/**
 * A row counts once both its name and its value/variable name are filled
 * in; an unfinished one is skipped rather than blocking generation (same
 * "incomplete draft = not sent" convention buildProxyConfig and the
 * hardening rows follow).
 * @param {SFDraft.RequestHeaderRow} row
 */
function rowIsComplete(row) {
  return Boolean(row.name?.trim()) && Boolean(row.value?.trim());
}

/**
 * Converts the draft into the wire `headers` list (ApiHeader shape), or
 * `null` (toggle-off equivalent) when disabled or no row is complete.
 * Duplicate names are deliberately *not* merged here — the companion
 * rejects them with a message naming the header, which is more helpful than
 * silently keeping one.
 * @param {SFDraft.RequestHeadersState | null | undefined} state
 * @returns {SFWire.ApiHeader[] | null}
 */
function buildRequestHeadersConfig(state) {
  if (!state?.enabled) return null;
  const headers = state.rows.filter(rowIsComplete).map((row) => ({
    name: row.name.trim(),
    ...(row.kind === 'env' ? { environmentVariableName: row.value.trim() } : { value: row.value.trim() }),
  }));
  return headers.length > 0 ? headers : null;
}

/**
 * Reverse of buildRequestHeadersConfig, for applyConfigToState. A header
 * with neither a value nor a variable (an API-mode-only template header can
 * never legitimately appear here) is skipped.
 * @param {SFWire.ApiHeader[] | null | undefined} wire
 * @returns {SFDraft.RequestHeadersState}
 */
function applyRequestHeadersConfig(wire) {
  /** @type {SFDraft.RequestHeaderRow[]} */
  const rows = [];
  for (const header of wire || []) {
    if (header.environmentVariableName) rows.push({ name: header.name, kind: 'env', value: header.environmentVariableName });
    else if (header.value != null) rows.push({ name: header.name, kind: 'value', value: header.value });
  }
  return { enabled: rows.length > 0, rows };
}

/**
 * The one-time test values for the env-var-backed headers, as the wire
 * `verificationValues` dict /generate expects (keyed by variable name) —
 * the same treatment buildVerificationValues gives Fill actions: assembled
 * only for the request, never persisted, logged or exported.
 * @param {SFDraft.RequestHeadersState | null | undefined} state
 * @param {Record<string, string> | null | undefined} testValues
 * @returns {Record<string, string>}
 */
function buildHeaderVerificationValues(state, testValues) {
  /** @type {Record<string, string>} */
  const result = {};
  if (!state?.enabled) return result;
  for (const row of state.rows) {
    if (row.kind !== 'env' || !rowIsComplete(row)) continue;
    const name = row.value.trim();
    const testValue = testValues?.[name];
    if (testValue) result[name] = testValue;
  }
  return result;
}

module.exports = {
  createDefaultRequestHeaders, addHeaderRow, removeHeaderRow, updateHeaderRow, rowIsComplete,
  buildRequestHeadersConfig, applyRequestHeadersConfig, buildHeaderVerificationValues,
};

