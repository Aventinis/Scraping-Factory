// Reopening an applied API configuration (Issue #506): the pure state logic. Apply keeps the draft it built the wire `apiConfig`
// from (`apiConfigApplied`); Edit hands a copy of it back to the API_CONFIG screen. See docs/design-notes/extension.md.
import type * as SFWire from '../types/wire';
import type { State, StatePatch } from '../types/popup';
import { buildStaticListSource, buildRangeSource, buildBrowserDiscoverySource, buildApiConfig, allParameterParts } from './api-config';
import type { ApiConfigDraft } from './api-config';
import { BOOTSTRAP_SOURCE_KIND, resolveBootstrapUrlParts } from './api-bootstrap';
import { serializeBrowserActions } from './scraping-config-builder';

// Final assembly on "Apply": staticList / range sources are raw UI state in the draft and built here from whatever is current;
// discovery sources are already wire objects. Iterates allParameterParts (URL + body-only parameters) so a body-only parameter's
// source is built too.
export function buildApiConfigFromDraft(draft: ApiConfigDraft): SFWire.ApiConfig {
  const parameterSources: Record<string, SFWire.ApiParameterSource> = {};
  const idToName: Record<string, string> = {};
  allParameterParts(draft).forEach((part) => {
    const source = draft.parameterSources[part.id];
    // A bootstrap-sourced URL part is a placeholder for the bootstrap value, never a declared parameter (resolveBootstrapUrlParts
    // names it after the bootstrap instead).
    if (source.kind === BOOTSTRAP_SOURCE_KIND) return;
    parameterSources[part.name] = source.kind === 'staticList'
      ? buildStaticListSource(source.valuesText)
      : source.kind === 'range'
        ? buildRangeSource(source.type, source.from, source.to, source.format)
        : source.kind === 'browserDiscovery'
          ? buildBrowserDiscoverySource(source.discoveryUrl, serializeBrowserActions(source.actions || []))
          : source as SFWire.DiscoverySource; // a discovery source is already complete once the user could press Apply
    idToName[part.id] = part.name;
  });

  return buildApiConfig({
    urlParts: draft.bootstrap
      ? resolveBootstrapUrlParts(draft.urlParts, draft.parameterSources, draft.bootstrap.name.trim())
      : draft.urlParts,
    groups: draft.groups,
    parameterSources,
    capturedHeaders: draft.capturedHeaders,
    headerDecisions: draft.headerDecisions,
    method: draft.method,
    bodyTree: draft.bodyTree,
    bodyParameterNames: (draft.bodyParameters || []).map(p => p.name),
    parameterIdToName: idToName,
    embeddedJsonSource: draft.embeddedJsonSource,
    bootstrap: draft.bootstrap,
    cursorPagination: draft.cursorPagination,
    linkHeaderPagination: draft.linkHeaderPagination,
  });
}

// The snapshot is only trusted while it still builds exactly the confirmed `apiConfig`: a configuration that was loaded, imported or
// replaced since has no matching draft, so Edit is not offered for it and no place that replaces `apiConfig` has to clear anything.
export function reopenableDraft(state: Pick<State, 'apiConfig' | 'apiConfigApplied'>): ApiConfigDraft | null {
  const { apiConfig, apiConfigApplied } = state;
  if (!apiConfig || !apiConfigApplied) return null;
  try {
    return JSON.stringify(buildApiConfigFromDraft(apiConfigApplied)) === JSON.stringify(apiConfig) ? apiConfigApplied : null;
  } catch {
    return null;
  }
}

// A deep copy, so that nothing edited on the reopened screen reaches the confirmed configuration before Apply.
export function reopenPatch(state: Pick<State, 'apiConfig' | 'apiConfigApplied'>): StatePatch | null {
  const draft = reopenableDraft(state);
  if (!draft) return null;
  return {
    apiConfigDraft: JSON.parse(JSON.stringify(draft)) as ApiConfigDraft,
    apiDiscoveryCandidates: null, apiTreeSearchResult: null, apiPathPicker: null,
  };
}
