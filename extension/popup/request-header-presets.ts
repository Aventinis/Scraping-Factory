// Common request headers for the "Send custom request headers" picker: pure data / logic (request-headers-ui.ts renders it). Instead of
// an empty row with a free-text name, the user picks what they want ("a language", "an API key", ...) and gets a valid row with the
// header name, a sensible kind (fixed value vs. environment variable) and an example. The wire format is untouched: a preset produces
// the same { name, kind, value } draft row a hand-typed header would.

import type * as SFDraft from '../types/drafts';

export interface RequestHeaderPreset {
  /** Stable id; also the i18n key suffix (requestHeaderPresets.<id>). */
  id: string;
  /** The header name ('' for "other"). */
  name: string;
  /** Suggested kind: secrets default to an environment variable. */
  kind: 'value' | 'env';
  /** Example value (kind 'value') or suggested variable name (kind 'env'). */
  value: string;
  /** The header typically carries a credential. */
  secret: boolean;
}

export const REQUEST_HEADER_PRESETS: RequestHeaderPreset[] = [
  { id: 'acceptLanguage', name: 'Accept-Language', kind: 'value', value: 'en-US,en;q=0.9', secret: false },
  { id: 'referer', name: 'Referer', kind: 'value', value: 'https://www.google.com/', secret: false },
  { id: 'userAgent', name: 'User-Agent', kind: 'value', value: 'Mozilla/5.0 (compatible; MyScraper/1.0)', secret: false },
  { id: 'cookie', name: 'Cookie', kind: 'env', value: 'SITE_COOKIE', secret: true },
  { id: 'authorization', name: 'Authorization', kind: 'env', value: 'AUTH_TOKEN', secret: true },
  { id: 'apiKey', name: 'X-Api-Key', kind: 'env', value: 'API_KEY', secret: true },
];

/** Id of the "type the name yourself" entry of the picker. */
export const OTHER_PRESET_ID = 'other';

export function presetById(id: string): RequestHeaderPreset | null {
  return REQUEST_HEADER_PRESETS.find((preset) => preset.id === id) || null;
}

/** The preset a header name belongs to (case-insensitive, like header names), or null when the picker has no entry for it. */
export function presetForName(name: string): RequestHeaderPreset | null {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return REQUEST_HEADER_PRESETS.find((preset) => preset.name.toLowerCase() === wanted) || null;
}

/** A ready-to-use draft row. Complete on purpose, so picking a header never leaves an unfinished row the builder would skip. */
export function rowFromPreset(preset: RequestHeaderPreset): SFDraft.RequestHeaderRow {
  return { name: preset.name, kind: preset.kind, value: preset.value };
}

// Names that almost always carry a credential: the exact well-known ones, plus anything containing token/secret/password/auth or
// ending in "-key" (a custom "X-Auth-Token" is no less secret than "Authorization").
const SECRET_NAME_EXACT = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'api-key', 'apikey']);
const SECRET_NAME_PATTERN = /(token|secret|passw|auth|api[-_]?key)|[-_]key$/i;

/** Whether a header with this name usually holds a credential (warned about when its value is fixed, i.e. plain text in the script). */
export function isSecretHeaderName(name: string): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  return SECRET_NAME_EXACT.has(trimmed.toLowerCase()) || SECRET_NAME_PATTERN.test(trimmed);
}

/** A valid environment-variable name derived from a header name ("X-Auth-Token" -> "X_AUTH_TOKEN"); a known preset keeps its own. */
export function suggestHeaderEnvName(headerName: string): string {
  const preset = presetForName(headerName);
  if (preset && preset.kind === 'env') return preset.value;
  const base = String(headerName || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!base) return 'HEADER_VALUE';
  return /^[0-9]/.test(base) ? `HEADER_${base}` : base;
}
