// ── Flat mode: "Fields (flat)" render + event-wiring ────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — flat mode was the original mode and, unlike
// container mode (container-tree.js/container-tree-ui.js) and API mode
// (api-config.js/api-config-ui.js), never got its own module. This is that
// module: the flat fields list, the "+ Datenfeld" pick flow, modal-field-name,
// and the transform-chain editor for it. Functions take a `bridge` object
// (same convention as api-config-ui.js/container-tree-ui.js) instead of
// closing over popup.js's own module-level state.
const SFFlatModeUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { STATES, escapeHtml } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { addField, removeField, frameBadgeHtml } =
    typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;
  const { transformsAreValid, addTransform } =
    typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;
  const { renderTransformList, renderTransformPreview, wireTransformList } =
    typeof require !== 'undefined' ? require('./field-transforms-ui') : self.SFFieldTransformsUI;
  // Issue #214: guessUrlAttribute/parseAllowedContentTypes/megabytesToBytes
  // are pure data helpers (not DOM-rendering ones), so they're imported
  // straight from container-tree.js rather than duplicated — same "small
  // DOM helpers get duplicated, pure logic doesn't" convention this
  // codebase already draws elsewhere (see renderMatchCountHint).
  const { guessUrlAttribute, parseAllowedContentTypes, megabytesToBytes } =
    typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;
  const { isDerivedField } =
    typeof require !== 'undefined' ? require('./combine-split-fields') : self.SFCombineSplitFields;
  const { openCombineFieldModal, openSplitFieldModal } =
    typeof require !== 'undefined' ? require('./combine-split-fields-ui') : self.SFCombineSplitFieldsUI;

  // Issue #206 follow-up: a field created through the dedicated combine/
  // split flow has no real selector (see addField's own doc comment) —
  // shows a distinguishing description instead of the (functionally
  // unused) selector string, mirroring container-tree.js's own
  // groupNodeSuffix branch for the identical case.
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

  // Issue #85: existence/quantity feedback next to the name input, the
  // instant a selector is picked — mirrors previewSummary's own
  // count/warn-styling pattern, just scoped to a single in-flight pick.
  // count is null before any pick, or if the content script couldn't
  // compute it — the hint simply stays hidden then. Duplicated in
  // container-tree-ui.js (its own extended-field modal needs the same
  // hint), same "no cross-module includes" convention as other small
  // shared DOM helpers in this codebase.
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

  // Issue #143/#214: live preview of the transform chain's output — reads
  // the live select-field-name-mode/select-field-name-attribute DOM values
  // directly, not _state (neither is state-managed), mirroring container
  // mode's own refreshExtendedTransformPreview exactly.
  function refreshFlatTransformPreview(bridge) {
    const state = bridge.getState();
    const mode = document.getElementById('select-field-name-mode')?.value ?? 'text';
    let rawValue = state.pendingRawText;
    if (mode === 'attribute') {
      const attrName = document.getElementById('select-field-name-attribute')?.value.trim();
      rawValue = attrName ? (state.pendingElementAttributes?.[attrName] ?? '').trim() : null;
    }
    renderTransformPreview('field-transform-preview', rawValue, state.pendingTransforms);
  }

  // Issue #214: same "clicked element's own actual attributes, pre-guessed
  // toward a resource-like URL" picker container-tree-ui.js's own
  // populateAttributeSelect already establishes — duplicated (not shared)
  // per this codebase's "small DOM helpers get duplicated" convention
  // (see renderMatchCountHint's own doc comment).
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

  // Called from popup.js's render() once it's determined the confirmed-
  // selection modal is flat mode's own (STATES.SELECTING + a pending
  // selector + mode !== 'container'). `isNewPick` distinguishes an actual
  // closed→open transition (reset name/focus) from a re-render triggered
  // by editing the transform chain (which must not wipe what's typed).
  function renderFlatFieldModal(bridge, isNewPick) {
    const state = bridge.getState();
    document.getElementById('modal-field-name')?.classList.remove('hidden');
    // Issue #214/#182: Blocks mode reuses this exact modal for its own flat
    // draft shape (see blocks-config-ui.js), but Download isn't wired into
    // Blocks-mode's own serialization yet (ScrapingPlanBuilder deliberately
    // doesn't carry it onto a block's ExtractStep) — hiding the whole
    // mode/attribute/download block there avoids exposing a control that
    // would silently do nothing, rather than only catching it server-side.
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
    }
    renderMatchCountHint('field-name-match-count', state.pendingMatchCount);
    renderTransformList('field-transform-list', state.pendingTransforms);
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
    log('FIELD_ADD', { name, selector: state.pendingSelector, framePath: state.pendingFramePath, transforms: state.pendingTransforms });
    bridge.setState(STATES.IDLE, {
      fields: addField(
        state.fields, name, state.pendingSelector, state.pendingFramePath, state.pendingTransforms,
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
  );
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

  return {
    renderFields, renderMatchCountHint, refreshFlatTransformPreview, renderFlatFieldModal,
    confirmField, wireFlatModeEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFFlatModeUI;
if (typeof self !== 'undefined') self.SFFlatModeUI = SFFlatModeUI;
