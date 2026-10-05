// API mode: cursor/token-based pagination (Issue #224) — DOM rendering and
// event wiring for the "Follow a next-page cursor" section on the API_CONFIG
// screen (see api-cursor-pagination.js for the pure draft/wire logic, the
// same <feature>.js/<feature>-ui.js split api-bootstrap.js/
// api-bootstrap-ui.js use). Every function that touches state takes
// popup.js's `bridge` as its first parameter, per Architecture Decision #12.
//
// State this module owns:
//   apiConfigDraft.cursorPagination — the cursor draft (null = disabled)
const SFApiCursorPaginationUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:ApiCursorPaginationUI');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { createDefaultCursorDraft, detectCursorSuggestion, DEFAULT_MAX_PAGES } =
    typeof require !== 'undefined' ? require('./api-cursor-pagination') : self.SFApiCursorPagination;

  // Duplicated from api-bootstrap-ui.js's own copy rather than imported — the
  // codebase's "no cross-module includes for small DOM helpers" convention.
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function patchDraft(bridge, patch) {
    const state = bridge.getState();
    bridge.setState(state.current, { apiConfigDraft: { ...state.apiConfigDraft, ...patch } });
  }

  function patchCursor(bridge, patch) {
    const draft = bridge.getState().apiConfigDraft;
    patchDraft(bridge, { cursorPagination: { ...draft.cursorPagination, ...patch } });
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function cursorConfigHtml(cursor, draft) {
    const bodyUnavailable = draft.method !== 'POST' || !draft.bodyTree;
    return `
      <div class="actions">
        <button type="button" id="btn-api-cursor-detect" class="btn-secondary btn-tiny">${escapeHtml(t('apiCursor.detectBtn'))}</button>
      </div>
      <div class="row-label">${escapeHtml(t('apiCursor.nextCursorPathLabel'))}</div>
      <input type="text" class="api-cursor-field" data-field="nextCursorPath" placeholder="pageInfo.endCursor" value="${escapeHtml(cursor.nextCursorPath)}" />
      <div class="row-label">${escapeHtml(t('apiCursor.hasNextPathLabel'))}</div>
      <input type="text" class="api-cursor-field" data-field="hasNextPagePath" placeholder="pageInfo.hasNextPage" value="${escapeHtml(cursor.hasNextPagePath)}" />
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
      <div class="row-label">${escapeHtml(t('apiCursor.maxPagesLabel'))}</div>
      <input type="number" min="1" step="1" class="api-cursor-field" data-field="maxPages" value="${escapeHtml(cursor.maxPages)}" />
      <p class="browser-actions-hint">${escapeHtml(t('apiCursor.firstPageHint'))}</p>`;
  }

  // Called from popup.js's render() while the API_CONFIG screen is showing.
  // An embedded-JSON source hides the whole section: a page load has no
  // cursor to follow (ScrapingPlanValidator rejects the combination).
  function renderApiCursorPaginationSection(bridge) {
    const draft = bridge.getState().apiConfigDraft;
    const section = document.getElementById('api-cursor-section');
    if (!section) return;
    section.classList.toggle('hidden', !!draft?.embeddedJsonSource);
    const cursor = draft?.cursorPagination || null;
    const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-api-cursor'));
    if (toggle) toggle.checked = !!cursor;
    const configEl = document.getElementById('api-cursor-config');
    if (!configEl) return;
    configEl.classList.toggle('hidden', !cursor);
    // Fields commit on `change` (never per keystroke), so re-rendering the
    // whole block every time can't clobber an input mid-edit.
    configEl.innerHTML = cursor ? cursorConfigHtml(cursor, draft) : '';
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function setCursorEnabled(bridge, enabled) {
    log('API_CURSOR toggle', enabled);
    patchDraft(bridge, { cursorPagination: enabled ? createDefaultCursorDraft() : null });
  }

  function setCursorField(bridge, field, value) {
    if (field === 'maxPages') {
      const parsed = parseInt(value, 10);
      patchCursor(bridge, { maxPages: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES });
      return;
    }
    patchCursor(bridge, { [field]: field === 'target' ? value : value.trim() });
  }

  // GET_API_CAPTURE_ENTRIES round trip — same message api-config-ui.js's own
  // fetchApiCaptureEntries sends, duplicated (a few lines) rather than
  // reaching into that module.
  async function fetchCaptureEntries() {
    try {
      return await chrome.runtime.sendMessage({ type: 'GET_API_CAPTURE_ENTRIES' }) || [];
    } catch (err) {
      log('GET_API_CAPTURE_ENTRIES failed', err.message);
      return [];
    }
  }

  // "Detect from recording": looks the confirmed request's own recorded
  // response up again (by entry id, else by URL+method — the latest such
  // entry) and fills in whatever detectCursorSuggestion finds. A query
  // parameter recorded on the URL itself is dropped from the URL parts: the
  // recorded request may already have been a later page, and page 1 must be
  // sent without a cursor.
  async function detectFromRecording(bridge) {
    const draft = bridge.getState().apiConfigDraft;
    const entries = await fetchCaptureEntries();
    const entry = entries.find(e => draft.sourceEntryId !== undefined && e.id === draft.sourceEntryId)
      || [...entries].reverse().find(e => e.url === draft.sourceUrl && (e.method || 'GET') === (draft.method || 'GET'));
    const found = entry ? detectCursorSuggestion(entry) : null;
    if (!found || (!found.nextCursorPath && !found.hasNextPagePath && !found.queryParameterName && !found.bodyPath)) {
      log('API_CURSOR detect: nothing found');
      bridge.showToast(t('apiCursor.detectNone'), null, 'warn');
      return;
    }
    log('API_CURSOR detect', found);

    const current = bridge.getState().apiConfigDraft;
    const cursor = current.cursorPagination || createDefaultCursorDraft();
    // Only overwrite what was actually found; keep whatever the user typed.
    const bodyUsable = found.target === 'Body' && current.method === 'POST' && !!current.bodyTree;
    const target = bodyUsable ? 'Body' : 'Query';
    const patch = {
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
    patchDraft(bridge, patch);
    bridge.showToast(t('apiCursor.detectApplied'), null, 'info');
  }

  // ── Event wiring ────────────────────────────────────────────────────────────

  function wireApiCursorPaginationEvents(bridge) {
    const section = document.getElementById('api-cursor-section');
    if (!section) return;

    section.addEventListener('change', (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      if (target.id === 'toggle-api-cursor') { setCursorEnabled(bridge, target.checked); return; }
      if (target.classList.contains('api-cursor-field')) setCursorField(bridge, target.dataset.field, target.value);
    });

    section.addEventListener('click', (e) => {
      if (/** @type {HTMLElement} */ (e.target).closest('#btn-api-cursor-detect')) detectFromRecording(bridge);
    });
  }

  return { renderApiCursorPaginationSection, wireApiCursorPaginationEvents, detectFromRecording };
})();

if (typeof module !== 'undefined') module.exports = SFApiCursorPaginationUI;
if (typeof self !== 'undefined') self.SFApiCursorPaginationUI = SFApiCursorPaginationUI;
