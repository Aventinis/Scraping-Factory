// ── Engine + browser actions: render + event-wiring ─────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — Issue #41/#42's engine toggle and the generic,
// ordered browser-actions list (WaitFor/Fill/Click/Scroll) never got their
// own module even after every other feature area did. Mode-independent,
// unlike fields/groups/apiConfig — no interaction with switchMode/
// MODE_SWITCH_CLEARS. Functions take a `bridge` object (same convention as
// flat-mode-ui.js/container-tree-ui.js) instead of closing over popup.js's
// own module-level state.
const SFBrowserActionsUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { STATES, escapeHtml } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { addBrowserAction, removeBrowserAction, updateBrowserAction, frameBadgeHtml } =
    typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

  // Issue #41/#42, Phase 5/6. One card per action, kind fixed at creation time
  // (via btn-add-action-wait/-fill/-click/-scroll) — unlike the API-config
  // parameter cards, there's no "change the kind afterward" control, since an
  // action is created from scratch by the user rather than pre-existing.
  function renderBrowserActions(actions, testValues) {
    const container = document.getElementById('browser-actions-list');
    if (!container) return;
    container.innerHTML = '';

    const kindLabels = {
      waitFor: t('browserActions.kindWaitFor'),
      fill: t('browserActions.kindFill'),
      click: t('browserActions.kindClick'),
      scroll: t('browserActions.kindScroll'),
    };

    // A single "pick element" row bound to a specific property of `action`
    // (data-field) — every kind but 'scroll' has exactly one such row
    // (property 'selector'); 'scroll' has two (containerSelector/
    // loadMoreButtonSelector), both optional, see buildSelectorRow's callers.
    function buildSelectorRow(index, field, value, label) {
      const row = document.createElement('div');
      row.className = 'browser-action-selector-row';
      const selectorText = value || t('browserActions.noSelector');
      const labelHtml = label ? `<label>${escapeHtml(label)}</label>` : '';
      row.innerHTML =
        labelHtml +
        `<span class="field-selector" title="${escapeHtml(selectorText)}">${escapeHtml(selectorText)}</span>` +
        `<button type="button" class="btn-secondary btn-tiny btn-pick-action-selector" data-index="${index}" data-field="${field}">${escapeHtml(t('browserActions.pickSelectorBtn'))}</button>`;
      return row;
    }

    actions.forEach((action, i) => {
      const card = document.createElement('div');
      card.className = 'browser-action-card';
      card.dataset.index = i;

      const header = document.createElement('div');
      header.className = 'browser-action-header';
      header.innerHTML =
        `<span class="row-label">${escapeHtml(kindLabels[action.kind] || action.kind)}</span>` +
        frameBadgeHtml(action.framePath) +
        `<button type="button" class="btn-danger btn-remove-action" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
      card.appendChild(header);

      if (action.kind === 'scroll') {
        card.appendChild(buildSelectorRow(i, 'containerSelector', action.containerSelector, t('browserActions.containerSelectorLabel')));
        card.appendChild(buildSelectorRow(i, 'loadMoreButtonSelector', action.loadMoreButtonSelector, t('browserActions.loadMoreButtonSelectorLabel')));

        const row = document.createElement('div');
        row.className = 'browser-action-field-row';
        row.innerHTML =
          `<label>${escapeHtml(t('browserActions.maxIterationsLabel'))}</label>` +
          `<input type="number" min="1" class="browser-action-max-iterations" data-index="${i}" value="${action.maxIterations}" />` +
          `<label>${escapeHtml(t('browserActions.waitAfterMsLabel'))}</label>` +
          `<input type="number" min="0" class="browser-action-wait-after-ms" data-index="${i}" value="${action.waitAfterMs}" />`;
        card.appendChild(row);

        container.appendChild(card);
        return;
      }

      card.appendChild(buildSelectorRow(i, 'selector', action.selector, null));

      if (action.kind === 'waitFor') {
        const row = document.createElement('div');
        row.className = 'browser-action-field-row';
        row.innerHTML =
          `<label>${escapeHtml(t('browserActions.timeoutLabel'))}</label>` +
          `<input type="number" min="1" class="browser-action-timeout" data-index="${i}" value="${action.timeoutMs}" />`;
        card.appendChild(row);
      } else if (action.kind === 'fill') {
        const row = document.createElement('div');
        row.className = 'browser-action-field-row';
        row.innerHTML =
          `<label>${escapeHtml(t('browserActions.envVarLabel'))}</label>` +
          `<input type="text" class="browser-action-env-name" data-index="${i}" placeholder="${escapeHtml(t('browserActions.envNamePlaceholder'))}" value="${escapeHtml(action.environmentVariableName || '')}" />`;
        card.appendChild(row);

        const hint = document.createElement('p');
        hint.className = 'browser-action-hint';
        hint.textContent = t('browserActions.envVarHint');
        card.appendChild(hint);

        // Issue #43: one-time test value for the /generate verification trial
        // run only — keyed by env-var name (not action index) so the change
        // handler doesn't need to look the action up by position. Only shown
        // once the env var name is actually set, since that's the join key.
        const envName = (action.environmentVariableName || '').trim();
        if (envName) {
          const testValueRow = document.createElement('div');
          testValueRow.className = 'browser-action-field-row';
          testValueRow.innerHTML =
            `<label>${escapeHtml(t('browserActions.testValueLabel'))}</label>` +
            `<input type="password" class="browser-action-test-value" data-env-name="${escapeHtml(envName)}" ` +
            `placeholder="${escapeHtml(t('browserActions.testValuePlaceholder'))}" value="${escapeHtml(testValues[envName] || '')}" />`;
          card.appendChild(testValueRow);

          const testValueHint = document.createElement('p');
          testValueHint.className = 'browser-action-hint';
          testValueHint.textContent = t('browserActions.testValueHint');
          card.appendChild(testValueHint);
        }
      }

      container.appendChild(card);
    });
  }

  // Called from popup.js's render(), alongside the mode-toggle section it
  // sits next to — engine active-state, browser-actions-section visibility,
  // and (Issue #175) the persistent-session toggle's checked-sync, which is
  // nested inside that section and needs no visibility gating of its own
  // beyond it.
  function renderBrowserActionsSection(bridge) {
    const state = bridge.getState();
    document.getElementById('btn-engine-static')?.classList.toggle('active', state.engine === 'Static');
    document.getElementById('btn-engine-browser')?.classList.toggle('active', state.engine === 'Browser');
    document.getElementById('browser-actions-section')?.classList.toggle('hidden', state.engine !== 'Browser');
    if (state.engine === 'Browser') renderBrowserActions(state.browserActions, state.fillTestValues);

    const persistentSessionToggle = document.getElementById('toggle-persistent-session');
    if (persistentSessionToggle) persistentSessionToggle.checked = state.persistentSession;
  }

  function wireBrowserActionsEvents(bridge) {
    document.getElementById('btn-engine-static')?.addEventListener('click', () => {
      log('BTN engine-static');
      bridge.setState(bridge.getState().current, { engine: 'Static' });
    });
    document.getElementById('btn-engine-browser')?.addEventListener('click', () => {
      log('BTN engine-browser');
      bridge.setState(bridge.getState().current, { engine: 'Browser' });
    });

    document.getElementById('btn-add-action-wait')?.addEventListener('click', () => {
      log('BTN add-action-wait');
      bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'waitFor') });
    });
    document.getElementById('btn-add-action-fill')?.addEventListener('click', () => {
      log('BTN add-action-fill');
      bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'fill') });
    });
    document.getElementById('btn-add-action-click')?.addEventListener('click', () => {
      log('BTN add-action-click');
      bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'click') });
    });
    document.getElementById('btn-add-action-scroll')?.addEventListener('click', () => {
      log('BTN add-action-scroll');
      bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'scroll') });
    });

    document.getElementById('browser-actions-list')?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.btn-remove-action');
      if (removeBtn) {
        const index = parseInt(removeBtn.dataset.index, 10);
        log('BROWSER_ACTION_REMOVE', { index });
        bridge.setState(bridge.getState().current, { browserActions: removeBrowserAction(bridge.getState().browserActions, index) });
        return;
      }
      const pickBtn = e.target.closest('.btn-pick-action-selector');
      if (pickBtn) {
        const index = parseInt(pickBtn.dataset.index, 10);
        const field = pickBtn.dataset.field; // 'selector' | 'containerSelector' | 'loadMoreButtonSelector' — see buildSelectorRow
        log('BTN pick-action-selector → START_SELECTION', { index, field });
        bridge.stopPreviewIfActive();
        chrome.runtime.sendMessage({ type: 'START_SELECTION' });
        bridge.setState(STATES.SELECTING, {
          pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [], selectionKind: 'browserAction', pendingBrowserActionIndex: index, pendingBrowserActionField: field,
          domTree: null, domTreeTruncated: false, domTreeError: null,
        });
      }
    });

    // change (not input) — same reasoning as the API-config screen's text
    // inputs: a re-render on every keystroke would reset the cursor position.
    document.getElementById('browser-actions-list')?.addEventListener('change', (e) => {
      const timeoutInput = e.target.closest('.browser-action-timeout');
      if (timeoutInput) {
        const index = parseInt(timeoutInput.dataset.index, 10);
        const timeoutMs = parseInt(timeoutInput.value, 10);
        bridge.setState(bridge.getState().current, {
          browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
            timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
          }),
        });
        return;
      }
      const envInput = e.target.closest('.browser-action-env-name');
      if (envInput) {
        const index = parseInt(envInput.dataset.index, 10);
        bridge.setState(bridge.getState().current, {
          browserActions: updateBrowserAction(bridge.getState().browserActions, index, { environmentVariableName: envInput.value.trim() }),
        });
        return;
      }
      const testValueInput = e.target.closest('.browser-action-test-value');
      if (testValueInput) {
        // patchState (not setState): fillTestValues must never reach
        // persistState()/chrome.storage.session — see its _state comment.
        const envName = testValueInput.dataset.envName;
        bridge.patchState({ fillTestValues: { ...bridge.getState().fillTestValues, [envName]: testValueInput.value } });
        return;
      }
      const maxIterationsInput = e.target.closest('.browser-action-max-iterations');
      if (maxIterationsInput) {
        const index = parseInt(maxIterationsInput.dataset.index, 10);
        const maxIterations = parseInt(maxIterationsInput.value, 10);
        bridge.setState(bridge.getState().current, {
          browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
            maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : 10,
          }),
        });
        return;
      }
      const waitAfterMsInput = e.target.closest('.browser-action-wait-after-ms');
      if (waitAfterMsInput) {
        const index = parseInt(waitAfterMsInput.dataset.index, 10);
        const waitAfterMs = parseInt(waitAfterMsInput.value, 10);
        bridge.setState(bridge.getState().current, {
          browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
            waitAfterMs: Number.isFinite(waitAfterMs) && waitAfterMs >= 0 ? waitAfterMs : 1000,
          }),
        });
      }
    });
  }

  return {
    renderBrowserActions, renderBrowserActionsSection, wireBrowserActionsEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFBrowserActionsUI;
if (typeof self !== 'undefined') self.SFBrowserActionsUI = SFBrowserActionsUI;
