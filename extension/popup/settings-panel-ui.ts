// ── Settings panel: change detection, proxy, pagination, hardening ─────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — the "Monitoring" (change detection + hardening)
// and "Settings" (proxy, pagination, output toggles) collapsible sections'
// own render + event-wiring for these four largely independent, mode-
// agnostic opt-in features (Issues #87/#88/#129/#130/#131/#132/#133/#174).
// Functions take a `bridge` object (same convention as api-config-ui.ts/
// companion-client.ts) instead of closing over popup.js's own module-level
// state.
import type * as SFDraft from '../types/drafts';
import type { PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { applyRecommendedHardening } from './hardening-presets';
import { autoOpenAdvanced } from './advanced-disclosure-ui';
import { retryStatusCodesDiffer } from './advanced-defaults';
import { STATES, escapeHtml } from './api-config';
import {
  collectFieldNames, addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
  addRequiredField, removeRequiredField,
} from './scraping-config-builder';
import { byIdOrNull } from './dom';

const log = createLogger('SF:Popup');

export function renderSettingsPanel(bridge: PopupBridge): void {
  const state = bridge.getState();
    // Issue #87: opt-in change detection + notification.
    const changeDetectionToggle = byIdOrNull<HTMLInputElement>('toggle-change-detection');
    if (changeDetectionToggle) changeDetectionToggle.checked = state.changeDetection.enabled;
    byIdOrNull('change-detection-config')?.classList.toggle('hidden', !state.changeDetection.enabled);
    byIdOrNull('btn-notify-email')?.classList.toggle('active', state.changeDetection.notify === 'Email');
    byIdOrNull('btn-notify-webhook')?.classList.toggle('active', state.changeDetection.notify === 'Webhook');
    byIdOrNull('notify-email-fields')?.classList.toggle('hidden', state.changeDetection.notify !== 'Email');
    byIdOrNull('notify-webhook-fields')?.classList.toggle('hidden', state.changeDetection.notify !== 'Webhook');
    const changeDetectionInputs = {
      'input-cd-smtp-host': state.changeDetection.email.smtpHostEnvVar,
      'input-cd-smtp-port': state.changeDetection.email.smtpPortEnvVar,
      'input-cd-smtp-username': state.changeDetection.email.smtpUsernameEnvVar,
      'input-cd-smtp-password': state.changeDetection.email.smtpPasswordEnvVar,
      'input-cd-email-from': state.changeDetection.email.fromEnvVar,
      'input-cd-email-to': state.changeDetection.email.toEnvVar,
      'input-cd-webhook-url': state.changeDetection.webhook.urlEnvVar,
    };
    for (const [id, value] of Object.entries(changeDetectionInputs)) {
      const input = byIdOrNull<HTMLInputElement>(id);
      if (input && document.activeElement !== input) input.value = value;
    }

    // Issue #88: opt-in proxy support.
    // Issue #228: opt-in robots.txt Crawl-delay/Request-rate.
    const respectRobotsToggle = byIdOrNull<HTMLInputElement>('toggle-respect-robots-delay');
    if (respectRobotsToggle) respectRobotsToggle.checked = state.respectRobotsDelay;
    // Issue #342: opt-in — append to the existing output file.
    const appendOutputToggle = byIdOrNull<HTMLInputElement>('toggle-append-output');
    if (appendOutputToggle) appendOutputToggle.checked = state.appendOutput;
    byIdOrNull('append-output-row')?.classList.toggle('hidden', state.mode === 'combined');

    // Issue #333: opt-in run-time robots.txt Disallow check.
    const robotsDisallowToggle = byIdOrNull<HTMLInputElement>('toggle-robots-disallow');
    if (robotsDisallowToggle) robotsDisallowToggle.checked = state.robotsDisallow.enabled;
    byIdOrNull('robots-disallow-config')?.classList.toggle('hidden', !state.robotsDisallow.enabled);
    const robotsActionSelect = byIdOrNull<HTMLSelectElement>('select-robots-disallow-action');
    if (robotsActionSelect) robotsActionSelect.value = state.robotsDisallow.action;

    // Issue #222: opt-in pause between requests.
    const requestDelayToggle = byIdOrNull<HTMLInputElement>('toggle-request-delay');
    if (requestDelayToggle) requestDelayToggle.checked = state.requestDelay.enabled;
    byIdOrNull('request-delay-config')?.classList.toggle('hidden', !state.requestDelay.enabled);
    const requestDelayInputs: Array<[string, 'minSecondsText' | 'maxSecondsText']> = [['input-request-delay-min', 'minSecondsText'], ['input-request-delay-max', 'maxSecondsText']];
    requestDelayInputs.forEach(([id, key]) => {
      const input = byIdOrNull<HTMLInputElement>(id);
      if (input && document.activeElement !== input) input.value = state.requestDelay[key];
    });

    // Issue #223: opt-in retry with backoff.
    const retryToggle = byIdOrNull<HTMLInputElement>('toggle-retry');
    if (retryToggle) retryToggle.checked = state.retry.enabled;
    byIdOrNull('retry-config')?.classList.toggle('hidden', !state.retry.enabled);
    const retryExponential = byIdOrNull<HTMLInputElement>('toggle-retry-exponential');
    if (retryExponential) retryExponential.checked = state.retry.exponential;
    const retryInputs: Array<[string, 'maxAttemptsText' | 'delaySecondsText' | 'statusCodesText']> = [['input-retry-attempts', 'maxAttemptsText'], ['input-retry-delay', 'delaySecondsText'], ['input-retry-status-codes', 'statusCodesText']];
    retryInputs.forEach(([id, key]) => {
      const input = byIdOrNull<HTMLInputElement>(id);
      if (input && document.activeElement !== input) input.value = state.retry[key];
    });

    // Issue #407: the status-code list sits under "Advanced"; a changed list opens it.
    autoOpenAdvanced(byIdOrNull('input-retry-status-codes'), retryStatusCodesDiffer(state.retry.statusCodesText));

    const proxyToggle = byIdOrNull<HTMLInputElement>('toggle-proxy');
    if (proxyToggle) proxyToggle.checked = state.proxy.enabled;
    byIdOrNull('proxy-config')?.classList.toggle('hidden', !state.proxy.enabled);
    const proxyEnvVarInput = byIdOrNull<HTMLInputElement>('input-proxy-env-var');
    if (proxyEnvVarInput && document.activeElement !== proxyEnvVarInput) {
      proxyEnvVarInput.value = state.proxy.envVar;
    }

    // Issue #174: opt-in classic multi-page pagination — hidden entirely for
    // API mode (which already has its own page-parameter mechanism via a
    // Number RangeSource), same reasoning as #additional-urls-row.
    byIdOrNull('pagination-toggle-row')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
    const paginationToggle = byIdOrNull<HTMLInputElement>('toggle-pagination');
    if (paginationToggle) paginationToggle.checked = state.pagination.enabled;
    byIdOrNull('pagination-config')?.classList.toggle('hidden', !state.pagination.enabled);
    byIdOrNull('btn-pagination-next-link')?.classList.toggle('active', state.pagination.kind === 'nextLink');
    byIdOrNull('btn-pagination-page-number')?.classList.toggle('active', state.pagination.kind === 'pageNumber');
    byIdOrNull('pagination-next-link-fields')?.classList.toggle('hidden', state.pagination.kind !== 'nextLink');
    byIdOrNull('pagination-page-number-fields')?.classList.toggle('hidden', state.pagination.kind !== 'pageNumber');
    const paginationInputs = {
      'input-pagination-next-link-selector': state.pagination.nextLinkSelector,
      'input-pagination-url-template': state.pagination.urlTemplate,
    };
    for (const [id, value] of Object.entries(paginationInputs)) {
      const input = byIdOrNull<HTMLInputElement>(id);
      if (input && document.activeElement !== input) input.value = value;
    }
    const paginationMaxPagesInput = byIdOrNull<HTMLInputElement>('input-pagination-max-pages');
    if (paginationMaxPagesInput && document.activeElement !== paginationMaxPagesInput) {
      paginationMaxPagesInput.value = String(state.pagination.maxPages);
    }

    // Issue #218: opt-in discovery of additional start URLs — hidden for
    // the same three modes the companion rejects it together with (Api,
    // which builds its own request URL; Combined/Blocks, which have no
    // single start URL of their own at the outer level).
    byIdOrNull('discovered-urls-toggle-row')?.classList.toggle(
      'hidden', state.mode === 'api' || state.mode === 'combined' || state.mode === 'blocks',
    );
    const discoveredUrlsToggle = byIdOrNull<HTMLInputElement>('toggle-discovered-urls');
    if (discoveredUrlsToggle) discoveredUrlsToggle.checked = state.discoveredUrls.enabled;
    byIdOrNull('discovered-urls-config')?.classList.toggle('hidden', !state.discoveredUrls.enabled);
    const discoveredUrlsInputs = {
      'input-discovered-urls-page-url': state.discoveredUrls.pageUrl,
      'input-discovered-urls-link-selector': state.discoveredUrls.linkSelector,
    };
    for (const [id, value] of Object.entries(discoveredUrlsInputs)) {
      const input = byIdOrNull<HTMLInputElement>(id);
      if (input && document.activeElement !== input) input.value = value;
    }
    const discoveredUrlsMaxInput = byIdOrNull<HTMLInputElement>('input-discovered-urls-max-urls');
    if (discoveredUrlsMaxInput && document.activeElement !== discoveredUrlsMaxInput) {
      discoveredUrlsMaxInput.value = String(state.discoveredUrls.maxUrls);
    }

    // Issue #183: collapsible "Monitoring" section (change detection +
    // hardening) — see popup.html's own comment on this markup for why a
    // chevron+.collapsed toggle was chosen over the API panel's Show/Hide
    // button-text-swap pattern.
    byIdOrNull('monitoring-section-toggle')?.classList.toggle('collapsed', !state.monitoringSectionOpen);
    byIdOrNull('monitoring-section-content')?.classList.toggle('hidden', !state.monitoringSectionOpen);

    // Issue #184: collapsible "Settings" section (Json output, trial-run
    // data preview, DOM-highlight "Vorschau") — same chevron+.collapsed
    // mechanism as Monitoring above.
    byIdOrNull('settings-section-toggle')?.classList.toggle('collapsed', !state.settingsSectionOpen);
    byIdOrNull('settings-section-content')?.classList.toggle('hidden', !state.settingsSectionOpen);

    // Issue #129: opt-in script hardening.
    const hardeningNoResultToggle = byIdOrNull<HTMLInputElement>('toggle-hardening-no-result');
    if (hardeningNoResultToggle) hardeningNoResultToggle.checked = state.hardening.noResult.enabled;
    byIdOrNull('hardening-no-result-severity')?.classList.toggle('hidden', !state.hardening.noResult.enabled);
    byIdOrNull('btn-hardening-no-result-warning')?.classList.toggle('active', state.hardening.noResult.severity === 'Warning');
    byIdOrNull('btn-hardening-no-result-error')?.classList.toggle('active', state.hardening.noResult.severity === 'Error');
    renderHardeningNullRateList(bridge);

    // Issue #131: opt-in baseline check — single-row toggle+severity,
    // same shape as noResult above (unlike nullRate's dynamic list).
    const hardeningBaselineToggle = byIdOrNull<HTMLInputElement>('toggle-hardening-baseline');
    if (hardeningBaselineToggle) hardeningBaselineToggle.checked = state.hardening.baseline.enabled;
    byIdOrNull('hardening-baseline-config')?.classList.toggle('hidden', !state.hardening.baseline.enabled);
    byIdOrNull('btn-hardening-baseline-warning')?.classList.toggle('active', state.hardening.baseline.severity === 'Warning');
    byIdOrNull('btn-hardening-baseline-error')?.classList.toggle('active', state.hardening.baseline.severity === 'Error');
    const hardeningBaselineThresholdInput = byIdOrNull<HTMLInputElement>('input-hardening-baseline-threshold');
    if (hardeningBaselineThresholdInput && document.activeElement !== hardeningBaselineThresholdInput) {
      hardeningBaselineThresholdInput.value = String(state.hardening.baseline.dropThresholdPercent);
    }

    // Issue #132: opt-in blocking-detection check — same single-row
    // toggle+severity shape as baseline above, plus an optional
    // min-body-length number input and a one-phrase-per-line textarea.
    const hardeningBlockingToggle = byIdOrNull<HTMLInputElement>('toggle-hardening-blocking');
    if (hardeningBlockingToggle) hardeningBlockingToggle.checked = state.hardening.blocking.enabled;
    byIdOrNull('hardening-blocking-config')?.classList.toggle('hidden', !state.hardening.blocking.enabled);
    byIdOrNull('btn-hardening-blocking-warning')?.classList.toggle('active', state.hardening.blocking.severity === 'Warning');
    byIdOrNull('btn-hardening-blocking-error')?.classList.toggle('active', state.hardening.blocking.severity === 'Error');
    const hardeningBlockingMinBodyLengthInput = byIdOrNull<HTMLInputElement>('input-hardening-blocking-min-body-length');
    if (hardeningBlockingMinBodyLengthInput && document.activeElement !== hardeningBlockingMinBodyLengthInput) {
      hardeningBlockingMinBodyLengthInput.value = state.hardening.blocking.minBodyLengthText;
    }
    const hardeningBlockingPhrasesInput = byIdOrNull<HTMLTextAreaElement>('input-hardening-blocking-phrases');
    if (hardeningBlockingPhrasesInput && document.activeElement !== hardeningBlockingPhrasesInput) {
      hardeningBlockingPhrasesInput.value = state.hardening.blocking.phrasesText;
    }

    // Issue #133 (+ container-mode and, since #204, Api-mode-tree-shape
    // follow-ups): required-fields check — supported for every mode/shape
    // now (flat, container, Api-flat, Api-tree), so this subsection is no
    // longer hidden for any of them.
    const hardeningRequiredFieldsToggle = byIdOrNull<HTMLInputElement>('toggle-hardening-required-fields');
    if (hardeningRequiredFieldsToggle) hardeningRequiredFieldsToggle.checked = state.hardening.requiredFields.enabled;
    byIdOrNull('hardening-required-fields-config')?.classList.toggle('hidden', !state.hardening.requiredFields.enabled);
    byIdOrNull('btn-hardening-required-fields-warning')?.classList.toggle('active', state.hardening.requiredFields.severity === 'Warning');
    byIdOrNull('btn-hardening-required-fields-error')?.classList.toggle('active', state.hardening.requiredFields.severity === 'Error');
    renderHardeningRequiredFieldsList(bridge);

    // Issue #219: opt-in preflight check — a plain boolean (no sub-fields),
    // same shape as persistentSession/externalConfig. Hidden for the same
    // three modes DiscoveredUrls already hides for (Api has no single fixed
    // start URL to preflight-check; Combined/Blocks have no single start URL
    // of their own at the outer level either).
    byIdOrNull('preflight-toggle-row')?.classList.toggle(
      'hidden', state.mode === 'api' || state.mode === 'combined' || state.mode === 'blocks',
    );
    const preflightToggle = byIdOrNull<HTMLInputElement>('toggle-preflight');
    if (preflightToggle) preflightToggle.checked = state.preflight;
}

// Issue #130: one row per _state.hardening.nullRate entry — a field
// dropdown (options from collectFieldNames, reusing whatever fields/groups/
// apiConfig the current mode already has, see that function's own doc
// comment), a threshold % number input, a Warning/Error severity toggle
// (the same .mode-toggle pattern the no-result check above already uses —
// syncModeToggleThumbs() picks these up automatically on every render()),
// and a remove button. Mirrors renderBrowserActions' DOM-building style.
// The field <select> always includes the row's own currently chosen value
// even if it's since dropped out of collectFieldNames' list (e.g. the field
// was renamed or removed after this row was added) — otherwise the browser
// would silently fall back to whichever option happens to be first,
// silently corrupting the row instead of leaving it visibly stale.
export function renderHardeningNullRateList(
  bridge: PopupBridge,
  nullRate: SFDraft.NullRateRow[] = bridge.getState().hardening.nullRate,
  fieldNames: string[] = collectFieldNames(bridge.getState().mode, bridge.getState().fields, bridge.getState().groups, bridge.getState().apiConfig),
) {
  const container = byIdOrNull('hardening-null-rate-list');
  if (!container) return;
  container.innerHTML = '';

  nullRate.forEach((row, i) => {
    const options = fieldNames.includes(row.fieldName) || !row.fieldName
      ? fieldNames
      : [row.fieldName, ...fieldNames];

    const rowEl = document.createElement('div');
    rowEl.className = 'hardening-null-rate-row';
    rowEl.dataset.index = String(i);
    rowEl.innerHTML =
      `<select class="hardening-null-rate-field" data-index="${i}">` +
      `<option value="">${escapeHtml(t('idle.hardeningNullRateFieldPlaceholder'))}</option>` +
      options.map(name => `<option value="${escapeHtml(name)}"${name === row.fieldName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('') +
      `</select>` +
      `<span class="hardening-sentence-text">${escapeHtml(t('idle.hardeningNullRateMiddle'))}</span>` +
      `<input type="number" min="0" max="100" class="hardening-null-rate-threshold" data-index="${i}" value="${row.threshold}" />` +
      `<span class="hardening-sentence-text">${escapeHtml(t('idle.hardeningNullRateAfter'))}</span>` +
      `<div class="mode-toggle hardening-null-rate-severity">` +
      `<div class="mode-toggle-thumb"></div>` +
      `<button type="button" class="mode-btn btn-null-rate-warning${row.severity === 'Warning' ? ' active' : ''}" data-index="${i}">${escapeHtml(t('idle.hardeningSeverityWarning'))}</button>` +
      `<button type="button" class="mode-btn btn-null-rate-error${row.severity === 'Error' ? ' active' : ''}" data-index="${i}">${escapeHtml(t('idle.hardeningSeverityError'))}</button>` +
      `</div>` +
      `<button type="button" class="btn-danger btn-tiny btn-remove-null-rate" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
    container.appendChild(rowEl);
  });
}

// Issue #133: unlike renderHardeningNullRateList's per-row field pickers
// (each row starts as an unfinished draft), a required field is already a
// complete, chosen name the moment it exists in the list — so each row is
// just a name + remove button, and picking a *new* one to add happens via
// one shared <select>/button pair (#select-hardening-required-field/
// #btn-add-required-field) outside the list itself, filtered to exclude
// names already added.
export function renderHardeningRequiredFieldsList(
  bridge: PopupBridge,
  fields: string[] = bridge.getState().hardening.requiredFields.fields,
  fieldNames: string[] = collectFieldNames(bridge.getState().mode, bridge.getState().fields, bridge.getState().groups, bridge.getState().apiConfig),
) {
  const container = byIdOrNull('hardening-required-fields-list');
  if (container) {
    container.innerHTML = '';
    fields.forEach((name, i) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'hardening-required-field-row';
      rowEl.innerHTML =
        `<span class="hardening-required-field-name">${escapeHtml(name)}</span>` +
        `<button type="button" class="btn-danger btn-tiny btn-remove-required-field" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
      container.appendChild(rowEl);
    });
  }

  const available = fieldNames.filter(name => !fields.includes(name));
  const select = byIdOrNull<HTMLSelectElement>('select-hardening-required-field');
  if (select) select.innerHTML = available.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  const addBtn = byIdOrNull<HTMLButtonElement>('btn-add-required-field');
  if (addBtn) addBtn.disabled = available.length === 0;
  if (select) select.disabled = available.length === 0;
}

export function wireSettingsPanelEvents(bridge: PopupBridge): void {
  // Issue #87: opt-in change detection + notification.
  byIdOrNull('toggle-change-detection')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { changeDetection: { ...bridge.getState().changeDetection, enabled: (e.target as HTMLInputElement).checked } });
  });
  byIdOrNull('btn-notify-email')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { changeDetection: { ...bridge.getState().changeDetection, notify: 'Email' } });
  });
  byIdOrNull('btn-notify-webhook')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { changeDetection: { ...bridge.getState().changeDetection, notify: 'Webhook' } });
  });
  const changeDetectionEmailFieldInputs = {
    'input-cd-smtp-host': 'smtpHostEnvVar',
    'input-cd-smtp-port': 'smtpPortEnvVar',
    'input-cd-smtp-username': 'smtpUsernameEnvVar',
    'input-cd-smtp-password': 'smtpPasswordEnvVar',
    'input-cd-email-from': 'fromEnvVar',
    'input-cd-email-to': 'toEnvVar',
  };
  for (const [id, field] of Object.entries(changeDetectionEmailFieldInputs)) {
    byIdOrNull(id)?.addEventListener('input', (e) => {
      bridge.setState(bridge.getState().current, {
        changeDetection: { ...bridge.getState().changeDetection, email: { ...bridge.getState().changeDetection.email, [field]: (e.target as HTMLInputElement).value } },
      });
    });
  }
  byIdOrNull('input-cd-webhook-url')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, {
      changeDetection: { ...bridge.getState().changeDetection, webhook: { ...bridge.getState().changeDetection.webhook, urlEnvVar: (e.target as HTMLInputElement).value } },
    });
  });

  // Issue #175: opt-in persistent session/cookie handling — a plain boolean
  // (no sub-fields), unlike proxy/pagination's { enabled, ... } shape.
  byIdOrNull('toggle-persistent-session')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { persistentSession: (e.target as HTMLInputElement).checked });
  });

  // Issue #219: opt-in preflight check — same plain-boolean shape as
  // persistentSession above.
  byIdOrNull('toggle-preflight')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { preflight: (e.target as HTMLInputElement).checked });
  });

  // Issue #228: opt-in robots.txt Crawl-delay/Request-rate — plain boolean.
  byIdOrNull('toggle-respect-robots-delay')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { respectRobotsDelay: (e.target as HTMLInputElement).checked });
  });

  // Issue #342: opt-in append to the existing output file — plain boolean.
  byIdOrNull('toggle-append-output')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { appendOutput: (e.target as HTMLInputElement).checked });
  });

  // Issue #333: opt-in run-time robots.txt Disallow check — an on/off switch
  // plus what to do with a disallowed request.
  byIdOrNull('toggle-robots-disallow')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { robotsDisallow: { ...bridge.getState().robotsDisallow, enabled: (e.target as HTMLInputElement).checked } });
  });
  byIdOrNull('select-robots-disallow-action')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { robotsDisallow: { ...bridge.getState().robotsDisallow, action: (e.target as HTMLSelectElement).value as SFDraft.RobotsDisallowState['action'] } });
  });

  // Issue #222: opt-in pause between requests.
  byIdOrNull('toggle-request-delay')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { requestDelay: { ...bridge.getState().requestDelay, enabled: (e.target as HTMLInputElement).checked } });
  });
  byIdOrNull('input-request-delay-min')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { requestDelay: { ...bridge.getState().requestDelay, minSecondsText: (e.target as HTMLInputElement).value } });
  });
  byIdOrNull('input-request-delay-max')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { requestDelay: { ...bridge.getState().requestDelay, maxSecondsText: (e.target as HTMLInputElement).value } });
  });

  // Issue #223: opt-in retry with backoff.
  const patchRetry = (patch: Partial<SFDraft.RetryState>) => bridge.setState(bridge.getState().current, { retry: { ...bridge.getState().retry, ...patch } });
  byIdOrNull('toggle-retry')?.addEventListener('change', (e) => patchRetry({ enabled: (e.target as HTMLInputElement).checked }));
  byIdOrNull('toggle-retry-exponential')?.addEventListener('change', (e) => patchRetry({ exponential: (e.target as HTMLInputElement).checked }));
  byIdOrNull('input-retry-attempts')?.addEventListener('input', (e) => patchRetry({ maxAttemptsText: (e.target as HTMLInputElement).value }));
  byIdOrNull('input-retry-delay')?.addEventListener('input', (e) => patchRetry({ delaySecondsText: (e.target as HTMLInputElement).value }));
  byIdOrNull('input-retry-status-codes')?.addEventListener('input', (e) => patchRetry({ statusCodesText: (e.target as HTMLInputElement).value }));

  // Issue #88: opt-in proxy support.
  byIdOrNull('toggle-proxy')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { proxy: { ...bridge.getState().proxy, enabled: (e.target as HTMLInputElement).checked } });
  });
  byIdOrNull('input-proxy-env-var')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { proxy: { ...bridge.getState().proxy, envVar: (e.target as HTMLInputElement).value } });
  });

  // Issue #174: opt-in classic multi-page pagination.
  byIdOrNull('toggle-pagination')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, enabled: (e.target as HTMLInputElement).checked } });
  });
  byIdOrNull('btn-pagination-next-link')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, kind: 'nextLink' } });
  });
  byIdOrNull('btn-pagination-page-number')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, kind: 'pageNumber' } });
  });
  byIdOrNull('input-pagination-next-link-selector')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, nextLinkSelector: (e.target as HTMLInputElement).value } });
  });
  byIdOrNull('input-pagination-url-template')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, urlTemplate: (e.target as HTMLInputElement).value } });
  });
  byIdOrNull('input-pagination-max-pages')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, maxPages: parseInt((e.target as HTMLInputElement).value, 10) } });
  });
  // Issue #174 follow-up: lets a non-developer pick the "next page" link by
  // clicking it instead of having to know/type a CSS selector — same
  // click-based selection flow browser actions' own pick button already
  // uses (see btn-pick-action-selector below), just for a single fixed
  // field instead of a per-index browserActions entry.
  byIdOrNull('btn-pick-pagination-next-link')?.addEventListener('click', () => {
    log('BTN pick-pagination-next-link → START_SELECTION');
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    bridge.setState(STATES.SELECTING, {
      pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [], selectionKind: 'pagination',
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
  });

  // Issue #218: opt-in discovery of additional start URLs.
  byIdOrNull('toggle-discovered-urls')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { discoveredUrls: { ...bridge.getState().discoveredUrls, enabled: (e.target as HTMLInputElement).checked } });
  });
  byIdOrNull('input-discovered-urls-page-url')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { discoveredUrls: { ...bridge.getState().discoveredUrls, pageUrl: (e.target as HTMLInputElement).value } });
  });
  byIdOrNull('input-discovered-urls-link-selector')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { discoveredUrls: { ...bridge.getState().discoveredUrls, linkSelector: (e.target as HTMLInputElement).value } });
  });
  byIdOrNull('input-discovered-urls-max-urls')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { discoveredUrls: { ...bridge.getState().discoveredUrls, maxUrls: parseInt((e.target as HTMLInputElement).value, 10) } });
  });
  // Issue #218 follow-up: lets a non-developer pick a navigation link by
  // clicking it instead of having to know/type a CSS selector or copy the
  // page's own URL by hand — avoidId generalizes the resulting selector
  // across every sibling link (the same "repeating" treatment a container's
  // own pick already gets), rather than collapsing to a single #id-based
  // match the way pagination's own single "next" link deliberately keeps.
  byIdOrNull('btn-pick-discovered-urls-link')?.addEventListener('click', () => {
    log('BTN pick-discovered-urls-link → START_SELECTION');
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION', avoidId: true });
    bridge.setState(STATES.SELECTING, {
      pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [], selectionKind: 'discoveredUrls',
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
  });

  // Issue #399: "Recommended checks" — one click for the sensible starting set.
  byIdOrNull('btn-hardening-recommended')?.addEventListener('click', () => {
    const state = bridge.getState();
    const fieldNames = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
    const { hardening, applied, needsFields } = applyRecommendedHardening(state.hardening, fieldNames);
    bridge.setState(state.current, { hardening });
    const parts = [];
    if (applied.noResult) parts.push(t('idle.hardeningRecommendedNoResult'));
    if (applied.requiredField) parts.push(t('idle.hardeningRecommendedRequired', { field: applied.requiredField }));
    const note = byIdOrNull('hardening-recommended-note');
    if (note) {
      note.textContent = [
        parts.length ? t('idle.hardeningRecommendedApplied', { checks: parts.join(', ') }) : t('idle.hardeningRecommendedNothingNew'),
        needsFields ? t('idle.hardeningRecommendedNeedFields') : '',
      ].filter(Boolean).join(' ');
      note.classList.remove('hidden');
    }
  });

  // Issue #129: opt-in script hardening — the "no result" check.
  byIdOrNull('toggle-hardening-no-result')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, noResult: { ...bridge.getState().hardening.noResult, enabled: (e.target as HTMLInputElement).checked } },
    });
  });
  byIdOrNull('btn-hardening-no-result-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, noResult: { ...bridge.getState().hardening.noResult, severity: 'Warning' } },
    });
  });
  byIdOrNull('btn-hardening-no-result-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, noResult: { ...bridge.getState().hardening.noResult, severity: 'Error' } },
    });
  });

  // Issue #130: the per-field null-rate check — a dynamic list, same
  // delegated-event-on-the-container pattern as browser-actions-list above.
  byIdOrNull('btn-add-null-rate-check')?.addEventListener('click', () => {
    const [firstField] = collectFieldNames(bridge.getState().mode, bridge.getState().fields, bridge.getState().groups, bridge.getState().apiConfig);
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, nullRate: addNullRateCheck(bridge.getState().hardening.nullRate, firstField) },
    });
  });
  byIdOrNull('hardening-null-rate-list')?.addEventListener('click', (e) => {
    const removeBtn = (e.target as Element).closest<HTMLElement>('.btn-remove-null-rate');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: removeNullRateCheck(bridge.getState().hardening.nullRate, index) },
      });
      return;
    }
    const warningBtn = (e.target as Element).closest<HTMLElement>('.btn-null-rate-warning');
    if (warningBtn) {
      const index = parseInt(warningBtn.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, { severity: 'Warning' }) },
      });
      return;
    }
    const errorBtn = (e.target as Element).closest<HTMLElement>('.btn-null-rate-error');
    if (errorBtn) {
      const index = parseInt(errorBtn.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, { severity: 'Error' }) },
      });
    }
  });
  // change (not input/click) for the field select and threshold number —
  // same "don't reset the cursor/dropdown on every keystroke" reasoning as
  // the browser-actions-list change listener above.
  byIdOrNull('hardening-null-rate-list')?.addEventListener('change', (e) => {
    const fieldSelect = (e.target as Element).closest<HTMLSelectElement>('.hardening-null-rate-field');
    if (fieldSelect) {
      const index = parseInt(fieldSelect.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, { fieldName: fieldSelect.value }) },
      });
      return;
    }
    const thresholdInput = (e.target as Element).closest<HTMLInputElement>('.hardening-null-rate-threshold');
    if (thresholdInput) {
      const index = parseInt(thresholdInput.dataset.index as string, 10);
      const threshold = parseInt(thresholdInput.value, 10);
      bridge.setState(bridge.getState().current, {
        hardening: {
          ...bridge.getState().hardening,
          nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, {
            threshold: Number.isFinite(threshold) ? Math.min(100, Math.max(0, threshold)) : 50,
          }),
        },
      });
    }
  });

  // Issue #131: opt-in script hardening — the baseline-drop check.
  byIdOrNull('toggle-hardening-baseline')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, baseline: { ...bridge.getState().hardening.baseline, enabled: (e.target as HTMLInputElement).checked } },
    });
  });
  byIdOrNull('btn-hardening-baseline-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, baseline: { ...bridge.getState().hardening.baseline, severity: 'Warning' } },
    });
  });
  byIdOrNull('btn-hardening-baseline-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, baseline: { ...bridge.getState().hardening.baseline, severity: 'Error' } },
    });
  });
  byIdOrNull('input-hardening-baseline-threshold')?.addEventListener('change', (e) => {
    const percent = parseInt((e.target as HTMLInputElement).value, 10);
    bridge.setState(bridge.getState().current, {
      hardening: {
        ...bridge.getState().hardening,
        baseline: {
          ...bridge.getState().hardening.baseline,
          dropThresholdPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 20,
        },
      },
    });
  });

  // Issue #132: opt-in script hardening — the blocking-detection check.
  byIdOrNull('toggle-hardening-blocking')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, enabled: (e.target as HTMLInputElement).checked } },
    });
  });
  byIdOrNull('btn-hardening-blocking-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, severity: 'Warning' } },
    });
  });
  byIdOrNull('btn-hardening-blocking-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, severity: 'Error' } },
    });
  });
  byIdOrNull('input-hardening-blocking-min-body-length')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, minBodyLengthText: (e.target as HTMLInputElement).value } },
    });
  });
  byIdOrNull('input-hardening-blocking-phrases')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, phrasesText: (e.target as HTMLInputElement).value } },
    });
  });

  // Issue #133: opt-in script hardening — the required-fields check.
  byIdOrNull('toggle-hardening-required-fields')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, requiredFields: { ...bridge.getState().hardening.requiredFields, enabled: (e.target as HTMLInputElement).checked } },
    });
  });
  byIdOrNull('btn-hardening-required-fields-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, requiredFields: { ...bridge.getState().hardening.requiredFields, severity: 'Warning' } },
    });
  });
  byIdOrNull('btn-hardening-required-fields-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, requiredFields: { ...bridge.getState().hardening.requiredFields, severity: 'Error' } },
    });
  });
  byIdOrNull('btn-add-required-field')?.addEventListener('click', () => {
    const fieldName = byIdOrNull<HTMLSelectElement>('select-hardening-required-field')?.value as string; // the button is disabled while the select has no option
    bridge.setState(bridge.getState().current, {
      hardening: {
        ...bridge.getState().hardening,
        requiredFields: { ...bridge.getState().hardening.requiredFields, fields: addRequiredField(bridge.getState().hardening.requiredFields.fields, fieldName) },
      },
    });
  });
  byIdOrNull('hardening-required-fields-list')?.addEventListener('click', (e) => {
    const removeBtn = (e.target as Element).closest<HTMLElement>('.btn-remove-required-field');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index as string, 10);
      bridge.setState(bridge.getState().current, {
        hardening: {
          ...bridge.getState().hardening,
          requiredFields: { ...bridge.getState().hardening.requiredFields, fields: removeRequiredField(bridge.getState().hardening.requiredFields.fields, index) },
        },
      });
    }
  });

  // Issue #183: collapsible "Monitoring" section toggle — a plain click
  // (and Enter/Space, since the header is a div with role="button", not a
  // real <button>) flips monitoringSectionOpen; nothing else about
  // change-detection/hardening's own state is touched.
  byIdOrNull('monitoring-section-toggle')?.addEventListener('click', (e) => {
    // Issue #354: the "?" next to the title opens its explanation, it doesn't collapse the section.
    if ((e.target as Element).closest && (e.target as Element).closest('.help-host')) return;
    bridge.setState(bridge.getState().current, { monitoringSectionOpen: !bridge.getState().monitoringSectionOpen });
  });
  byIdOrNull('monitoring-section-toggle')?.addEventListener('keydown', (e) => {
    if (e.target !== e.currentTarget) return; // a key on the "?" inside belongs to its own button
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      bridge.setState(bridge.getState().current, { monitoringSectionOpen: !bridge.getState().monitoringSectionOpen });
    }
  });

  // Issue #184: collapsible "Settings" section toggle — same click/Enter/
  // Space pattern as Monitoring above. The section's own three toggles
  // (Json output, trial-run data preview, full output-file download) live
  // here too, since they're exactly the "Settings" section's own content.
  byIdOrNull('settings-section-toggle')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { settingsSectionOpen: !bridge.getState().settingsSectionOpen });
  });
  byIdOrNull('settings-section-toggle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      bridge.setState(bridge.getState().current, { settingsSectionOpen: !bridge.getState().settingsSectionOpen });
    }
  });

}
