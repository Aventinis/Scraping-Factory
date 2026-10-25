// ── Engine + browser actions: render / wiring ──
// Extracted from popup.ts (docs/design-notes/extension.md, "Popup module boundaries"): the engine toggle and the ordered browser-actions list
// (WaitFor / Fill / Click / Scroll). Mode-independent, so no interaction with switchMode. Functions take a `bridge`.
import type * as SFDraft from '../types/drafts';
import type { BrowserActionField, PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { STATES } from './api-config';
import { envVarNoteHtml } from './env-var-ui';
import { autoOpenAdvanced, createAdvancedDisclosure } from './advanced-disclosure-ui';
import { helpHostHtml } from './help-popover';
import { addLoginFlow, msToSecondsText, secondsTextToMs } from './login-flow';
import { addBrowserAction, removeBrowserAction, updateBrowserAction, frameBadgeHtml } from './scraping-config-builder';
import { renderStepRecording, wireStepRecordingEvents } from './step-recording-ui';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:Popup');

// One card per action, its kind fixed at creation (there is no "change the kind" control). A card made by the "Login form" starter carries a
// UI-only `role` (user / password / submit / loggedIn) that only changes wording; times are shown in seconds (stored as milliseconds, see
// login-flow.ts); rarely needed options sit under a remembered "Advanced" disclosure.
export function renderBrowserActions(actions: SFDraft.BrowserAction[], testValues: Record<string, string>): void {
  const container = byIdOrNull('browser-actions-list');
  if (!container) return;
  container.innerHTML = '';

  const kindLabels: Record<SFDraft.BrowserAction['kind'], string> = {
    waitFor: t('browserActions.kindWaitFor'),
    fill: t('browserActions.kindFill'),
    click: t('browserActions.kindClick'),
    scroll: t('browserActions.kindScroll'),
  };

  // A single "pick element" row bound to a specific property of `action`
  // (data-field) — every kind but 'scroll' has exactly one such row
  // (property 'selector'); 'scroll' has two (containerSelector/
  // loadMoreButtonSelector), both optional, see buildSelectorRow's callers.
  function buildSelectorRow(index: number, field: BrowserActionField, value: string | null | undefined, label: string | null, pickLabel?: string | null): HTMLElement {
    const row = document.createElement('div');
    row.className = 'browser-action-selector-row';
    const selectorText = value || t('browserActions.noSelector');
    const labelHtml = label ? `<label>${escapeHtml(label)}</label>` : '';
    row.innerHTML =
      labelHtml +
      `<span class="field-selector" title="${escapeHtml(selectorText)}">${escapeHtml(selectorText)}</span>` +
      `<button type="button" class="btn-secondary btn-tiny btn-pick-action-selector" data-index="${index}" data-field="${field}">${escapeHtml(pickLabel || t('browserActions.pickSelectorBtn'))}</button>`;
    return row;
  }

  // A labelled number input in seconds: shows the default as a placeholder.
  function secondsRow(labelKey: string, cls: string, index: number, ms: number | null | undefined, defaultMs: number, helpKey?: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'browser-action-field-row';
    row.innerHTML =
      `<label>${escapeHtml(t(labelKey))}</label>` +
      (helpKey ? helpHostHtml(helpKey) : '') +
      `<input type="number" min="0" step="any" class="${cls}" data-index="${index}" placeholder="${escapeHtml(msToSecondsText(defaultMs))}" value="${escapeHtml(msToSecondsText(ms))}" />`;
    return row;
  }

  // Rarely needed options, collapsed by default and remembered per kind.
  function advancedBlock(id: string): { details: HTMLDetailsElement; body: HTMLElement } {
    const details = createAdvancedDisclosure(id);
    return { details, body: details.querySelector('.advanced-disclosure-body') as HTMLElement };
  }

  actions.forEach((action, i) => {
    const role = action.role;
    const card = document.createElement('div');
    card.className = 'browser-action-card';
    card.dataset.index = String(i);

    const header = document.createElement('div');
    header.className = 'browser-action-header';
    const headerLabel = role ? t('browserActions.role.' + role) : (kindLabels[action.kind] || action.kind);
    header.innerHTML =
      `<span class="row-label">${escapeHtml(headerLabel)}</span>` +
      frameBadgeHtml(action.framePath) +
      `<button type="button" class="btn-danger btn-remove-action" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
    card.appendChild(header);

    if (action.kind === 'scroll') {
      const rounds = document.createElement('div');
      rounds.className = 'browser-action-field-row';
      rounds.innerHTML =
        `<label>${escapeHtml(t('browserActions.maxIterationsLabel'))}</label>` +
        helpHostHtml('help.browserActions.maxRounds') +
        `<input type="number" min="1" class="browser-action-max-iterations" data-index="${i}" placeholder="10" value="${action.maxIterations}" />`;
      card.appendChild(rounds);
      card.appendChild(secondsRow('browserActions.waitAfterRoundSecondsLabel', 'browser-action-wait-after-ms', i, action.waitAfterMs, 1000));

      const { details, body } = advancedBlock('browser-action-scroll');
      body.appendChild(buildSelectorRow(i, 'containerSelector', action.containerSelector, t('browserActions.containerSelectorLabel')));
      body.appendChild(buildSelectorRow(i, 'loadMoreButtonSelector', action.loadMoreButtonSelector, t('browserActions.loadMoreButtonSelectorLabel')));

      // Issue #289: empty = null = today's "jump straight to the bottom"
      // default — only a site whose sections lazy-load per scrolled-through
      // viewport (not classic append-below infinite scroll) needs this set.
      const stepRow = document.createElement('div');
      stepRow.className = 'browser-action-field-row';
      stepRow.innerHTML =
        `<label>${escapeHtml(t('browserActions.scrollStepPxLabel'))}</label>` +
        `<input type="number" min="1" class="browser-action-scroll-step-px" data-index="${i}" placeholder="${escapeHtml(t('browserActions.scrollStepPxPlaceholder'))}" value="${action.scrollStepPx || ''}" />`;
      body.appendChild(stepRow);
      card.appendChild(details);

      container.appendChild(card);
      return;
    }

    card.appendChild(buildSelectorRow(i, 'selector', action.selector, null, role ? t('browserActions.pickRole.' + role) : null));

    if (action.kind === 'click') {
      // Issue #267: which of several matches to click (Playwright would
      // otherwise abort on more than one) — "all" additionally paces the
      // clicks with a wait after each. A plain login button needs neither,
      // so both sit under "Advanced".
      const target = action.target || 'first';
      const { details, body } = advancedBlock('browser-action-click');
      const row = document.createElement('div');
      row.className = 'browser-action-field-row';
      row.innerHTML =
        `<label>${escapeHtml(t('browserActions.clickTargetLabel'))}</label>` +
        `<select class="browser-action-click-target" data-index="${i}">` +
        ['first', 'last', 'all'].map(v => `<option value="${v}"${v === target ? ' selected' : ''}>${escapeHtml(t('browserActions.clickTarget.' + v))}</option>`).join('') +
        `</select>`;
      body.appendChild(row);
      if (target === 'all') {
        body.appendChild(secondsRow('browserActions.waitAfterClickSecondsLabel', 'browser-action-click-wait-after-ms', i, action.waitAfterMs ?? 250, 250));
      }
      card.appendChild(details);
    }

    if (action.kind === 'waitFor') {
      card.appendChild(secondsRow('browserActions.timeoutSecondsLabel', 'browser-action-timeout', i, action.timeoutMs, 5000));
    } else if (action.kind === 'fill') {
      const envLabelKey = role === 'user' ? 'browserActions.envVarLabelUser' : role === 'password' ? 'browserActions.envVarLabelPassword' : 'browserActions.envVarLabel';
      const row = document.createElement('div');
      row.className = 'browser-action-field-row';
      row.innerHTML =
        `<label>${escapeHtml(t(envLabelKey))}</label>` +
        `<input type="text" class="browser-action-env-name" data-env-var data-index="${i}" placeholder="${escapeHtml(t('envVar.placeholder.fill'))}" value="${escapeHtml(action.environmentVariableName || '')}" />`;
      card.appendChild(row);
      card.insertAdjacentHTML('beforeend', envVarNoteHtml()); // Issue #397: the shared explanation + popover

      // Issue #43: one-time test value for the /generate verification trial
      // run only — keyed by env-var name (not action index) so the change
      // handler doesn't need to look the action up by position. Only shown
      // once the env var name is actually set, since that's the join key.
      const envName = (action.environmentVariableName || '').trim();
      if (envName) {
        const testLabelKey = role === 'user' ? 'browserActions.testValueLabelUser' : role === 'password' ? 'browserActions.testValueLabelPassword' : 'browserActions.testValueLabel';
        const testValueRow = document.createElement('div');
        testValueRow.className = 'browser-action-field-row';
        testValueRow.innerHTML =
          `<label>${escapeHtml(t(testLabelKey))}</label>` +
          `<input type="password" class="browser-action-test-value" data-env-name="${escapeHtml(envName)}" ` +
          `placeholder="${escapeHtml(t('envVar.testValuePlaceholder'))}" value="${escapeHtml(testValues[envName] || '')}" />`;
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

// Called from render(): engine state, browser-actions visibility and the persistent-session toggle's checked state (nested in that section).
export function renderBrowserActionsSection(bridge: PopupBridge): void {
  const state = bridge.getState();
  byIdOrNull('btn-engine-static')?.classList.toggle('active', state.engine === 'Static');
  byIdOrNull('btn-engine-browser')?.classList.toggle('active', state.engine === 'Browser');
  byIdOrNull('browser-actions-section')?.classList.toggle('hidden', state.engine !== 'Browser');
  if (state.engine === 'Browser') {
    renderBrowserActions(state.browserActions, state.fillTestValues);
    renderStepRecording(bridge);
  }
  // Issue #403: while a starter action still has no element, say what to do next.
  byIdOrNull('login-flow-hint')?.classList.toggle(
    'hidden', !state.browserActions.some((a) => a.role && !a.selector),
  );

  const persistentSessionToggle = byIdOrNull<HTMLInputElement>('toggle-persistent-session');
  if (persistentSessionToggle) persistentSessionToggle.checked = state.persistentSession;
  autoOpenAdvanced(persistentSessionToggle, !!state.persistentSession); // Issue #407
}

export function wireBrowserActionsEvents(bridge: PopupBridge): void {
  wireStepRecordingEvents(bridge);
  byIdOrNull('btn-engine-static')?.addEventListener('click', () => {
    log('BTN engine-static');
    bridge.setState(bridge.getState().current, { engine: 'Static' });
  });
  byIdOrNull('btn-engine-browser')?.addEventListener('click', () => {
    log('BTN engine-browser');
    bridge.setState(bridge.getState().current, { engine: 'Browser' });
  });

  byIdOrNull('btn-add-login-flow')?.addEventListener('click', () => {
    log('BTN add-login-flow');
    bridge.setState(bridge.getState().current, { browserActions: addLoginFlow(bridge.getState().browserActions) });
  });
  byIdOrNull('btn-add-action-wait')?.addEventListener('click', () => {
    log('BTN add-action-wait');
    bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'waitFor') });
  });
  byIdOrNull('btn-add-action-fill')?.addEventListener('click', () => {
    log('BTN add-action-fill');
    bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'fill') });
  });
  byIdOrNull('btn-add-action-click')?.addEventListener('click', () => {
    log('BTN add-action-click');
    bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'click') });
  });
  byIdOrNull('btn-add-action-scroll')?.addEventListener('click', () => {
    log('BTN add-action-scroll');
    bridge.setState(bridge.getState().current, { browserActions: addBrowserAction(bridge.getState().browserActions, 'scroll') });
  });

  byIdOrNull('browser-actions-list')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const removeBtn = target.closest<HTMLElement>('.btn-remove-action');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index as string, 10);
      log('BROWSER_ACTION_REMOVE', { index });
      bridge.setState(bridge.getState().current, { browserActions: removeBrowserAction(bridge.getState().browserActions, index) });
      return;
    }
    const pickBtn = target.closest<HTMLElement>('.btn-pick-action-selector');
    if (pickBtn) {
      const index = parseInt(pickBtn.dataset.index as string, 10);
      const field = pickBtn.dataset.field as BrowserActionField; // written by buildSelectorRow
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
  byIdOrNull('browser-actions-list')?.addEventListener('change', (e) => {
    const target = e.target as Element;
    const timeoutInput = target.closest<HTMLInputElement>('.browser-action-timeout');
    if (timeoutInput) {
      const index = parseInt(timeoutInput.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
          timeoutMs: secondsTextToMs(timeoutInput.value, 5000),
        }),
      });
      return;
    }
    const envInput = target.closest<HTMLInputElement>('.browser-action-env-name');
    if (envInput) {
      const index = parseInt(envInput.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, { environmentVariableName: envInput.value.trim() }),
      });
      return;
    }
    const testValueInput = target.closest<HTMLInputElement>('.browser-action-test-value');
    if (testValueInput) {
      // patchState (not setState): fillTestValues must never reach
      // persistState()/chrome.storage.session — see its _state comment.
      const envName = testValueInput.dataset.envName as string;
      bridge.patchState({ fillTestValues: { ...bridge.getState().fillTestValues, [envName]: testValueInput.value } });
      return;
    }
    const clickTargetSelect = target.closest<HTMLSelectElement>('.browser-action-click-target');
    if (clickTargetSelect) {
      const index = parseInt(clickTargetSelect.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, { target: clickTargetSelect.value as 'first' | 'last' | 'all' }),
      });
      return;
    }
    const clickWaitInput = target.closest<HTMLInputElement>('.browser-action-click-wait-after-ms');
    if (clickWaitInput) {
      const index = parseInt(clickWaitInput.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
          waitAfterMs: secondsTextToMs(clickWaitInput.value, 250, { allowZero: true }),
        }),
      });
      return;
    }
    const maxIterationsInput = target.closest<HTMLInputElement>('.browser-action-max-iterations');
    if (maxIterationsInput) {
      const index = parseInt(maxIterationsInput.dataset.index as string, 10);
      const maxIterations = parseInt(maxIterationsInput.value, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
          maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : 10,
        }),
      });
      return;
    }
    const waitAfterMsInput = target.closest<HTMLInputElement>('.browser-action-wait-after-ms');
    if (waitAfterMsInput) {
      const index = parseInt(waitAfterMsInput.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
          waitAfterMs: secondsTextToMs(waitAfterMsInput.value, 1000, { allowZero: true }),
        }),
      });
      return;
    }
    // Issue #289: a blank input is a deliberate "go back to the
    // jump-to-bottom default", not an invalid value falling back to some
    // other number — unlike maxIterations/waitAfterMs above, there's no
    // sensible non-null default to clamp to here.
    const scrollStepPxInput = target.closest<HTMLInputElement>('.browser-action-scroll-step-px');
    if (scrollStepPxInput) {
      const index = parseInt(scrollStepPxInput.dataset.index as string, 10);
      const scrollStepPx = parseInt(scrollStepPxInput.value, 10);
      bridge.setState(bridge.getState().current, {
        browserActions: updateBrowserAction(bridge.getState().browserActions, index, {
          scrollStepPx: Number.isFinite(scrollStepPx) && scrollStepPx > 0 ? scrollStepPx : null,
        }),
      });
    }
  });
}
