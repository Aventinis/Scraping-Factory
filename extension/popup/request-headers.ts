// Custom request headers for flat / container / Blocks mode: pure data / logic (request-headers-ui.ts renders it). API mode has its
// own header editor (adopted from the recorded request); this is the hand-written DOM-mode counterpart.
//
// Draft (_state.requestHeaders), kept as typed so a half-edited row never blocks anything:
//   { enabled, rows: [{ name, kind: 'value' | 'env', value }] }
// `value` is the literal for kind 'value', or the *name* of an environment variable for 'env', never a secret literal.

import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';

export function createDefaultRequestHeaders(): SFDraft.RequestHeadersState {
  return { enabled: false, rows: [] };
}

export function addHeaderRow(state: SFDraft.RequestHeadersState): SFDraft.RequestHeadersState {
  return { ...state, rows: [...state.rows, { name: '', kind: 'value', value: '' }] };
}

/** Appends a ready-made row (a picked preset). */
export function appendHeaderRow(state: SFDraft.RequestHeadersState, row: SFDraft.RequestHeaderRow): SFDraft.RequestHeadersState {
  return { ...state, rows: [...state.rows, { ...row }] };
}

export function removeHeaderRow(state: SFDraft.RequestHeadersState, index: number): SFDraft.RequestHeadersState {
  return { ...state, rows: state.rows.filter((_, i) => i !== index) };
}

export function updateHeaderRow(
  state: SFDraft.RequestHeadersState, index: number, patch: Partial<SFDraft.RequestHeaderRow>,
): SFDraft.RequestHeadersState {
  return { ...state, rows: state.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) };
}

/** A row counts once its name and its value/variable name are filled in; an unfinished one is skipped, never blocks generation. */
export function rowIsComplete(row: SFDraft.RequestHeaderRow): boolean {
  return Boolean(row.name?.trim()) && Boolean(row.value?.trim());
}

/**
 * The wire `headers` list (ApiHeader shape), or null (toggle-off equivalent) when disabled or no row is complete. Duplicate names are
 * deliberately not merged here: the companion rejects them with a message naming the header.
 */
export function buildRequestHeadersConfig(state: SFDraft.RequestHeadersState | null | undefined): SFWire.ApiHeader[] | null {
  if (!state?.enabled) return null;
  const headers = state.rows.filter(rowIsComplete).map((row) => ({
    name: row.name.trim(),
    ...(row.kind === 'env' ? { environmentVariableName: row.value.trim() } : { value: row.value.trim() }),
  }));
  return headers.length > 0 ? headers : null;
}

/** Reverse of buildRequestHeadersConfig, for applyConfigToState. A header with neither a value nor a variable is skipped. */
export function applyRequestHeadersConfig(wire: SFWire.ApiHeader[] | null | undefined): SFDraft.RequestHeadersState {
  const rows: SFDraft.RequestHeaderRow[] = [];
  for (const header of wire || []) {
    if (header.environmentVariableName) rows.push({ name: header.name, kind: 'env', value: header.environmentVariableName });
    else if (header.value != null) rows.push({ name: header.name, kind: 'value', value: header.value });
  }
  return { enabled: rows.length > 0, rows };
}

/**
 * The one-time test values for the env-var-backed headers, as the wire `verificationValues` dict /generate expects (keyed by variable
 * name). Like the Fill actions' values: assembled only for the request, never persisted, logged or exported.
 */
export function buildHeaderVerificationValues(
  state: SFDraft.RequestHeadersState | null | undefined, testValues: Record<string, string> | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!state?.enabled) return result;
  for (const row of state.rows) {
    if (row.kind !== 'env' || !rowIsComplete(row)) continue;
    const name = row.value.trim();
    const testValue = testValues?.[name];
    if (testValue) result[name] = testValue;
  }
  return result;
}
