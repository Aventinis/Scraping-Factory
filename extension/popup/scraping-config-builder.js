// @ts-check
/** @import * as SFWire from '../types/wire' */
/** @import * as SFDraft from '../types/drafts' */
// ── Pure scraping-config builder functions ─────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — every function here is a pure data
// transformation with no DOM/state access, taking plain values in and
// returning plain values out, so it's trivially testable in isolation
// (see scraping-config-builder.test.js).
//
// Issue #238: JSDoc-annotated and typechecked via `// @ts-check` + tsconfig
// (`npm run typecheck`), against types/wire.ts's `SFWire`
// namespace. `buildScrapingConfig`/`buildConfigExport` deliberately return
// a plain `object` rather than `SFWire.ScrapingConfig` — each one has five
// mutually-exclusive branches (blocks/combined/container/api/flat) built as
// separate object literals, and TypeScript's excess-property checks on a
// returned object literal would have to be fought branch by branch for
// little real benefit; every *input* parameter is still precisely typed, so
// a caller passing e.g. a field where a transform chain is expected is
// still caught at the call site either way.
// Draft (popup-internal) shapes referenced below — SFDraft.ChangeDetectionState,
// SFDraft.ProxyState, SFDraft.PaginationState, SFDraft.HardeningState,
// SFDraft.GlobalSettings, SFDraft.Field, SFDraft.CombinedComponent,
// SFDraft.Block, SFDraft.BrowserAction, SFDraft.ContainerNode — all live in
// types/drafts.ts rather than as local @typedefs here, since
// container-tree.ts's own JSDoc needs to reference the very same shapes
// (see that file's own top-of-file comment).
const { escapeHtml } = require('./api-config');

const { t } = require('../i18n/i18n');

const { serializeGroupTree } = require('./container-tree');

const { buildOutputBlueprintMapping } = require('./output-blueprints');

const { buildDeduplicationConfig } = require('./dedup-config');
const { buildRequestHeadersConfig } = require('./request-headers');

// ── Pure functions (exported for testing) ────────────────────────────────────

// Mirrors the companion's FileNameSanitizer (ScrapingFactory.Compiler/IR/FileNameSanitizer.cs):
// the name shown here — used for the actual download — must match what the companion baked
// into the script's "# Run: python X.py" comment. test-vectors/file-name-sanitizer.json pins both.
/**
 * @param {string} input
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeFileNameBase(input, fallback) {
  if (!input || !input.trim()) return fallback;
  const sanitized = input.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[-_]+|[-_]+$/g, '');
  return sanitized || fallback;
}

// Issue-driven follow-up (default script name preference): derives a
// sanitized script-name base from a URL's own hostname, for the global
// Settings tab's "always from the website" scriptNameMode. A malformed/
// relative `url` (same possibility openSaveConfigModal's own defaultName
// already has to guard against) falls back to `fallback` — new URL() throws
// rather than returning something sanitizeFileNameBase could clean up on
// its own.
/**
 * @param {string} url
 * @param {string} fallback
 * @returns {string}
 */
function deriveScriptFileNameFromHostname(url, fallback) {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // hostname stays '' — sanitizeFileNameBase below falls back to
    // `fallback`, same as any other unreachable default elsewhere in this
    // popup.
  }
  return sanitizeFileNameBase(hostname, fallback);
}

// Issue-driven follow-up: the scriptFileName patch to apply whenever a
// fresh site is detected — checkCompanion()'s own health check, and the
// stale-tracked-URL self-correction in message-router.js/session-restore.js
// — reused by every call site instead of duplicating the mode branch. In
// 'hostname' mode, the field always recomputes/overwrites, tracking
// whichever site is current ("immer von der Webseite abgeleitet"); in
// 'fixed' mode, it only ever fills the field once, when it's still blank —
// a starting point that never stomps a manual edit. Returns {} when neither
// applies (fixed mode with an already-non-blank name), the same "omit the
// key entirely rather than send a no-op" convention this module's own
// build*Config helpers already use for an incomplete/inactive draft.
/**
 * @param {string} currentScriptFileName
 * @param {string} url
 * @param {SFDraft.GlobalSettings} globalSettings
 * @returns {{scriptFileName?: string}}
 */
function computeScriptFileNamePatch(currentScriptFileName, url, globalSettings) {
  if (globalSettings.scriptNameMode === 'hostname') {
    return { scriptFileName: deriveScriptFileNameFromHostname(url, globalSettings.scriptNameFixed) };
  }
  if (!currentScriptFileName) {
    return { scriptFileName: globalSettings.scriptNameFixed };
  }
  return {};
}

// Issue #83: one URL per line, pasted/typed into the additional-start-urls
// textarea — blank lines (a trailing newline, or blank lines between pasted
// entries) are a formatting artifact, not a URL the user meant to add, so
// they're dropped here rather than surfacing as a companion-side validation
// error later. A genuinely malformed non-blank entry is deliberately left
// as-is — it's still sent to the companion, which rejects it the same way
// it already rejects a malformed primary `url` (ScrapingPlanValidator).
/**
 * @param {string} text
 * @returns {string[]}
 */
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
/**
 * @param {SFDraft.ChangeDetectionState | null | undefined} changeDetection
 * @returns {SFWire.ChangeDetectionConfig | null}
 */
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
/**
 * @param {SFDraft.ProxyState | null | undefined} proxy
 * @returns {SFWire.ProxyConfig | null}
 */
function buildProxyConfig(proxy) {
  if (!proxy?.enabled) return null;
  const environmentVariableName = (proxy.envVar || '').trim();
  return environmentVariableName ? { environmentVariableName } : null;
}

// Issue #222: converts _state.requestDelay's editable draft (two free-text
// second inputs, so "1,5" and "1.5" both work) into the wire
// RequestDelayConfig in milliseconds, or null when disabled or the "from"
// value isn't a usable number — the same "incomplete draft treated as
// toggle-off" convention buildProxyConfig uses. A blank "to" means a fixed
// pause; a "to" below "from" is raised to it; both are clamped to
// RequestDelayConfig.MaxAllowedMs (60 s) the way buildPaginationConfig
// clamps maxPages, so a stray value never turns into a 400 from /generate.
const REQUEST_DELAY_MAX_MS = 60000;
/**
 * @param {string | null | undefined} text
 * @returns {number | null}
 */
function parseSecondsToMs(text) {
  const normalized = String(text ?? '').trim().replace(',', '.');
  if (normalized === '') return null;
  const seconds = Number(normalized);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.round(seconds * 1000), REQUEST_DELAY_MAX_MS) : null;
}
/**
 * @param {SFDraft.RequestDelayState | null | undefined} requestDelay
 * @returns {SFWire.RequestDelayConfig | null}
 */
function buildRequestDelayConfig(requestDelay) {
  if (!requestDelay?.enabled) return null;
  const minMs = parseSecondsToMs(requestDelay.minSecondsText);
  if (minMs === null) return null;
  const maxMs = parseSecondsToMs(requestDelay.maxSecondsText);
  return { minMs, maxMs: maxMs === null ? minMs : Math.max(minMs, maxMs) };
}

// Issue #223: converts _state.retry's editable draft into the wire
// RetryConfig, or null when disabled. Unlike buildRequestDelayConfig there's
// no "incomplete = off" case: every input falls back to its default when
// blank or unusable (3 attempts, 2 s, the companion's default status-code
// list), and attempts/delay are clamped to RetryConfig's own bounds (2-10
// attempts, 0-60 s) — so a stray value never turns into a 400 from /generate.
// Status codes accept any separator ("429, 503" / "429 503"); only 400-599
// are kept, deduplicated, and an empty result is omitted so the companion's
// own default list applies.
const RETRY_DEFAULT_ATTEMPTS = 3;
const RETRY_DEFAULT_DELAY_MS = 2000;
/**
 * @param {SFDraft.RetryState | null | undefined} retry
 * @returns {SFWire.RetryConfig | null}
 */
function buildRetryConfig(retry) {
  if (!retry?.enabled) return null;
  const attempts = parseInt(String(retry.maxAttemptsText ?? '').trim(), 10);
  const maxAttempts = Number.isFinite(attempts) ? Math.min(Math.max(attempts, 2), 10) : RETRY_DEFAULT_ATTEMPTS;
  const delayMs = parseSecondsToMs(retry.delaySecondsText) ?? RETRY_DEFAULT_DELAY_MS;
  const codes = [...new Set(String(retry.statusCodesText ?? '').split(/[^0-9]+/).filter(Boolean).map(Number))]
    .filter(code => code >= 400 && code <= 599);
  return {
    maxAttempts, delayMs, exponential: retry.exponential !== false,
    ...(codes.length > 0 ? { retryOnStatusCodes: codes } : {}),
  };
}

// Issue #174: converts _state.pagination's editable draft shape into the
// wire PaginationConfig, or null when disabled or the kind-specific
// required field (nextLinkSelector / urlTemplate) is left blank — same
// "incomplete draft treated as toggle-off" convention as
// buildChangeDetectionConfig/buildProxyConfig. maxPages is clamped/
// defaulted the same way hardening's own percent thresholds are, so a
// cleared/invalid number input doesn't block generation.
/**
 * @param {SFDraft.PaginationState | null | undefined} pagination
 * @returns {SFWire.PaginationConfig | null}
 */
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

// Issue #218: builds the wire-format DiscoveredUrlsConfig from
// _state.discoveredUrls — same "incomplete draft = toggle-off" convention
// buildPaginationConfig/buildProxyConfig already establish: a missing
// PageUrl/LinkSelector means there's nothing a discovery pass could
// meaningfully do yet, so the whole key is omitted rather than sent
// half-filled. MaxUrls falls back to the companion's own default (100,
// IR/DiscoveredUrlsConfig.cs) for an invalid/blank number input, the same
// way buildPaginationConfig's own MaxPages already does.
/**
 * @param {SFDraft.DiscoveredUrlsState | null | undefined} discoveredUrls
 * @returns {SFWire.DiscoveredUrlsConfig | null}
 */
function buildDiscoveredUrlsConfig(discoveredUrls) {
  if (!discoveredUrls?.enabled) return null;
  const pageUrl = (discoveredUrls.pageUrl || '').trim();
  const linkSelector = (discoveredUrls.linkSelector || '').trim();
  if (!pageUrl || !linkSelector) return null;
  const maxUrlsRaw = Number(discoveredUrls.maxUrls);
  const maxUrls = Number.isFinite(maxUrlsRaw) && maxUrlsRaw > 0 ? Math.floor(maxUrlsRaw) : 100;
  return { pageUrl, linkSelector, maxUrls };
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
/**
 * @param {SFDraft.HardeningState | null | undefined} hardening
 * @returns {SFWire.HardeningCheck[] | null}
 */
function buildHardeningConfig(hardening) {
  /** @type {SFWire.HardeningCheck[]} */
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
/**
 * @param {SFDraft.ChangeDetectionState | null | undefined} changeDetection
 * @param {SFDraft.HardeningState | null | undefined} hardening
 * @returns {boolean}
 */
function computeInitialMonitoringSectionOpen(changeDetection, hardening) {
  return buildChangeDetectionConfig(changeDetection) !== null || buildHardeningConfig(hardening) !== null;
}

// Issue #130: collects every leaf field name currently configured, across
// whichever mode/shape is active — feeds the NullRateCheck field picker in
// the hardening UI, reusing the exact field list the user already built
// instead of a second, free-text name input that could too easily drift out
// of sync with an actual (or renamed) field. Container mode's `groups` is
// still the live draft tree (GroupNode/DataFieldNode, `kind: 'group'|'field'`
// — see container-tree.ts); API mode's `apiConfig` is instead the *already
// serialized* wire object built once at API_CONFIG-confirm time, so its tree
// shape (if any) is discriminated structurally by `children` presence
// instead, the same way countApiConfigFields already reads it. Deduplicated
// (a tree can repeat the same field name at several nesting depths —
// NullRateCheck itself matches by name globally, see the companion-side doc
// comment on NullRateCheck) and order-preserving.
/**
 * @param {string} mode
 * @param {SFDraft.Field[] | null | undefined} fields
 * @param {SFDraft.ContainerNode[] | null | undefined} groups
 * @param {SFWire.ApiConfig | null | undefined} apiConfig
 * @returns {string[]}
 */
function collectFieldNames(mode, fields, groups, apiConfig) {
  /** @type {string[]} */
  const names = [];
  /** @param {string} name */
  const add = (name) => { if (name && !names.includes(name)) names.push(name); };

  if (mode === 'container') {
    /** @param {SFDraft.ContainerNode[] | undefined} nodes */
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.kind === 'field') add(node.name);
        else if (node.kind === 'group') walk(node.children);
      }
    };
    walk(groups || []);
  } else if (mode === 'api') {
    /** @param {SFWire.ApiNode[] | undefined} nodes */
    const walk = (nodes) => {
      for (const node of nodes || []) {
        const n = /** @type {any} */ (node);
        if (n.children) walk(n.children);
        else add(n.name);
      }
    };
    if (apiConfig?.groups) walk(apiConfig.groups);
    else for (const f of apiConfig?.fields || []) add(f.name);
  } else {
    for (const f of fields || []) add(f.name);
  }
  return names;
}

/**
 * Builds the /generate request body (and the `config` of an export) from the popup state. Only `url` and `mode` are required; an absent or
 * default value leaves its key out, so a bare state gives the minimal body. The companion stays the source of truth for forced defaults
 * (output format per shape, Engine.Api, ...). Only the slice matching `mode` (fields / groups / apiConfig / combinedComponents / blocks) is read.
 * @param {SFDraft.ConfigBuildOptions} options
 * @returns {object}
 */
function buildScrapingConfig({
  url, mode, fields = [], groups = [], apiConfig = null, scriptFileName = null, outputFileName = null,
  engine = 'Static', browserActions = [], includePreview = false, useJsonOutput = false,
  additionalUrls = [], changeDetection = null, proxy = null, hardening = null, pagination = null,
  persistentSession = false, includeOutputFile = false, externalConfig = false, combinedComponents = null,
  blocks = null, outputBlueprint = {}, discoveredUrls = null, preflight = false, requestDelay = null,
  retry = null, deduplication = null, requestHeaders = null, respectRobotsDelay = false,
  skipVerification = false, robotsDisallow = null, appendOutput = false,
}) {
  const {
    id: outputBlueprintId = null, schemaKind: outputBlueprintSchemaKind = 'Flat', fieldNames: outputBlueprintFieldNames = [],
    mapping: outputBlueprintMapping = {}, tree: outputBlueprintTree = [], treeMapping: outputBlueprintTreeMapping = {},
  } = outputBlueprint;
  /** @type {Record<string, unknown>} */
  const skipVerificationFields = skipVerification ? { skipVerification: true } : {};
  const respectRobotsFields = respectRobotsDelay ? { respectRobotsDelay: true } : {};
  // true / 'json' / 'sqlite' / 'xlsx'; anything else leaves the companion's per-shape default in charge.
  const tableOrJsonFormat = useJsonOutput === true || useJsonOutput === 'json' ? 'Json'
    : useJsonOutput === 'sqlite' ? 'Sqlite' : useJsonOutput === 'xlsx' ? 'Xlsx' : null;
  const requestDelayConfig = buildRequestDelayConfig(requestDelay);
  const requestDelayFields = requestDelayConfig ? { requestDelay: requestDelayConfig } : {};
  const robotsDisallowFields = robotsDisallow?.enabled ? { robotsDisallow: { action: robotsDisallow.action } } : {};
  const appendOutputFields = appendOutput ? { appendOutput: true } : {};
  // One spread for the pacing/robots/append settings: the object literals below are at TypeScript's union-complexity limit.
  /** @type {Record<string, unknown>} */
  const settingFields = { ...requestDelayFields, ...respectRobotsFields, ...robotsDisallowFields, ...appendOutputFields };
  const retryConfig = buildRetryConfig(retry);
  const retryFields = retryConfig ? { retry: retryConfig } : {};
  // Key fields no longer in the field list are dropped.
  const deduplicationConfig = buildDeduplicationConfig(deduplication, collectFieldNames(mode, fields, groups, apiConfig));
  const deduplicationFields = deduplicationConfig ? { deduplication: deduplicationConfig } : {};
  // DOM shapes only: API mode has its own header list inside apiConfig, Combined components carry theirs.
  const requestHeadersConfig = buildRequestHeadersConfig(requestHeaders);
  // A plain record: with this many optional spread groups TypeScript otherwise gives up on the union type (TS2590).
  /** @type {Record<string, unknown>} */
  const requestHeadersFields = requestHeadersConfig ? { headers: requestHeadersConfig } : {};
  // Blocks mode: each block is sent verbatim and shares this request's url/engine/proxy/pagination/persistentSession. Per-block
  // changeDetection/hardening have no UI yet; the companion rejects them on the outer request.
  if (mode === 'blocks') {
    const engineFields = engine === 'Browser'
      ? { engine, ...(browserActions.length > 0 ? { browserActions: serializeBrowserActions(browserActions) } : {}) }
      : {};
    const previewFields = includePreview ? { includePreview: true } : {};
    const additionalUrlsFields = additionalUrls.length > 0 ? { additionalUrls } : {};
    const proxyConfig = buildProxyConfig(proxy);
    const proxyFields = proxyConfig ? { proxy: proxyConfig } : {};
    const paginationConfig = buildPaginationConfig(pagination);
    const paginationFields = paginationConfig ? { pagination: paginationConfig } : {};
    const persistentSessionFields = persistentSession ? { persistentSession: true } : {};
    const outputFileFields = includeOutputFile ? { includeOutputFile: true } : {};
    return {
      version: '1', url,
      blocks: (blocks || []).map(b => ({
        name: b.name || null,
        outputFileName: b.outputFileName || null,
        ...(b.shape === 'group'
          ? { groups: serializeGroupTree(/** @type {SFDraft.ContainerNode[]} */ (b.groups)) }
          : { fields: (b.fields || []).map(f => ({
              name: f.name, selector: f.selector, attribute: f.attribute ?? null,
              ...(f.framePath ? { framePath: f.framePath } : {}),
              ...(f.transforms && f.transforms.length > 0 ? { transforms: f.transforms } : {}),
            })) }),
      })),
      scriptFileName: scriptFileName || null,
      ...engineFields, ...previewFields, ...additionalUrlsFields,
      ...proxyFields, ...settingFields, ...retryFields, ...requestHeadersFields, ...paginationFields, ...persistentSessionFields, ...outputFileFields, ...skipVerificationFields,
    };
  }
  // Combined mode: each component is an already-resolved {name, config, savedConfigId}; the companion rejects every per-run
  // option on the outer request (a component's own config carries it), so they are ignored here.
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
      ...previewFields, ...outputFileFields, ...skipVerificationFields,
    };
  }

  const engineFields = engine === 'Browser'
    ? { engine, ...(browserActions.length > 0 ? { browserActions: serializeBrowserActions(browserActions) } : {}) }
    : {};
  const previewFields = includePreview ? { includePreview: true } : {};
  const outputFormatFields = tableOrJsonFormat ? { outputFormat: tableOrJsonFormat } : {};
  const additionalUrlsFields = additionalUrls.length > 0 ? { additionalUrls } : {};
  const changeDetectionConfig = buildChangeDetectionConfig(changeDetection);
  const changeDetectionFields = changeDetectionConfig ? { changeDetection: changeDetectionConfig } : {};
  const proxyConfig = buildProxyConfig(proxy);
  const proxyFields = proxyConfig ? { proxy: proxyConfig } : {};
  const hardeningConfig = buildHardeningConfig(hardening);
  const hardeningFields = hardeningConfig ? { hardening: hardeningConfig } : {};
  const paginationConfig = buildPaginationConfig(pagination);
  const paginationFields = paginationConfig ? { pagination: paginationConfig } : {};
  const discoveredUrlsConfig = buildDiscoveredUrlsConfig(discoveredUrls);
  const discoveredUrlsFields = discoveredUrlsConfig ? { discoveredUrls: discoveredUrlsConfig } : {};
  // Sent as-is rather than gated on the engine; the companion rejects the combination server-side.
  const persistentSessionFields = persistentSession ? { persistentSession: true } : {};
  const preflightFields = preflight ? { preflight: true } : {};
  const outputFileFields = includeOutputFile ? { includeOutputFile: true } : {};
  const externalConfigFields = externalConfig ? { externalConfig: true } : {};
  // Null (key omitted) until a blueprint is picked and its mapping is complete, so a no-op for Combined/Blocks too.
  const outputBlueprintConfig = buildOutputBlueprintMapping(
    outputBlueprintId, outputBlueprintSchemaKind, outputBlueprintFieldNames, outputBlueprintMapping,
    outputBlueprintTree, outputBlueprintTreeMapping,
  );
  const outputBlueprintFields = outputBlueprintConfig ? { outputBlueprint: outputBlueprintConfig } : {};

  if (mode === 'container') {
    return {
      version: '1', url, groups: serializeGroupTree(groups),
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields, ...settingFields, ...retryFields, ...deduplicationFields, ...requestHeadersFields, ...hardeningFields, ...paginationFields, ...discoveredUrlsFields, ...persistentSessionFields,
      ...preflightFields, ...outputFileFields, ...skipVerificationFields, ...externalConfigFields, ...outputBlueprintFields,
    };
  }
  if (mode === 'api') {
    return {
      version: '1', url, api: apiConfig,
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields, ...settingFields, ...retryFields, ...deduplicationFields, ...hardeningFields, ...paginationFields, ...discoveredUrlsFields, ...persistentSessionFields,
      ...preflightFields, ...outputFileFields, ...skipVerificationFields, ...externalConfigFields, ...outputBlueprintFields,
    };
  }
  return {
    version: '1',
    url,
    fields: fields.map(f => ({
      name: f.name, selector: f.selector, attribute: f.attribute ?? null,
      ...(f.framePath ? { framePath: f.framePath } : {}),
      ...(f.transforms && f.transforms.length > 0 ? { transforms: f.transforms } : {}),
      ...(f.download ? { download: true } : {}),
      ...(f.download && f.maxDownloadSizeBytes ? { maxDownloadSizeBytes: f.maxDownloadSizeBytes } : {}),
      ...(f.download && f.allowedContentTypes?.length > 0 ? { allowedContentTypes: f.allowedContentTypes } : {}),
      ...(f.hiddenFromOutput ? { hiddenFromOutput: true } : {}),
    })),
    outputFormat: tableOrJsonFormat ?? 'Csv',
    scriptFileName: scriptFileName || null,
    outputFileName: outputFileName || null,
    ...engineFields, ...previewFields, ...additionalUrlsFields, ...changeDetectionFields, ...proxyFields, ...settingFields, ...retryFields, ...deduplicationFields, ...requestHeadersFields,
    ...hardeningFields, ...paginationFields, ...discoveredUrlsFields, ...persistentSessionFields,
    ...preflightFields, ...outputFileFields, ...skipVerificationFields, ...externalConfigFields, ...outputBlueprintFields,
  };
}

// Wraps the exact wire config with export metadata, so a user hitting a selector problem can hand over one file that is, unwrapped, the
// request body /generate would receive. `manifest` is injected so this stays pure and testable.
/**
 * @param {SFDraft.ConfigExportOptions} options
 * @returns {{exportedAt: string, extensionVersion: string, config: object}}
 */
function buildConfigExport({ manifest = {}, ...options }) {
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: manifest.version || '?',
    config: buildScrapingConfig(options),
  };
}

// The one place that maps the popup state (and the cross-session global settings) to buildScrapingConfig's options, so generate(), "Save
// configuration" and "Export configuration" cannot drift apart. `overrides` wins: combinedComponents (resolved asynchronously by the
// caller), includeOutputFile (only a real run keeps the output file) and, for an export, manifest.
/**
 * @param {Record<string, any>} state the popup's _state
 * @param {{ includeDataPreview?: boolean, outputFormat?: boolean | string | null, includeOutputFile?: boolean, externalConfig?: boolean, skipVerification?: boolean }} globalSettings
 * @param {Partial<SFDraft.ConfigExportOptions>} [overrides]
 * @returns {SFDraft.ConfigExportOptions}
 */
function configOptionsFromState(state, globalSettings, overrides = {}) {
  return {
    url: state.url, mode: state.mode, fields: state.fields, groups: state.groups, apiConfig: state.apiConfig,
    scriptFileName: state.scriptFileName, outputFileName: state.outputFileName,
    engine: state.engine, browserActions: state.browserActions, persistentSession: state.persistentSession,
    additionalUrls: state.additionalStartUrls, pagination: state.pagination, discoveredUrls: state.discoveredUrls, preflight: state.preflight,
    changeDetection: state.changeDetection, proxy: state.proxy, hardening: state.hardening, requestDelay: state.requestDelay,
    retry: state.retry, deduplication: state.deduplication, requestHeaders: state.requestHeaders,
    respectRobotsDelay: state.respectRobotsDelay, robotsDisallow: state.robotsDisallow, appendOutput: state.appendOutput,
    blocks: state.blocks,
    outputBlueprint: {
      id: state.selectedOutputBlueprintId, schemaKind: state.selectedOutputBlueprintSchemaKind,
      fieldNames: state.selectedOutputBlueprintFieldNames, mapping: state.outputBlueprintMapping,
      tree: state.selectedOutputBlueprintTree, treeMapping: state.outputBlueprintTreeMapping,
    },
    includePreview: globalSettings.includeDataPreview, useJsonOutput: globalSettings.outputFormat,
    includeOutputFile: globalSettings.includeOutputFile, externalConfig: globalSettings.externalConfig,
    skipVerification: globalSettings.skipVerification,
    ...overrides,
  };
}

// Appends a flat field. `selector` may be null for a derived (combine / split) field. `extras` are the optional settings, each with the
// "off" default: attribute (null = text), download (+ its safety net), framePath, transforms; hiddenFromOutput is set only by the combine /
// split flow's "remove original field(s)" option (updateField).
/**
 * @param {SFDraft.Field[]} fields
 * @param {string} name
 * @param {string | null} selector
 * @param {{
 *   framePath?: string[] | null, transforms?: SFWire.FieldTransform[], attribute?: string | null, download?: boolean,
 *   maxDownloadSizeBytes?: number | null, allowedContentTypes?: string[], hiddenFromOutput?: boolean,
 * }} [extras]
 * @returns {SFDraft.Field[]}
 */
function addField(fields, name, selector, extras = {}) {
  const {
    framePath = null, transforms = [], attribute = null, download = false,
    maxDownloadSizeBytes = null, allowedContentTypes = [], hiddenFromOutput = false,
  } = extras;
  const isDownload = !!attribute && !!download;
  return [...fields, {
    name, selector, attribute: attribute || null, framePath: framePath || null,
    transforms: transforms.length > 0 ? transforms : null,
    download: isDownload,
    maxDownloadSizeBytes: isDownload ? (maxDownloadSizeBytes || null) : null,
    allowedContentTypes: isDownload && allowedContentTypes.length > 0 ? allowedContentTypes : [],
    hiddenFromOutput,
  }];
}

// Issue #206 follow-up: generic in-place field patch — same shape as
// updateBrowserAction below — used by the combine/split creation flow's own
// "remove original field(s)" checkbox to set hiddenFromOutput on the picked
// source fields without deleting them (their value is still needed for the
// new field's own combine/split transform to read).
/**
 * @param {SFDraft.Field[]} fields
 * @param {number} index
 * @param {Partial<SFDraft.Field>} patch
 * @returns {SFDraft.Field[]}
 */
function updateField(fields, index, patch) {
  return fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
}

// Issue #41/#42, Phase 5/6: browser actions (WaitFor/Fill/Click/Scroll,
// executed in order before extraction) — same pure add/remove/update shape
// as addField/removeField above, so setState() callers stay trivial.
// MaxIterations/WaitAfterMs default to the same values ScrollStep itself
// defaults to server-side (IR/ScrapingStep.cs), kept in sync by hand.
/**
 * @param {SFDraft.BrowserAction[]} actions
 * @param {SFDraft.BrowserAction['kind']} kind
 * @returns {SFDraft.BrowserAction[]}
 */
function addBrowserAction(actions, kind) {
  /** @type {Record<SFDraft.BrowserAction['kind'], SFDraft.BrowserAction>} */
  const defaults = {
    waitFor: { kind: 'waitFor', selector: '', timeoutMs: 5000 },
    fill:    { kind: 'fill', selector: '', environmentVariableName: '' },
    // Issue #267: first match by default (the companion's own default too).
    click:   { kind: 'click', selector: '', target: 'first', waitAfterMs: 250 },
    // Issue #289: scrollStepPx stays null (keeping today's "jump straight
    // to the bottom" default) until the user explicitly types a value.
    scroll:  { kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: null },
  };
  return [...actions, defaults[kind]];
}

/**
 * @param {SFDraft.BrowserAction[]} actions
 * @param {number} index
 * @returns {SFDraft.BrowserAction[]}
 */
function removeBrowserAction(actions, index) {
  return actions.filter((_, i) => i !== index);
}

/**
 * @param {SFDraft.BrowserAction[]} actions
 * @param {number} index
 * @param {Partial<SFDraft.BrowserAction>} patch
 * @returns {SFDraft.BrowserAction[]}
 */
function updateBrowserAction(actions, index, patch) {
  return actions.map((a, i) => (i === index ? { ...a, ...patch } : a));
}

// Picks exactly the wire-relevant fields per kind (companion's BrowserAction
// variants, IR/BrowserAction.cs) — actions themselves are free to carry
// extra UI-only bookkeeping later without it leaking into the request body.
// ScrollStep's ContainerSelector/LoadMoreButtonSelector are nullable on the
// server, and "set but blank" is rejected (ScrapingPlanValidator) — an
// unpicked '' here must serialize to null, never ''.
/**
 * @param {SFDraft.BrowserAction[]} actions
 * @returns {SFWire.BrowserAction[]}
 */
function serializeBrowserActions(actions) {
  return actions.map((a) => {
    const framePath = a.framePath ? { framePath: a.framePath } : {};
    const selector = /** @type {string} */ (a.selector);
    if (a.kind === 'waitFor') return { kind: 'waitFor', selector, timeoutMs: a.timeoutMs, ...framePath };
    if (a.kind === 'fill') {
      return {
        kind: 'fill', selector,
        environmentVariableName: /** @type {string} */ (a.environmentVariableName),
        ...framePath,
      };
    }
    if (a.kind === 'scroll') {
      return {
        kind: 'scroll',
        containerSelector: a.containerSelector || null,
        loadMoreButtonSelector: a.loadMoreButtonSelector || null,
        maxIterations: a.maxIterations,
        waitAfterMs: a.waitAfterMs,
        // Issue #289: omitted (not 0/null) when unset — None is the
        // runtime's own "jump straight to the bottom" default.
        ...(a.scrollStepPx ? { scrollStepPx: a.scrollStepPx } : {}),
        ...framePath,
      };
    }
    // Issue #267: target/waitAfterMs only when they differ from the
    // companion's defaults (First / only used for All).
    const target = a.target === 'last' ? 'Last' : a.target === 'all' ? 'All' : null;
    return {
      kind: 'click', selector,
      ...(target ? { target } : {}),
      ...(target === 'All' ? { waitAfterMs: a.waitAfterMs ?? 250 } : {}),
      ...framePath,
    };
  });
}

// Issue #43: bundles fillTestValues into the wire dict /generate expects,
// keyed by FillAction.environmentVariableName — the same join key the wire
// FillAction itself carries. Never touches buildScrapingConfig or
// persistState. Returns {} when there's nothing to send (e.g. no test values
// typed, or no fill actions at all).
/**
 * @param {SFDraft.BrowserAction[]} browserActions
 * @param {Record<string, string>} fillTestValues
 * @returns {Record<string, string>}
 */
function buildVerificationValues(browserActions, fillTestValues) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const action of browserActions) {
    if (action.kind !== 'fill') continue;
    const name = action.environmentVariableName?.trim();
    const value = name ? fillTestValues[name] : null;
    if (name && value) result[name] = value;
  }
  return result;
}

/**
 * @param {SFDraft.Field[]} fields
 * @param {number} index
 * @returns {SFDraft.Field[]}
 */
function removeField(fields, index) {
  return fields.filter((_, i) => i !== index);
}

// Issue #130: same pure add/remove/update shape as addBrowserAction/
// removeBrowserAction/updateBrowserAction below, for _state.hardening.
// nullRate rows. threshold defaults to 50 (%) — an arbitrary but reasonable
// starting point, the same role addBrowserAction's own kind-specific
// defaults play.
/**
 * @param {SFDraft.NullRateRow[]} nullRate
 * @param {string} fieldName
 * @returns {SFDraft.NullRateRow[]}
 */
function addNullRateCheck(nullRate, fieldName) {
  return [...nullRate, { fieldName: fieldName || '', threshold: 50, severity: /** @type {SFWire.HardeningSeverity} */ ('Warning') }];
}

/**
 * @param {SFDraft.NullRateRow[]} nullRate
 * @param {number} index
 * @returns {SFDraft.NullRateRow[]}
 */
function removeNullRateCheck(nullRate, index) {
  return nullRate.filter((_, i) => i !== index);
}

/**
 * @param {SFDraft.NullRateRow[]} nullRate
 * @param {number} index
 * @param {Partial<SFDraft.NullRateRow>} patch
 * @returns {SFDraft.NullRateRow[]}
 */
function updateNullRateCheck(nullRate, index, patch) {
  return nullRate.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

// Issue #133: unlike nullRate's rows (each its own draft object with a
// field/threshold/severity), requiredFields.fields is just a plain array of
// already-chosen field names — there's nothing else to configure per entry,
// so no updateRequiredField counterpart exists. A duplicate add is a no-op
// rather than an error, mirroring how the add-field <select> below is
// itself already filtered to exclude already-added names.
/**
 * @param {string[]} fields
 * @param {string} fieldName
 * @returns {string[]}
 */
function addRequiredField(fields, fieldName) {
  if (!fieldName || fields.includes(fieldName)) return fields;
  return [...fields, fieldName];
}

/**
 * @param {string[]} fields
 * @param {number} index
 * @returns {string[]}
 */
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
/**
 * @param {string[] | null | undefined} framePath
 * @returns {string}
 */
function frameBadgeHtml(framePath) {
  if (!framePath || framePath.length === 0) return '';
  const title = escapeHtml(t('frame.badgeTitle', { path: framePath.join(' > ') }));
  return `<span class="frame-badge" title="${title}">${escapeHtml(t('frame.badge'))}</span>`;
}

module.exports = {sanitizeFileNameBase, deriveScriptFileNameFromHostname, computeScriptFileNamePatch, parseAdditionalUrls,
  buildChangeDetectionConfig, buildProxyConfig, buildRequestDelayConfig, buildRetryConfig, buildPaginationConfig, buildDiscoveredUrlsConfig, buildHardeningConfig,
  computeInitialMonitoringSectionOpen, collectFieldNames,
  buildScrapingConfig, buildConfigExport, configOptionsFromState,
  addField, removeField, updateField,
  addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions,
  buildVerificationValues,
  addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
  addRequiredField, removeRequiredField,
  frameBadgeHtml,};

