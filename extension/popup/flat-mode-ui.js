// ── Flat mode render / wiring ──
// The original mode's module: the flat fields list, the "+ Field" pick flow, modal-field-name and its transform-chain editor.
// Functions take a `bridge` instead of closing over popup.js state.
const { createLogger } = require('../shared/logger');
const { buildFlatFieldHighlight, wireHoverHighlight } = require('./hover-highlight');
const log = createLogger('SF:Popup');
const { t } = require('../i18n/i18n');
const { STATES, escapeHtml } = require('./api-config');
const { addField, removeField, frameBadgeHtml } = require('./scraping-config-builder');
const { transformsAreValid, addTransform } = require('./field-transforms');
const { appendTextFilter } = require('./selector-text-filter');
const { resetTextFilter, effectiveMatchCount, wireTextFilter } = require('./selector-text-filter-ui');
const { renderTransformList, renderTransformPreview, wireTransformList } = require('./field-transforms-ui');
// Pure data helpers are imported from container-tree.js; small DOM helpers (renderMatchCountHint) are duplicated instead.
const { guessUrlAttribute, parseAllowedContentTypes, megabytesToBytes } = require('./container-tree');
const { isDerivedField } = require('./combine-split-fields');
const { openCombineFieldModal, openSplitFieldModal } = require('./combine-split-fields-ui');

// A combine / split field has no real selector: show a distinguishing description instead (like container-tree.js's groupNodeSuffix).
function fieldSelectorLabel(field) {
  if (isDerivedField(field.transforms)) {
    const transform = field.transforms[0];
    return transform.kind === 'combineFields'
      ? t('group.combinedFieldMode', { sources: transform.sourceFieldNames.join(', ') })
      : t('group.splitFieldMode', { source: transform.sourceFieldName });
  }
  return field.selector;
}

function renderFields(fields) {
  const listEl = document.getElementById('fields-list');
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

// Match-count feedback next to the name input the instant a selector is picked. count is null before a pick or if the content
// script could not compute it; the hint stays hidden then. Duplicated in container-tree-ui.js (its modal needs the same hint).
function renderMatchCountHint(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (count === null || count === undefined) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = t('modals.matchCount.found', { count });
  el.classList.toggle('warn', count === 0);
  el.classList.remove('hidden');
}

// Live preview of the chain's output, reading the live mode / attribute DOM values (not _state). The value the chain would run on now:
// the picked element's text, or its chosen attribute (null until chosen); also read lazily by the transform editor's helpers.
function resolveFlatRawValue(state) {
  const mode = document.getElementById('select-field-name-mode')?.value ?? 'text';
  if (mode === 'attribute') {
    const attrName = document.getElementById('select-field-name-attribute')?.value.trim();
    return attrName ? (state.pendingElementAttributes?.[attrName] ?? '').trim() : null;
  }
  return state.pendingRawText;
}

function refreshFlatTransformPreview(bridge) {
  const state = bridge.getState();
  renderTransformPreview('field-transform-preview', resolveFlatRawValue(state), state.pendingTransforms);
}

// The attribute picker, like container-tree-ui.js's populateAttributeSelect (duplicated, not shared).
function populateFlatAttributeSelect(attributes) {
  const select = document.getElementById('select-field-name-attribute');
  if (!select) return;
  const entries = Object.entries(attributes || {});
  if (entries.length === 0) {
    select.innerHTML = `<option value="">${escapeHtml(t('modals.fieldExtended.noAttributesFound'))}</option>`;
    return;
  }
  const guess = guessUrlAttribute(attributes);
  select.innerHTML = entries.map(([name, value]) => {
    const preview = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    const label = preview ? `${name}: ${preview}` : name;
    return `<option value="${escapeHtml(name)}"${name === guess ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

// Called from render() once the confirmed-selection modal is flat mode's own. `isNewPick` tells a closed→open transition (reset
// name / focus) from a re-render caused by editing the transform chain (which must not wipe what is typed).
function renderFlatFieldModal(bridge, isNewPick) {
  const state = bridge.getState();
  document.getElementById('modal-field-name')?.classList.remove('hidden');
  // Blocks mode reuses this modal, but Download is not carried onto a block's fields: hide the whole mode / attribute / download block
  // there instead of exposing a control that silently does nothing.
  document.getElementById('field-name-mode-section')?.classList.toggle('hidden', state.mode === 'blocks');
  if (isNewPick) {
    const input = document.getElementById('input-field-name');
    if (input) { input.value = ''; input.focus(); }
    const modeSelect = document.getElementById('select-field-name-mode');
    if (modeSelect) modeSelect.value = 'text';
    document.getElementById('field-name-attribute-row')?.classList.add('hidden');
    populateFlatAttributeSelect(state.pendingElementAttributes);
    const downloadToggle = document.getElementById('toggle-field-name-download');
    if (downloadToggle) downloadToggle.checked = false;
    document.getElementById('field-name-download-options')?.classList.add('hidden');
    const maxSizeInput = document.getElementById('input-field-name-download-max-size');
    if (maxSizeInput) maxSizeInput.value = '';
    const allowedTypesInput = document.getElementById('input-field-name-download-allowed-types');
    if (allowedTypesInput) allowedTypesInput.value = '';
    resetTextFilter('input-field-name-text-filter', 'btn-field-name-use-text', state.pendingRawText);
  }
  renderMatchCountHint('field-name-match-count', effectiveMatchCount('input-field-name-text-filter', state.pendingMatchCount));
  renderTransformList('field-transform-list', state.pendingTransforms, () => resolveFlatRawValue(bridge.getState()));
  refreshFlatTransformPreview(bridge);
}

function confirmField(bridge) {
  const state = bridge.getState();
  const name = document.getElementById('input-field-name')?.value.trim();
  if (!name) return;
  const mode = document.getElementById('select-field-name-mode')?.value ?? 'text';
  const attribute = document.getElementById('select-field-name-attribute')?.value.trim();
  if (mode === 'attribute' && !attribute) return;
  const download = document.getElementById('toggle-field-name-download')?.checked ?? false;
  const maxDownloadSizeBytes = megabytesToBytes(document.getElementById('input-field-name-download-max-size')?.value);
  const allowedContentTypes = parseAllowedContentTypes(document.getElementById('input-field-name-download-allowed-types')?.value);
  if (!transformsAreValid(state.pendingTransforms)) return;
  // Issue #227: an optional text the element must contain — appended as a
  // :contains("…") suffix; blank leaves the pick's selector untouched.
  const selector = appendTextFilter(state.pendingSelector, document.getElementById('input-field-name-text-filter')?.value);
  log('FIELD_ADD', { name, selector, framePath: state.pendingFramePath, transforms: state.pendingTransforms });
  bridge.setState(STATES.IDLE, {
    fields: addField(
      state.fields, name, selector, state.pendingFramePath, state.pendingTransforms,
      mode === 'attribute' ? attribute : null, download, maxDownloadSizeBytes, allowedContentTypes,
    ),
    pendingSelector:   null,
    pendingFramePath:  null,
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: null,
    pendingTransforms: [],
  });
}

function wireFlatModeEvents(bridge) {
  // Issue #233: hovering a field row highlights its element(s) on the page.
  wireHoverHighlight(document.getElementById('fields-list'), '.field-row',
    row => buildFlatFieldHighlight(bridge.getState().fields[parseInt(row.dataset.index, 10)]));

  document.getElementById('btn-add-field')?.addEventListener('click', () => {
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
  // shared combine/split creation modal directly (combine-split-fields-ui.js).
  document.getElementById('btn-add-combine-field')?.addEventListener('click', () => {
    openCombineFieldModal(bridge, { mode: 'flat' });
  });
  document.getElementById('btn-add-split-field')?.addEventListener('click', () => {
    openSplitFieldModal(bridge, { mode: 'flat' });
  });
  document.getElementById('btn-field-transform-add')?.addEventListener('click', () => {
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
  document.getElementById('btn-field-confirm')?.addEventListener('click', () => confirmField(bridge));

  document.getElementById('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField(bridge);
  });

  // Issue #214: same show/hide-on-change wiring container-tree-ui.js's
  // wireContainerModeEvents already establishes for its own identical mode
  // select/download checkbox.
  document.getElementById('select-field-name-mode')?.addEventListener('change', (e) => {
    document.getElementById('field-name-attribute-row')?.classList.toggle('hidden', e.target.value !== 'attribute');
    refreshFlatTransformPreview(bridge);
  });
  document.getElementById('select-field-name-attribute')?.addEventListener('change', () => refreshFlatTransformPreview(bridge));
  document.getElementById('toggle-field-name-download')?.addEventListener('change', (e) => {
    document.getElementById('field-name-download-options')?.classList.toggle('hidden', !e.target.checked);
  });

  document.getElementById('btn-field-cancel')?.addEventListener('click', () => {
    log('BTN field-cancel');
    bridge.setState(STATES.IDLE, { pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [] });
  });
  // Event delegation for "Remove" buttons in the field list
  document.getElementById('fields-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    log('FIELD_REMOVE', { index, name: bridge.getState().fields[index]?.name });
    bridge.stopPreviewIfActive();
    bridge.setState(bridge.getState().current, { fields: removeField(bridge.getState().fields, index) });
  });
}

module.exports = {
  renderFields, renderMatchCountHint, refreshFlatTransformPreview, renderFlatFieldModal,
  confirmField, wireFlatModeEvents,
};

