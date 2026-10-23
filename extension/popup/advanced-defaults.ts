// Rarely needed options sit under a remembered "Advanced" disclosure. A returning user whose setting differs from the default
// must not find it tucked away, so the owning renderer opens the disclosure once when one of these says the option is in use.
// Pure: no DOM, no state access.
import { createDefaultDeduplication } from './dedup-config';

/** The codes a fresh "Retry on transient errors" starts with (popup.js). */
export const DEFAULT_RETRY_STATUS_CODES = [429, 502, 503, 504];

/** True when the status codes as typed (any separator, order ignored) are not the default list. */
export function retryStatusCodesDiffer(text: string | null | undefined): boolean {
  const codes = [...new Set(String(text ?? '').split(/[^0-9]+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const defaults = [...DEFAULT_RETRY_STATUS_CODES].sort((a, b) => a - b);
  return codes.length !== defaults.length || codes.some((c, i) => c !== defaults[i]);
}

/** True when "remember …" was changed from its default. */
export function dedupRetentionDiffers(dedup: { retentionKind: string; retentionValueText: string } | null | undefined): boolean {
  if (!dedup) return false;
  const defaults = createDefaultDeduplication();
  return dedup.retentionKind !== defaults.retentionKind || String(dedup.retentionValueText).trim() !== String(defaults.retentionValueText);
}
