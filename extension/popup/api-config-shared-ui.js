// API mode: small draft helpers shared by the API_CONFIG UI modules (Issue #390)
// — patching apiConfigDraft/a parameter source, and the "insert a parameter
// placeholder" picker used by both discovery-source editors. Kept apart so the
// parameter and browser-discovery modules need not import each other both ways.
// See api-config-ui.js for the `bridge` convention.
const { t } = require('../i18n/i18n');
const { escapeHtml } = require('./api-config');

// Issue #217: a small "insert parameter" picker next to a free-text
// UrlTemplate/DiscoveryUrl input, listing every already-declared parameter
// this field could legally reference via a "{name}" placeholder
// (ScrapingPlanValidator rejects anything else — see
// earlierParameterNames's own doc comment for why declaration order is
// already the right order with no separate reordering concept needed).
// Picking one inserts "{name}" at the target input's own cursor position
// via insertParameterPlaceholder, rather than requiring the user to
// remember/type the exact placeholder syntax by hand. Renders nothing at
// all once there's no earlier parameter yet to offer.
function renderParameterPlaceholderPicker(earlierNames, safePartId, targetSelector, patchField) {
  if (earlierNames.length === 0) return '';
  const options = earlierNames.map(name => `<option value="${escapeHtml(name)}">{${escapeHtml(name)}}</option>`).join('');
  return `
      <select class="api-param-placeholder-select" data-part-id="${safePartId}" data-target-selector="${escapeHtml(targetSelector)}" data-patch-field="${escapeHtml(patchField)}">
        <option value="">${escapeHtml(t('apiConfig.insertParameterPlaceholder'))}</option>
        ${options}
      </select>
      <p class="api-param-placeholder-hint">${escapeHtml(t('apiConfig.insertParameterHint'))}</p>
    `;
}

// Persists every apiConfigDraft edit through setState (not patchState) so it
// survives a popup close/reopen mid-configuration, same as fields/groups.
function patchApiConfigDraft(bridge, patch) {
  const state = bridge.getState();
  bridge.setState(state.current, { apiConfigDraft: { ...state.apiConfigDraft, ...patch } });
}

function patchApiConfigSource(bridge, partId, patch) {
  const draft = bridge.getState().apiConfigDraft;
  patchApiConfigDraft(bridge, { parameterSources: { ...draft.parameterSources, [partId]: { ...draft.parameterSources[partId], ...patch } } });
}

// Issue #217: the delegated `change` handler for every
// `.api-param-placeholder-select` picker rendered by
// renderParameterPlaceholderPicker — inserts "{name}" at the target
// input's own cursor position (falling back to the end when nothing is
// selected/focused) and commits the result through patchApiConfigSource,
// the same key (`discoveryUrl`/`urlTemplate`, named by the select's own
// data-patch-field) the target input's own `change` handler would commit
// on blur. A `change`-triggered commit already causes a full re-render
// (see this file's own doc comment on that trade-off), so no attempt is
// made to restore focus/selection afterward — the input is about to be
// torn down and rebuilt anyway.
function insertParameterPlaceholder(bridge, selectEl) {
  const name = selectEl.value;
  if (!name) return;
  const card = selectEl.closest('.api-config-param-card');
  const targetInput = card?.querySelector(selectEl.dataset.targetSelector);
  if (!targetInput) return;
  // Picking from the <select> moves focus to the select itself, not the
  // text input — so targetInput.selectionStart/selectionEnd (meaningful
  // only while an input is actually focused) would otherwise read as the
  // browser's default for a never-focused field, which is the *start* of
  // the value, not the end — silently inserting the placeholder in front
  // of the whole URL (even before "https://") instead of appending it
  // where it's actually useful. Only trust the live selection while the
  // input is the actually-focused element; otherwise always append at the
  // end, the far more useful default for the common "never clicked into
  // the field first" case.
  const hasLiveSelection = document.activeElement === targetInput;
  const start = hasLiveSelection ? (targetInput.selectionStart ?? targetInput.value.length) : targetInput.value.length;
  const end = hasLiveSelection ? (targetInput.selectionEnd ?? targetInput.value.length) : targetInput.value.length;
  const newValue = `${targetInput.value.slice(0, start)}{${name}}${targetInput.value.slice(end)}`;
  patchApiConfigSource(bridge, selectEl.dataset.partId, { [selectEl.dataset.patchField]: newValue.trim() });
}

// ── BrowserDiscoverySource action list (Issue #216) ─────────────────────
// Thin per-parameter wrappers around scraping-config-builder.js's own
// add/remove/updateBrowserAction — those are already fully generic over
// "some actions array", so no new mutation logic is needed here, only
// routing the result back into this one parameter's own source object
// instead of _state.browserActions.

module.exports = {
  patchApiConfigDraft,
  patchApiConfigSource,
  renderParameterPlaceholderPicker,
  insertParameterPlaceholder,
};
