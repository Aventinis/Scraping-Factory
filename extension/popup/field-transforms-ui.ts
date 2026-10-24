// Issue #84: DOM rendering + event wiring for the transform-chain editor —
// shared between modal-field-name (flat mode) and modal-field-extended
// (container mode), each with its own list/add-button element ids but
// backed by the same _state.pendingTransforms in popup.ts. Split out the
// same way container-tree-ui.ts/api-config-ui.js are (see their own doc
// comments for why).
//
// Unlike container-tree-ui.ts's handler functions (which take a `bridge`
// object because they need popup.ts's stopPreviewIfActive/requestDomTree
// too), this module only ever needs to read/write one piece of state — so
// wireTransformList takes plain getter/setter closures instead, supplied by
// whichever call site in popup.ts's wireEvents() actually owns _state.
import type * as SFWire from '../types/wire';
import { t } from '../i18n/i18n';
import {
  removeTransform, updateTransform, changeTransformKind, moveTransform, applyTransformsPreview, CURRENCY_FORMAT_IDS,
} from './field-transforms';
import { appendRegexHelperControls, wireRecipePanels, appendDateHelper, dateFormatPatchFor } from './transform-helpers-ui';
import type { RawValueGetter } from './transform-helpers-ui';
import { byIdOrNull } from './dom';

type Transforms = SFWire.FieldTransform[];
type TransformKind = SFWire.FieldTransform['kind'];
// The kinds whose rows end in the shared "on error" select.
type TypeConversionTransform = Extract<SFWire.FieldTransform, { kind: 'toInteger' | 'toBoolean' | 'toDate' | 'toCurrency' }>;

// Issue #234: i18n key suffix per currency-format preset (see
// transforms.currencyFormat.* in i18n/*.json).
const CURRENCY_FORMAT_LABEL_KEYS: Record<string, string> = { '1.234,56': 'commaDecimal', '1,234.56': 'dotDecimal', '1 234,56': 'spaceGrouped', "1'234.56": 'apostropheGrouped' };

// Long raw values (a whole paragraph clicked in Text mode) would otherwise
// stretch the modal — same defensive-cap spirit as api-capture.js's own
// MAX_BODY_CHARS, just a much smaller number since this is a one-line hint.
const MAX_PREVIEW_CHARS = 200;

function truncatePreviewValue(value: string): string {
  return value.length > MAX_PREVIEW_CHARS ? `${value.slice(0, MAX_PREVIEW_CHARS)}…` : value;
}

// Issue #206 follow-up: combineFields/splitField are no longer reachable
// through this generic per-field transform-kind dropdown — they have
// their own dedicated "Felder kombinieren"/"Feld aufteilen" creation flow
// (combine-split-fields.ts/-ui.js) instead, since neither kind actually
// transforms *this* field's own value the way every other kind here does.
const KIND_OPTIONS: Array<[TransformKind, string]> = [
  ['trim', 'transforms.trimOption'],
  ['regexExtract', 'transforms.regexExtractOption'],
  ['replace', 'transforms.replaceOption'],
  ['toNumber', 'transforms.toNumberOption'],
  ['toInteger', 'transforms.toIntegerOption'],
  ['toBoolean', 'transforms.toBooleanOption'],
  ['toDate', 'transforms.toDateOption'],
  ['toCurrency', 'transforms.toCurrencyOption'],
];

// Issue #205: shared by all three type-conversion kinds — an onError
// select plus, only when "useDefault" is actually picked, a default-value
// text input. Appended after whichever kind-specific inputs (if any) a
// given row already has.
function appendTypeConversionInputs(li: HTMLElement, transform: TypeConversionTransform): void {
  const onErrorSelect = document.createElement('select');
  onErrorSelect.className = 'transform-onerror-select';
  [
    ['KeepOriginal', 'transforms.onErrorKeepOriginalOption'],
    ['UseDefault', 'transforms.onErrorUseDefaultOption'],
  ].forEach(([value, labelKey]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(labelKey);
    if (value === transform.onError) option.selected = true;
    onErrorSelect.appendChild(option);
  });
  li.appendChild(onErrorSelect);

  if (transform.onError === 'UseDefault') {
    const defaultValueInput = document.createElement('input');
    defaultValueInput.type = 'text';
    defaultValueInput.className = 'transform-default-value-input';
    defaultValueInput.placeholder = t('transforms.defaultValuePlaceholder');
    defaultValueInput.value = transform.defaultValue ?? '';
    li.appendChild(defaultValueInput);
  }
}

function buildTransformRowEl(transform: SFWire.FieldTransform, index: number, total: number, getRawValue: RawValueGetter): HTMLElement {
  const li = document.createElement('li');
  li.className = 'transform-row';
  li.dataset.index = String(index);

  const select = document.createElement('select');
  select.className = 'transform-kind-select';
  KIND_OPTIONS.forEach(([value, labelKey]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(labelKey);
    if (value === transform.kind) option.selected = true;
    select.appendChild(option);
  });
  li.appendChild(select);

  if (transform.kind === 'regexExtract') {
    const patternInput = document.createElement('input');
    patternInput.type = 'text';
    patternInput.className = 'transform-pattern-input';
    patternInput.placeholder = t('transforms.patternPlaceholder');
    patternInput.value = transform.pattern;
    li.appendChild(patternInput);

    const groupInput = document.createElement('input');
    groupInput.type = 'number';
    groupInput.min = '0';
    groupInput.className = 'transform-group-input';
    groupInput.placeholder = t('transforms.groupPlaceholder');
    groupInput.value = String(transform.group);
    li.appendChild(groupInput);
    appendRegexHelperControls(li); // Issue #400: "Pattern helper" + "?" popover
  } else if (transform.kind === 'replace') {
    const findInput = document.createElement('input');
    findInput.type = 'text';
    findInput.className = 'transform-find-input';
    findInput.placeholder = t('transforms.findPlaceholder');
    findInput.value = transform.find;
    li.appendChild(findInput);

    const replacementInput = document.createElement('input');
    replacementInput.type = 'text';
    replacementInput.className = 'transform-replacement-input';
    replacementInput.placeholder = t('transforms.replacementPlaceholder');
    replacementInput.value = transform.replacement;
    li.appendChild(replacementInput);
  } else if (transform.kind === 'toDate') {
    const sourceFormatInput = document.createElement('input');
    sourceFormatInput.type = 'text';
    sourceFormatInput.className = 'transform-source-format-input';
    sourceFormatInput.placeholder = t('transforms.sourceFormatPlaceholder');
    sourceFormatInput.value = transform.sourceFormat ?? '';
    li.appendChild(sourceFormatInput);
    appendTypeConversionInputs(li, transform);
    appendDateHelper(li, transform, getRawValue); // Issue #400: "?" popover + the format guessed from the value
  } else if (transform.kind === 'toCurrency') {
    // Issue #234: each preset's option text is its own example amount plus
    // a short hint naming the decimal separator.
    const formatSelect = document.createElement('select');
    formatSelect.className = 'transform-currency-format-select';
    CURRENCY_FORMAT_IDS.forEach((format) => {
      const option = document.createElement('option');
      option.value = format;
      option.textContent = t(`transforms.currencyFormat.${CURRENCY_FORMAT_LABEL_KEYS[format]}`);
      if (format === transform.format) option.selected = true;
      formatSelect.appendChild(option);
    });
    li.appendChild(formatSelect);
    appendTypeConversionInputs(li, transform);
  } else if (transform.kind === 'toInteger' || transform.kind === 'toBoolean') {
    appendTypeConversionInputs(li, transform);
  }

  const moveUpBtn = document.createElement('button');
  moveUpBtn.type = 'button';
  moveUpBtn.className = 'btn-secondary btn-tiny btn-transform-move-up';
  moveUpBtn.textContent = '↑';
  moveUpBtn.disabled = index === 0;
  li.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement('button');
  moveDownBtn.type = 'button';
  moveDownBtn.className = 'btn-secondary btn-tiny btn-transform-move-down';
  moveDownBtn.textContent = '↓';
  moveDownBtn.disabled = index === total - 1;
  li.appendChild(moveDownBtn);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-danger btn-transform-remove';
  removeBtn.textContent = t('common.remove');
  li.appendChild(removeBtn);

  return li;
}

// Issue #400: `getRawValue` returns the picked value the chain runs on (or null) —
// read lazily, since the helpers (date-format guess, recipe preview) must follow
// what the modal currently shows (e.g. a changed attribute).
export function renderTransformList(listElId: string, transforms: Transforms, getRawValue: RawValueGetter = () => null): void {
  const root = byIdOrNull(listElId);
  if (!root) return;
  root.innerHTML = '';
  transforms.forEach((transform, i) => root.appendChild(buildTransformRowEl(transform, i, transforms.length, getRawValue)));
}

// Issue #143: live "what would this chain actually produce" hint, run
// against the raw value of the element the user just picked. rawValue is
// null/undefined when there's nothing to preview yet — no pick at all, or
// (container mode, attribute type) the attribute name input is still
// blank — in which case the hint is hidden entirely rather than showing a
// misleading empty result.
export function renderTransformPreview(elId: string, rawValue: string | null | undefined, transforms: Transforms): void {
  const el = byIdOrNull(elId);
  if (!el) return;
  if (rawValue === null || rawValue === undefined) {
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('warn');
    return;
  }
  el.classList.remove('hidden');
  const result = applyTransformsPreview(rawValue, transforms);
  if (result === null) {
    el.textContent = t('transforms.previewUnavailable');
    el.classList.add('warn');
  } else {
    el.classList.remove('warn');
    el.textContent = t('transforms.previewLabel', {
      value: result === '' ? t('transforms.previewEmptyValue') : truncatePreviewValue(result),
    });
  }
}

// Wired once (in popup.ts's wireEvents()) per list root — event delegation
// survives renderTransformList's innerHTML rebuild, same as the group
// tree's own delegated click handler.
export function wireTransformList(
  listElId: string, getTransforms: () => Transforms, setTransforms: (transforms: Transforms) => void, getRawValue: RawValueGetter = () => null,
): void {
  const root = byIdOrNull(listElId);
  if (!root) return;

  // Issue #400: the regex "Pattern helper" panel — writes pattern + group like typing them.
  wireRecipePanels(root, getRawValue, (index, recipe) => {
    setTransforms(updateTransform(getTransforms(), index, { pattern: recipe.pattern, group: recipe.group }));
  });

  root.addEventListener('change', (e) => {
    // The row's controls are inputs or selects; which one is told by its class below.
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const row = target.closest<HTMLElement>('.transform-row');
    if (!row) return;
    const index = parseInt(row.dataset.index as string, 10);
    const transforms = getTransforms();

    if (target.classList.contains('transform-kind-select')) {
      let changed = changeTransformKind(transforms, index, target.value as TransformKind);
      // Issue #400: "Convert to date" starts with the format guessed from the picked value.
      if (target.value === 'toDate') {
        const patch = dateFormatPatchFor(getRawValue());
        if (patch) changed = updateTransform(changed, index, patch);
      }
      setTransforms(changed);
    } else if (target.classList.contains('transform-pattern-input')) {
      setTransforms(updateTransform(transforms, index, { pattern: target.value }));
    } else if (target.classList.contains('transform-group-input')) {
      const group = parseInt(target.value, 10);
      setTransforms(updateTransform(transforms, index, { group: Number.isFinite(group) && group >= 0 ? group : 0 }));
    } else if (target.classList.contains('transform-find-input')) {
      setTransforms(updateTransform(transforms, index, { find: target.value }));
    } else if (target.classList.contains('transform-replacement-input')) {
      setTransforms(updateTransform(transforms, index, { replacement: target.value }));
    } else if (target.classList.contains('transform-source-format-input')) {
      setTransforms(updateTransform(transforms, index, { sourceFormat: target.value }));
    } else if (target.classList.contains('transform-currency-format-select')) {
      setTransforms(updateTransform(transforms, index, { format: target.value }));
    } else if (target.classList.contains('transform-onerror-select')) {
      setTransforms(updateTransform(transforms, index, { onError: target.value }));
    } else if (target.classList.contains('transform-default-value-input')) {
      setTransforms(updateTransform(transforms, index, { defaultValue: target.value }));
    }
  });

  root.addEventListener('click', (e) => {
    const target = e.target as Element;
    const row = target.closest<HTMLElement>('.transform-row');
    if (!row) return;
    const index = parseInt(row.dataset.index as string, 10);
    const transforms = getTransforms();

    if (target.closest('.btn-transform-move-up')) setTransforms(moveTransform(transforms, index, -1));
    else if (target.closest('.btn-transform-move-down')) setTransforms(moveTransform(transforms, index, 1));
    else if (target.closest('.btn-transform-remove')) setTransforms(removeTransform(transforms, index));
  });
}
