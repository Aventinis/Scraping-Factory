// API mode: cursor/token-based pagination (Issue #224) — DOM rendering and
// event wiring for the "Follow a next-page cursor" section on the API_CONFIG
// screen (see api-cursor-pagination.ts for the pure draft/wire logic, the
// same <feature>.js/<feature>-ui.js split api-bootstrap.ts/
// api-bootstrap-ui.ts use). Every function that touches state takes
// popup.js's `bridge` as its first parameter, per Architecture Decision #12.
//
// State this module owns:
//   apiConfigDraft.cursorPagination — the cursor draft (null = disabled)
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { createDefaultCursorDraft, detectCursorSuggestion, DEFAULT_MAX_PAGES } from './api-cursor-pagination';
import { autoOpenAdvanced } from './advanced-disclosure-ui';
import { pathPickerButtonHtml, pathPickerPanelHtml, wirePathPickerEvents } from './json-path-picker-ui';
import type { ApiConfigDraft } from './api-config';
import { patchApiConfigDraft } from './api-config-shared-ui';
import { fetchApiCaptureEntries } from './api-capture-ui';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:ApiCursorPaginationUI');

// These handlers only run on the API_CONFIG screen, where the draft exists.
const currentDraft = (bridge: PopupBridge): ApiConfigDraft => bridge.getState().apiConfigDraft as ApiConfigDraft;

function patchCursor(bridge: PopupBridge, patch: Partial<SFDraft.ApiCursorPagination>): void {
  const draft = currentDraft(bridge);
  patchApiConfigDraft(bridge, { cursorPagination: { ...draft.cursorPagination, ...patch } as SFDraft.ApiCursorPagination });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function cursorConfigHtml(cursor: SFDraft.ApiCursorPagination, draft: ApiConfigDraft, state: State): string {
  const bodyUnavailable = draft.method !== 'POST' || !draft.bodyTree;
  return `
      <div class="actions">
        <button type="button" id="btn-api-cursor-detect" class="btn-secondary btn-tiny">${escapeHtml(t('apiCursor.detectBtn'))}</button>
      </div>
      <div class="row-label">${escapeHtml(t('apiCursor.nextCursorPathLabel'))}</div>
      <input type="text" class="api-cursor-field" data-field="nextCursorPath" placeholder="pageInfo.endCursor" value="${escapeHtml(cursor.nextCursorPath)}" />
      <div class="actions">${pathPickerButtonHtml('cursor.nextCursorPath')}</div>${pathPickerPanelHtml(state, 'cursor.nextCursorPath')}
      <div class="row-label">${escapeHtml(t('apiCursor.hasNextPathLabel'))}</div>
      <input type="text" class="api-cursor-field" data-field="hasNextPagePath" placeholder="pageInfo.hasNextPage" value="${escapeHtml(cursor.hasNextPagePath)}" />
      <div class="actions">${pathPickerButtonHtml('cursor.hasNextPagePath')}</div>${pathPickerPanelHtml(state, 'cursor.hasNextPagePath')}
      <div class="row-label">${escapeHtml(t('apiCursor.targetLabel'))}</div>
      <div class="api-cursor-target-row">
        <select class="api-cursor-field" data-field="target">
          <option value="Query" ${cursor.target === 'Query' ? 'selected' : ''}>${escapeHtml(t('apiCursor.targetQuery'))}</option>
          <option value="Body" ${cursor.target === 'Body' ? 'selected' : ''}>${escapeHtml(t('apiCursor.targetBody'))}</option>
        </select>
        ${cursor.target === 'Body'
        ? `<input type="text" class="api-cursor-field" data-field="bodyPath" placeholder="variables.after" value="${escapeHtml(cursor.bodyPath)}" />`
        : `<input type="text" class="api-cursor-field" data-field="queryParameterName" placeholder="cursor" value="${escapeHtml(cursor.queryParameterName)}" />`}
      </div>
      ${cursor.target === 'Body' && bodyUnavailable
      ? `<p class="browser-actions-hint">${escapeHtml(t('apiCursor.bodyNeedsPost'))}</p>`
      : ''}
      ${cursor.target === 'Body' ? `<div class="actions">${pathPickerButtonHtml('cursor.bodyPath')}</div>${pathPickerPanelHtml(state, 'cursor.bodyPath')}` : ''}
      <div class="row-label">${escapeHtml(t('apiCursor.maxPagesLabel'))}</div>
      <input type="number" min="1" step="1" class="api-cursor-field" data-field="maxPages" value="${escapeHtml(cursor.maxPages)}" />`;
}

// Called from popup.js's render() while the API_CONFIG screen is showing.
// An embedded-JSON source hides the whole section: a page load has no
// cursor to follow (ScrapingPlanValidator rejects the combination).
export function renderApiCursorPaginationSection(bridge: PopupBridge): void {
  const state = bridge.getState();
  const draft = state.apiConfigDraft;
  const section = byIdOrNull('api-cursor-section');
  if (!section) return;
  // The section sits inside its "Advanced" disclosure — hide that whole block for an embedded source.
  (section.closest('details') || section).classList.toggle('hidden', !!draft?.embeddedJsonSource);
  const cursor = draft?.cursorPagination || null;
  autoOpenAdvanced(section, !!cursor);
  const toggle = byIdOrNull<HTMLInputElement>('toggle-api-cursor');
  if (toggle) toggle.checked = !!cursor;
  const configEl = byIdOrNull('api-cursor-config');
  if (!configEl) return;
  configEl.classList.toggle('hidden', !cursor);
  // Fields commit on `change` (never per keystroke), so re-rendering the
  // whole block every time can't clobber an input mid-edit.
  configEl.innerHTML = cursor && draft ? cursorConfigHtml(cursor, draft, state) : ''; // a cursor only exists on a draft
}

// ── Actions ─────────────────────────────────────────────────────────────────

function setCursorEnabled(bridge: PopupBridge, enabled: boolean): void {
  log('API_CURSOR toggle', enabled);
  // Issue #321: exclusive with Link-header pagination — enabling this one drops the other.
  patchApiConfigDraft(bridge, enabled
    ? { cursorPagination: createDefaultCursorDraft(), linkHeaderPagination: null }
    : { cursorPagination: null });
}

function setCursorField(bridge: PopupBridge, field: string, value: string): void {
  if (field === 'maxPages') {
    const parsed = parseInt(value, 10);
    patchCursor(bridge, { maxPages: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES });
    return;
  }
  patchCursor(bridge, { [field]: field === 'target' ? value : value.trim() } as Partial<SFDraft.ApiCursorPagination>); // field is one of the data-field names
}

// "Detect from recording": looks the confirmed request's own recorded
// response up again (by entry id, else by URL+method — the latest such
// entry) and fills in whatever detectCursorSuggestion finds. A query
// parameter recorded on the URL itself is dropped from the URL parts: the
// recorded request may already have been a later page, and page 1 must be
// sent without a cursor.
export async function detectFromRecording(bridge: PopupBridge): Promise<void> {
  const draft = currentDraft(bridge);
  const entries = await fetchApiCaptureEntries();
  const entry = entries.find(e => draft.sourceEntryId !== undefined && e.id === draft.sourceEntryId)
    || [...entries].reverse().find(e => e.url === draft.sourceUrl && (e.method || 'GET') === (draft.method || 'GET'));
  const found = entry ? detectCursorSuggestion(entry, entries.filter(e => e !== entry)) : null;
  if (!found || (!found.nextCursorPath && !found.hasNextPagePath && !found.queryParameterName && !found.bodyPath)) {
    log('API_CURSOR detect: nothing found');
    bridge.showToast(t('apiCursor.detectNone'), null, 'warn');
    return;
  }
  log('API_CURSOR detect', found);

  const current = currentDraft(bridge);
  const cursor = current.cursorPagination || createDefaultCursorDraft();
  // Only overwrite what was actually found; keep whatever the user typed.
  const bodyUsable = found.target === 'Body' && current.method === 'POST' && !!current.bodyTree;
  const target = bodyUsable ? 'Body' : 'Query';
  const patch: Partial<ApiConfigDraft> = {
    cursorPagination: {
      ...cursor,
      nextCursorPath: found.nextCursorPath || cursor.nextCursorPath,
      hasNextPagePath: found.hasNextPagePath || cursor.hasNextPagePath,
      target,
      queryParameterName: found.queryParameterName || cursor.queryParameterName,
      bodyPath: found.bodyPath || cursor.bodyPath,
    },
  };
  if (target === 'Query' && found.queryParameterName) {
    patch.urlParts = {
      ...current.urlParts,
      queryParams: current.urlParts.queryParams.filter(param => param.key !== found.queryParameterName),
    };
  }
  patchApiConfigDraft(bridge, patch);
  bridge.showToast(t('apiCursor.detectApplied'), null, 'info');
}

// ── Event wiring ────────────────────────────────────────────────────────────

export function wireApiCursorPaginationEvents(bridge: PopupBridge): void {
  const section = byIdOrNull('api-cursor-section');
  if (!section) return;
  wirePathPickerEvents(bridge, section); // Issue #404

  section.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'toggle-api-cursor') { setCursorEnabled(bridge, target.checked); return; }
    if (target.classList.contains('api-cursor-field')) setCursorField(bridge, target.dataset.field as string, target.value);
  });

  section.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#btn-api-cursor-detect')) detectFromRecording(bridge);
  });
}
