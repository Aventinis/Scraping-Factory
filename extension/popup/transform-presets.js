// @ts-check
// Reusable named transform-chain presets: pure (transform-presets-ui.js renders them; the companion's /transform-presets endpoints store them).
// A preset is a saved FieldTransform[] in the wire shape a field's chain already uses, so applying one is an array copy into
// _state.pendingTransforms, the slot all three transform editors share.
const { transformsAreValid } = require('./field-transforms');

// Built-in presets ship with the extension: read-only, available without a companion, nothing to migrate. Names come from i18n (nameKey).
// The price clean-up chain (trim + toCurrency) is the natural first example.
/** @type {Array<{id: string, builtin: true, nameKey: string, transforms: SFWire.FieldTransform[]}>} */
const BUILTIN_TRANSFORM_PRESETS = [
  {
    id: 'builtin:price-comma-decimal',
    builtin: true,
    nameKey: 'transformPresets.builtinPriceCommaDecimal',
    transforms: [{ kind: 'trim' }, { kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' }],
  },
  {
    id: 'builtin:price-dot-decimal',
    builtin: true,
    nameKey: 'transformPresets.builtinPriceDotDecimal',
    transforms: [{ kind: 'trim' }, { kind: 'toCurrency', format: '1,234.56', onError: 'KeepOriginal', defaultValue: '' }],
  },
];

// Built-ins first, then the user's own saved presets (already ordered by
// name by the companion), as one list of {id, name, builtin, transforms}.
// Saved ids are prefixed so they can never collide with a built-in's.
/**
 * @param {Array<{id: number, name: string, transforms: SFWire.FieldTransform[]}> | null | undefined} saved
 * @param {(key: string) => string} translate
 * @returns {Array<{id: string, name: string, builtin: boolean, transforms: SFWire.FieldTransform[], savedId?: number}>}
 */
function allTransformPresets(saved, translate) {
  return [
    ...BUILTIN_TRANSFORM_PRESETS.map(p => ({ id: p.id, name: translate(p.nameKey), builtin: true, transforms: p.transforms })),
    ...(saved || []).map(p => ({ id: `saved:${p.id}`, name: p.name, builtin: false, transforms: p.transforms, savedId: p.id })),
  ];
}

// Appends (never replaces — Issue #279's own scope decision: an existing
// chain is never lost) a deep copy of the preset's steps, so editing the
// applied steps afterward can't reach back into the preset itself.
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @param {{transforms: SFWire.FieldTransform[]}} preset
 * @returns {SFWire.FieldTransform[]}
 */
function applyTransformPreset(transforms, preset) {
  return [...transforms, ...preset.transforms.map(step => ({ ...step }))];
}

// Mirrors the companion's ValidateTransformPresetChain so "Save as preset" is only enabled for a chain it will accept: at least one step, every
// step complete, no combine / split (they reference other fields by name).
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @returns {boolean}
 */
function transformChainIsSaveable(transforms) {
  return transforms.length > 0
    && transformsAreValid(transforms)
    && !transforms.some(t => t.kind === 'combineFields' || t.kind === 'splitField');
}

module.exports = { BUILTIN_TRANSFORM_PRESETS, allTransformPresets, applyTransformPreset, transformChainIsSaveable };

