// Reusable named transform-chain presets: pure (transform-presets-ui.js renders them; the companion's /transform-presets endpoints
// store them). A preset is a saved FieldTransform[] in the wire shape a field's chain already uses, so applying one is an array copy
// into _state.pendingTransforms, the slot all three transform editors share.
import type * as SFWire from '../types/wire';
import { transformsAreValid } from './field-transforms';

type Transforms = SFWire.FieldTransform[];

interface BuiltinPreset { id: string; builtin: true; nameKey: string; transforms: Transforms }

export interface TransformPresetOption {
  id: string;
  name: string;
  builtin: boolean;
  transforms: Transforms;
  savedId?: number;
}

/** A preset saved in the companion. */
export interface SavedPreset { id: number; name: string; transforms: Transforms }

// Built-ins ship with the extension: read-only, available without a companion, nothing to migrate. Names come from i18n (nameKey).
export const BUILTIN_TRANSFORM_PRESETS: BuiltinPreset[] = [
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

/** Built-ins first, then the user's saved presets (already ordered by name); saved ids are prefixed so they never collide. */
export function allTransformPresets(saved: SavedPreset[] | null | undefined, translate: (key: string) => string): TransformPresetOption[] {
  return [
    ...BUILTIN_TRANSFORM_PRESETS.map(p => ({ id: p.id, name: translate(p.nameKey), builtin: true, transforms: p.transforms })),
    ...(saved || []).map(p => ({ id: `saved:${p.id}`, name: p.name, builtin: false, transforms: p.transforms, savedId: p.id })),
  ];
}

/** Appends a copy of the preset's steps, never replacing the chain; the copy keeps later edits from reaching back into the preset. */
export function applyTransformPreset(transforms: Transforms, preset: { transforms: Transforms }): Transforms {
  return [...transforms, ...preset.transforms.map(step => ({ ...step }))];
}

/** Mirrors the companion's ValidateTransformPresetChain: at least one complete step, no combine/split (they reference other fields). */
export function transformChainIsSaveable(transforms: Transforms): boolean {
  return transforms.length > 0
    && transformsAreValid(transforms)
    && !transforms.some(t => t.kind === 'combineFields' || t.kind === 'splitField');
}
