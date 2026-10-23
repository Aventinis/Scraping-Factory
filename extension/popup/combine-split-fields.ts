// Issue #206 follow-up: pure, DOM-free helpers backing the dedicated
// "Felder kombinieren"/"Feld aufteilen" field creation flow — replaces the
// original Issue #206 design, where combineFields/splitField were just two
// more kinds in the generic per-field transform-chain editor
// (field-transforms.ts/-ui.js), reachable only by first faking a normal
// field (a click-based selector pick the resulting value never actually
// uses). A combine/split-derived field has no selector/path of its own —
// its whole value comes from other already-configured sibling fields — so
// it gets its own creation modal instead (combine-split-fields-ui.js),
// never a click-based pick.
import type * as SFWire from '../types/wire';

// True when `transforms` is exactly the shape the dedicated creation flow
// below produces: a single combineFields/splitField transform, nothing
// else. Mirrors the companion's own ScrapingPlanValidator.IsDerivedField
// (same "must be the first transform" rule) — used by every mode's own
// row renderer to show a distinguishing label instead of a (functionally
// unused) selector/path.
export function isDerivedField(transforms: SFWire.FieldTransform[] | null | undefined): boolean {
  return Array.isArray(transforms) && transforms.length > 0 &&
    (transforms[0].kind === 'combineFields' || transforms[0].kind === 'splitField');
}

// Issue #407: the split modal shows "Part (1 = first)" — people count from
// one — while the wire format (SplitFieldTransform.Index) stays 0-based.
// These two are the only place the +1/-1 lives.
export function partNumberToIndex(partNumber: number): number {
  return Number.isFinite(partNumber) && partNumber >= 1 ? Math.floor(partNumber) - 1 : 0;
}

export function indexToPartNumber(index: number): number {
  return Number.isFinite(index) && index >= 0 ? Math.floor(index) + 1 : 1;
}

export function buildCombineFieldsTransform(sourceFieldNames: string[], separator?: string): SFWire.CombineFieldsTransform {
  return { kind: 'combineFields', sourceFieldNames, separator: separator || ' ' };
}

export function buildSplitFieldTransform(sourceFieldName: string, separator: string | undefined, index: number): SFWire.SplitFieldTransform {
  return { kind: 'splitField', sourceFieldName, separator: separator || ' ', index: Number.isFinite(index) && index >= 0 ? index : 0 };
}

// Same structural checks field-transforms.ts's own transformsAreValid
// already applies to these two kinds when they could still appear inside
// an arbitrary chain — exposed directly here since the dedicated modals
// below only ever build one transform at a time, not a whole chain.
export function combineFieldsIsValid(sourceFieldNames: string[] | null | undefined): boolean {
  return Array.isArray(sourceFieldNames) && sourceFieldNames.length >= 2;
}

export function splitFieldIsValid(sourceFieldName: string | null | undefined): boolean {
  return !!sourceFieldName && sourceFieldName.trim() !== '';
}
