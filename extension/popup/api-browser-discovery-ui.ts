// API mode: the BrowserDiscoverySource editor (Issue #216) — its action-list
// cards (WaitFor/Fill/Click/Scroll, times in seconds) and the draft mutations
// behind them. Split out of api-config-ui.ts (Issue #390); behavior unchanged.
// See api-config-ui.ts for the `bridge` convention.
import type * as SFDraft from '../types/drafts';
import type { BrowserActionField, PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { envVarNoteHtml } from './env-var-ui';
import { msToSecondsText, secondsTextToMs } from './login-flow';
import {
  STATES, earlierParameterNames,
} from './api-config';
import { escapeHtml } from './dom';
import type { ApiConfigDraft, ParameterPart, SourceOf } from './api-config';

const log = createLogger('SF:ApiConfigUI');
// Issue #216: BrowserDiscoverySource's action list reuses the exact same
// draft shape/helpers the top-level login-flow editor already uses —
// api-config.ts can't import these itself (scraping-config-builder.ts
// already imports api-config.ts; the reverse would be a circular
// require), so the API_CONFIG UI modules (one layer above both) do the
// wiring instead.
import {
  addBrowserAction, removeBrowserAction, updateBrowserAction, frameBadgeHtml,
} from './scraping-config-builder';
import { renderParameterPlaceholderPicker, patchApiConfigSource } from './api-config-shared-ui';

// Issue #216: BrowserDiscoverySource's own action-list editor — visually
// mirrors browser-actions-ui.ts's renderBrowserActions (one card per
// action, a kind label, a frame badge, a remove button, kind-specific
// fields) but is its own smaller renderer rather than a reused/
// parameterized version of that function: renderBrowserActions is
// hardcoded to the single, page-level '#browser-actions-list' container,
// and this is this codebase's own established convention for a second,
// differently-scoped instance of the same kind of small DOM helper (see renderMatchCountHint). Every control carries both data-part-id and
// data-index so the single delegated listener on #api-config-parameters
// can address the right parameter's own action array.
export function renderBrowserDiscoverySourceFields(draft: ApiConfigDraft, part: ParameterPart, source: SourceOf<'browserDiscovery'>): HTMLElement {
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

  const kindLabels: Record<SFDraft.BrowserAction['kind'], string> = {
    waitFor: t('browserActions.kindWaitFor'),
    fill: t('browserActions.kindFill'),
    click: t('browserActions.kindClick'),
    scroll: t('browserActions.kindScroll'),
  };

  function pickRow(index: number, field: string, value: string | null | undefined, label: string | null): HTMLElement {
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
    card.dataset.index = String(i);

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
  const kinds: SFDraft.BrowserAction['kind'][] = ['waitFor', 'fill', 'click', 'scroll'];
  addRow.innerHTML = kinds.map(kind =>
    `<button type="button" class="btn-secondary btn-tiny btn-add-discovery-action" data-part-id="${safePartId}" data-kind="${kind}">+ ${escapeHtml(kindLabels[kind])}</button>`,
  ).join('');
  wrap.appendChild(addRow);

  return wrap;
}

// These handlers only run for a browser-discovery part of an open API_CONFIG draft.
function discoverySource(bridge: PopupBridge, partId: string): SourceOf<'browserDiscovery'> {
  return (bridge.getState().apiConfigDraft as ApiConfigDraft).parameterSources[partId] as SourceOf<'browserDiscovery'>;
}

export function addDiscoveryAction(bridge: PopupBridge, partId: string, kind: SFDraft.BrowserAction['kind']): void {
  patchApiConfigSource<SourceOf<'browserDiscovery'>>(bridge, partId, { actions: addBrowserAction(discoverySource(bridge, partId).actions || [], kind) });
}

export function removeDiscoveryAction(bridge: PopupBridge, partId: string, index: number): void {
  patchApiConfigSource<SourceOf<'browserDiscovery'>>(bridge, partId, { actions: removeBrowserAction(discoverySource(bridge, partId).actions || [], index) });
}

export function updateDiscoveryAction(bridge: PopupBridge, partId: string, index: number, patch: Partial<SFDraft.BrowserAction>): void {
  patchApiConfigSource<SourceOf<'browserDiscovery'>>(bridge, partId, { actions: updateBrowserAction(discoverySource(bridge, partId).actions || [], index, patch) });
}

// The BrowserDiscoverySource part of the "api-config-parameters" delegated
// listeners (see wireApiParameterEvents in api-parameters-ui.ts): called last,
// after the parameter-source branches have not matched.
export function handleBrowserDiscoveryChange(bridge: PopupBridge, e: Event): void {
    const target = e.target as Element;
    // ── BrowserDiscoverySource (Issue #216) ───────────────────────────────
    const discoveryUrl = target.closest<HTMLInputElement>('.api-discovery-url');
    if (discoveryUrl) { patchApiConfigSource(bridge, discoveryUrl.dataset.partId as string, { discoveryUrl: discoveryUrl.value.trim() }); return; }

    const actionTimeout = target.closest<HTMLInputElement>('.discovery-action-timeout');
    if (actionTimeout) {
      updateDiscoveryAction(bridge, actionTimeout.dataset.partId as string, parseInt(actionTimeout.dataset.index as string, 10), {
        timeoutMs: secondsTextToMs(actionTimeout.value, 5000),
      });
      return;
    }
    const actionEnvName = target.closest<HTMLInputElement>('.discovery-action-env-name');
    if (actionEnvName) {
      updateDiscoveryAction(bridge, actionEnvName.dataset.partId as string, parseInt(actionEnvName.dataset.index as string, 10), {
        environmentVariableName: actionEnvName.value.trim(),
      });
      return;
    }
    const actionClickTarget = target.closest<HTMLSelectElement>('.discovery-action-click-target');
    if (actionClickTarget) {
      updateDiscoveryAction(bridge, actionClickTarget.dataset.partId as string, parseInt(actionClickTarget.dataset.index as string, 10), { target: actionClickTarget.value as 'first' | 'last' | 'all' });
      return;
    }
    const actionClickWait = target.closest<HTMLInputElement>('.discovery-action-click-wait-after-ms');
    if (actionClickWait) {
      updateDiscoveryAction(bridge, actionClickWait.dataset.partId as string, parseInt(actionClickWait.dataset.index as string, 10), {
        waitAfterMs: secondsTextToMs(actionClickWait.value, 250, { allowZero: true }),
      });
      return;
    }
    const actionMaxIterations = target.closest<HTMLInputElement>('.discovery-action-max-iterations');
    if (actionMaxIterations) {
      const maxIterations = parseInt(actionMaxIterations.value, 10);
      updateDiscoveryAction(bridge, actionMaxIterations.dataset.partId as string, parseInt(actionMaxIterations.dataset.index as string, 10), {
        maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : 10,
      });
      return;
    }
    const actionWaitAfterMs = target.closest<HTMLInputElement>('.discovery-action-wait-after-ms');
    if (actionWaitAfterMs) {
      updateDiscoveryAction(bridge, actionWaitAfterMs.dataset.partId as string, parseInt(actionWaitAfterMs.dataset.index as string, 10), {
        waitAfterMs: secondsTextToMs(actionWaitAfterMs.value, 1000, { allowZero: true }),
      });
      return;
    }
    // Issue #289: a blank input deliberately resets to null (today's
    // jump-to-bottom default), not a clamped fallback number.
    const actionScrollStepPx = target.closest<HTMLInputElement>('.discovery-action-scroll-step-px');
    if (actionScrollStepPx) {
      const scrollStepPx = parseInt(actionScrollStepPx.value, 10);
      updateDiscoveryAction(bridge, actionScrollStepPx.dataset.partId as string, parseInt(actionScrollStepPx.dataset.index as string, 10), {
        scrollStepPx: Number.isFinite(scrollStepPx) && scrollStepPx > 0 ? scrollStepPx : null,
      });
    }
}

export function handleBrowserDiscoveryClick(bridge: PopupBridge, e: Event): void {
    const target = e.target as Element;
    // ── BrowserDiscoverySource (Issue #216) ───────────────────────────────
    const addActionBtn = target.closest<HTMLElement>('.btn-add-discovery-action');
    if (addActionBtn) { addDiscoveryAction(bridge, addActionBtn.dataset.partId as string, addActionBtn.dataset.kind as SFDraft.BrowserAction['kind']); return; }
    const removeActionBtn = target.closest<HTMLElement>('.btn-remove-discovery-action');
    if (removeActionBtn) { removeDiscoveryAction(bridge, removeActionBtn.dataset.partId as string, parseInt(removeActionBtn.dataset.index as string, 10)); return; }
    const pickActionBtn = target.closest<HTMLElement>('.btn-pick-discovery-action-selector');
    if (pickActionBtn) {
      const partId = pickActionBtn.dataset.partId as string;
      const index = parseInt(pickActionBtn.dataset.index as string, 10);
      const field = pickActionBtn.dataset.field as BrowserActionField;
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
