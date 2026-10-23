// @ts-check
// Common request headers for the "Send custom request headers" picker: pure data / logic (request-headers-ui.js renders it). Instead of
// an empty row with a free-text name, the user picks what they want ("a language", "an API key", ...) and gets a valid row with the
// header name, a sensible kind (fixed value vs. environment variable) and an example. The wire format is untouched: a preset produces
// the same { name, kind, value } draft row a hand-typed header would.

/**
 * @typedef {Object} RequestHeaderPreset
 * @property {string} id            stable id; also the i18n key suffix (requestHeaderPresets.<id>)
 * @property {string} name          the header name ('' for "other")
 * @property {'value' | 'env'} kind suggested kind — secrets default to an environment variable
 * @property {string} value         example value (kind 'value') or suggested variable name (kind 'env')
 * @property {boolean} secret       the header typically carries a credential
 */

/** @type {RequestHeaderPreset[]} */
const REQUEST_HEADER_PRESETS = [
  { id: 'acceptLanguage', name: 'Accept-Language', kind: 'value', value: 'en-US,en;q=0.9', secret: false },
  { id: 'referer', name: 'Referer', kind: 'value', value: 'https://www.google.com/', secret: false },
  { id: 'userAgent', name: 'User-Agent', kind: 'value', value: 'Mozilla/5.0 (compatible; MyScraper/1.0)', secret: false },
  { id: 'cookie', name: 'Cookie', kind: 'env', value: 'SITE_COOKIE', secret: true },
  { id: 'authorization', name: 'Authorization', kind: 'env', value: 'AUTH_TOKEN', secret: true },
  { id: 'apiKey', name: 'X-Api-Key', kind: 'env', value: 'API_KEY', secret: true },
];

/** Id of the "type the name yourself" entry of the picker. */
const OTHER_PRESET_ID = 'other';

/**
 * @param {string} id
 * @returns {RequestHeaderPreset | null}
 */
function presetById(id) {
  return REQUEST_HEADER_PRESETS.find((preset) => preset.id === id) || null;
}

/**
 * The preset a header name belongs to (case-insensitive — header names are),
 * or null for a header the picker has no entry for.
 * @param {string} name
 * @returns {RequestHeaderPreset | null}
 */
function presetForName(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return REQUEST_HEADER_PRESETS.find((preset) => preset.name.toLowerCase() === wanted) || null;
}

/**
 * A ready-to-use draft row for a preset. Complete on purpose (name and
 * value/variable set), so picking a header never leaves an unfinished row
 * that the builder would silently skip.
 * @param {RequestHeaderPreset} preset
 * @returns {SFDraft.RequestHeaderRow}
 */
function rowFromPreset(preset) {
  return { name: preset.name, kind: preset.kind, value: preset.value };
}

// Names that almost always carry a credential. Beyond the exact well-known
// ones, anything that *contains* token/secret/password/auth, or ends in
// "-key", is treated the same — a custom "X-Auth-Token" is no less secret
// than "Authorization".
const SECRET_NAME_EXACT = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'api-key', 'apikey']);
const SECRET_NAME_PATTERN = /(token|secret|passw|auth|api[-_]?key)|[-_]key$/i;

/**
 * Whether a header with this name usually holds a credential — used to warn
 * when its value is a fixed one (which ends up in the script as plain text).
 * @param {string} name
 */
function isSecretHeaderName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  return SECRET_NAME_EXACT.has(trimmed.toLowerCase()) || SECRET_NAME_PATTERN.test(trimmed);
}

/**
 * A valid environment-variable name derived from a header name, offered when
 * the user switches a secret header to "Environment variable":
 * "X-Auth-Token" -> "X_AUTH_TOKEN". A known preset keeps its own suggestion.
 * @param {string} headerName
 */
function suggestHeaderEnvName(headerName) {
  const preset = presetForName(headerName);
  if (preset && preset.kind === 'env') return preset.value;
  const base = String(headerName || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!base) return 'HEADER_VALUE';
  return /^[0-9]/.test(base) ? `HEADER_${base}` : base;
}

module.exports = {
  REQUEST_HEADER_PRESETS,
  OTHER_PRESET_ID,
  presetById,
  presetForName,
  rowFromPreset,
  isSecretHeaderName,
  suggestHeaderEnvName,
};
