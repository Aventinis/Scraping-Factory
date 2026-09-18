// ── Pure scraping-config builder functions ─────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — every function here is a pure data
// transformation with no DOM/state access, taking plain values in and
// returning plain values out, so it's trivially testable in isolation
// (see scraping-config-builder.test.js).
const SFScrapingConfigBuilder = (function() {
const { escapeHtml } =
  typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

const { t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { serializeGroupTree } =
  typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

// ── Pure functions (exported for testing) ────────────────────────────────────

// Mirrors the companion's FileNameSanitizer (ScrapingFactory.Compiler/IR/
// FileNameSanitizer.cs) character-for-character: strips everything but
// letters/digits/underscore/hyphen and falls back to `fallback` for
// empty/fully-invalid input. Kept in sync by hand (same pattern as
// RangeFormat's client-side mirror) so the name shown here — used for the
// actual download — always matches what the companion baked into the
// generated script's "# Run: python X.py" comment for the same raw input.
function sanitizeFileNameBase(input, fallback) {
  if (!input || !input.trim()) return fallback;
  const sanitized = input.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[-_]+|[-_]+$/g, '');
  return sanitized || fallback;
}

// Issue #83: one URL per line, pasted/typed into the additional-start-urls
// textarea — blank lines (a trailing newline, or blank lines between pasted
// entries) are a formatting artifact, not a URL the user meant to add, so
// they're dropped here rather than surfacing as a companion-side validation
// error later. A genuinely malformed non-blank entry is deliberately left
// as-is — it's still sent to the companion, which rejects it the same way
// it already rejects a malformed primary `url` (ScrapingPlanValidator).
function parseAdditionalUrls(text) {
  return (text || '').split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

// Issue #87: converts _state.changeDetection's editable draft shape into
// the wire ChangeDetectionConfig, or null when disabled or not yet fully
// configured (a required env-var-name field left blank) — buildScrapingConfig
// only adds the `changeDetection` key at all when this returns non-null, so
// an incomplete draft is simply treated the same as the toggle being off
// rather than sending a partial config the companion would reject with 400.
// Every field here is an environment-variable *name*, never a value.
function buildChangeDetectionConfig(changeDetection) {
  if (!changeDetection?.enabled) return null;

  if (changeDetection.notify === 'Webhook') {
    const urlEnvVar = (changeDetection.webhook.urlEnvVar || '').trim();
    return urlEnvVar ? { notify: 'Webhook', webhook: { urlEnvVar } } : null;
  }

  const email = changeDetection.email;
  const smtpHostEnvVar = (email.smtpHostEnvVar || '').trim();
  const fromEnvVar = (email.fromEnvVar || '').trim();
  const toEnvVar = (email.toEnvVar || '').trim();
  if (!smtpHostEnvVar || !fromEnvVar || !toEnvVar) return null;

  const smtpPortEnvVar = (email.smtpPortEnvVar || '').trim();
  const smtpUsernameEnvVar = (email.smtpUsernameEnvVar || '').trim();
  const smtpPasswordEnvVar = (email.smtpPasswordEnvVar || '').trim();
  return {
    notify: 'Email',
    email: {
      smtpHostEnvVar, fromEnvVar, toEnvVar,
      ...(smtpPortEnvVar ? { smtpPortEnvVar } : {}),
      ...(smtpUsernameEnvVar ? { smtpUsernameEnvVar } : {}),
      ...(smtpPasswordEnvVar ? { smtpPasswordEnvVar } : {}),
    },
  };
}

// Issue #88: converts _state.proxy's editable draft shape into the wire
// ProxyConfig, or null when disabled or the env-var-name field is left
// blank — same "incomplete draft treated as toggle-off" convention as
// buildChangeDetectionConfig. The field is an environment-variable *name*,
// never a literal proxy address.
function buildProxyConfig(proxy) {
  if (!proxy?.enabled) return null;
  const environmentVariableName = (proxy.envVar || '').trim();
  return environmentVariableName ? { environmentVariableName } : null;
}

// Issue #174: converts _state.pagination's editable draft shape into the
// wire PaginationConfig, or null when disabled or the kind-specific
// required field (nextLinkSelector / urlTemplate) is left blank — same
// "incomplete draft treated as toggle-off" convention as
// buildChangeDetectionConfig/buildProxyConfig. maxPages is clamped/
// defaulted the same way hardening's own percent thresholds are, so a
// cleared/invalid number input doesn't block generation.
function buildPaginationConfig(pagination) {
  if (!pagination?.enabled) return null;
  const maxPagesRaw = Number(pagination.maxPages);
  const maxPages = Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? Math.floor(maxPagesRaw) : 50;
  if (pagination.kind === 'pageNumber') {
    const urlTemplate = (pagination.urlTemplate || '').trim();
    return urlTemplate ? { kind: 'pageNumber', urlTemplate, maxPages } : null;
  }
  const nextLinkSelector = (pagination.nextLinkSelector || '').trim();
  return nextLinkSelector ? { kind: 'nextLink', nextLinkSelector, maxPages } : null;
}

// Issue #129: builds the wire-format Hardening list (companion's
// List<HardeningCheck>?) from every enabled check in _state.hardening — an
// array even though only one check exists today, since the wire format is
// inherently a list (see HardeningCheck.cs) to make room for the other four
// planned checks (see CLAUDE.md) without a breaking change. `kind` is the
// camelCase discriminator the companion's [JsonDerivedType] expects
// (mirrors FieldTransform's own kind values, e.g. 'trim'/'toNumber' — not
// PascalCase like `severity`, which is a plain enum). Returns null (not [])
// when nothing is enabled, same "omit the key entirely" convention
// buildChangeDetectionConfig/buildProxyConfig already use.
function buildHardeningConfig(hardening) {
  const checks = [];
  if (hardening?.noResult?.enabled) {
    checks.push({ kind: 'noResult', severity: hardening.noResult.severity });
  }
  // Issue #130: unlike noResult, a row with no field chosen yet is simply
  // skipped rather than blocking generation — same "incomplete draft, not
  // an error" convention as an unfinished Fill/Proxy env-var name. Threshold
  // is stored as a whole percent (0-100) in the UI for a friendlier input,
  // divided by 100 to reach the wire format's 0.0-1.0 fraction — clamped and
  // defaulted here too, since a cleared/invalid number input can leave
  // `threshold` as NaN or out of range.
  for (const row of hardening?.nullRate || []) {
    const fieldName = (row.fieldName || '').trim();
    if (!fieldName) continue;
    const percent = Number.isFinite(row.threshold) ? row.threshold : 50;
    const threshold = Math.min(100, Math.max(0, percent)) / 100;
    checks.push({ kind: 'nullRate', severity: row.severity, fieldName, threshold });
  }
  // Issue #131: same percent-to-fraction conversion as nullRate above.
  // Unlike nullRate, there's only ever one baseline row (a single object,
  // not an array) — an unfinished/invalid dropThresholdPercent is clamped/
  // defaulted rather than skipping the check entirely, since there's no
  // "which field" completeness gate the way nullRate has.
  if (hardening?.baseline?.enabled) {
    const percent = Number.isFinite(hardening.baseline.dropThresholdPercent) ? hardening.baseline.dropThresholdPercent : 20;
    const dropThreshold = Math.min(100, Math.max(0, percent)) / 100;
    checks.push({ kind: 'baseline', severity: hardening.baseline.severity, dropThreshold });
  }
  // Issue #132: unlike baseline's percent, minBodyLengthText has no
  // meaningful default to fall back to (there's no "at least one signal
  // configured" requirement — the cross-origin-redirect signal is always
  // active) — a blank/invalid input simply omits minBodyLength (signal
  // disabled) rather than substituting a guessed number. phrasesText is
  // one phrase per line (not comma-split like API mode's value list — a
  // block phrase such as "Please verify you are human" could plausibly
  // contain a comma of its own); blank lines are dropped.
  if (hardening?.blocking?.enabled) {
    const minBodyLength = parseInt(hardening.blocking.minBodyLengthText, 10);
    const blockPhrases = String(hardening.blocking.phrasesText || '').split('\n').map(s => s.trim()).filter(s => s.length > 0);
    checks.push({
      kind: 'blocking',
      severity: hardening.blocking.severity,
      minBodyLength: Number.isFinite(minBodyLength) && minBodyLength > 0 ? minBodyLength : null,
      blockPhrases,
    });
  }
  // Issue #133: like nullRate's own "incomplete draft" rows, an enabled
  // check with no fields picked yet is simply skipped rather than sent as
  // an empty list — ScrapingPlanValidator rejects an empty FieldNames list
  // outright, and there's nothing incomplete-but-useful to send here the
  // way an unfinished env-var name still is for Fill/Proxy.
  if (hardening?.requiredFields?.enabled && hardening.requiredFields.fields.length > 0) {
    checks.push({ kind: 'requiredFields', severity: hardening.requiredFields.severity, fieldNames: hardening.requiredFields.fields });
  }
  return checks.length > 0 ? checks : null;
}

// Issue #183: the "Monitoring" section (change detection + hardening)
// should start expanded, not collapsed, for a returning user who already
// has something configured in it — reuses buildHardeningConfig/
// buildChangeDetectionConfig's own "does this actually produce a wire
// config" logic rather than re-deriving "is anything enabled" separately,
// so the two can never quietly disagree about what counts as "configured".
function computeInitialMonitoringSectionOpen(changeDetection, hardening) {
  return buildChangeDetectionConfig(changeDetection) !== null || buildHardeningConfig(hardening) !== null;
}

// Issue #130: collects every leaf field name currently configured, across
// whichever mode/shape is active — feeds the NullRateCheck field picker in
// the hardening UI, reusing the exact field list the user already built
// instead of a second, free-text name input that could too easily drift out
// of sync with an actual (or renamed) field. Container mode's `groups` is
// still the live draft tree (GroupNode/DataFieldNode, `kind: 'group'|'field'`
// — see container-tree.js); API mode's `apiConfig` is instead the *already
// serialized* wire object built once at API_CONFIG-confirm time, so its tree
// shape (if any) is discriminated structurally by `children` presence
// instead, the same way countApiConfigFields already reads it. Deduplicated
// (a tree can repeat the same field name at several nesting depths —
// NullRateCheck itself matches by name globally, see the companion-side doc
// comment on NullRateCheck) and order-preserving.
function collectFieldNames(mode, fields, groups, apiConfig) {
  const names = [];
  const add = (name) => { if (name && !names.includes(name)) names.push(name); };

  if (mode === 'container') {
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.kind === 'field') add(node.name);
        else if (node.kind === 'group') walk(node.children);
      }
    };
    walk(groups);
  } else if (mode === 'api') {
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.children) walk(node.children);
        else add(node.name);
      }
    };
    if (apiConfig?.groups) walk(apiConfig.groups);
    else for (const f of apiConfig?.fields || []) add(f.name);
  } else {
    for (const f of fields || []) add(f.name);
  }
  return names;
}

// `apiConfig` is only read when mode === 'api' — the confirmed ApiConfig
// wire object built by buildApiConfig (Issue #53 Phase 5), passed straight
// through as the request body's `api` field. Method is forced server-side
// (see companion's ScrapingPlanBuilder); OutputFormat is forced too, unless
// `useJsonOutput` opts into Json (Issue #86, see below).
// `scriptFileName`/`outputFileName` are sent as-is (possibly blank) — the
// companion sanitizes and defaults them itself (see FileNameSanitizer),
// same "server is the source of truth" pattern as OutputFormat.
// `engine`/`browserActions` (Issue #41/#42, Phase 5) are mode-independent —
// only included at all when `engine === 'Browser'` (the server already
// defaults to Static when the key is absent, so the 'Static' case round-trips
// to byte-for-byte the same request body as before this existed), and
// `browserActions` only on top of that when non-empty.
// `includePreview` (Issue #122) is mode-independent too — only included when
// true, so the default (checkbox unchecked) request stays byte-for-byte
// identical to before this existed. See companion's ScrapingConfig.IncludePreview.
// `useJsonOutput` (Issue #86) is mode-independent as well: container/api mode
// send no `outputFormat` key at all by default (the companion forces its own
// Xml/Csv default per shape) and only add `outputFormat: 'Json'` when this
// is true; flat mode always sends an explicit outputFormat, so it just swaps
// the literal 'Csv' for 'Json'. The companion decides — per mode/shape —
// whether Json actually fits, same "server is the source of truth" pattern
// as everything else here.
// `additionalUrls` (Issue #83) is only included when non-empty, same
// omit-when-default convention as browserActions — the companion runs the
// same Fields/Groups extraction config against every one of these in
// addition to `url`, combining the results. The UI never lets this be
// non-empty for mode === 'api' (the input is hidden there), since API mode
// builds its own request URL and the companion rejects the combination
// outright rather than silently ignoring it.
// `pagination` (Issue #174) follows the same "hidden and so always empty for
// mode === 'api'" convention as additionalUrls, for the same reason (API
// mode already has its own page-parameter mechanism via a Number
// RangeSource, and the companion rejects the combination outright).
function buildScrapingConfig(
  url, mode, fields, groups, apiConfig = null, scriptFileName = null, outputFileName = null,
  engine = 'Static', browserActions = [], includePreview = false, useJsonOutput = false,
  additionalUrls = [], changeDetection = null, proxy = null, hardening = null, pagination = null,
  persistentSession = false, includeOutputFile = false, externalConfig = false, combinedComponents = null,
) {
  // Combined mode (Issue #239): no ad-hoc fields/groups/apiConfig of its own
  // — each component is a fully independent, already-resolved
  // {name, config, savedConfigId} (see companion-client.js's
  // resolveCombinedComponents), sent verbatim. None of engine/
  // browserActions/additionalUrls/changeDetection/proxy/hardening/
  // pagination/persistentSession/externalConfig/useJsonOutput apply at this
  // outer level — the companion rejects all of them here outright (each
  // component's own config carries its own instead) — so this branch
  // deliberately ignores every one of those parameters.
  if (mode === 'combined') {
    const previewFields = includePreview ? { includePreview: true } : {};
    const outputFileFields = includeOutputFile ? { includeOutputFile: true } : {};
    return {
      version: '1', url,
      combined: (combinedComponents || []).map(c => ({
        name: c.name, config: c.config,
        ...(c.savedConfigId ? { savedConfigId: c.savedConfigId } : {}),
      })),
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...previewFields, ...outputFileFields,
    };
  }

  const engineFields = engine === 'Browser'
    ? { engine, ...(browserActions.length > 0 ? { browserActions: serializeBrowserActions(browserActions) } : {}) }
    : {};
  const previewFields = includePreview ? { includePreview: true } : {};
  const outputFormatFields = useJsonOutput ? { outputFormat: 'Json' } : {};
  const additionalUrlsFields = additionalUrls.length > 0 ? { additionalUrls } : {};
  const changeDetectionConfig = buildChangeDetectionConfig(changeDetection);
  const changeDetectionFields = changeDetectionConfig ? { changeDetection: changeDetectionConfig } : {};
  const proxyConfig = buildProxyConfig(proxy);
  const proxyFields = proxyConfig ? { proxy: proxyConfig } : {};
  const hardeningConfig = buildHardeningConfig(hardening);
  const hardeningFields = hardeningConfig ? { hardening: hardeningConfig } : {};
  const paginationConfig = buildPaginationConfig(pagination);
  const paginationFields = paginationConfig ? { pagination: paginationConfig } : {};
  // Issue #175: Browser-engine only, but simply sent as-is (like
  // browserActions) rather than gated on `engine === 'Browser'` here — the
  // toggle itself is only reachable through the UI while the browser-actions
  // section is visible (Engine=Browser), and the companion rejects the
  // combination server-side regardless (see ScrapingPlanValidator).
  const persistentSessionFields = persistentSession ? { persistentSession: true } : {};
  // Issue #161: mirrors previewFields exactly — only included when true, so
  // the default (checkbox unchecked) request stays byte-for-byte identical
  // to before this existed. See companion's ScrapingConfig.IncludeOutputFile.
  const outputFileFields = includeOutputFile ? { includeOutputFile: true } : {};
  // Issue #178: mirrors previewFields/outputFileFields exactly — only
  // included when true, so the default (checkbox unchecked) request stays
  // byte-for-byte identical to before this existed.
  const externalConfigFields = externalConfig ? { externalConfig: true } : {};

  if (mode === 'container') {
    return {
      version: '1', url, groups: serializeGroupTree(groups),
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields, ...hardeningFields, ...paginationFields, ...persistentSessionFields, ...outputFileFields,
      ...externalConfigFields,
    };
  }
  if (mode === 'api') {
    return {
      version: '1', url, api: apiConfig,
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields, ...hardeningFields, ...paginationFields, ...persistentSessionFields, ...outputFileFields,
      ...externalConfigFields,
    };
  }
  return {
    version: '1',
    url,
    fields: fields.map(f => ({
      name: f.name, selector: f.selector, attribute: f.attribute ?? null,
      ...(f.framePath ? { framePath: f.framePath } : {}),
      ...(f.transforms && f.transforms.length > 0 ? { transforms: f.transforms } : {}),
    })),
    outputFormat: useJsonOutput ? 'Json' : 'Csv',
    scriptFileName: scriptFileName || null,
    outputFileName: outputFileName || null,
    ...engineFields, ...previewFields, ...additionalUrlsFields, ...changeDetectionFields, ...proxyFields,
    ...hardeningFields, ...paginationFields, ...persistentSessionFields, ...outputFileFields, ...externalConfigFields,
  };
}

// Wraps the exact wire-format config (buildScrapingConfig) with export
// metadata, so a user hitting a selector problem can hand over one file
// that both shows the current Fields/Groups/Api config and, unwrapped, is
// the literal request body /generate would receive — no need to describe
// the setup by hand. `manifest` is injected so this stays a pure, testable
// function instead of reaching into chrome.runtime itself.
function buildConfigExport(
  url, mode, fields, groups, manifest = {}, apiConfig = null, scriptFileName = null, outputFileName = null,
  engine = 'Static', browserActions = [], includePreview = false, useJsonOutput = false, additionalUrls = [],
  changeDetection = null, proxy = null, hardening = null, pagination = null, persistentSession = false,
  includeOutputFile = false, externalConfig = false, combinedComponents = null,
) {
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: manifest.version || '?',
    config: buildScrapingConfig(
      url, mode, fields, groups, apiConfig, scriptFileName, outputFileName, engine, browserActions, includePreview,
      useJsonOutput, additionalUrls, changeDetection, proxy, hardening, pagination, persistentSession,
      includeOutputFile, externalConfig, combinedComponents,
    ),
  };
}

function addField(fields, name, selector, framePath = null, transforms = []) {
  return [...fields, {
    name, selector, attribute: null, framePath: framePath || null,
    transforms: transforms.length > 0 ? transforms : null,
  }];
}

// Issue #41/#42, Phase 5/6: browser actions (WaitFor/Fill/Click/Scroll,
// executed in order before extraction) — same pure add/remove/update shape
// as addField/removeField above, so setState() callers stay trivial.
// MaxIterations/WaitAfterMs default to the same values ScrollStep itself
// defaults to server-side (IR/ScrapingStep.cs), kept in sync by hand.
function addBrowserAction(actions, kind) {
  const defaults = {
    waitFor: { kind: 'waitFor', selector: '', timeoutMs: 5000 },
    fill:    { kind: 'fill', selector: '', environmentVariableName: '' },
    click:   { kind: 'click', selector: '' },
    scroll:  { kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000 },
  };
  return [...actions, defaults[kind]];
}

function removeBrowserAction(actions, index) {
  return actions.filter((_, i) => i !== index);
}

function updateBrowserAction(actions, index, patch) {
  return actions.map((a, i) => (i === index ? { ...a, ...patch } : a));
}

// Picks exactly the wire-relevant fields per kind (companion's BrowserAction
// variants, IR/BrowserAction.cs) — actions themselves are free to carry
// extra UI-only bookkeeping later without it leaking into the request body.
// ScrollStep's ContainerSelector/LoadMoreButtonSelector are nullable on the
// server, and "set but blank" is rejected (ScrapingPlanValidator) — an
// unpicked '' here must serialize to null, never ''.
function serializeBrowserActions(actions) {
  return actions.map((a) => {
    const framePath = a.framePath ? { framePath: a.framePath } : {};
    if (a.kind === 'waitFor') return { kind: 'waitFor', selector: a.selector, timeoutMs: a.timeoutMs, ...framePath };
    if (a.kind === 'fill') return { kind: 'fill', selector: a.selector, environmentVariableName: a.environmentVariableName, ...framePath };
    if (a.kind === 'scroll') {
      return {
        kind: 'scroll',
        containerSelector: a.containerSelector || null,
        loadMoreButtonSelector: a.loadMoreButtonSelector || null,
        maxIterations: a.maxIterations,
        waitAfterMs: a.waitAfterMs,
        ...framePath,
      };
    }
    return { kind: 'click', selector: a.selector, ...framePath };
  });
}

// Issue #43: bundles fillTestValues into the wire dict /generate expects,
// keyed by FillAction.environmentVariableName — the same join key the wire
// FillAction itself carries. Never touches buildScrapingConfig or
// persistState. Returns {} when there's nothing to send (e.g. no test values
// typed, or no fill actions at all).
function buildVerificationValues(browserActions, fillTestValues) {
  const result = {};
  for (const action of browserActions) {
    if (action.kind !== 'fill') continue;
    const name = action.environmentVariableName?.trim();
    const value = name ? fillTestValues[name] : null;
    if (name && value) result[name] = value;
  }
  return result;
}

function removeField(fields, index) {
  return fields.filter((_, i) => i !== index);
}

// Issue #130: same pure add/remove/update shape as addBrowserAction/
// removeBrowserAction/updateBrowserAction below, for _state.hardening.
// nullRate rows. threshold defaults to 50 (%) — an arbitrary but reasonable
// starting point, the same role addBrowserAction's own kind-specific
// defaults play.
function addNullRateCheck(nullRate, fieldName) {
  return [...nullRate, { fieldName: fieldName || '', threshold: 50, severity: 'Warning' }];
}

function removeNullRateCheck(nullRate, index) {
  return nullRate.filter((_, i) => i !== index);
}

function updateNullRateCheck(nullRate, index, patch) {
  return nullRate.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

// Issue #133: unlike nullRate's rows (each its own draft object with a
// field/threshold/severity), requiredFields.fields is just a plain array of
// already-chosen field names — there's nothing else to configure per entry,
// so no updateRequiredField counterpart exists. A duplicate add is a no-op
// rather than an error, mirroring how the add-field <select> below is
// itself already filtered to exclude already-added names.
function addRequiredField(fields, fieldName) {
  if (!fieldName || fields.includes(fieldName)) return fields;
  return [...fields, fieldName];
}

function removeRequiredField(fields, index) {
  return fields.filter((_, i) => i !== index);
}

// Issue #42, Phase 7: a small pill shown next to a field's/node's/action's
// selector once ELEMENT_SELECTED resolved a non-null framePath for it — the
// side panel's own, translated indicator of what content-script.js's
// synchronous, icon-only overlay badge could only hint at live during
// selection (see createOverlay's frameDepth-based styling). `path.join(' > ')`
// matches the top-to-target reading order the backend itself documents on
// FramePath (IR/BrowserAction.cs, ContainerNode.cs).
function frameBadgeHtml(framePath) {
  if (!framePath || framePath.length === 0) return '';
  const title = escapeHtml(t('frame.badgeTitle', { path: framePath.join(' > ') }));
  return `<span class="frame-badge" title="${title}">${escapeHtml(t('frame.badge'))}</span>`;
}

  return {sanitizeFileNameBase, parseAdditionalUrls,
    buildChangeDetectionConfig, buildProxyConfig, buildPaginationConfig, buildHardeningConfig,
    computeInitialMonitoringSectionOpen, collectFieldNames,
    buildScrapingConfig, buildConfigExport,
    addField, removeField,
    addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions,
    buildVerificationValues,
    addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
    addRequiredField, removeRequiredField,
    frameBadgeHtml,};
})();

if (typeof module !== 'undefined') module.exports = SFScrapingConfigBuilder;
if (typeof self !== 'undefined') self.SFScrapingConfigBuilder = SFScrapingConfigBuilder;
