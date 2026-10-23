// API mode: small draft helpers shared by the API_CONFIG UI modules: patching apiConfigDraft / a parameter source, and the "insert a parameter
// placeholder" picker of both discovery-source editors. Apart so the parameter and browser-discovery modules need not import each other. See
// api-config-ui.js for the `bridge` convention.
const { t } = require('../i18n/i18n');
const { escapeHtml } = require('./api-config');
const { autoOpenAdvanced } = require('./advanced-disclosure-ui');

// An "insert parameter" picker next to a free-text UrlTemplate / DiscoveryUrl input, listing the already-declared parameters it may reference as
// "{name}" (declaration order is dependency order, see earlierParameterNames). Picking one inserts it at the input's cursor. Renders nothing while
// there is no earlier parameter.
function renderParameterPlaceholderPicker(earlierNames, safePartId, targetSelector, patchField) {
  if (earlierNames.length === 0) return '';
  const options = earlierNames.map(name => `<option value="${escapeHtml(name)}">{${escapeHtml(name)}}</option>`).join('');
  return `
      <select class="api-param-placeholder-select" data-part-id="${safePartId}" data-target-selector="${escapeHtml(targetSelector)}" data-patch-field="${escapeHtml(patchField)}">
        <option value="">${escapeHtml(t('apiConfig.insertParameterPlaceholder'))}</option>
        ${options}
      </select>
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

// The delegated `change` handler of every `.api-param-placeholder-select`: inserts "{name}" at the target input's cursor (the end if nothing is
// focused) and commits via patchApiConfigSource under the select's data-patch-field. The commit re-renders, so focus is not restored.
function insertParameterPlaceholder(bridge, selectEl) {
  const name = selectEl.value;
  if (!name) return;
  const card = selectEl.closest('.api-config-param-card');
  const targetInput = card?.querySelector(selectEl.dataset.targetSelector);
  if (!targetInput) return;
  // Picking from the <select> moves focus off the input, where selectionStart / selectionEnd read as a never-focused field's default, the *start*
  // (placeholder in front of "https://"). Trust the live selection only while the input is focused; otherwise append at the end.
  const hasLiveSelection = document.activeElement === targetInput;
  const start = hasLiveSelection ? (targetInput.selectionStart ?? targetInput.value.length) : targetInput.value.length;
  const end = hasLiveSelection ? (targetInput.selectionEnd ?? targetInput.value.length) : targetInput.value.length;
  const newValue = `${targetInput.value.slice(0, start)}{${name}}${targetInput.value.slice(end)}`;
  patchApiConfigSource(bridge, selectEl.dataset.partId, { [selectEl.dataset.patchField]: newValue.trim() });
}

// ── BrowserDiscoverySource action list ──
// Thin per-parameter wrappers around scraping-config-builder.ts's add / remove / updateBrowserAction (generic over "some actions array"),
// routing the result back into this parameter's source instead of _state.browserActions.

module.exports = {
  autoOpenAdvanced,
  patchApiConfigDraft,
  patchApiConfigSource,
  renderParameterPlaceholderPicker,
  insertParameterPlaceholder,
};
