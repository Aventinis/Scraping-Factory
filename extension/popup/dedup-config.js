// @ts-check
// Deduplication by key field(s): pure data / logic (dedup-config-ui.js renders it).
//
// Draft (_state.deduplication), kept as typed so a half-edited number never blocks anything (the draft is forgiving, the wire is
// strict, like buildRequestDelayConfig / buildRetryConfig):
//   { enabled, keyFields: string[], incremental, appendOutput, retentionKind: 'MaxCount' | 'MaxAge', retentionValueText }
// keyFields are field names from the current mode's field list (collectFieldNames): the (composite) identity of a row / element.
const DEFAULT_MAX_COUNT = 100000;
const DEFAULT_MAX_AGE_DAYS = 90;

/** @returns {SFDraft.DeduplicationState} */
function createDefaultDeduplication() {
  return {
    enabled: false,
    keyFields: [],
    incremental: false,
    appendOutput: false,
    retentionKind: 'MaxCount',
    retentionValueText: String(DEFAULT_MAX_COUNT),
  };
}

/** @param {'MaxCount' | 'MaxAge'} kind */
function defaultRetentionValue(kind) {
  return kind === 'MaxAge' ? DEFAULT_MAX_AGE_DAYS : DEFAULT_MAX_COUNT;
}

/**
 * Switching the retention kind swaps the value to that kind's own default —
 * "100000" days or "90" remembered items would both be nonsense carried
 * over from the other kind.
 * @param {SFDraft.DeduplicationState} dedup
 * @param {'MaxCount' | 'MaxAge'} kind
 * @returns {SFDraft.DeduplicationState}
 */
function setRetentionKind(dedup, kind) {
  if (dedup.retentionKind === kind) return dedup;
  return { ...dedup, retentionKind: kind, retentionValueText: String(defaultRetentionValue(kind)) };
}

/**
 * @param {SFDraft.DeduplicationState} dedup
 * @param {string} name
 * @returns {SFDraft.DeduplicationState}
 */
function addKeyField(dedup, name) {
  if (!name || dedup.keyFields.includes(name)) return dedup;
  return { ...dedup, keyFields: [...dedup.keyFields, name] };
}

/**
 * @param {SFDraft.DeduplicationState} dedup
 * @param {number} index
 * @returns {SFDraft.DeduplicationState}
 */
function removeKeyField(dedup, index) {
  return { ...dedup, keyFields: dedup.keyFields.filter((_, i) => i !== index) };
}

/**
 * A positive whole number, else the kind's own default — a blank/garbled
 * retention box must never block generation, the same "clamp, don't
 * error" rule buildRetryConfig follows for its own number inputs.
 * @param {string | undefined} text
 * @param {'MaxCount' | 'MaxAge'} kind
 */
function parseRetentionValue(text, kind) {
  const n = parseInt(String(text ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : defaultRetentionValue(kind);
}

/**
 * Converts the editable draft into the wire `DeduplicationConfig`, or
 * `null` (toggle-off-equivalent) when it's disabled or no key field is
 * (still) valid. Key fields no longer present in the current mode's field
 * list (renamed/removed since being picked) are dropped here rather than
 * sent to be rejected by the companion — the same silent-skip convention
 * the null-rate/required-fields hardening rows follow.
 * @param {SFDraft.DeduplicationState | null | undefined} dedup
 * @param {string[]} [availableFieldNames] when given, key fields not in it are dropped
 * @returns {SFWire.DeduplicationConfig | null}
 */
function buildDeduplicationConfig(dedup, availableFieldNames) {
  if (!dedup?.enabled) return null;
  const keyFields = (dedup.keyFields || []).filter(
    name => name && (!availableFieldNames || availableFieldNames.includes(name)),
  );
  if (keyFields.length === 0) return null;

  /** @type {SFWire.DeduplicationConfig} */
  const wire = { keyFields };
  if (dedup.incremental) {
    wire.incremental = true;
    wire.incrementalOutput = dedup.appendOutput ? 'Append' : 'Delta';
    wire.retention = { kind: dedup.retentionKind, value: parseRetentionValue(dedup.retentionValueText, dedup.retentionKind) };
  }
  return wire;
}

/**
 * Reverse of buildDeduplicationConfig, for applyConfigToState.
 * @param {SFWire.DeduplicationConfig | null | undefined} wire
 * @returns {SFDraft.DeduplicationState}
 */
function applyDeduplicationConfig(wire) {
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

module.exports = {
  DEFAULT_MAX_COUNT, DEFAULT_MAX_AGE_DAYS,
  createDefaultDeduplication, defaultRetentionValue, setRetentionKind, addKeyField, removeKeyField,
  parseRetentionValue, buildDeduplicationConfig, applyDeduplicationConfig,
};

