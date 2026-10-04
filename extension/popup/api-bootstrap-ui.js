// API mode: token/auth bootstrap value (Issue #220) — DOM rendering and
// event wiring for the "Auth bootstrap (token)" section on the API_CONFIG
// screen (see api-bootstrap.js for the pure draft/wire logic, the same
// <feature>.js/<feature>-ui.js split the rest of the popup uses). Every
// function that touches state takes popup.js's `bridge` as its first
// parameter, per Architecture Decision #12.
//
// State this module owns:
//   apiConfigDraft.bootstrap       — the bootstrap draft (null = disabled)
//   apiBootstrapRecordingEntries   — the "Take from recording" picker's list
//                                    (null = closed), UI-only like
//                                    apiDiscoveryCandidates
//   apiBootstrapTestValues         — one-time credential test values for the
//                                    /generate trial run, keyed by env-var
//                                    name; written via patchState only, so
//                                    they never reach chrome.storage (same
//                                    treatment as fillTestValues, Issue #43)
const SFApiBootstrapUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:ApiBootstrapUI');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const {
    createDefaultBootstrapDraft, createBootstrapPair, detectTokenInResponse, bootstrapDraftFromCaptureEntry,
    wireTokenIntoMainRequest, stripBootstrapReferences, suggestEnvVarName,
  } = typeof require !== 'undefined' ? require('./api-bootstrap') : self.SFApiBootstrap;

  // Duplicated from api-config.js's own copy rather than imported — the
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

  function patchBootstrap(bridge, patch) {
    const draft = bridge.getState().apiConfigDraft;
    patchDraft(bridge, { bootstrap: { ...draft.bootstrap, ...patch } });
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function pairRowHtml(listKey, pair, index, testValues) {
    const attrs = `data-list="${listKey}" data-index="${index}"`;
    const valueInput = pair.mode === 'env'
      ? `<input type="text" class="api-bootstrap-pair-env" ${attrs} placeholder="${escapeHtml(t('apiConfig.envNamePlaceholder'))}" value="${escapeHtml(pair.envName)}" />` +
        `<input type="password" class="api-bootstrap-test-value" data-env-name="${escapeHtml(pair.envName)}" placeholder="${escapeHtml(t('apiBootstrap.testValuePlaceholder'))}" value="${escapeHtml(testValues[pair.envName] || '')}" ${pair.envName ? '' : 'disabled'} autocomplete="off" />`
      : `<input type="text" class="api-bootstrap-pair-value" ${attrs} placeholder="${escapeHtml(t('apiBootstrap.valuePlaceholder'))}" value="${escapeHtml(pair.value)}" />`;
    return `
      <li class="api-bootstrap-pair-row">
        <input type="text" class="api-bootstrap-pair-name" ${attrs} placeholder="${escapeHtml(t('common.namePlaceholder'))}" value="${escapeHtml(pair.name)}" />
        <select class="api-bootstrap-pair-mode" ${attrs}>
          <option value="literal" ${pair.mode === 'literal' ? 'selected' : ''}>${escapeHtml(t('apiConfig.headerModeValue'))}</option>
          <option value="env" ${pair.mode === 'env' ? 'selected' : ''}>${escapeHtml(t('apiConfig.headerModeEnv'))}</option>
        </select>
        ${valueInput}
        <button type="button" class="btn-secondary btn-tiny btn-api-bootstrap-remove-pair" ${attrs} title="${escapeHtml(t('common.remove'))}">−</button>
      </li>`;
  }

  function pairListHtml(listKey, labelKey, pairs, testValues) {
    return `
      <div class="row-label">${escapeHtml(t(labelKey))}</div>
      <ul class="api-bootstrap-pairs">${pairs.map((pair, i) => pairRowHtml(listKey, pair, i, testValues)).join('')}</ul>
      <button type="button" class="btn-secondary btn-tiny btn-api-bootstrap-add-pair" data-list="${listKey}">${escapeHtml(t('apiBootstrap.addRow'))}</button>`;
  }

  function recordingListHtml(entries) {
    if (entries.length === 0) {
      return `<li class="api-candidates-empty">${escapeHtml(t('apiBootstrap.recordingEmpty'))}</li>`;
    }
    return entries.map(({ entry, likely }) => `
      <li class="api-candidate api-bootstrap-recording-entry${likely ? ' likely' : ''}" data-entry-id="${escapeHtml(entry.id)}">
        <div class="api-candidate-source">${escapeHtml(entry.method)} ${escapeHtml(entry.status)}${likely ? ` · ${escapeHtml(t('apiBootstrap.recordingLikely'))}` : ''}</div>
        <div class="api-candidate-path" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</div>
      </li>`).join('');
  }

  function bootstrapConfigHtml(bootstrap, recordingEntries, testValues) {
    return `
      <div class="actions">
        <button type="button" id="btn-api-bootstrap-from-recording" class="btn-secondary btn-tiny">${escapeHtml(t('apiBootstrap.fromRecordingBtn'))}</button>
      </div>
      ${recordingEntries
        ? `<p class="browser-actions-hint">${escapeHtml(t('apiBootstrap.recordingHint'))}</p>
           <ul id="api-bootstrap-recording-list" class="api-candidates-list">${recordingListHtml(recordingEntries)}</ul>`
        : ''}
      <div class="api-bootstrap-request-row">
        <select class="api-bootstrap-field" data-field="method">
          <option value="POST" ${bootstrap.method === 'POST' ? 'selected' : ''}>POST</option>
          <option value="GET" ${bootstrap.method === 'GET' ? 'selected' : ''}>GET</option>
        </select>
        <input type="text" class="api-bootstrap-field" data-field="url" placeholder="https://example.com/auth/token" value="${escapeHtml(bootstrap.url)}" />
      </div>
      ${pairListHtml('headers', 'apiBootstrap.headersLabel', bootstrap.headers, testValues)}
      ${bootstrap.method === 'POST'
        ? `${pairListHtml('bodyFields', 'apiBootstrap.bodyFieldsLabel', bootstrap.bodyFields, testValues)}
           <label class="api-bootstrap-encoding">${escapeHtml(t('apiBootstrap.bodyEncodingLabel'))}
             <select class="api-bootstrap-field" data-field="bodyEncoding">
               <option value="Json" ${bootstrap.bodyEncoding === 'Json' ? 'selected' : ''}>JSON</option>
               <option value="Form" ${bootstrap.bodyEncoding === 'Form' ? 'selected' : ''}>${escapeHtml(t('apiBootstrap.bodyEncodingForm'))}</option>
             </select>
           </label>`
        : ''}
      <div class="row-label">${escapeHtml(t('apiBootstrap.valuePathLabel'))}</div>
      <input type="text" class="api-bootstrap-field" data-field="valuePath" placeholder="access_token" value="${escapeHtml(bootstrap.valuePath)}" />
      <div class="row-label">${escapeHtml(t('apiBootstrap.nameLabel'))}</div>
      <input type="text" class="api-bootstrap-field" data-field="name" placeholder="token" value="${escapeHtml(bootstrap.name)}" />
      <p class="browser-actions-hint">${escapeHtml(t('apiBootstrap.usageHint', { placeholder: `{${bootstrap.name || 'token'}}` }))}</p>`;
  }

  // Called from popup.js's render() while the API_CONFIG screen is showing.
  function renderApiBootstrapSection(bridge) {
    const state = bridge.getState();
    const bootstrap = state.apiConfigDraft?.bootstrap || null;
    const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-api-bootstrap'));
    if (toggle) toggle.checked = !!bootstrap;
    const configEl = document.getElementById('api-bootstrap-config');
    if (!configEl) return;
    configEl.classList.toggle('hidden', !bootstrap);
    configEl.innerHTML = bootstrap
      ? bootstrapConfigHtml(bootstrap, state.apiBootstrapRecordingEntries, state.apiBootstrapTestValues || {})
      : '';
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function setBootstrapEnabled(bridge, enabled) {
    const draft = bridge.getState().apiConfigDraft;
    log('API_BOOTSTRAP toggle', enabled);
    if (enabled) {
      patchDraft(bridge, { bootstrap: createDefaultBootstrapDraft() });
    } else {
      bridge.patchState({ apiBootstrapRecordingEntries: null });
      patchDraft(bridge, { bootstrap: null, ...stripBootstrapReferences(draft) });
    }
  }

  // Renaming the bootstrap value carries every header template referencing
  // the old "{name}" along, so a rename never silently breaks the
  // "Bearer {token}" header the user already set up.
  function setBootstrapField(bridge, field, value) {
    const draft = bridge.getState().apiConfigDraft;
    if (field !== 'name') {
      patchBootstrap(bridge, { [field]: field === 'url' || field === 'valuePath' ? value.trim() : value });
      return;
    }
    const oldName = draft.bootstrap.name;
    const newName = value.trim();
    const headerDecisions = { ...draft.headerDecisions };
    Object.entries(headerDecisions).forEach(([header, decision]) => {
      if (decision.mode === 'bootstrap' && decision.template) {
        headerDecisions[header] = { ...decision, template: decision.template.split(`{${oldName}}`).join(`{${newName}}`) };
      }
    });
    patchDraft(bridge, { bootstrap: { ...draft.bootstrap, name: newName }, headerDecisions });
  }

  function updatePair(bridge, listKey, index, patch) {
    const bootstrap = bridge.getState().apiConfigDraft.bootstrap;
    const list = bootstrap[listKey].map((pair, i) => {
      if (i !== index) return pair;
      const next = { ...pair, ...patch };
      // Switching a named row to env mode suggests a variable name right away.
      if (patch.mode === 'env' && !next.envName && next.name) next.envName = suggestEnvVarName(next.name);
      return next;
    });
    patchBootstrap(bridge, { [listKey]: list });
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

  // "Take from recording": lists every recorded request with a successful
  // JSON-looking response (the main request itself excluded), sorted so the
  // ones whose response contains a value the main request actually sends
  // (its token, in practice) come first, marked as "likely".
  async function openRecordingPicker(bridge) {
    if (bridge.getState().apiBootstrapRecordingEntries) {
      bridge.patchState({ apiBootstrapRecordingEntries: null });
      return;
    }
    const draft = bridge.getState().apiConfigDraft;
    const mainStrings = [draft.sourceUrl || '', ...(draft.capturedHeaders || []).map(h => h.value)];
    const entries = (await fetchCaptureEntries())
      .filter(entry => entry.status >= 200 && entry.status < 300 && entry.body && entry.url !== draft.sourceUrl)
      .map((entry) => {
        let likely = false;
        try {
          const detected = detectTokenInResponse(JSON.parse(entry.body), mainStrings);
          likely = !!detected && mainStrings.some(s => s.includes(detected.value));
        } catch {
          return null; // not a JSON response — can't be a token endpoint we can read a value from
        }
        return { entry, likely };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.likely) - Number(a.likely));
    log('API_BOOTSTRAP recording picker', { count: entries.length });
    bridge.patchState({ apiBootstrapRecordingEntries: entries });
  }

  function applyRecordingEntry(bridge, entryId) {
    const state = bridge.getState();
    const picked = (state.apiBootstrapRecordingEntries || []).find(({ entry }) => String(entry.id) === String(entryId));
    if (!picked) return;
    const draft = state.apiConfigDraft;
    const name = draft.bootstrap?.name?.trim() || undefined;
    const { bootstrap, tokenValue } = bootstrapDraftFromCaptureEntry(picked.entry, { url: draft.sourceUrl, capturedHeaders: draft.capturedHeaders }, name);
    log('API_BOOTSTRAP from recording', { url: bootstrap.url, valuePath: bootstrap.valuePath, tokenDetected: !!tokenValue });
    bridge.patchState({ apiBootstrapRecordingEntries: null });
    patchDraft(bridge, { bootstrap, ...wireTokenIntoMainRequest(draft, tokenValue, bootstrap.name) });
    bridge.showToast(
      bootstrap.valuePath ? t('apiBootstrap.recordingApplied', { path: bootstrap.valuePath }) : t('apiBootstrap.recordingNoValuePath'),
      null, bootstrap.valuePath ? 'info' : 'warn');
  }

  // ── Event wiring ────────────────────────────────────────────────────────────

  function wireApiBootstrapEvents(bridge) {
    const section = document.getElementById('api-bootstrap-section');
    if (!section) return;

    section.addEventListener('change', (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      if (target.id === 'toggle-api-bootstrap') { setBootstrapEnabled(bridge, target.checked); return; }
      if (target.classList.contains('api-bootstrap-field')) { setBootstrapField(bridge, target.dataset.field, target.value); return; }
      if (target.classList.contains('api-bootstrap-test-value')) {
        // patchState (not setState): test values must never reach
        // persistState()/chrome.storage.session, same as fillTestValues.
        const envName = target.dataset.envName;
        bridge.patchState({ apiBootstrapTestValues: { ...bridge.getState().apiBootstrapTestValues, [envName]: target.value } });
        return;
      }
      const listKey = target.dataset.list;
      const index = parseInt(target.dataset.index, 10);
      if (!listKey || Number.isNaN(index)) return;
      if (target.classList.contains('api-bootstrap-pair-name')) updatePair(bridge, listKey, index, { name: target.value.trim() });
      else if (target.classList.contains('api-bootstrap-pair-mode')) updatePair(bridge, listKey, index, { mode: target.value });
      else if (target.classList.contains('api-bootstrap-pair-value')) updatePair(bridge, listKey, index, { value: target.value });
      else if (target.classList.contains('api-bootstrap-pair-env')) updatePair(bridge, listKey, index, { envName: target.value.trim() });
    });

    section.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.closest('#btn-api-bootstrap-from-recording')) { openRecordingPicker(bridge); return; }
      const entryEl = /** @type {HTMLElement | null} */ (target.closest('.api-bootstrap-recording-entry'));
      if (entryEl) { applyRecordingEntry(bridge, entryEl.dataset.entryId); return; }
      const addBtn = /** @type {HTMLElement | null} */ (target.closest('.btn-api-bootstrap-add-pair'));
      if (addBtn) {
        const listKey = addBtn.dataset.list;
        const bootstrap = bridge.getState().apiConfigDraft.bootstrap;
        patchBootstrap(bridge, { [listKey]: [...bootstrap[listKey], createBootstrapPair()] });
        return;
      }
      const removeBtn = /** @type {HTMLElement | null} */ (target.closest('.btn-api-bootstrap-remove-pair'));
      if (removeBtn) {
        const listKey = removeBtn.dataset.list;
        const index = parseInt(removeBtn.dataset.index, 10);
        const bootstrap = bridge.getState().apiConfigDraft.bootstrap;
        patchBootstrap(bridge, { [listKey]: bootstrap[listKey].filter((_, i) => i !== index) });
      }
    });
  }

  return { renderApiBootstrapSection, wireApiBootstrapEvents, openRecordingPicker, applyRecordingEntry };
})();

if (typeof module !== 'undefined') module.exports = SFApiBootstrapUI;
if (typeof self !== 'undefined') self.SFApiBootstrapUI = SFApiBootstrapUI;
