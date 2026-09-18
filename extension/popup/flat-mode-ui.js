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

  function renderFields(fields) {
    const listEl = document.getElementById('fields-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    fields.forEach((field, i) => {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.innerHTML =
        `<span class="field-name" title="${escapeHtml(field.name)}">${escapeHtml(field.name)}</span>` +
        `<span class="field-selector" title="${escapeHtml(field.selector)}">${escapeHtml(field.selector)}</span>` +
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

  // Issue #143: live preview of the transform chain's output — flat mode has
  // no attribute/exists mode, so the raw value is always the picked element's
  // trimmed text.
  function refreshFlatTransformPreview(bridge) {
    const state = bridge.getState();
    renderTransformPreview('field-transform-preview', state.pendingRawText, state.pendingTransforms);
  }

  // Called from popup.js's render() once it's determined the confirmed-
  // selection modal is flat mode's own (STATES.SELECTING + a pending
  // selector + mode !== 'container'). `isNewPick` distinguishes an actual
  // closed→open transition (reset name/focus) from a re-render triggered
  // by editing the transform chain (which must not wipe what's typed).
  function renderFlatFieldModal(bridge, isNewPick) {
    const state = bridge.getState();
    document.getElementById('modal-field-name')?.classList.remove('hidden');
    if (isNewPick) {
      const input = document.getElementById('input-field-name');
      if (input) { input.value = ''; input.focus(); }
    }
    renderMatchCountHint('field-name-match-count', state.pendingMatchCount);
    renderTransformList('field-transform-list', state.pendingTransforms);
    refreshFlatTransformPreview(bridge);
  }

  function confirmField(bridge) {
    const state = bridge.getState();
    const name = document.getElementById('input-field-name')?.value.trim();
    if (!name) return;
    if (!transformsAreValid(state.pendingTransforms)) return;
    log('FIELD_ADD', { name, selector: state.pendingSelector, framePath: state.pendingFramePath, transforms: state.pendingTransforms });
    bridge.setState(STATES.IDLE, {
      fields:            addField(state.fields, name, state.pendingSelector, state.pendingFramePath, state.pendingTransforms),
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
