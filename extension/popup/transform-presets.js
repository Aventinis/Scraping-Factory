// @ts-check
// Issue #279: reusable, named transform-chain presets — pure data/logic, no
// DOM (see transform-presets-ui.js for rendering/wiring and the companion's
// /transform-presets endpoints for storage). A preset is just a saved
// FieldTransform[] in exactly the wire shape a field's own chain already
// uses, so applying one is a plain array copy into _state.pendingTransforms —
// the same slot all three transform editors (flat, container, API field
// modals) already share.
const SFTransformPresets = (function () {
  const { transformsAreValid } = typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;

  // Built-in presets ship with the extension itself (not the companion's
  // database): read-only, available even without a reachable companion, and
  // nothing to migrate when they change. Names come from i18n (nameKey), so
  // they follow the UI language. The price clean-up chain is the one Issue
  // #279 itself names as the natural first example (Issue #234's transform).
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

  // Mirrors the companion's ValidateTransformPresetChain closely enough that
  // the "Save as preset" button is only ever enabled for a chain the
  // companion will accept: at least one step, every step complete
  // (transformsAreValid), and no combine/split step (those reference other
  // fields by name, meaningless as a reusable chain).
  /**
   * @param {SFWire.FieldTransform[]} transforms
   * @returns {boolean}
   */
  function transformChainIsSaveable(transforms) {
    return transforms.length > 0
      && transformsAreValid(transforms)
      && !transforms.some(t => t.kind === 'combineFields' || t.kind === 'splitField');
  }

  return { BUILTIN_TRANSFORM_PRESETS, allTransformPresets, applyTransformPreset, transformChainIsSaveable };
})();

if (typeof module !== 'undefined') module.exports = SFTransformPresets;
if (typeof self !== 'undefined') self.SFTransformPresets = SFTransformPresets;
