// @ts-check
// Issue #407: rarely needed options sit under a remembered "Advanced"
// disclosure. A returning user whose setting differs from the default must not
// find it tucked away, so the owning renderer opens the disclosure once when
// one of these says the option is in use. Pure: no DOM, no state access.
const { createDefaultDeduplication } = require('./dedup-config');

/** The codes a fresh "Retry on transient errors" starts with (popup.js). */
const DEFAULT_RETRY_STATUS_CODES = [429, 502, 503, 504];

/**
 * @param {string | undefined | null} text status codes as typed, any separator
 * @returns {boolean} true when the list is not the default one (order ignored)
 */
function retryStatusCodesDiffer(text) {
  const codes = [...new Set(String(text ?? '').split(/[^0-9]+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const defaults = [...DEFAULT_RETRY_STATUS_CODES].sort((a, b) => a - b);
  return codes.length !== defaults.length || codes.some((c, i) => c !== defaults[i]);
}

/**
 * @param {{ retentionKind: string, retentionValueText: string } | undefined | null} dedup
 * @returns {boolean} true when "remember …" was changed from its default
 */
function dedupRetentionDiffers(dedup) {
  if (!dedup) return false;
  const defaults = createDefaultDeduplication();
  return dedup.retentionKind !== defaults.retentionKind || String(dedup.retentionValueText).trim() !== String(defaults.retentionValueText);
}

module.exports = { DEFAULT_RETRY_STATUS_CODES, retryStatusCodesDiffer, dedupRetentionDiffers };
