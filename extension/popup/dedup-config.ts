// Deduplication by key field(s): pure data / logic (dedup-config-ui.js renders it).
//
// Draft (_state.deduplication), kept as typed so a half-edited number never blocks anything (the draft is forgiving, the wire is
// strict, like buildRequestDelayConfig / buildRetryConfig):
//   { enabled, keyFields: string[], incremental, appendOutput, retentionKind: 'MaxCount' | 'MaxAge', retentionValueText }
// keyFields are field names from the current mode's field list (collectFieldNames): the (composite) identity of a row / element.

import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';

type RetentionKind = 'MaxCount' | 'MaxAge';

export const DEFAULT_MAX_COUNT = 100000;
export const DEFAULT_MAX_AGE_DAYS = 90;

export function createDefaultDeduplication(): SFDraft.DeduplicationState {
  return {
    enabled: false,
    keyFields: [],
    incremental: false,
    appendOutput: false,
    retentionKind: 'MaxCount',
    retentionValueText: String(DEFAULT_MAX_COUNT),
  };
}

export function defaultRetentionValue(kind: RetentionKind): number {
  return kind === 'MaxAge' ? DEFAULT_MAX_AGE_DAYS : DEFAULT_MAX_COUNT;
}

/** Switching the retention kind swaps the value to that kind's own default: the other kind's number would be nonsense. */
export function setRetentionKind(dedup: SFDraft.DeduplicationState, kind: RetentionKind): SFDraft.DeduplicationState {
  if (dedup.retentionKind === kind) return dedup;
  return { ...dedup, retentionKind: kind, retentionValueText: String(defaultRetentionValue(kind)) };
}

export function addKeyField(dedup: SFDraft.DeduplicationState, name: string): SFDraft.DeduplicationState {
  if (!name || dedup.keyFields.includes(name)) return dedup;
  return { ...dedup, keyFields: [...dedup.keyFields, name] };
}

export function removeKeyField(dedup: SFDraft.DeduplicationState, index: number): SFDraft.DeduplicationState {
  return { ...dedup, keyFields: dedup.keyFields.filter((_, i) => i !== index) };
}

/** A positive whole number, else the kind's default: a blank or garbled retention box never blocks generation (clamp, don't error). */
export function parseRetentionValue(text: string | undefined, kind: RetentionKind): number {
  const n = parseInt(String(text ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : defaultRetentionValue(kind);
}

/**
 * The wire `DeduplicationConfig`, or null (toggle-off equivalent) when disabled or no key field is left valid. Key fields no longer
 * in `availableFieldNames` (renamed or removed since being picked) are dropped here instead of being rejected by the companion.
 */
export function buildDeduplicationConfig(
  dedup: SFDraft.DeduplicationState | null | undefined, availableFieldNames?: string[],
): SFWire.DeduplicationConfig | null {
  if (!dedup?.enabled) return null;
  const keyFields = (dedup.keyFields || []).filter(
    name => name && (!availableFieldNames || availableFieldNames.includes(name)),
  );
  if (keyFields.length === 0) return null;

  const wire: SFWire.DeduplicationConfig = { keyFields };
  if (dedup.incremental) {
    wire.incremental = true;
    wire.incrementalOutput = dedup.appendOutput ? 'Append' : 'Delta';
    wire.retention = { kind: dedup.retentionKind, value: parseRetentionValue(dedup.retentionValueText, dedup.retentionKind) };
  }
  return wire;
}

/** Reverse of buildDeduplicationConfig, for applyConfigToState. */
export function applyDeduplicationConfig(wire: SFWire.DeduplicationConfig | null | undefined): SFDraft.DeduplicationState {
  const defaults = createDefaultDeduplication();
  if (!wire?.keyFields?.length) return defaults;
  const kind = wire.retention?.kind === 'MaxAge' ? 'MaxAge' : 'MaxCount';
  return {
    enabled: true,
    keyFields: [...wire.keyFields],
    incremental: wire.incremental === true,
    appendOutput: wire.incrementalOutput === 'Append',
    retentionKind: kind,
    retentionValueText: wire.retention?.value ? String(wire.retention.value) : String(defaultRetentionValue(kind)),
  };
}
