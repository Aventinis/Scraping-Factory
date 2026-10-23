// API mode: the BrowserDiscoverySource editor (Issue #216) — its action-list
// cards (WaitFor/Fill/Click/Scroll, times in seconds) and the draft mutations
// behind them. Split out of api-config-ui.js (Issue #390); behavior unchanged.
// See api-config-ui.js for the `bridge` convention.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const { envVarNoteHtml } = require('./env-var-ui');
const { msToSecondsText, secondsTextToMs } = require('./login-flow');
const {
  STATES, escapeHtml, earlierParameterNames,
} = require('./api-config');
// Issue #216: BrowserDiscoverySource's action list reuses the exact same
// draft shape/helpers the top-level login-flow editor already uses —
// api-config.js can't import these itself (scraping-config-builder.js
// already imports api-config.js; the reverse would be a circular
// require), so the API_CONFIG UI modules (one layer above both) do the
// wiring instead.
const {
  addBrowserAction, removeBrowserAction, updateBrowserAction, frameBadgeHtml,
} = require('./scraping-config-builder');
const { renderParameterPlaceholderPicker, patchApiConfigSource } = require('./api-config-shared-ui');

// Issue #216: BrowserDiscoverySource's own action-list editor — visually
// mirrors browser-actions-ui.js's renderBrowserActions (one card per
// action, a kind label, a frame badge, a remove button, kind-specific
// fields) but is its own smaller renderer rather than a reused/
// parameterized version of that function: renderBrowserActions is
// hardcoded to the single, page-level '#browser-actions-list' container,
// and this is this codebase's own established convention for a second,
// differently-scoped instance of the same kind of small DOM helper (see renderMatchCountHint). Every control carries both data-part-id and
// data-index so the single delegated listener on #api-config-parameters
// can address the right parameter's own action array.
function renderBrowserDiscoverySourceFields(draft, part, source) {
  const safePartId = escapeHtml(part.id);
  const actions = source.actions || [];
  const wrap = document.createElement('div');
  wrap.className = 'api-discovery-source';

  // Issue #217: DiscoveryUrl may itself reference an earlier-declared
  // parameter's own value — see renderParameterPlaceholderPicker's doc
  // comment.
  const earlierNames = earlierParameterNames(draft, part.id);
  const urlRow = document.createElement('div');
  urlRow.innerHTML =
    `<label>${escapeHtml(t('apiConfig.discoveryUrlLabel'))}</label>` +
    `<input type="text" class="api-discovery-url" data-part-id="${safePartId}" placeholder="https://example.com/angebote" value="${escapeHtml(source.discoveryUrl || '')}" />` +
    renderParameterPlaceholderPicker(earlierNames, safePartId, '.api-discovery-url', 'discoveryUrl');
  wrap.appendChild(urlRow);

  const kindLabels = {
    waitFor: t('browserActions.kindWaitFor'),
    fill: t('browserActions.kindFill'),
    click: t('browserActions.kindClick'),
    scroll: t('browserActions.kindScroll'),
  };

  function pickRow(index, field, value, label) {
    const row = document.createElement('div');
    row.className = 'browser-action-selector-row';
    const selectorText = value || t('browserActions.noSelector');
    const labelHtml = label ? `<label>${escapeHtml(label)}</label>` : '';
    row.innerHTML =
      labelHtml +
      `<span class="field-selector" title="${escapeHtml(selectorText)}">${escapeHtml(selectorText)}</span>` +
      `<button type="button" class="btn-secondary btn-tiny btn-pick-discovery-action-selector" data-part-id="${safePartId}" data-index="${index}" data-field="${field}">${escapeHtml(t('browserActions.pickSelectorBtn'))}</button>`;
    return row;
  }

  const list = document.createElement('div');
  list.className = 'api-discovery-actions-list';
  actions.forEach((action, i) => {
    const card = document.createElement('div');
    card.className = 'browser-action-card';
    card.dataset.partId = part.id;
    card.dataset.index = i;

    const header = document.createElement('div');
    header.className = 'browser-action-header';
    header.innerHTML =
      `<span class="row-label">${escapeHtml(kindLabels[action.kind] || action.kind)}</span>` +
      frameBadgeHtml(action.framePath) +
      `<button type="button" class="btn-danger btn-remove-discovery-action" data-part-id="${safePartId}" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
    card.appendChild(header);

    if (action.kind === 'waitFor') {
      card.appendChild(pickRow(i, 'selector', action.selector, null));
      card.insertAdjacentHTML('beforeend', `<div class="browser-action-field-row">
          <label>${escapeHtml(t('browserActions.timeoutSecondsLabel'))}</label>
          <input type="number" class="discovery-action-timeout" data-part-id="${safePartId}" data-index="${i}" placeholder="5" value="${escapeHtml(msToSecondsText(action.timeoutMs))}" min="0" step="any" />
        </div>`);
    } else if (action.kind === 'fill') {
      card.appendChild(pickRow(i, 'selector', action.selector, null));
      card.insertAdjacentHTML('beforeend', `<div class="browser-action-field-row">
          <label>${escapeHtml(t('browserActions.envVarLabel'))}</label>
          <input type="text" class="discovery-action-env-name" data-env-var data-part-id="${safePartId}" data-index="${i}" placeholder="${escapeHtml(t('envVar.placeholder.fill'))}" value="${escapeHtml(action.environmentVariableName || '')}" />
        </div>${envVarNoteHtml()}`);
    } else if (action.kind === 'click') {
      card.appendChild(pickRow(i, 'selector', action.selector, null));
      // Issue #267: same first/last/all choice as the top-level click action.
      const clickTarget = action.target || 'first';
      card.insertAdjacentHTML('beforeend', `<div class="browser-action-field-row">
          <label>${escapeHtml(t('browserActions.clickTargetLabel'))}</label>
          <select class="discovery-action-click-target" data-part-id="${safePartId}" data-index="${i}">${
          ['first', 'last', 'all'].map(v => `<option value="${v}"${v === clickTarget ? ' selected' : ''}>${escapeHtml(t('browserActions.clickTarget.' + v))}</option>`).join('')
        }</select>
        </div>`);
      if (clickTarget === 'all') {
        card.insertAdjacentHTML('beforeend', `<div class="browser-action-field-row">
            <label>${escapeHtml(t('browserActions.waitAfterClickSecondsLabel'))}</label>
            <input type="number" class="discovery-action-click-wait-after-ms" data-part-id="${safePartId}" data-index="${i}" placeholder="0.25" value="${escapeHtml(msToSecondsText(action.waitAfterMs ?? 250))}" min="0" step="any" />
          </div>`);
      }
    } else if (action.kind === 'scroll') {
      card.appendChild(pickRow(i, 'containerSelector', action.containerSelector, t('browserActions.containerSelectorLabel')));
      card.appendChild(pickRow(i, 'loadMoreButtonSelector', action.loadMoreButtonSelector, t('browserActions.loadMoreButtonSelectorLabel')));
      card.insertAdjacentHTML('beforeend', `<div class="browser-action-field-row">
          <label>${escapeHtml(t('browserActions.maxIterationsLabel'))}</label>
          <input type="number" class="discovery-action-max-iterations" data-part-id="${safePartId}" data-index="${i}" value="${action.maxIterations}" min="1" />
          <label>${escapeHtml(t('browserActions.waitAfterRoundSecondsLabel'))}</label>
          <input type="number" class="discovery-action-wait-after-ms" data-part-id="${safePartId}" data-index="${i}" placeholder="1" value="${escapeHtml(msToSecondsText(action.waitAfterMs))}" min="0" step="any" />
        </div>
        <div class="browser-action-field-row">
          <label>${escapeHtml(t('browserActions.scrollStepPxLabel'))}</label>
          <input type="number" class="discovery-action-scroll-step-px" data-part-id="${safePartId}" data-index="${i}" placeholder="${escapeHtml(t('browserActions.scrollStepPxPlaceholder'))}" value="${action.scrollStepPx || ''}" min="1" />
        </div>`);
    }

    list.appendChild(card);
  });
  wrap.appendChild(list);

  const addRow = document.createElement('div');
  addRow.className = 'actions';
  addRow.innerHTML = ['waitFor', 'fill', 'click', 'scroll'].map(kind =>
    `<button type="button" class="btn-secondary btn-tiny btn-add-discovery-action" data-part-id="${safePartId}" data-kind="${kind}">+ ${escapeHtml(kindLabels[kind])}</button>`,
  ).join('');
  wrap.appendChild(addRow);

  return wrap;
}

function addDiscoveryAction(bridge, partId, kind) {
  const source = bridge.getState().apiConfigDraft.parameterSources[partId];
  patchApiConfigSource(bridge, partId, { actions: addBrowserAction(source.actions || [], kind) });
}

function removeDiscoveryAction(bridge, partId, index) {
  const source = bridge.getState().apiConfigDraft.parameterSources[partId];
  patchApiConfigSource(bridge, partId, { actions: removeBrowserAction(source.actions || [], index) });
}

function updateDiscoveryAction(bridge, partId, index, patch) {
  const source = bridge.getState().apiConfigDraft.parameterSources[partId];
  patchApiConfigSource(bridge, partId, { actions: updateBrowserAction(source.actions || [], index, patch) });
}

// The BrowserDiscoverySource part of the "api-config-parameters" delegated
// listeners (see wireApiParameterEvents in api-parameters-ui.js): called last,
// after the parameter-source branches have not matched.
function handleBrowserDiscoveryChange(bridge, e) {
    // ── BrowserDiscoverySource (Issue #216) ───────────────────────────────
    const discoveryUrl = e.target.closest('.api-discovery-url');
    if (discoveryUrl) { patchApiConfigSource(bridge, discoveryUrl.dataset.partId, { discoveryUrl: discoveryUrl.value.trim() }); return; }

    const actionTimeout = e.target.closest('.discovery-action-timeout');
    if (actionTimeout) {
      updateDiscoveryAction(bridge, actionTimeout.dataset.partId, parseInt(actionTimeout.dataset.index, 10), {
        timeoutMs: secondsTextToMs(actionTimeout.value, 5000),
      });
      return;
    }
    const actionEnvName = e.target.closest('.discovery-action-env-name');
    if (actionEnvName) {
      updateDiscoveryAction(bridge, actionEnvName.dataset.partId, parseInt(actionEnvName.dataset.index, 10), {
        environmentVariableName: actionEnvName.value.trim(),
      });
      return;
    }
    const actionClickTarget = e.target.closest('.discovery-action-click-target');
    if (actionClickTarget) {
      updateDiscoveryAction(bridge, actionClickTarget.dataset.partId, parseInt(actionClickTarget.dataset.index, 10), { target: actionClickTarget.value });
      return;
    }
    const actionClickWait = e.target.closest('.discovery-action-click-wait-after-ms');
    if (actionClickWait) {
      updateDiscoveryAction(bridge, actionClickWait.dataset.partId, parseInt(actionClickWait.dataset.index, 10), {
        waitAfterMs: secondsTextToMs(actionClickWait.value, 250, { allowZero: true }),
      });
      return;
    }
    const actionMaxIterations = e.target.closest('.discovery-action-max-iterations');
    if (actionMaxIterations) {
      const maxIterations = parseInt(actionMaxIterations.value, 10);
      updateDiscoveryAction(bridge, actionMaxIterations.dataset.partId, parseInt(actionMaxIterations.dataset.index, 10), {
        maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : 10,
      });
      return;
    }
    const actionWaitAfterMs = e.target.closest('.discovery-action-wait-after-ms');
    if (actionWaitAfterMs) {
      updateDiscoveryAction(bridge, actionWaitAfterMs.dataset.partId, parseInt(actionWaitAfterMs.dataset.index, 10), {
        waitAfterMs: secondsTextToMs(actionWaitAfterMs.value, 1000, { allowZero: true }),
      });
      return;
    }
    // Issue #289: a blank input deliberately resets to null (today's
    // jump-to-bottom default), not a clamped fallback number.
    const actionScrollStepPx = e.target.closest('.discovery-action-scroll-step-px');
    if (actionScrollStepPx) {
      const scrollStepPx = parseInt(actionScrollStepPx.value, 10);
      updateDiscoveryAction(bridge, actionScrollStepPx.dataset.partId, parseInt(actionScrollStepPx.dataset.index, 10), {
        scrollStepPx: Number.isFinite(scrollStepPx) && scrollStepPx > 0 ? scrollStepPx : null,
      });
    }
}

function handleBrowserDiscoveryClick(bridge, e) {
    // ── BrowserDiscoverySource (Issue #216) ───────────────────────────────
    const addActionBtn = e.target.closest('.btn-add-discovery-action');
    if (addActionBtn) { addDiscoveryAction(bridge, addActionBtn.dataset.partId, addActionBtn.dataset.kind); return; }
    const removeActionBtn = e.target.closest('.btn-remove-discovery-action');
    if (removeActionBtn) { removeDiscoveryAction(bridge, removeActionBtn.dataset.partId, parseInt(removeActionBtn.dataset.index, 10)); return; }
    const pickActionBtn = e.target.closest('.btn-pick-discovery-action-selector');
    if (pickActionBtn) {
      const partId = pickActionBtn.dataset.partId;
      const index = parseInt(pickActionBtn.dataset.index, 10);
      const field = pickActionBtn.dataset.field;
      log('BTN pick-discovery-action-selector → START_SELECTION', { partId, index, field });
      bridge.stopPreviewIfActive();
      chrome.runtime.sendMessage({ type: 'START_SELECTION' });
      bridge.setState(STATES.SELECTING, {
        pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        selectionKind: 'apiDiscoveryAction', pendingApiDiscoveryPartId: partId, pendingApiDiscoveryActionIndex: index, pendingApiDiscoveryActionField: field,
        domTree: null, domTreeTruncated: false, domTreeError: null,
      });
    }
}

module.exports = {
  renderBrowserDiscoverySourceFields,
  addDiscoveryAction,
  removeDiscoveryAction,
  updateDiscoveryAction,
  handleBrowserDiscoveryChange,
  handleBrowserDiscoveryClick,
};
