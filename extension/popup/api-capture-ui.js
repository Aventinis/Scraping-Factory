// API mode: network recording and the candidate-search results (Issue #53/#136) —
// the recording toggle, the click-based searches (recorded requests and the
// page's embedded JSON), the candidate and recorded-requests lists, confirming a
// candidate into an apiConfigDraft. Split out of api-config-ui.js (Issue #390);
// behavior unchanged. See api-config-ui.js for the `bridge` convention.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const {
  STATES, escapeHtml, parseUrlTemplateParts, jsonValueToBodyDraft, buildApiSubtreeFromCandidate,
} = require('./api-config');
const { patchApiConfigDraft } = require('./api-config-shared-ui');

// ids (Phase A5): the primary-field search panel (#api-candidates-target/
// -list, the default) and the "add root group"/"add sub-field" search panel
// (#api-tree-search-target/-list) render the exact same candidate shape —
// only the confirm action differs (confirmApiFieldCandidate vs.
// confirmApiTreeFieldCandidate, see wireApiCandidateListEvents), so this one
// function serves both rather than duplicating the whole render.
function renderApiCandidates({ target, candidates }, ids = { targetEl: 'api-candidates-target', listEl: 'api-candidates-list' }) {
  const targetEl = document.getElementById(ids.targetEl);
  if (targetEl) targetEl.textContent = t('apiCandidates.searchedFor', { target });

  const listEl = document.getElementById(ids.listEl);
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
    // Issue #136: an embedded-JSON candidate (content-script.js's
    // findEmbeddedJsonCandidates) has no request/method at all — only the
    // <script> tag selector it was found in — unlike a network candidate
    // (findApiCandidates), which always has both.
    const sourceLine = candidate.scriptSelector
      ? `<div class="api-candidate-url" title="${escapeHtml(candidate.scriptSelector)}">${escapeHtml(t('apiCandidates.embeddedJsonSourceLabel', { selector: candidate.scriptSelector }))}</div>`
      : `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.method)} ${escapeHtml(candidate.url)}</div>`;
    li.innerHTML =
      sourceLine +
      `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
      `<div class="api-candidate-value">${escapeHtml(t('apiCandidates.matchLabel', { value: String(candidate.value) }))}</div>`;

    if (candidate.siblings.length > 0) {
      const siblingsEl = document.createElement('div');
      siblingsEl.className = 'api-candidate-siblings';

      // Picking one-by-one is fine for a handful of siblings, but a record
      // with many keys is exactly the "I want most of these" case a user
      // asked to no longer have to click through individually — one button
      // to pick all of them, toggling back to none on a second click
      // (mirrors this file's other state-reflecting toggle buttons, e.g.
      // preview show/hide). Picked state itself stays DOM-only (see the
      // click handler in wireEvents), so this button's own label is updated
      // directly on click rather than through a render() pass.
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

    // "Use" (Issue #53 Phase 5): only offered when the match sits
    // inside an actual repeating record (candidate.itemsPath truthy,
    // valuePath non-empty — see deriveItemsAndValuePath's doc comment for
    // why an empty-but-non-null valuePath also isn't usable) — Api-Mode's
    // whole model is "records extracted from a repeating array".
    if (candidate.itemsPath && candidate.valuePath) {
      const useRow = document.createElement('div');
      useRow.className = 'api-candidate-use';
      useRow.innerHTML =
        `<input type="text" class="api-candidate-field-name" placeholder="${escapeHtml(t('apiCandidates.useFieldNamePlaceholder'))}" data-candidate-index="${i}" />` +
        `<button type="button" class="btn-secondary btn-tiny api-candidate-confirm" data-candidate-index="${i}" disabled>${escapeHtml(t('common.use'))}</button>`;
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

// API-mode follow-up: the raw recorded pool, for whoever wants to see it
// directly instead of only going through a value-correlation search — e.g.
// to sanity-check that a variable part's other values were actually
// recorded before relying on the pool-derived autofill below. Reuses the
// same .api-candidate/.api-candidate-url/.api-candidate-path row styling
// renderApiCandidates already uses, just without the value/siblings/use
// parts that only apply to a JSON-body match.
function renderApiEntriesList(entries) {
  const listEl = document.getElementById('api-entries-list');
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
    // Request-body display (Issue #55 prep): a GET/HEAD entry never has one
    // (requestBody stays '' and requestBodySkipped stays false, see
    // api-capture.js's buildEntry), so this naturally shows nothing for them
    // without needing an explicit method check here.
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
// ── API-Mode config screen (Issue #53 Phase 5) ──────────────────────────────
// Renders the in-progress apiConfigDraft: confirmed fields (read-only),
// URL path segments/query params with a fest/variabel toggle per part, one
// source-configuration card per variable part, and the header-adoption
// table. Structural choices (variable toggle, source kind, header
// include/mode) are reactive — patched into apiConfigDraft and immediately
// re-rendered — but committed via the `change` event, not `input`, so
// typing in a text field doesn't trigger a re-render (and thus lose focus)
// on every keystroke; only leaving the field (or picking a different
// control) does. A rerender triggered by one control can still visually
// reset another field's *not yet committed* typing elsewhere on the same
// screen — an accepted rough edge given how many independent inputs this
// screen has, not a bug in the reactive fields themselves.
//
// partId identifies a variable-part-in-progress independently of its
// (user-editable, only committed on blur) name — "path:<index>" or
// "query:<key>" — so apiConfigDraft.parameterSources can be keyed by
// something stable while the display name is still being typed.

function startApiCapture(bridge) {
  log('API_CAPTURE_START');
  chrome.runtime.sendMessage({ type: 'API_CAPTURE_START' });
  bridge.patchState({ apiCaptureActive: true, apiCaptureCount: 0 });
}

function stopApiCapture(bridge) {
  log('API_CAPTURE_STOP');
  chrome.runtime.sendMessage({ type: 'API_CAPTURE_STOP' });
  // Keep apiCaptureCount — Phase 4's search below runs on what was recorded
  // *after* stopping, so the user still needs to see it stayed non-zero.
  bridge.patchState({ apiCaptureActive: false });
}

function toggleApiCapture(bridge) {
  if (bridge.getState().apiCaptureActive) stopApiCapture(bridge); else startApiCapture(bridge);
}

// ── API-Mode candidate search (Issue #53 Phase 4) ───────────────────────────
// Reuses the existing click-selection mechanism (START_SELECTION/
// ELEMENT_SELECTED) with an extra apiSearch flag — content-script.js still
// sends ELEMENT_SELECTED as always (see the guard in popup.js's message
// listener), but additionally correlates the clicked element's text against
// the entries buffered during the (now stopped) recording and reports
// candidates via a separate API_CANDIDATES message.

function startApiFieldSearch(bridge) {
  const state = bridge.getState();
  if (state.apiCaptureCount === 0) return;
  log('API_SEARCH start → START_SELECTION(apiSearch)');
  bridge.stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true });
  bridge.setState(STATES.SELECTING, {
    apiSearchTarget: 'field', pendingSelector: null, apiCandidates: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (state.domViewEnabled) bridge.requestDomTree();
}

// Issue #136: the embedded-JSON analogue of startApiFieldSearch above —
// needs no recording toggle/apiCaptureCount gate at all, since
// findEmbeddedJsonCandidates scans document.scripts directly at click
// time rather than a pool that first has to be recorded into. Reuses the
// exact same apiSearchTarget/apiCandidates state (and so the exact same
// #api-candidates-panel/-list rendering and wireApiCandidateListEvents
// wiring, see popup.js) as the network search — the resulting
// EMBEDDED_JSON_CANDIDATES message is handled identically to
// API_CANDIDATES there, and confirmEmbeddedJsonFieldCandidate below is
// dispatched to purely by candidate shape (candidate.scriptSelector).
function startEmbeddedJsonFieldSearch(bridge) {
  const state = bridge.getState();
  log('EMBEDDED_JSON_SEARCH start → START_SELECTION(embeddedJsonSearch)');
  bridge.stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION', embeddedJsonSearch: true });
  bridge.setState(STATES.SELECTING, {
    apiSearchTarget: 'field', pendingSelector: null, apiCandidates: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (state.domViewEnabled) bridge.requestDomTree();
}

// ── API-Mode parameter configuration (Issue #53 Phase 5) ────────────────────
// Turns a confirmed primary-field candidate into an in-progress ApiConfig
// draft and enters STATES.API_CONFIG — see buildApiConfig (the pure wire-
// format assembly) for what this eventually becomes once the user finishes
// configuring URL segments/params/headers there.

// `siblingNames` are JSON keys the user picked as one-click extra fields —
// each already IS a valid field name/path (a sibling's own key, always a
// direct property of the same record, see content-script.js's
// siblingFields) so no separate naming step is needed for those, unlike the
// primary field which needs a user-chosen name.
//
// Issue #54, Phase A5: builds the full nested tree draft (buildApiSubtree
// FromCandidate, using A3's deriveApiTreeSkeleton) instead of a flat fields
// array — a single top-level match still ends up a one-node-deep tree, see
// buildApiConfig's own doc comment on why the flat wire shape stays
// available even though the popup only ever builds trees now.
function confirmApiFieldCandidate(bridge, candidate, fieldName, siblingNames) {
  const groups = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames);

  log('API_FIELD_CONFIRM', { url: candidate.url, groups });
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.API_CONFIG, {
    apiCandidates: null,
    apiConfigDraft: {
      sourceUrl: candidate.url,
      urlParts: parseUrlTemplateParts(candidate.url),
      groups,
      capturedHeaders: candidate.requestHeaders || [],
      parameterSources: {},
      headerDecisions: {},
      // Issue #55, Phase B4: candidate.method is already there for free
      // (content-script.js's findApiCandidates always carried it, just
      // unused until now) — bodyTree starts null and is filled in
      // asynchronously below since the captured body itself isn't attached
      // to the candidate (only entryId is).
      method: candidate.method || 'GET',
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

// Issue #136: the embedded-JSON analogue of confirmApiFieldCandidate above.
// Unlike a network candidate, there's no captured request to derive
// sourceUrl/method/headers from — the request is just an ordinary GET of
// the current page (bridge.getState().url), optionally parameterized later
// on the API_CONFIG screen exactly like a network candidate's URL already
// is (see the "Architecture Decisions" note on UrlTemplate parameterization
// staying available for embedded-JSON mode). No request body is possible
// (a page load has no body — ScrapingPlanValidator rejects the
// combination), so bodyTree/loadInitialBodyTreeForCandidate don't apply
// here. embeddedJsonSource is stamped with the candidate's own
// scriptSelector, later read by startApiTreeFieldSearch (to scope any
// further tree-extension search to that same <script> tag) and by
// buildApiConfig (to include it in the wire object).
function confirmEmbeddedJsonFieldCandidate(bridge, candidate, fieldName, siblingNames) {
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
      embeddedJsonSource: { scriptSelector: candidate.scriptSelector },
    },
  });
}

// Fire-and-forget follow-up (Issue #55): a POST candidate's own captured
// request body isn't attached to the click-correlated candidate object
// itself (only entryId is — content-script.js's findApiCandidates never
// needed the request body before this) — so once the primary field is
// confirmed and the API_CONFIG screen is already showing, this looks the
// matching entry up in the raw recorded pool (fetchApiCaptureEntries, the
// same pool "Aufgezeichnete Anfragen" and the value-list autofill already
// use) and, if it captured a JSON-string body, turns it into the initial
// all-literal body draft (jsonValueToBodyDraft). Runs after the screen is
// already up rather than blocking the transition on it — a bodyless POST is
// still a fully valid config, so an extra async round trip just to maybe
// populate the body tree isn't worth delaying the screen transition for.
async function loadInitialBodyTreeForCandidate(bridge, candidate) {
  if (!candidate.method || candidate.method === 'GET' || candidate.method === 'HEAD') return;

  const entries = await fetchApiCaptureEntries();
  const entry = entries.find(e => e.id === candidate.entryId);
  if (!entry || entry.requestBodySkipped || !entry.requestBody) return;

  let parsed;
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

// Low-level GET_API_CAPTURE_ENTRIES round trip, shared by the "view
// recorded endpoints" panel below and the value-list autofill further down
// — same request/response shape as GET_LOGS/CHECK_ROBOTS_TXT, just no
// dedicated loading/result state of its own since both callers keep their
// own. Needs no bridge — it only ever talks to chrome.runtime, never state.
async function fetchApiCaptureEntries() {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_API_CAPTURE_ENTRIES' }) || [];
  } catch (err) {
    log('GET_API_CAPTURE_ENTRIES failed', err.message);
    return [];
  }
}

// API-mode follow-up: toggles the inline "view recorded endpoints" panel —
// fetches a fresh snapshot of the pool on every open (not just once) so a
// user who recorded more requests, closed the panel, and reopens it sees
// them without needing to stop/restart recording.
async function toggleApiEntriesPanel(bridge) {
  if (bridge.getState().apiEntriesPanelOpen) {
    log('API_ENTRIES_PANEL close');
    bridge.patchState({ apiEntriesPanelOpen: false });
    return;
  }
  log('API_ENTRIES_PANEL open');
  const entries = await fetchApiCaptureEntries();
  bridge.patchState({ apiEntriesPanelOpen: true, apiEntries: entries });
}

// Event delegation for the sibling-field suggestion chips and the "Use" row —
// shared by both candidate-search panels (the primary/root search's
// #api-candidates-list and Phase A5's "add root group"/"add sub-field" search's
// #api-tree-search-list, see renderApiCandidates' own `ids` doc comment):
// identical markup and interaction, only getCandidates/onConfirm differ per
// caller.
// Event delegation for the sibling-field suggestion chips and the "Use"
// row — shared by both candidate-search panels (the primary/root search's
// #api-candidates-list and Phase A5's "add root group"/"add sub-field"
// search's #api-tree-search-list, see renderApiCandidates' own `ids` doc
// comment): identical markup and interaction, only getCandidates/onConfirm
// differ per caller.
function wireApiCandidateListEvents(listElId, getCandidates, onConfirm) {
  document.getElementById(listElId)?.addEventListener('click', (e) => {
    const chip = e.target.closest('.api-sibling-chip');
    if (chip) {
      chip.classList.toggle('picked');
      log('API_CANDIDATE sibling toggled', chip.dataset.siblingName);
      return;
    }

    const selectAllBtn = e.target.closest('.api-sibling-select-all');
    if (selectAllBtn) {
      const chips = selectAllBtn.closest('.api-candidate-siblings').querySelectorAll('.api-sibling-chip');
      const allPicked = Array.from(chips).every(c => c.classList.contains('picked'));
      chips.forEach(c => c.classList.toggle('picked', !allPicked));
      selectAllBtn.textContent = t(allPicked ? 'apiCandidates.selectAllChips' : 'apiCandidates.deselectAllChips');
      log('API_CANDIDATE siblings select-all', { toggledTo: !allPicked });
      return;
    }

    const confirmBtn = e.target.closest('.api-candidate-confirm');
    if (confirmBtn) {
      const index = parseInt(confirmBtn.dataset.candidateIndex, 10);
      const candidate = getCandidates()?.[index];
      if (!candidate) return;
      const li = confirmBtn.closest('.api-candidate');
      const fieldName = li.querySelector('.api-candidate-field-name')?.value.trim();
      if (!fieldName) return;
      const siblingNames = Array.from(li.querySelectorAll('.api-sibling-chip.picked')).map(c => c.dataset.siblingName);
      onConfirm(candidate, fieldName, siblingNames);
    }
  });

  // Enables "Use" once a field name has been typed for that row.
  document.getElementById(listElId)?.addEventListener('input', (e) => {
    const input = e.target.closest('.api-candidate-field-name');
    if (!input) return;
    const li = input.closest('.api-candidate');
    const confirmBtn = li?.querySelector('.api-candidate-confirm');
    if (confirmBtn) confirmBtn.disabled = input.value.trim() === '';
  });
}

function wireApiCaptureEvents(bridge) {
  document.getElementById('btn-api-search')?.addEventListener('click', () => {
    log('BTN api-search');
    startApiFieldSearch(bridge);
  });

  document.getElementById('btn-embedded-json-search')?.addEventListener('click', () => {
    log('BTN embedded-json-search');
    startEmbeddedJsonFieldSearch(bridge);
  });

  document.getElementById('btn-api-entries-toggle')?.addEventListener('click', () => {
    log('BTN api-entries-toggle');
    toggleApiEntriesPanel(bridge);
  });

  // Issue #136: the same #api-candidates-list serves both a network search
  // (startApiFieldSearch) and an embedded-JSON search (startEmbeddedJsonField
  // Search) — dispatch to the matching confirm function purely by candidate
  // shape (only an embedded-JSON candidate ever carries scriptSelector, see
  // content-script.js's findEmbeddedJsonCandidates vs. findApiCandidates).
  wireApiCandidateListEvents(
    'api-candidates-list', () => bridge.getState().apiCandidates?.candidates,
    (candidate, fieldName, siblingNames) => (candidate.scriptSelector
      ? confirmEmbeddedJsonFieldCandidate(bridge, candidate, fieldName, siblingNames)
      : confirmApiFieldCandidate(bridge, candidate, fieldName, siblingNames)),
  );
}

module.exports = {
  renderApiCandidates,
  renderApiEntriesList,
  startApiCapture,
  stopApiCapture,
  toggleApiCapture,
  startApiFieldSearch,
  startEmbeddedJsonFieldSearch,
  confirmApiFieldCandidate,
  confirmEmbeddedJsonFieldCandidate,
  loadInitialBodyTreeForCandidate,
  fetchApiCaptureEntries,
  toggleApiEntriesPanel,
  wireApiCandidateListEvents,
  wireApiCaptureEvents,
};
