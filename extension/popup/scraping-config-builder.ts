// Pure scraping-config builder functions, extracted from popup.ts: every function is a data transformation with no DOM or state access,
// plain values in, plain values out (see scraping-config-builder.test.js). Inputs are typed against the popup's draft shapes (SFDraft),
// outputs against the wire format (SFWire).
import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';
import { escapeHtml } from './dom';
import { t } from '../i18n/i18n';
import { serializeGroupTree } from './container-tree';
import { buildOutputBlueprintMapping } from './output-blueprints';
import { buildDeduplicationConfig } from './dedup-config';
import { buildRequestHeadersConfig } from './request-headers';

/** The options of buildScrapingConfig (the /generate request body); only `url` and `mode` are required. */
export interface ConfigBuildOptions {
  url: string;
  /** 'flat' | 'container' | 'api' | 'combined' | 'blocks'. Only the slice below that matches the mode is read. */
  mode: string;
  fields?: SFDraft.Field[];
  groups?: SFDraft.ContainerNode[];
  apiConfig?: SFWire.ApiConfig | null;
  combinedComponents?: SFDraft.CombinedComponent[] | null;
  blocks?: SFDraft.Block[] | null;

  engine?: SFWire.ScrapingEngine;
  browserActions?: SFDraft.BrowserAction[];
  persistentSession?: boolean;
  additionalUrls?: string[];
  pagination?: SFDraft.PaginationState | null;
  discoveredUrls?: SFDraft.DiscoveredUrlsState | null;
  preflight?: boolean;

  scriptFileName?: string | null;
  outputFileName?: string | null;
  /** true / 'json' -> Json, 'sqlite' -> Sqlite, 'xlsx' -> Xlsx; anything else leaves the companion's per-shape default. */
  useJsonOutput?: boolean | string | null;
  outputBlueprint?: OutputBlueprintOptions;

  changeDetection?: SFDraft.ChangeDetectionState | null;
  hardening?: SFDraft.HardeningState | null;
  proxy?: SFDraft.ProxyState | null;
  requestDelay?: SFDraft.RequestDelayState | null;
  retry?: SFDraft.RetryState | null;
  respectRobotsDelay?: boolean;
  robotsDisallow?: SFDraft.RobotsDisallowState | null;
  deduplication?: SFDraft.DeduplicationState | null;
  requestHeaders?: SFDraft.RequestHeadersState | null;
  appendOutput?: boolean;

  includePreview?: boolean;
  includeOutputFile?: boolean;
  externalConfig?: boolean;
  skipVerification?: boolean;
}

/** The blueprint part of ConfigBuildOptions; `schemaKind` picks which of fieldNames+mapping / tree+treeMapping counts. */
export interface OutputBlueprintOptions {
  id?: number | string | null;
  schemaKind?: SFWire.OutputBlueprintSchemaKind;
  fieldNames?: string[];
  mapping?: Record<string, string | null>;
  tree?: SFDraft.OutputBlueprintTreeNode[];
  treeMapping?: Record<string, string | null>;
}

/** buildConfigExport takes the same options plus the manifest (for the version). */
export interface ConfigExportOptions extends ConfigBuildOptions {
  manifest?: { version?: string };
}

/** The slice of the popup's `_state` that configOptionsFromState reads. */
export interface ConfigState {
  url: string;
  mode: string;
  fields: SFDraft.Field[];
  groups: SFDraft.ContainerNode[];
  apiConfig: SFWire.ApiConfig | null;
  scriptFileName: string;
  outputFileName: string;
  engine: SFWire.ScrapingEngine;
  browserActions: SFDraft.BrowserAction[];
  persistentSession: boolean;
  additionalStartUrls: string[];
  pagination: SFDraft.PaginationState;
  discoveredUrls: SFDraft.DiscoveredUrlsState;
  preflight: boolean;
  changeDetection: SFDraft.ChangeDetectionState;
  proxy: SFDraft.ProxyState;
  hardening: SFDraft.HardeningState;
  requestDelay: SFDraft.RequestDelayState;
  retry: SFDraft.RetryState;
  deduplication: SFDraft.DeduplicationState;
  requestHeaders: SFDraft.RequestHeadersState;
  respectRobotsDelay: boolean;
  robotsDisallow: SFDraft.RobotsDisallowState;
  appendOutput: boolean;
  blocks: SFDraft.Block[];
  selectedOutputBlueprintId: string;
  selectedOutputBlueprintSchemaKind?: SFWire.OutputBlueprintSchemaKind;
  selectedOutputBlueprintFieldNames: string[];
  outputBlueprintMapping: Record<string, string | null>;
  selectedOutputBlueprintTree?: SFDraft.OutputBlueprintTreeNode[];
  outputBlueprintTreeMapping?: Record<string, string | null>;
}

/** The cross-session global settings that end up in the request. */
export interface ConfigGlobalSettings {
  includeDataPreview?: boolean;
  outputFormat?: boolean | string | null;
  includeOutputFile?: boolean;
  externalConfig?: boolean;
  skipVerification?: boolean;
}

// ── Pure functions (exported for testing) ────────────────────────────────────

/**
 * Mirrors the companion's FileNameSanitizer (ScrapingFactory.Compiler/IR/FileNameSanitizer.cs): the name shown here, used for the actual
 * download, must match what the companion baked into the script's "# Run: python X.py" comment. test-vectors/file-name-sanitizer.json
 * pins both.
 */
export function sanitizeFileNameBase(input: string, fallback: string): string {
  if (!input || !input.trim()) return fallback;
  const sanitized = input.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[-_]+|[-_]+$/g, '');
  return sanitized || fallback;
}

/**
 * A sanitized script-name base from a URL's hostname, for the "always from the website" script-name mode. A malformed or relative `url`
 * falls back to `fallback` (new URL() throws instead of returning something sanitizeFileNameBase could clean up).
 */
export function deriveScriptFileNameFromHostname(url: string, fallback: string): string {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // hostname stays '' and sanitizeFileNameBase falls back
  }
  return sanitizeFileNameBase(hostname, fallback);
}

/**
 * The scriptFileName patch to apply whenever a fresh site is detected (the health check, the stale-tracked-URL self-correction),
 * shared by every call site. In 'hostname' mode the name is always recomputed, tracking the current site; in 'fixed' mode it is only
 * filled while still blank, so a manual edit is never overwritten. {} when neither applies.
 */
export function computeScriptFileNamePatch(
  currentScriptFileName: string, url: string, globalSettings: SFDraft.GlobalSettings,
): { scriptFileName?: string } {
  if (globalSettings.scriptNameMode === 'hostname') {
    return { scriptFileName: deriveScriptFileNameFromHostname(url, globalSettings.scriptNameFixed) };
  }
  if (!currentScriptFileName) {
    return { scriptFileName: globalSettings.scriptNameFixed };
  }
  return {};
}

/**
 * One URL per line from the additional-start-urls textarea. Blank lines are a formatting artifact and dropped; a genuinely malformed
 * non-blank entry is left as it is and rejected by the companion like a malformed primary `url`.
 */
export function parseAdditionalUrls(text: string): string[] {
  return (text || '').split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

/**
 * The wire ChangeDetectionConfig, or null when disabled or not fully configured (a required env-var-name field left blank): an
 * incomplete draft is treated like the toggle being off instead of sending a config the companion would reject. Every field is an
 * environment-variable *name*, never a value.
 */
export function buildChangeDetectionConfig(changeDetection: SFDraft.ChangeDetectionState | null | undefined): SFWire.ChangeDetectionConfig | null {
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

/** The wire ProxyConfig, or null when disabled or the env-var name is blank. The field is a variable *name*, never a proxy address. */
export function buildProxyConfig(proxy: SFDraft.ProxyState | null | undefined): SFWire.ProxyConfig | null {
  if (!proxy?.enabled) return null;
  const environmentVariableName = (proxy.envVar || '').trim();
  return environmentVariableName ? { environmentVariableName } : null;
}

const REQUEST_DELAY_MAX_MS = 60000;

/** Seconds as typed ("1,5" and "1.5" both work) to milliseconds, clamped to 60 s like RequestDelayConfig.MaxAllowedMs; null when unusable. */
function parseSecondsToMs(text: string | null | undefined): number | null {
  const normalized = String(text ?? '').trim().replace(',', '.');
  if (normalized === '') return null;
  const seconds = Number(normalized);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.round(seconds * 1000), REQUEST_DELAY_MAX_MS) : null;
}

/**
 * The wire RequestDelayConfig in milliseconds, or null when disabled or "from" is not a usable number. A blank "to" means a fixed pause,
 * a "to" below "from" is raised to it, so a stray value never turns into a 400 from /generate.
 */
export function buildRequestDelayConfig(requestDelay: SFDraft.RequestDelayState | null | undefined): SFWire.RequestDelayConfig | null {
  if (!requestDelay?.enabled) return null;
  const minMs = parseSecondsToMs(requestDelay.minSecondsText);
  if (minMs === null) return null;
  const maxMs = parseSecondsToMs(requestDelay.maxSecondsText);
  return { minMs, maxMs: maxMs === null ? minMs : Math.max(minMs, maxMs) };
}

const RETRY_DEFAULT_ATTEMPTS = 3;
const RETRY_DEFAULT_DELAY_MS = 2000;

/**
 * The wire RetryConfig, or null when disabled. There is no "incomplete means off" case: every blank or unusable input falls back to its
 * default (3 attempts, 2 s, the companion's status-code list), attempts and delay are clamped to RetryConfig's bounds (2-10 attempts,
 * 0-60 s), so a stray value never becomes a 400. Status codes accept any separator; only 400-599 are kept, deduplicated, and an empty
 * result is omitted so the companion's default list applies.
 */
export function buildRetryConfig(retry: SFDraft.RetryState | null | undefined): SFWire.RetryConfig | null {
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

/**
 * The wire PaginationConfig, or null when disabled or the kind's required field (nextLinkSelector / urlTemplate) is blank. maxPages is
 * clamped and defaulted so a cleared number input does not block generation.
 */
export function buildPaginationConfig(pagination: SFDraft.PaginationState | null | undefined): SFWire.PaginationConfig | null {
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

/**
 * The wire DiscoveredUrlsConfig, or null when disabled or PageUrl / LinkSelector is blank (nothing a discovery pass could do yet).
 * MaxUrls falls back to the companion's default (100) for an invalid number input.
 */
export function buildDiscoveredUrlsConfig(discoveredUrls: SFDraft.DiscoveredUrlsState | null | undefined): SFWire.DiscoveredUrlsConfig | null {
  if (!discoveredUrls?.enabled) return null;
  const pageUrl = (discoveredUrls.pageUrl || '').trim();
  const linkSelector = (discoveredUrls.linkSelector || '').trim();
  if (!pageUrl || !linkSelector) return null;
  const maxUrlsRaw = Number(discoveredUrls.maxUrls);
  const maxUrls = Number.isFinite(maxUrlsRaw) && maxUrlsRaw > 0 ? Math.floor(maxUrlsRaw) : 100;
  return { pageUrl, linkSelector, maxUrls };
}

/**
 * The wire Hardening list from every enabled check in _state.hardening, or null (not []) when nothing is enabled. `kind` is the camelCase
 * discriminator the companion's [JsonDerivedType] expects (like FieldTransform's kinds), unlike the PascalCase `severity` enum.
 */
export function buildHardeningConfig(hardening: SFDraft.HardeningState | null | undefined): SFWire.HardeningCheck[] | null {
  const checks: SFWire.HardeningCheck[] = [];
  if (hardening?.noResult?.enabled) {
    checks.push({ kind: 'noResult', severity: hardening.noResult.severity });
  }
  // A null-rate row with no field chosen yet is skipped instead of blocking generation. The threshold is a whole percent in the UI,
  // divided by 100 for the wire's 0.0-1.0 fraction, clamped and defaulted because a cleared number input can leave NaN or a value
  // out of range.
  for (const row of hardening?.nullRate || []) {
    const fieldName = (row.fieldName || '').trim();
    if (!fieldName) continue;
    const percent = Number.isFinite(row.threshold) ? row.threshold : 50;
    const threshold = Math.min(100, Math.max(0, percent)) / 100;
    checks.push({ kind: 'nullRate', severity: row.severity, fieldName, threshold });
  }
  // The baseline check is a single object (one result count to track); an invalid percent is clamped to its default instead of
  // skipping the check, as there is no "which field" completeness gate.
  if (hardening?.baseline?.enabled) {
    const percent = Number.isFinite(hardening.baseline.dropThresholdPercent) ? hardening.baseline.dropThresholdPercent : 20;
    const dropThreshold = Math.min(100, Math.max(0, percent)) / 100;
    checks.push({ kind: 'baseline', severity: hardening.baseline.severity, dropThreshold });
  }
  // Blocking: a blank or invalid min body length simply omits the signal (there is no meaningful default); the cross-origin-redirect
  // signal is always active, so a check with neither option is still valid. Phrases are one per line (not comma-split: a phrase such as
  // "Please verify you are human" may contain a comma); blank lines are dropped.
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
  // Required fields: an enabled check with no field picked is skipped, as ScrapingPlanValidator rejects an empty list.
  if (hardening?.requiredFields?.enabled && hardening.requiredFields.fields.length > 0) {
    checks.push({ kind: 'requiredFields', severity: hardening.requiredFields.severity, fieldNames: hardening.requiredFields.fields });
  }
  return checks.length > 0 ? checks : null;
}

/**
 * Whether the "Monitoring" section (change detection + hardening) should start expanded: for a returning user who already configured
 * something in it. Reuses the builders' own "does this produce a wire config" logic so the two cannot disagree about "configured".
 */
export function computeInitialMonitoringSectionOpen(
  changeDetection: SFDraft.ChangeDetectionState | null | undefined, hardening: SFDraft.HardeningState | null | undefined,
): boolean {
  return buildChangeDetectionConfig(changeDetection) !== null || buildHardeningConfig(hardening) !== null;
}

/**
 * Every leaf field name currently configured, across the active mode and shape, deduplicated and in order: feeds the null-rate field
 * picker. Container mode's `groups` is the live draft tree (`kind: 'group'|'field'`); API mode's `apiConfig` is the already-serialized
 * wire object, whose tree shape is told apart by `children` presence (as countApiConfigFields does).
 */
export function collectFieldNames(
  mode: string, fields: SFDraft.Field[] | null | undefined, groups: SFDraft.ContainerNode[] | null | undefined,
  apiConfig: SFWire.ApiConfig | null | undefined,
): string[] {
  const names: string[] = [];
  const add = (name: string) => { if (name && !names.includes(name)) names.push(name); };

  if (mode === 'container') {
    const walk = (nodes: SFDraft.ContainerNode[] | undefined) => {
      for (const node of nodes || []) {
        if (node.kind === 'field') add(node.name);
        else if (node.kind === 'group') walk(node.children);
      }
    };
    walk(groups || []);
  } else if (mode === 'api') {
    const walk = (nodes: SFWire.ApiNode[] | undefined) => {
      for (const node of nodes || []) {
        if ('children' in node && node.children) walk(node.children);
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

type WireFields = Partial<SFWire.ScrapingConfig>;

/**
 * Builds the /generate request body (and the `config` of an export) from the popup state. Only `url` and `mode` are required; an absent or
 * default value leaves its key out, so a bare state gives the minimal body. The companion stays the source of truth for forced defaults
 * (output format per shape, Engine.Api, ...). Only the slice matching `mode` (fields / groups / apiConfig / combinedComponents / blocks) is read.
 */
export function buildScrapingConfig({
  url, mode, fields = [], groups = [], apiConfig = null, scriptFileName = null, outputFileName = null,
  engine = 'Static', browserActions = [], includePreview = false, useJsonOutput = false,
  additionalUrls = [], changeDetection = null, proxy = null, hardening = null, pagination = null,
  persistentSession = false, includeOutputFile = false, externalConfig = false, combinedComponents = null,
  blocks = null, outputBlueprint = {}, discoveredUrls = null, preflight = false, requestDelay = null,
  retry = null, deduplication = null, requestHeaders = null, respectRobotsDelay = false,
  skipVerification = false, robotsDisallow = null, appendOutput = false,
}: ConfigBuildOptions): SFWire.ScrapingConfig {
  const {
    id: outputBlueprintId = null, schemaKind: outputBlueprintSchemaKind = 'Flat', fieldNames: outputBlueprintFieldNames = [],
    mapping: outputBlueprintMapping = {}, tree: outputBlueprintTree = [], treeMapping: outputBlueprintTreeMapping = {},
  } = outputBlueprint;
  const skipVerificationFields: WireFields = skipVerification ? { skipVerification: true } : {};
  const respectRobotsFields: WireFields = respectRobotsDelay ? { respectRobotsDelay: true } : {};
  // true / 'json' / 'sqlite' / 'xlsx'; anything else leaves the companion's per-shape default in charge.
  const tableOrJsonFormat: SFWire.OutputFormat | null = useJsonOutput === true || useJsonOutput === 'json' ? 'Json'
    : useJsonOutput === 'sqlite' ? 'Sqlite' : useJsonOutput === 'xlsx' ? 'Xlsx' : null;
  const requestDelayConfig = buildRequestDelayConfig(requestDelay);
  const requestDelayFields: WireFields = requestDelayConfig ? { requestDelay: requestDelayConfig } : {};
  const robotsDisallowFields: WireFields = robotsDisallow?.enabled ? { robotsDisallow: { action: robotsDisallow.action } } : {};
  const appendOutputFields: WireFields = appendOutput ? { appendOutput: true } : {};
  const settingFields: WireFields = { ...requestDelayFields, ...respectRobotsFields, ...robotsDisallowFields, ...appendOutputFields };
  const retryConfig = buildRetryConfig(retry);
  const retryFields: WireFields = retryConfig ? { retry: retryConfig } : {};
  // Key fields no longer in the field list are dropped.
  const deduplicationConfig = buildDeduplicationConfig(deduplication, collectFieldNames(mode, fields, groups, apiConfig));
  const deduplicationFields: WireFields = deduplicationConfig ? { deduplication: deduplicationConfig } : {};
  // DOM shapes only: API mode has its own header list inside apiConfig, Combined components carry theirs.
  const requestHeadersConfig = buildRequestHeadersConfig(requestHeaders);
  const requestHeadersFields: WireFields = requestHeadersConfig ? { headers: requestHeadersConfig } : {};
  // Blocks mode: each block is sent verbatim and shares this request's url/engine/proxy/pagination/persistentSession. Per-block
  // changeDetection/hardening have no UI yet; the companion rejects them on the outer request.
  if (mode === 'blocks') {
    const engineFields: WireFields = engine === 'Browser'
      ? { engine, ...(browserActions.length > 0 ? { browserActions: serializeBrowserActions(browserActions) } : {}) }
      : {};
    const previewFields: WireFields = includePreview ? { includePreview: true } : {};
    const additionalUrlsFields: WireFields = additionalUrls.length > 0 ? { additionalUrls } : {};
    const proxyConfig = buildProxyConfig(proxy);
    const proxyFields: WireFields = proxyConfig ? { proxy: proxyConfig } : {};
    const paginationConfig = buildPaginationConfig(pagination);
    const paginationFields: WireFields = paginationConfig ? { pagination: paginationConfig } : {};
    const persistentSessionFields: WireFields = persistentSession ? { persistentSession: true } : {};
    const outputFileFields: WireFields = includeOutputFile ? { includeOutputFile: true } : {};
    return {
      version: '1', url,
      blocks: (blocks || []).map((b): SFWire.ExtractionBlockConfig => ({
        name: b.name || null,
        outputFileName: b.outputFileName || null,
        ...(b.shape === 'group'
          ? { groups: serializeGroupTree(b.groups as SFDraft.ContainerNode[]) }
          : { fields: (b.fields || []).map((f): SFWire.ScrapingField => ({
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
    const previewFields: WireFields = includePreview ? { includePreview: true } : {};
    const outputFileFields: WireFields = includeOutputFile ? { includeOutputFile: true } : {};
    return {
      version: '1', url,
      combined: (combinedComponents || []).map((c): SFWire.CombinedComponentConfig => ({
        name: c.name, config: c.config,
        ...(c.savedConfigId ? { savedConfigId: c.savedConfigId } : {}),
      })),
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...previewFields, ...outputFileFields, ...skipVerificationFields,
    };
  }

  const engineFields: WireFields = engine === 'Browser'
    ? { engine, ...(browserActions.length > 0 ? { browserActions: serializeBrowserActions(browserActions) } : {}) }
    : {};
  const previewFields: WireFields = includePreview ? { includePreview: true } : {};
  const outputFormatFields: WireFields = tableOrJsonFormat ? { outputFormat: tableOrJsonFormat } : {};
  const additionalUrlsFields: WireFields = additionalUrls.length > 0 ? { additionalUrls } : {};
  const changeDetectionConfig = buildChangeDetectionConfig(changeDetection);
  const changeDetectionFields: WireFields = changeDetectionConfig ? { changeDetection: changeDetectionConfig } : {};
  const proxyConfig = buildProxyConfig(proxy);
  const proxyFields: WireFields = proxyConfig ? { proxy: proxyConfig } : {};
  const hardeningConfig = buildHardeningConfig(hardening);
  const hardeningFields: WireFields = hardeningConfig ? { hardening: hardeningConfig } : {};
  const paginationConfig = buildPaginationConfig(pagination);
  const paginationFields: WireFields = paginationConfig ? { pagination: paginationConfig } : {};
  const discoveredUrlsConfig = buildDiscoveredUrlsConfig(discoveredUrls);
  const discoveredUrlsFields: WireFields = discoveredUrlsConfig ? { discoveredUrls: discoveredUrlsConfig } : {};
  // Sent as-is rather than gated on the engine; the companion rejects the combination server-side.
  const persistentSessionFields: WireFields = persistentSession ? { persistentSession: true } : {};
  const preflightFields: WireFields = preflight ? { preflight: true } : {};
  const outputFileFields: WireFields = includeOutputFile ? { includeOutputFile: true } : {};
  const externalConfigFields: WireFields = externalConfig ? { externalConfig: true } : {};
  // Null (key omitted) until a blueprint is picked and its mapping is complete, so a no-op for Combined/Blocks too.
  const outputBlueprintConfig = buildOutputBlueprintMapping(
    outputBlueprintId, outputBlueprintSchemaKind, outputBlueprintFieldNames, outputBlueprintMapping,
    outputBlueprintTree, outputBlueprintTreeMapping,
  );
  const outputBlueprintFields: WireFields = outputBlueprintConfig ? { outputBlueprint: outputBlueprintConfig } : {};

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
      version: '1', url, api: apiConfig ?? undefined,
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields, ...settingFields, ...retryFields, ...deduplicationFields, ...hardeningFields, ...paginationFields, ...discoveredUrlsFields, ...persistentSessionFields,
      ...preflightFields, ...outputFileFields, ...skipVerificationFields, ...externalConfigFields, ...outputBlueprintFields,
    };
  }
  return {
    version: '1',
    url,
    fields: fields.map((f): SFWire.ScrapingField => ({
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

/**
 * Wraps the exact wire config with export metadata, so a user hitting a selector problem can hand over one file that is, unwrapped, the
 * request body /generate would receive. `manifest` is injected so this stays pure and testable.
 */
export function buildConfigExport({ manifest = {}, ...options }: ConfigExportOptions): { exportedAt: string; extensionVersion: string; config: SFWire.ScrapingConfig } {
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: manifest.version || '?',
    config: buildScrapingConfig(options),
  };
}

/**
 * The one place that maps the popup state (and the cross-session global settings) to buildScrapingConfig's options, so generate(), "Save
 * configuration" and "Export configuration" cannot drift apart. `overrides` wins: combinedComponents (resolved asynchronously by the
 * caller), includeOutputFile (only a real run keeps the output file) and, for an export, manifest.
 */
export function configOptionsFromState(
  state: ConfigState, globalSettings: ConfigGlobalSettings, overrides: Partial<ConfigExportOptions> = {},
): ConfigExportOptions {
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

interface FieldExtras {
  framePath?: string[] | null;
  transforms?: SFWire.FieldTransform[];
  attribute?: string | null;
  download?: boolean;
  maxDownloadSizeBytes?: number | null;
  allowedContentTypes?: string[];
  hiddenFromOutput?: boolean;
  sampleValue?: string | null;
}

/**
 * Appends a flat field. `selector` may be null for a derived (combine / split) field. `extras` are the optional settings, each with its
 * "off" default: attribute (null = text), download (+ its safety net), framePath, transforms; hiddenFromOutput is set only by the
 * combine / split flow's "remove original field(s)" option (updateField).
 */
export function addField(fields: SFDraft.Field[], name: string, selector: string | null, extras: FieldExtras = {}): SFDraft.Field[] {
  const {
    framePath = null, transforms = [], attribute = null, download = false,
    maxDownloadSizeBytes = null, allowedContentTypes = [], hiddenFromOutput = false, sampleValue = null,
  } = extras;
  const isDownload = !!attribute && !!download;
  return [...fields, {
    name, selector, attribute: attribute || null, framePath: framePath || null,
    transforms: transforms.length > 0 ? transforms : null,
    download: isDownload,
    maxDownloadSizeBytes: isDownload ? (maxDownloadSizeBytes || null) : null,
    allowedContentTypes: isDownload && allowedContentTypes.length > 0 ? allowedContentTypes : [],
    hiddenFromOutput,
    ...(sampleValue !== null ? { sampleValue } : {}),
  }];
}

/** Generic in-place field patch, used by the combine/split flow to set hiddenFromOutput on the source fields without deleting them. */
export function updateField(fields: SFDraft.Field[], index: number, patch: Partial<SFDraft.Field>): SFDraft.Field[] {
  return fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
}

/**
 * Browser actions (WaitFor/Fill/Click/Scroll, executed in order before extraction): the same pure add/remove/update shape as addField.
 * MaxIterations/WaitAfterMs default to what ScrollStep defaults to server-side (IR/ScrapingStep.cs), kept in sync by hand.
 */
export function addBrowserAction(actions: SFDraft.BrowserAction[], kind: SFDraft.BrowserAction['kind']): SFDraft.BrowserAction[] {
  const defaults: Record<SFDraft.BrowserAction['kind'], SFDraft.BrowserAction> = {
    waitFor: { kind: 'waitFor', selector: '', timeoutMs: 5000 },
    fill:    { kind: 'fill', selector: '', environmentVariableName: '' },
    // First match by default (the companion's own default too).
    click:   { kind: 'click', selector: '', target: 'first', waitAfterMs: 250 },
    // scrollStepPx stays null (today's "jump straight to the bottom") until the user types a value.
    scroll:  { kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: null },
  };
  return [...actions, defaults[kind]];
}

export function removeBrowserAction(actions: SFDraft.BrowserAction[], index: number): SFDraft.BrowserAction[] {
  return actions.filter((_, i) => i !== index);
}

export function updateBrowserAction(actions: SFDraft.BrowserAction[], index: number, patch: Partial<SFDraft.BrowserAction>): SFDraft.BrowserAction[] {
  return actions.map((a, i) => (i === index ? { ...a, ...patch } : a));
}

/**
 * Picks exactly the wire-relevant fields per kind (the companion's BrowserAction variants, IR/BrowserAction.cs), so a UI-only field on an
 * action never leaks into the request body. ScrollStep's ContainerSelector/LoadMoreButtonSelector are nullable on the server and "set but
 * blank" is rejected (ScrapingPlanValidator): an unpicked '' must serialize to null.
 */
export function serializeBrowserActions(actions: SFDraft.BrowserAction[]): SFWire.BrowserAction[] {
  return actions.map((a): SFWire.BrowserAction => {
    const framePath = a.framePath ? { framePath: a.framePath } : {};
    const selector = a.selector as string;
    if (a.kind === 'waitFor') return { kind: 'waitFor', selector, timeoutMs: a.timeoutMs, ...framePath };
    if (a.kind === 'fill') {
      return {
        kind: 'fill', selector,
        environmentVariableName: a.environmentVariableName as string,
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
        // Omitted (not 0/null) when unset: None is the runtime's own "jump straight to the bottom" default.
        ...(a.scrollStepPx ? { scrollStepPx: a.scrollStepPx } : {}),
        ...framePath,
      };
    }
    // target/waitAfterMs only when they differ from the companion's defaults (First / only used for All).
    const target = a.target === 'last' ? 'Last' : a.target === 'all' ? 'All' : null;
    return {
      kind: 'click', selector,
      ...(target ? { target } : {}),
      ...(target === 'All' ? { waitAfterMs: a.waitAfterMs ?? 250 } : {}),
      ...framePath,
    };
  });
}

/**
 * Bundles fillTestValues into the wire dict /generate expects, keyed by FillAction.environmentVariableName (the join key the wire action
 * carries). Never touches buildScrapingConfig or persistState. {} when there is nothing to send.
 */
export function buildVerificationValues(browserActions: SFDraft.BrowserAction[], fillTestValues: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const action of browserActions) {
    if (action.kind !== 'fill') continue;
    const name = action.environmentVariableName?.trim();
    const value = name ? fillTestValues[name] : null;
    if (name && value) result[name] = value;
  }
  return result;
}

export function removeField(fields: SFDraft.Field[], index: number): SFDraft.Field[] {
  return fields.filter((_, i) => i !== index);
}

/** Null-rate hardening rows: the same pure add/remove/update shape as the browser actions. The threshold starts at 50 (%). */
export function addNullRateCheck(nullRate: SFDraft.NullRateRow[], fieldName: string): SFDraft.NullRateRow[] {
  return [...nullRate, { fieldName: fieldName || '', threshold: 50, severity: 'Warning' }];
}

export function removeNullRateCheck(nullRate: SFDraft.NullRateRow[], index: number): SFDraft.NullRateRow[] {
  return nullRate.filter((_, i) => i !== index);
}

export function updateNullRateCheck(nullRate: SFDraft.NullRateRow[], index: number, patch: Partial<SFDraft.NullRateRow>): SFDraft.NullRateRow[] {
  return nullRate.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

/**
 * `requiredFields.fields` is a plain array of chosen names (nothing else to configure per entry, so there is no update counterpart). A
 * duplicate add is a no-op, mirroring the add-field <select> that already excludes added names.
 */
export function addRequiredField(fields: string[], fieldName: string): string[] {
  if (!fieldName || fields.includes(fieldName)) return fields;
  return [...fields, fieldName];
}

export function removeRequiredField(fields: string[], index: number): string[] {
  return fields.filter((_, i) => i !== index);
}

/**
 * A small pill shown next to a field's / node's / action's selector once a pick resolved a non-null framePath: the side panel's own,
 * translated indicator of what the content script's icon-only overlay badge could only hint at during selection. `path.join(' > ')`
 * matches the top-to-target reading order the backend documents on FramePath.
 */
export function frameBadgeHtml(framePath: string[] | null | undefined): string {
  if (!framePath || framePath.length === 0) return '';
  const title = escapeHtml(t('frame.badgeTitle', { path: framePath.join(' > ') }));
  return `<span class="frame-badge" title="${title}">${escapeHtml(t('frame.badge'))}</span>`;
}
