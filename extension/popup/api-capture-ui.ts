// API mode: network recording and the candidate-search results: the recording toggle, the click-based searches (recorded
// requests, the page's embedded JSON), the candidate and recorded-request lists, and confirming a candidate into an
// apiConfigDraft. See api-config-ui.ts for the `bridge` convention.
import type * as SFDraft from '../types/drafts';
import type { ApiCandidatesResult, PopupBridge } from '../types/popup';
import type { ApiCandidate } from '../types/messages';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import {
  STATES, parseUrlTemplateParts, jsonValueToBodyDraft, buildApiSubtreeFromCandidate,
} from './api-config';
import { patchApiConfigDraft } from './api-config-shared-ui';
import { candidateFieldName } from './api-field-name';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:ApiConfigUI');

// ids: the primary-field search panel (#api-candidates-*) and the "add group / sub-field" panel (#api-tree-search-*) render the
// same candidate shape and differ only in the confirm action, so one function serves both.
// takenNames: the names already in the tree, so the placeholder shows the name "Use" will really take.
export function renderApiCandidates(
  { target, candidates }: ApiCandidatesResult, ids = { targetEl: 'api-candidates-target', listEl: 'api-candidates-list' },
  takenNames: string[] = [],
): void {
  const targetEl = byIdOrNull(ids.targetEl);
  if (targetEl) targetEl.textContent = t('apiCandidates.searchedFor', { target });

  const listEl = byIdOrNull(ids.listEl);
  if (!listEl) return;
  listEl.innerHTML = '';

  if (candidates.length === 0) {
    const li = document.createElement('li');
    li.className = 'api-candidates-empty';
    li.textContent = t('common.noMatches');
    listEl.appendChild(li);
    return;
  }

  candidates.forEach((candidate, i) => {
    const li = document.createElement('li');
    li.className = 'api-candidate';
    // An embedded-JSON candidate has no request / method, only the selector of the <script> tag it was found in.
    const sourceLine = candidate.scriptSelector
      ? `<div class="api-candidate-url" title="${escapeHtml(candidate.scriptSelector)}">${escapeHtml(t('apiCandidates.embeddedJsonSourceLabel', { selector: candidate.scriptSelector }))}</div>`
      : `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(t('apiCandidates.recordedRequestLabel', { method: candidate.method, url: candidate.url }))}</div>`;
    li.innerHTML =
      sourceLine +
      `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
      `<div class="api-candidate-value">${escapeHtml(t('apiCandidates.matchLabel', { value: String(candidate.value) }))}</div>`;

    if (candidate.siblings.length > 0) {
      const siblingsEl = document.createElement('div');
      siblingsEl.className = 'api-candidate-siblings';

      // One button picks all siblings (a second click none), for records with many keys. Picked state stays DOM-only, so the
      // label is updated on click, not through a render pass.
      const selectAllBtn = document.createElement('button');
      selectAllBtn.type = 'button';
      selectAllBtn.className = 'api-sibling-select-all';
      selectAllBtn.textContent = t('apiCandidates.selectAllChips');
      selectAllBtn.dataset.candidateIndex = String(i);
      siblingsEl.appendChild(selectAllBtn);

      candidate.siblings.forEach((sibling) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'api-sibling-chip';
        chip.textContent = t('apiCandidates.siblingChip', { name: sibling.name });
        chip.title = String(sibling.value);
        chip.dataset.candidateIndex = String(i);
        chip.dataset.siblingName = sibling.name;
        siblingsEl.appendChild(chip);
      });
      li.appendChild(siblingsEl);
    }

    // "Use" is only offered when the match sits in a repeating record (itemsPath set, valuePath non-empty): API mode extracts
    // records from a repeating array.
    if (candidate.itemsPath && candidate.valuePath) {
      const useRow = document.createElement('div');
      useRow.className = 'api-candidate-use';
      useRow.innerHTML =
        `<input type="text" class="api-candidate-field-name" placeholder="${escapeHtml(candidateFieldName(candidate, takenNames))}" data-candidate-index="${i}" />` +
        `<button type="button" class="btn-secondary btn-tiny api-candidate-confirm" data-candidate-index="${i}">${escapeHtml(t('common.use'))}</button>`;
      li.appendChild(useRow);
    } else {
      const note = document.createElement('div');
      note.className = 'api-candidate-unusable';
      note.textContent = t('common.noRecordArray');
      li.appendChild(note);
    }

    listEl.appendChild(li);
  });
}

// The raw recorded pool, to check that a variable part's other values were actually recorded before relying on the
// autofill. Reuses the candidate row styling without the value / siblings / use parts.
export function renderApiEntriesList(entries: SFDraft.ApiCaptureEntry[] | null | undefined): void {
  const listEl = byIdOrNull('api-entries-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!entries || entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'api-candidates-empty';
    li.textContent = t('idle.apiEntriesEmpty');
    listEl.appendChild(li);
    return;
  }

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'api-candidate';
    // A GET / HEAD entry has no request body, so nothing shows for it without a method check.
    let bodyHtml = '';
    if (entry.requestBodySkipped) {
      bodyHtml = `<div class="api-candidate-body api-candidate-body-skipped">${escapeHtml(t('idle.apiEntriesBodyNotCaptured'))}</div>`;
    } else if (entry.requestBody) {
      bodyHtml = `<div class="api-candidate-body">${escapeHtml(entry.requestBody)}</div>`;
    }
    li.innerHTML =
      `<div class="api-candidate-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.method)} ${escapeHtml(String(entry.status))} ${escapeHtml(entry.url)}</div>` +
      (entry.contentType ? `<div class="api-candidate-path">${escapeHtml(entry.contentType)}</div>` : '') +
      bodyHtml;
    listEl.appendChild(li);
  });
}
// ── API config screen ──
// Renders the in-progress apiConfigDraft: confirmed fields, URL parts with a fixed / variable toggle, one source card per
// variable part, and the header-adoption table. Structural choices are patched into the draft and re-rendered on `change`
// (not `input`), so typing does not lose focus on every keystroke; an uncommitted entry elsewhere on the screen can still
// reset on a re-render (accepted). partId ("path:<index>" or "query:<key>") identifies a variable part independently of its
// user-editable name, so parameterSources can be keyed by something stable.

export function startApiCapture(bridge: PopupBridge): void {
  log('API_CAPTURE_START');
  chrome.runtime.sendMessage({ type: 'API_CAPTURE_START' });
  bridge.patchState({ apiCaptureActive: true, apiCaptureCount: 0 });
}

export function stopApiCapture(bridge: PopupBridge): void {
  log('API_CAPTURE_STOP');
  chrome.runtime.sendMessage({ type: 'API_CAPTURE_STOP' });
  // Keep apiCaptureCount — Phase 4's search below runs on what was recorded
  // *after* stopping, so the user still needs to see it stayed non-zero.
  bridge.patchState({ apiCaptureActive: false });
}

export function toggleApiCapture(bridge: PopupBridge): void {
  if (bridge.getState().apiCaptureActive) stopApiCapture(bridge); else startApiCapture(bridge);
}

// ── Candidate search ──
// Reuses the click selection (START_SELECTION / ELEMENT_SELECTED) with both search flags: the content script also correlates the
// clicked text against the recorded entries AND the page's own <script> JSON (no recording needed for the latter) and reports one
// API_CANDIDATES list. Confirmation is dispatched by candidate shape (candidate.scriptSelector is set only for embedded JSON).

export function startApiFieldSearch(bridge: PopupBridge): void {
  const state = bridge.getState();
  log('API_SEARCH start → START_SELECTION(apiSearch + embeddedJsonSearch)');
  bridge.stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true, embeddedJsonSearch: true });
  bridge.setState(STATES.SELECTING, {
    apiSearchTarget: 'field', pendingSelector: null, apiCandidates: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (state.domViewEnabled) bridge.requestDomTree();
}

// ── Parameter configuration ──
// Turns a confirmed primary-field candidate into an ApiConfig draft and enters STATES.API_CONFIG; buildApiConfig later
// assembles the wire format.

// `siblingNames` are keys picked as one-click extra fields; each is already a valid name and path (a direct property of the same
// record), unlike the primary field, which gets a user-chosen name. Builds the full nested tree draft; a single match is a
// one-node-deep tree (the flat wire shape stays available, see buildApiConfig).
export function confirmApiFieldCandidate(bridge: PopupBridge, candidate: ApiCandidate, fieldName: string, siblingNames: string[]): void {
  const groups = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames);

  log('API_FIELD_CONFIRM', { url: candidate.url, groups });
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.API_CONFIG, {
    apiCandidates: null,
    apiConfigDraft: {
      sourceUrl: candidate.url,
      urlParts: parseUrlTemplateParts(candidate.url as string), // a network candidate always has its recorded url
      groups,
      capturedHeaders: candidate.requestHeaders || [],
      parameterSources: {},
      headerDecisions: {},
      // candidate.method is available; bodyTree starts null and is filled in asynchronously (the captured body is not on the
      // candidate, only entryId).
      method: (candidate.method || 'GET') as 'GET' | 'POST', // the recorded method; the companion rejects anything else
      bodyTree: null,
      bodyParameters: [],
      nextBodyParameterSeq: 0,
      embeddedJsonSource: null,
      // Issue #224: lets the cursor-pagination section find this request's
      // own recorded response again ("Detect from recording").
      sourceEntryId: candidate.entryId,
      // Issue #321: the recorded response announced a rel="next" Link header.
      sourceHasNextLink: !!candidate.hasNextLink,
    },
  });
  loadInitialBodyTreeForCandidate(bridge, candidate);
}

// The embedded-JSON analogue of confirmApiFieldCandidate: there is no captured request, so the request is a GET of the
// current page (bridge.getState().url), parameterizable later like any URL. No body is possible. embeddedJsonSource is
// stamped with the candidate's scriptSelector, which scopes further tree searches and goes into the wire object.
export function confirmEmbeddedJsonFieldCandidate(bridge: PopupBridge, candidate: ApiCandidate, fieldName: string, siblingNames: string[]): void {
  const groups = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames);
  const url = bridge.getState().url;

  log('EMBEDDED_JSON_FIELD_CONFIRM', { scriptSelector: candidate.scriptSelector, groups });
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.API_CONFIG, {
    apiCandidates: null,
    apiConfigDraft: {
      sourceUrl: url,
      urlParts: parseUrlTemplateParts(url),
      groups,
      capturedHeaders: [],
      parameterSources: {},
      headerDecisions: {},
      method: 'GET',
      bodyTree: null,
      bodyParameters: [],
      nextBodyParameterSeq: 0,
      embeddedJsonSource: { scriptSelector: candidate.scriptSelector as string }, // an embedded-JSON candidate always names its script tag
    },
  });
}

// Fire-and-forget: looks the POST candidate's captured body up in the recorded pool and, if it is a JSON string, turns it
// into the initial all-literal body draft. It runs after the screen is up: a bodyless POST is a valid config, so the
// transition is not delayed.
export async function loadInitialBodyTreeForCandidate(bridge: PopupBridge, candidate: ApiCandidate): Promise<void> {
  if (!candidate.method || candidate.method === 'GET' || candidate.method === 'HEAD') return;

  const entries = await fetchApiCaptureEntries();
  const entry = entries.find(e => e.id === candidate.entryId);
  if (!entry || entry.requestBodySkipped || !entry.requestBody) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.requestBody);
  } catch {
    return; // not JSON — no structured draft to build, request stays bodyless
  }

  // The screen may have moved on while the round trip was in flight
  // (cancelled, or a different candidate confirmed) — only apply if we're
  // still looking at the same, still-bodyless draft.
  const state = bridge.getState();
  if (state.current !== STATES.API_CONFIG || !state.apiConfigDraft || state.apiConfigDraft.bodyTree) return;
  patchApiConfigDraft(bridge, { bodyTree: jsonValueToBodyDraft(parsed) });
}

// GET_API_CAPTURE_ENTRIES round trip shared by the recorded-endpoints panel and the value-list autofill; needs no bridge.
export async function fetchApiCaptureEntries(): Promise<SFDraft.ApiCaptureEntry[]> {
  try {
    const entries: SFDraft.ApiCaptureEntry[] | undefined = await chrome.runtime.sendMessage({ type: 'GET_API_CAPTURE_ENTRIES' }); // the content script's recorded pool
    return entries || [];
  } catch (err) {
    log('GET_API_CAPTURE_ENTRIES failed', (err as Error).message);
    return [];
  }
}

// Toggles the recorded-endpoints panel; fetches a fresh snapshot on every open.
export async function toggleApiEntriesPanel(bridge: PopupBridge): Promise<void> {
  if (bridge.getState().apiEntriesPanelOpen) {
    log('API_ENTRIES_PANEL close');
    bridge.patchState({ apiEntriesPanelOpen: false });
    return;
  }
  log('API_ENTRIES_PANEL open');
  const entries = await fetchApiCaptureEntries();
  bridge.patchState({ apiEntriesPanelOpen: true, apiEntries: entries });
}

// Event delegation for the sibling chips and the "Use" row, shared by both candidate panels (identical markup; only
// getCandidates / getTakenNames / onConfirm differ).
export function wireApiCandidateListEvents(
  listElId: string, getCandidates: () => ApiCandidate[] | undefined, getTakenNames: () => string[],
  onConfirm: (candidate: ApiCandidate, fieldName: string, siblingNames: string[]) => void,
): void {
  byIdOrNull(listElId)?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const chip = target.closest<HTMLElement>('.api-sibling-chip');
    if (chip) {
      chip.classList.toggle('picked');
      log('API_CANDIDATE sibling toggled', chip.dataset.siblingName);
      return;
    }

    const selectAllBtn = target.closest<HTMLElement>('.api-sibling-select-all');
    if (selectAllBtn) {
      const chips = (selectAllBtn.closest('.api-candidate-siblings') as HTMLElement).querySelectorAll('.api-sibling-chip'); // rendered inside it
      const allPicked = Array.from(chips).every(c => c.classList.contains('picked'));
      chips.forEach(c => c.classList.toggle('picked', !allPicked));
      selectAllBtn.textContent = t(allPicked ? 'apiCandidates.selectAllChips' : 'apiCandidates.deselectAllChips');
      log('API_CANDIDATE siblings select-all', { toggledTo: !allPicked });
      return;
    }

    const confirmBtn = target.closest<HTMLElement>('.api-candidate-confirm');
    if (confirmBtn) {
      const index = parseInt(confirmBtn.dataset.candidateIndex as string, 10);
      const candidate = getCandidates()?.[index];
      if (!candidate) return;
      const li = confirmBtn.closest('.api-candidate') as HTMLElement;
      const siblingNames = Array.from(li.querySelectorAll<HTMLElement>('.api-sibling-chip.picked')).map(c => c.dataset.siblingName as string);
      // An empty input means "take the name from the query"; a typed name wins, even when it collides.
      const fieldName = li.querySelector<HTMLInputElement>('.api-candidate-field-name')?.value.trim()
        || candidateFieldName(candidate, [...getTakenNames(), ...siblingNames]);
      onConfirm(candidate, fieldName, siblingNames);
    }
  });
}

export function wireApiCaptureEvents(bridge: PopupBridge): void {
  byIdOrNull('btn-api-search')?.addEventListener('click', () => {
    log('BTN api-search');
    startApiFieldSearch(bridge);
  });

  byIdOrNull('btn-api-entries-toggle')?.addEventListener('click', () => {
    log('BTN api-entries-toggle');
    toggleApiEntriesPanel(bridge);
  });

  // The one list holds recorded-request and embedded-JSON candidates: dispatch by candidate shape (only an embedded-JSON candidate
  // carries scriptSelector).
  wireApiCandidateListEvents(
    'api-candidates-list', () => bridge.getState().apiCandidates?.candidates, () => [],
    (candidate, fieldName, siblingNames) => (candidate.scriptSelector
      ? confirmEmbeddedJsonFieldCandidate(bridge, candidate, fieldName, siblingNames)
      : confirmApiFieldCandidate(bridge, candidate, fieldName, siblingNames)),
  );
}
