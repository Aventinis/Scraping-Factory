// API mode: small draft helpers shared by the API_CONFIG UI modules: patching apiConfigDraft / a parameter source, and the "insert a parameter
// placeholder" picker of both discovery-source editors. Apart so the parameter and browser-discovery modules need not import each other. See
// api-config-ui.ts for the `bridge` convention.
import type { PopupBridge } from '../types/popup';
import { t } from '../i18n/i18n';
import { escapeHtml } from './api-config';
import type { ApiConfigDraft, ApiParameterSourceDraft } from './api-config';
import { autoOpenAdvanced } from './advanced-disclosure-ui';

// An "insert parameter" picker next to a free-text UrlTemplate / DiscoveryUrl input, listing the already-declared parameters it may reference as
// "{name}" (declaration order is dependency order, see earlierParameterNames). Picking one inserts it at the input's cursor. Renders nothing while
// there is no earlier parameter.
export function renderParameterPlaceholderPicker(earlierNames: string[], safePartId: string, targetSelector: string, patchField: string): string {
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
export function patchApiConfigDraft(bridge: PopupBridge, patch: Partial<ApiConfigDraft>): void {
  const state = bridge.getState();
  // The API_CONFIG handlers only run while the draft exists.
  bridge.setState(state.current, { apiConfigDraft: { ...state.apiConfigDraft, ...patch } as ApiConfigDraft });
}

// `S` narrows the patch to one source kind for a caller that knows it (patchApiConfigSource<SourceOf<'range'>>).
export function patchApiConfigSource<S extends ApiParameterSourceDraft = ApiParameterSourceDraft>(
  bridge: PopupBridge, partId: string, patch: Partial<S>,
): void {
  const draft = bridge.getState().apiConfigDraft as ApiConfigDraft;
  patchApiConfigDraft(bridge, {
    parameterSources: { ...draft.parameterSources, [partId]: { ...draft.parameterSources[partId], ...patch } as ApiParameterSourceDraft },
  });
}

// The delegated `change` handler of every `.api-param-placeholder-select`: inserts "{name}" at the target input's cursor (the end if nothing is
// focused) and commits via patchApiConfigSource under the select's data-patch-field. The commit re-renders, so focus is not restored.
export function insertParameterPlaceholder(bridge: PopupBridge, selectEl: HTMLSelectElement): void {
  const name = selectEl.value;
  if (!name) return;
  const card = selectEl.closest('.api-config-param-card');
  const targetInput = card?.querySelector<HTMLInputElement>(selectEl.dataset.targetSelector as string);
  if (!targetInput) return;
  // Picking from the <select> moves focus off the input, where selectionStart / selectionEnd read as a never-focused field's default, the *start*
  // (placeholder in front of "https://"). Trust the live selection only while the input is focused; otherwise append at the end.
  const hasLiveSelection = document.activeElement === targetInput;
  const start = hasLiveSelection ? (targetInput.selectionStart ?? targetInput.value.length) : targetInput.value.length;
  const end = hasLiveSelection ? (targetInput.selectionEnd ?? targetInput.value.length) : targetInput.value.length;
  const newValue = `${targetInput.value.slice(0, start)}{${name}}${targetInput.value.slice(end)}`;
  // data-patch-field names the text property (urlTemplate / discoveryUrl) of the source this select belongs to.
  patchApiConfigSource(bridge, selectEl.dataset.partId as string, { [selectEl.dataset.patchField as string]: newValue.trim() } as Partial<ApiParameterSourceDraft>);
}

// ── BrowserDiscoverySource action list ──
// Thin per-parameter wrappers around scraping-config-builder.ts's add / remove / updateBrowserAction (generic over "some actions array"),
// routing the result back into this parameter's source instead of _state.browserActions.

export { autoOpenAdvanced };
