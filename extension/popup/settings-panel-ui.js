// ── Settings panel: change detection, proxy, pagination, hardening ─────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — the "Monitoring" (change detection + hardening)
// and "Settings" (proxy, pagination, output toggles) collapsible sections'
// own render + event-wiring for these four largely independent, mode-
// agnostic opt-in features (Issues #87/#88/#129/#130/#131/#132/#133/#174).
// Functions take a `bridge` object (same convention as api-config-ui.js/
// companion-client.js) instead of closing over popup.js's own module-level
// state.
const SFSettingsPanelUI = (function() {
const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { STATES, escapeHtml } =
  typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

const {
  collectFieldNames, addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
  addRequiredField, removeRequiredField,
} = typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

function renderSettingsPanel(bridge) {
  const state = bridge.getState();
    // Issue #87: opt-in change detection + notification.
    const changeDetectionToggle = document.getElementById('toggle-change-detection');
    if (changeDetectionToggle) changeDetectionToggle.checked = state.changeDetection.enabled;
    document.getElementById('change-detection-config')?.classList.toggle('hidden', !state.changeDetection.enabled);
    document.getElementById('btn-notify-email')?.classList.toggle('active', state.changeDetection.notify === 'Email');
    document.getElementById('btn-notify-webhook')?.classList.toggle('active', state.changeDetection.notify === 'Webhook');
    document.getElementById('notify-email-fields')?.classList.toggle('hidden', state.changeDetection.notify !== 'Email');
    document.getElementById('notify-webhook-fields')?.classList.toggle('hidden', state.changeDetection.notify !== 'Webhook');
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
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = value;
    }

    // Issue #178: opt-in external XML config file — mode-independent, lives
    // in the Settings section like Proxy/Json-output, needs no visibility
    // gating of its own.
    const externalConfigToggle = document.getElementById('toggle-external-config');
    if (externalConfigToggle) externalConfigToggle.checked = state.externalConfig;

    // Issue #88: opt-in proxy support.
    const proxyToggle = document.getElementById('toggle-proxy');
    if (proxyToggle) proxyToggle.checked = state.proxy.enabled;
    document.getElementById('proxy-config')?.classList.toggle('hidden', !state.proxy.enabled);
    const proxyEnvVarInput = document.getElementById('input-proxy-env-var');
    if (proxyEnvVarInput && document.activeElement !== proxyEnvVarInput) {
      proxyEnvVarInput.value = state.proxy.envVar;
    }

    // Issue #174: opt-in classic multi-page pagination — hidden entirely for
    // API mode (which already has its own page-parameter mechanism via a
    // Number RangeSource), same reasoning as #additional-urls-row.
    document.getElementById('pagination-toggle-row')?.classList.toggle('hidden', state.mode === 'api');
    const paginationToggle = document.getElementById('toggle-pagination');
    if (paginationToggle) paginationToggle.checked = state.pagination.enabled;
    document.getElementById('pagination-config')?.classList.toggle('hidden', !state.pagination.enabled);
    document.getElementById('btn-pagination-next-link')?.classList.toggle('active', state.pagination.kind === 'nextLink');
    document.getElementById('btn-pagination-page-number')?.classList.toggle('active', state.pagination.kind === 'pageNumber');
    document.getElementById('pagination-next-link-fields')?.classList.toggle('hidden', state.pagination.kind !== 'nextLink');
    document.getElementById('pagination-page-number-fields')?.classList.toggle('hidden', state.pagination.kind !== 'pageNumber');
    const paginationInputs = {
      'input-pagination-next-link-selector': state.pagination.nextLinkSelector,
      'input-pagination-url-template': state.pagination.urlTemplate,
    };
    for (const [id, value] of Object.entries(paginationInputs)) {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = value;
    }
    const paginationMaxPagesInput = document.getElementById('input-pagination-max-pages');
    if (paginationMaxPagesInput && document.activeElement !== paginationMaxPagesInput) {
      paginationMaxPagesInput.value = state.pagination.maxPages;
    }

    // Issue #183: collapsible "Monitoring" section (change detection +
    // hardening) — see popup.html's own comment on this markup for why a
    // chevron+.collapsed toggle was chosen over the API panel's Show/Hide
    // button-text-swap pattern.
    document.getElementById('monitoring-section-toggle')?.classList.toggle('collapsed', !state.monitoringSectionOpen);
    document.getElementById('monitoring-section-content')?.classList.toggle('hidden', !state.monitoringSectionOpen);

    // Issue #184: collapsible "Settings" section (Json output, trial-run
    // data preview, DOM-highlight "Vorschau") — same chevron+.collapsed
    // mechanism as Monitoring above.
    document.getElementById('settings-section-toggle')?.classList.toggle('collapsed', !state.settingsSectionOpen);
    document.getElementById('settings-section-content')?.classList.toggle('hidden', !state.settingsSectionOpen);

    // Issue #129: opt-in script hardening.
    const hardeningNoResultToggle = document.getElementById('toggle-hardening-no-result');
    if (hardeningNoResultToggle) hardeningNoResultToggle.checked = state.hardening.noResult.enabled;
    document.getElementById('hardening-no-result-severity')?.classList.toggle('hidden', !state.hardening.noResult.enabled);
    document.getElementById('btn-hardening-no-result-warning')?.classList.toggle('active', state.hardening.noResult.severity === 'Warning');
    document.getElementById('btn-hardening-no-result-error')?.classList.toggle('active', state.hardening.noResult.severity === 'Error');
    renderHardeningNullRateList(bridge);

    // Issue #131: opt-in baseline check — single-row toggle+severity,
    // same shape as noResult above (unlike nullRate's dynamic list).
    const hardeningBaselineToggle = document.getElementById('toggle-hardening-baseline');
    if (hardeningBaselineToggle) hardeningBaselineToggle.checked = state.hardening.baseline.enabled;
    document.getElementById('hardening-baseline-config')?.classList.toggle('hidden', !state.hardening.baseline.enabled);
    document.getElementById('btn-hardening-baseline-warning')?.classList.toggle('active', state.hardening.baseline.severity === 'Warning');
    document.getElementById('btn-hardening-baseline-error')?.classList.toggle('active', state.hardening.baseline.severity === 'Error');
    const hardeningBaselineThresholdInput = document.getElementById('input-hardening-baseline-threshold');
    if (hardeningBaselineThresholdInput && document.activeElement !== hardeningBaselineThresholdInput) {
      hardeningBaselineThresholdInput.value = state.hardening.baseline.dropThresholdPercent;
    }

    // Issue #132: opt-in blocking-detection check — same single-row
    // toggle+severity shape as baseline above, plus an optional
    // min-body-length number input and a one-phrase-per-line textarea.
    const hardeningBlockingToggle = document.getElementById('toggle-hardening-blocking');
    if (hardeningBlockingToggle) hardeningBlockingToggle.checked = state.hardening.blocking.enabled;
    document.getElementById('hardening-blocking-config')?.classList.toggle('hidden', !state.hardening.blocking.enabled);
    document.getElementById('btn-hardening-blocking-warning')?.classList.toggle('active', state.hardening.blocking.severity === 'Warning');
    document.getElementById('btn-hardening-blocking-error')?.classList.toggle('active', state.hardening.blocking.severity === 'Error');
    const hardeningBlockingMinBodyLengthInput = document.getElementById('input-hardening-blocking-min-body-length');
    if (hardeningBlockingMinBodyLengthInput && document.activeElement !== hardeningBlockingMinBodyLengthInput) {
      hardeningBlockingMinBodyLengthInput.value = state.hardening.blocking.minBodyLengthText;
    }
    const hardeningBlockingPhrasesInput = document.getElementById('input-hardening-blocking-phrases');
    if (hardeningBlockingPhrasesInput && document.activeElement !== hardeningBlockingPhrasesInput) {
      hardeningBlockingPhrasesInput.value = state.hardening.blocking.phrasesText;
    }

    // Issue #133 (+ container-mode and, since #204, Api-mode-tree-shape
    // follow-ups): required-fields check — supported for every mode/shape
    // now (flat, container, Api-flat, Api-tree), so this subsection is no
    // longer hidden for any of them.
    const hardeningRequiredFieldsToggle = document.getElementById('toggle-hardening-required-fields');
    if (hardeningRequiredFieldsToggle) hardeningRequiredFieldsToggle.checked = state.hardening.requiredFields.enabled;
    document.getElementById('hardening-required-fields-config')?.classList.toggle('hidden', !state.hardening.requiredFields.enabled);
    document.getElementById('btn-hardening-required-fields-warning')?.classList.toggle('active', state.hardening.requiredFields.severity === 'Warning');
    document.getElementById('btn-hardening-required-fields-error')?.classList.toggle('active', state.hardening.requiredFields.severity === 'Error');
    renderHardeningRequiredFieldsList(bridge);
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
function renderHardeningNullRateList(
  bridge,
  nullRate = bridge.getState().hardening.nullRate,
  fieldNames = collectFieldNames(bridge.getState().mode, bridge.getState().fields, bridge.getState().groups, bridge.getState().apiConfig),
) {
  const container = document.getElementById('hardening-null-rate-list');
  if (!container) return;
  container.innerHTML = '';

  nullRate.forEach((row, i) => {
    const options = fieldNames.includes(row.fieldName) || !row.fieldName
      ? fieldNames
      : [row.fieldName, ...fieldNames];

    const rowEl = document.createElement('div');
    rowEl.className = 'hardening-null-rate-row';
    rowEl.dataset.index = i;
    rowEl.innerHTML =
      `<select class="hardening-null-rate-field" data-index="${i}">` +
      `<option value="">${escapeHtml(t('idle.hardeningNullRateFieldPlaceholder'))}</option>` +
      options.map(name => `<option value="${escapeHtml(name)}"${name === row.fieldName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('') +
      `</select>` +
      `<input type="number" min="0" max="100" class="hardening-null-rate-threshold" data-index="${i}" value="${row.threshold}" />%` +
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
function renderHardeningRequiredFieldsList(
  bridge,
  fields = bridge.getState().hardening.requiredFields.fields,
  fieldNames = collectFieldNames(bridge.getState().mode, bridge.getState().fields, bridge.getState().groups, bridge.getState().apiConfig),
) {
  const container = document.getElementById('hardening-required-fields-list');
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
  const select = document.getElementById('select-hardening-required-field');
  if (select) select.innerHTML = available.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  const addBtn = document.getElementById('btn-add-required-field');
  if (addBtn) addBtn.disabled = available.length === 0;
  if (select) select.disabled = available.length === 0;
}

function wireSettingsPanelEvents(bridge) {
  // Issue #87: opt-in change detection + notification.
  document.getElementById('toggle-change-detection')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { changeDetection: { ...bridge.getState().changeDetection, enabled: e.target.checked } });
  });
  document.getElementById('btn-notify-email')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { changeDetection: { ...bridge.getState().changeDetection, notify: 'Email' } });
  });
  document.getElementById('btn-notify-webhook')?.addEventListener('click', () => {
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
    document.getElementById(id)?.addEventListener('input', (e) => {
      bridge.setState(bridge.getState().current, {
        changeDetection: { ...bridge.getState().changeDetection, email: { ...bridge.getState().changeDetection.email, [field]: e.target.value } },
      });
    });
  }
  document.getElementById('input-cd-webhook-url')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, {
      changeDetection: { ...bridge.getState().changeDetection, webhook: { ...bridge.getState().changeDetection.webhook, urlEnvVar: e.target.value } },
    });
  });

  // Issue #175: opt-in persistent session/cookie handling — a plain boolean
  // (no sub-fields), unlike proxy/pagination's { enabled, ... } shape.
  document.getElementById('toggle-persistent-session')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { persistentSession: e.target.checked });
  });

  // Issue #178: opt-in external XML config file — a plain boolean (no
  // sub-fields), same shape as persistentSession above.
  document.getElementById('toggle-external-config')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { externalConfig: e.target.checked });
  });

  // Issue #88: opt-in proxy support.
  document.getElementById('toggle-proxy')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { proxy: { ...bridge.getState().proxy, enabled: e.target.checked } });
  });
  document.getElementById('input-proxy-env-var')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { proxy: { ...bridge.getState().proxy, envVar: e.target.value } });
  });

  // Issue #174: opt-in classic multi-page pagination.
  document.getElementById('toggle-pagination')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, enabled: e.target.checked } });
  });
  document.getElementById('btn-pagination-next-link')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, kind: 'nextLink' } });
  });
  document.getElementById('btn-pagination-page-number')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, kind: 'pageNumber' } });
  });
  document.getElementById('input-pagination-next-link-selector')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, nextLinkSelector: e.target.value } });
  });
  document.getElementById('input-pagination-url-template')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, urlTemplate: e.target.value } });
  });
  document.getElementById('input-pagination-max-pages')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { pagination: { ...bridge.getState().pagination, maxPages: parseInt(e.target.value, 10) } });
  });
  // Issue #174 follow-up: lets a non-developer pick the "next page" link by
  // clicking it instead of having to know/type a CSS selector — same
  // click-based selection flow browser actions' own pick button already
  // uses (see btn-pick-action-selector below), just for a single fixed
  // field instead of a per-index browserActions entry.
  document.getElementById('btn-pick-pagination-next-link')?.addEventListener('click', () => {
    log('BTN pick-pagination-next-link → START_SELECTION');
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    bridge.setState(STATES.SELECTING, {
      pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [], selectionKind: 'pagination',
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
  });

  // Issue #129: opt-in script hardening — the "no result" check.
  document.getElementById('toggle-hardening-no-result')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, noResult: { ...bridge.getState().hardening.noResult, enabled: e.target.checked } },
    });
  });
  document.getElementById('btn-hardening-no-result-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, noResult: { ...bridge.getState().hardening.noResult, severity: 'Warning' } },
    });
  });
  document.getElementById('btn-hardening-no-result-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, noResult: { ...bridge.getState().hardening.noResult, severity: 'Error' } },
    });
  });

  // Issue #130: the per-field null-rate check — a dynamic list, same
  // delegated-event-on-the-container pattern as browser-actions-list above.
  document.getElementById('btn-add-null-rate-check')?.addEventListener('click', () => {
    const [firstField] = collectFieldNames(bridge.getState().mode, bridge.getState().fields, bridge.getState().groups, bridge.getState().apiConfig);
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, nullRate: addNullRateCheck(bridge.getState().hardening.nullRate, firstField) },
    });
  });
  document.getElementById('hardening-null-rate-list')?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.btn-remove-null-rate');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: removeNullRateCheck(bridge.getState().hardening.nullRate, index) },
      });
      return;
    }
    const warningBtn = e.target.closest('.btn-null-rate-warning');
    if (warningBtn) {
      const index = parseInt(warningBtn.dataset.index, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, { severity: 'Warning' }) },
      });
      return;
    }
    const errorBtn = e.target.closest('.btn-null-rate-error');
    if (errorBtn) {
      const index = parseInt(errorBtn.dataset.index, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, { severity: 'Error' }) },
      });
    }
  });
  // change (not input/click) for the field select and threshold number —
  // same "don't reset the cursor/dropdown on every keystroke" reasoning as
  // the browser-actions-list change listener above.
  document.getElementById('hardening-null-rate-list')?.addEventListener('change', (e) => {
    const fieldSelect = e.target.closest('.hardening-null-rate-field');
    if (fieldSelect) {
      const index = parseInt(fieldSelect.dataset.index, 10);
      bridge.setState(bridge.getState().current, {
        hardening: { ...bridge.getState().hardening, nullRate: updateNullRateCheck(bridge.getState().hardening.nullRate, index, { fieldName: fieldSelect.value }) },
      });
      return;
    }
    const thresholdInput = e.target.closest('.hardening-null-rate-threshold');
    if (thresholdInput) {
      const index = parseInt(thresholdInput.dataset.index, 10);
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
  document.getElementById('toggle-hardening-baseline')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, baseline: { ...bridge.getState().hardening.baseline, enabled: e.target.checked } },
    });
  });
  document.getElementById('btn-hardening-baseline-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, baseline: { ...bridge.getState().hardening.baseline, severity: 'Warning' } },
    });
  });
  document.getElementById('btn-hardening-baseline-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, baseline: { ...bridge.getState().hardening.baseline, severity: 'Error' } },
    });
  });
  document.getElementById('input-hardening-baseline-threshold')?.addEventListener('change', (e) => {
    const percent = parseInt(e.target.value, 10);
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
  document.getElementById('toggle-hardening-blocking')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, enabled: e.target.checked } },
    });
  });
  document.getElementById('btn-hardening-blocking-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, severity: 'Warning' } },
    });
  });
  document.getElementById('btn-hardening-blocking-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, severity: 'Error' } },
    });
  });
  document.getElementById('input-hardening-blocking-min-body-length')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, minBodyLengthText: e.target.value } },
    });
  });
  document.getElementById('input-hardening-blocking-phrases')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, blocking: { ...bridge.getState().hardening.blocking, phrasesText: e.target.value } },
    });
  });

  // Issue #133: opt-in script hardening — the required-fields check.
  document.getElementById('toggle-hardening-required-fields')?.addEventListener('change', (e) => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, requiredFields: { ...bridge.getState().hardening.requiredFields, enabled: e.target.checked } },
    });
  });
  document.getElementById('btn-hardening-required-fields-warning')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, requiredFields: { ...bridge.getState().hardening.requiredFields, severity: 'Warning' } },
    });
  });
  document.getElementById('btn-hardening-required-fields-error')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, {
      hardening: { ...bridge.getState().hardening, requiredFields: { ...bridge.getState().hardening.requiredFields, severity: 'Error' } },
    });
  });
  document.getElementById('btn-add-required-field')?.addEventListener('click', () => {
    const fieldName = document.getElementById('select-hardening-required-field')?.value;
    bridge.setState(bridge.getState().current, {
      hardening: {
        ...bridge.getState().hardening,
        requiredFields: { ...bridge.getState().hardening.requiredFields, fields: addRequiredField(bridge.getState().hardening.requiredFields.fields, fieldName) },
      },
    });
  });
  document.getElementById('hardening-required-fields-list')?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.btn-remove-required-field');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index, 10);
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
  document.getElementById('monitoring-section-toggle')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { monitoringSectionOpen: !bridge.getState().monitoringSectionOpen });
  });
  document.getElementById('monitoring-section-toggle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      bridge.setState(bridge.getState().current, { monitoringSectionOpen: !bridge.getState().monitoringSectionOpen });
    }
  });

  // Issue #184: collapsible "Settings" section toggle — same click/Enter/
  // Space pattern as Monitoring above. The section's own three toggles
  // (Json output, trial-run data preview, full output-file download) live
  // here too, since they're exactly the "Settings" section's own content.
  document.getElementById('settings-section-toggle')?.addEventListener('click', () => {
    bridge.setState(bridge.getState().current, { settingsSectionOpen: !bridge.getState().settingsSectionOpen });
  });
  document.getElementById('settings-section-toggle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      bridge.setState(bridge.getState().current, { settingsSectionOpen: !bridge.getState().settingsSectionOpen });
    }
  });

  document.getElementById('toggle-include-data-preview')?.addEventListener('change', (e) => {
    log('BTN toggle-include-data-preview', e.target.checked);
    bridge.patchState({ includeDataPreview: e.target.checked });
  });

  document.getElementById('toggle-include-output-file')?.addEventListener('change', (e) => {
    log('BTN toggle-include-output-file', e.target.checked);
    bridge.patchState({ includeOutputFile: e.target.checked });
  });

  document.getElementById('toggle-output-json')?.addEventListener('change', (e) => {
    log('BTN toggle-output-json', e.target.checked);
    bridge.patchState({ useJsonOutput: e.target.checked });
  });

}

  return {renderSettingsPanel, renderHardeningNullRateList, renderHardeningRequiredFieldsList,
    wireSettingsPanelEvents,};
})();

if (typeof module !== 'undefined') module.exports = SFSettingsPanelUI;
if (typeof self !== 'undefined') self.SFSettingsPanelUI = SFSettingsPanelUI;
