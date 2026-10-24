// ── Flat mode render / wiring ──
// The original mode's module: the flat fields list, the "+ Field" pick flow, modal-field-name and its transform-chain editor.
// Functions take a `bridge` instead of closing over popup.js state.
import type * as SFDraft from '../types/drafts';
import type * as SFWire from '../types/wire';
import type { PopupBridge, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { buildFlatFieldHighlight, wireHoverHighlight } from './hover-highlight';
import { t } from '../i18n/i18n';
import { STATES, escapeHtml } from './api-config';
import { addField, removeField, frameBadgeHtml } from './scraping-config-builder';
import { transformsAreValid, addTransform } from './field-transforms';
import { appendTextFilter } from './selector-text-filter';
import { resetTextFilter, effectiveMatchCount, wireTextFilter } from './selector-text-filter-ui';
import { renderTransformList, renderTransformPreview, wireTransformList } from './field-transforms-ui';
import { parseAllowedContentTypes, megabytesToBytes } from './container-tree';
import { isDerivedField } from './combine-split-fields';
import { openCombineFieldModal, openSplitFieldModal } from './combine-split-fields-ui';
import { renderMatchCountHint, populateAttributeSelect } from './field-modal';
import { byIdOrNull, qsOrNull } from './dom';

const log = createLogger('SF:Popup');

// A combine / split field has no real selector: show a distinguishing description instead (like container-tree.ts's groupNodeSuffix).
function fieldSelectorLabel(field: SFDraft.Field): string {
  if (isDerivedField(field.transforms)) {
    const transform = (field.transforms as SFWire.FieldTransform[])[0];
    return transform.kind === 'combineFields'
      ? t('group.combinedFieldMode', { sources: transform.sourceFieldNames.join(', ') })
      : t('group.splitFieldMode', { source: (transform as SFWire.SplitFieldTransform).sourceFieldName });
  }
  return field.selector as string; // a field without a selector is a derived one, handled above
}

export function renderFields(fields: SFDraft.Field[]): void {
  const listEl = byIdOrNull('fields-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  fields.forEach((field, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.dataset.index = String(i); // Issue #233: wireHoverHighlight resolves the hovered row's field by index
    const selectorLabel = fieldSelectorLabel(field);
    row.innerHTML =
      `<span class="field-name" title="${escapeHtml(field.name)}">${escapeHtml(field.name)}</span>` +
      `<span class="field-selector" title="${escapeHtml(selectorLabel)}">${escapeHtml(selectorLabel)}</span>` +
      (field.hiddenFromOutput ? `<span class="field-hidden-badge">${escapeHtml(t('group.hiddenFromOutputBadge'))}</span>` : '') +
      frameBadgeHtml(field.framePath) +
      `<button class="btn-danger btn-remove-field" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
    listEl.appendChild(row);
  });
}

// Live preview of the chain's output, reading the live mode / attribute DOM values (not _state). The value the chain would run on now:
// the picked element's text, or its chosen attribute (null until chosen); also read lazily by the transform editor's helpers.
function resolveFlatRawValue(state: State): string | null {
  const mode = byIdOrNull<HTMLSelectElement>('select-field-name-mode')?.value ?? 'text';
  if (mode === 'attribute') {
    const attrName = byIdOrNull<HTMLSelectElement>('select-field-name-attribute')?.value.trim();
    return attrName ? (state.pendingElementAttributes?.[attrName] ?? '').trim() : null;
  }
  return state.pendingRawText;
}

export function refreshFlatTransformPreview(bridge: PopupBridge): void {
  const state = bridge.getState();
  renderTransformPreview('field-transform-preview', resolveFlatRawValue(state), state.pendingTransforms);
}

// Called from render() once the confirmed-selection modal is flat mode's own. `isNewPick` tells a closed→open transition (reset
// name / focus) from a re-render caused by editing the transform chain (which must not wipe what is typed).
export function renderFlatFieldModal(bridge: PopupBridge, isNewPick: boolean): void {
  const state = bridge.getState();
  byIdOrNull('modal-field-name')?.classList.remove('hidden');
  // Blocks mode reuses this modal, but Download is not carried onto a block's fields: hide the whole mode / attribute / download block
  // there instead of exposing a control that silently does nothing.
  byIdOrNull('field-name-mode-section')?.classList.toggle('hidden', state.mode === 'blocks');
  if (isNewPick) {
    const input = byIdOrNull<HTMLInputElement>('input-field-name');
    if (input) { input.value = ''; input.focus(); }
    const modeSelect = byIdOrNull<HTMLSelectElement>('select-field-name-mode');
    if (modeSelect) modeSelect.value = 'text';
    byIdOrNull('field-name-attribute-row')?.classList.add('hidden');
    populateAttributeSelect('select-field-name-attribute', state.pendingElementAttributes);
    const downloadToggle = byIdOrNull<HTMLInputElement>('toggle-field-name-download');
    if (downloadToggle) downloadToggle.checked = false;
    byIdOrNull('field-name-download-options')?.classList.add('hidden');
    const maxSizeInput = byIdOrNull<HTMLInputElement>('input-field-name-download-max-size');
    if (maxSizeInput) maxSizeInput.value = '';
    const allowedTypesInput = byIdOrNull<HTMLInputElement>('input-field-name-download-allowed-types');
    if (allowedTypesInput) allowedTypesInput.value = '';
    resetTextFilter('input-field-name-text-filter', 'btn-field-name-use-text', state.pendingRawText);
  }
  renderMatchCountHint('field-name-match-count', effectiveMatchCount('input-field-name-text-filter', state.pendingMatchCount));
  renderTransformList('field-transform-list', state.pendingTransforms, () => resolveFlatRawValue(bridge.getState()));
  refreshFlatTransformPreview(bridge);
}

export function confirmField(bridge: PopupBridge): void {
  const state = bridge.getState();
  const name = byIdOrNull<HTMLInputElement>('input-field-name')?.value.trim();
  if (!name) return;
  const mode = byIdOrNull<HTMLSelectElement>('select-field-name-mode')?.value ?? 'text';
  const attribute = byIdOrNull<HTMLSelectElement>('select-field-name-attribute')?.value.trim();
  if (mode === 'attribute' && !attribute) return;
  const download = byIdOrNull<HTMLInputElement>('toggle-field-name-download')?.checked ?? false;
  const maxDownloadSizeBytes = megabytesToBytes(byIdOrNull<HTMLInputElement>('input-field-name-download-max-size')?.value as string);
  const allowedContentTypes = parseAllowedContentTypes(byIdOrNull<HTMLInputElement>('input-field-name-download-allowed-types')?.value as string);
  if (!transformsAreValid(state.pendingTransforms)) return;
  // Issue #227: an optional text the element must contain — appended as a
  // :contains("…") suffix; blank leaves the pick's selector untouched.
  const selector = appendTextFilter(state.pendingSelector as string, byIdOrNull<HTMLInputElement>('input-field-name-text-filter')?.value);
  log('FIELD_ADD', { name, selector, framePath: state.pendingFramePath, transforms: state.pendingTransforms });
  bridge.setState(STATES.IDLE, {
    fields: addField(state.fields, name, selector, {
      framePath: state.pendingFramePath, transforms: state.pendingTransforms,
      attribute: mode === 'attribute' ? attribute : null, download, maxDownloadSizeBytes, allowedContentTypes,
    }),
    pendingSelector:   null,
    pendingFramePath:  null,
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: null,
    pendingTransforms: [],
  });
}

export function wireFlatModeEvents(bridge: PopupBridge): void {
  // Issue #233: hovering a field row highlights its element(s) on the page.
  wireHoverHighlight(byIdOrNull('fields-list'), '.field-row',
    row => buildFlatFieldHighlight(bridge.getState().fields[parseInt(row.dataset.index as string, 10)]));

  byIdOrNull('btn-add-field')?.addEventListener('click', () => {
    log('BTN add-field → START_SELECTION');
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    bridge.setState(STATES.SELECTING, {
      pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (bridge.getState().domViewEnabled) {
      log('DOM view was enabled → re-requesting tree');
      bridge.requestDomTree();
    }
  });
  // Issue #206 follow-up: no click-based selection at all — opens the
  // shared combine/split creation modal directly (combine-split-fields-ui.ts).
  byIdOrNull('btn-add-combine-field')?.addEventListener('click', () => {
    openCombineFieldModal(bridge, { mode: 'flat' });
  });
  byIdOrNull('btn-add-split-field')?.addEventListener('click', () => {
    openSplitFieldModal(bridge, { mode: 'flat' });
  });
  byIdOrNull('btn-field-transform-add')?.addEventListener('click', () => {
    bridge.patchState({ pendingTransforms: addTransform(bridge.getState().pendingTransforms) });
  });
  wireTransformList(
    'field-transform-list',
    () => bridge.getState().pendingTransforms,
    (transforms) => bridge.patchState({ pendingTransforms: transforms }),
    () => resolveFlatRawValue(bridge.getState()),
  );
  // Issue #227: re-rendering the modal lets the match-count hint follow the
  // typed text (renderFlatFieldModal reads effectiveMatchCount each time).
  wireTextFilter({
    inputId: 'input-field-name-text-filter',
    useButtonId: 'btn-field-name-use-text',
    rerender: () => bridge.patchState({}),
    getRawText: () => bridge.getState().pendingRawText,
  });
  byIdOrNull('btn-field-confirm')?.addEventListener('click', () => confirmField(bridge));

  byIdOrNull('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField(bridge);
  });

  // Issue #214: same show/hide-on-change wiring container-tree-ui.ts's
  // wireContainerModeEvents already establishes for its own identical mode
  // select/download checkbox.
  byIdOrNull('select-field-name-mode')?.addEventListener('change', (e) => {
    byIdOrNull('field-name-attribute-row')?.classList.toggle('hidden', (e.target as HTMLSelectElement).value !== 'attribute');
    refreshFlatTransformPreview(bridge);
  });
  byIdOrNull('select-field-name-attribute')?.addEventListener('change', () => refreshFlatTransformPreview(bridge));
  byIdOrNull('toggle-field-name-download')?.addEventListener('change', (e) => {
    byIdOrNull('field-name-download-options')?.classList.toggle('hidden', !(e.target as HTMLInputElement).checked);
  });

  byIdOrNull('btn-field-cancel')?.addEventListener('click', () => {
    log('BTN field-cancel');
    bridge.setState(STATES.IDLE, { pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [] });
  });
  // Event delegation for "Remove" buttons in the field list
  byIdOrNull('fields-list')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index as string, 10);
    log('FIELD_REMOVE', { index, name: bridge.getState().fields[index]?.name });
    bridge.stopPreviewIfActive();
    bridge.setState(bridge.getState().current, { fields: removeField(bridge.getState().fields, index) });
  });
}
