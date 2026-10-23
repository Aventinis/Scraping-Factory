// @ts-check
/** @import * as SFWire from '../types/wire' */
/** @import * as SFDraft from '../types/drafts' */
// Reverses buildScrapingConfig's wire output into a _state patch (the "Load" half of saved configurations). Pure and
// DOM-free. Inputs are typed against SFWire, the reconstructed draft shapes against SFDraft. applyConfigToState returns a
// loose `object`: it spans every mode's slice at once and no interface would describe the five exclusive branches; its
// per-branch helpers are typed precisely.
const { applyDeduplicationConfig } = require('./dedup-config');
const { applyRequestHeadersConfig } = require('./request-headers');

// Inverse of container-tree.js's FIELD_MODE_WIRE_NAMES, kept as its own copy for four constants.
/** @type {Record<SFWire.ExtractMode, string>} */
const FIELD_MODE_INTERNAL_NAMES = { Text: 'text', Attribute: 'attribute', Exists: 'exists', OwnText: 'ownText' };

// Reverse of container-tree.js's serializeGroupTree — a wire GroupNode is
// told apart from a DataFieldNode structurally (children present vs. not),
// exactly like the companion's own ContainerNodeJsonConverter.
/**
 * @param {SFWire.ContainerNode[] | null | undefined} wireNodes
 * @returns {object[]}
 */
function deserializeGroupTree(wireNodes) {
  return (wireNodes || []).map((node) => {
    // The structural discriminator of ContainerNodeJsonConverter (children present = group), read through an `any` view
    // instead of narrowing the union field by field.
    const n = /** @type {any} */ (node);
    return Array.isArray(n.children)
      ? {
          kind: 'group', name: n.name, selector: n.selector, repeating: !!n.repeating,
          children: deserializeGroupTree(n.children), framePath: n.framePath || null,
        }
      : {
          kind: 'field', name: n.name, selector: n.selector,
          mode: FIELD_MODE_INTERNAL_NAMES[/** @type {SFWire.ExtractMode} */ (n.mode)] || 'text',
          attribute: n.mode === 'Attribute' ? (n.attribute ?? null) : null,
          framePath: n.framePath || null,
          transforms: n.transforms && n.transforms.length > 0 ? n.transforms : null,
          // Issue #213: same "only meaningful under Attribute mode" gate
          // attribute itself already uses; absent on the wire = false.
          download: n.mode === 'Attribute' && !!n.download,
          // Issue #214: same gate as download itself.
          maxDownloadSizeBytes: n.mode === 'Attribute' && n.download ? (n.maxDownloadSizeBytes ?? null) : null,
          allowedContentTypes: n.mode === 'Attribute' && n.download ? (n.allowedContentTypes || []) : [],
          // Issue #206 follow-up: absent on the wire = false, same
          // convention as download itself.
          hiddenFromOutput: !!n.hiddenFromOutput,
        };
  });
}

// Reverse of popup.js's serializeBrowserActions — fills back in each
// kind's own defaults (mirroring addBrowserAction) for whichever fields
// a wire action of that kind doesn't carry.
/**
 * @param {SFWire.BrowserAction[] | null | undefined} wireActions
 * @returns {object[]}
 */
function deserializeBrowserActions(wireActions) {
  return (wireActions || []).map((a) => {
    const framePath = a.framePath || null;
    if (a.kind === 'waitFor') return { kind: 'waitFor', selector: a.selector || '', timeoutMs: a.timeoutMs ?? 5000, framePath };
    if (a.kind === 'fill') return { kind: 'fill', selector: a.selector || '', environmentVariableName: a.environmentVariableName || '', framePath };
    if (a.kind === 'scroll') {
      return {
        kind: 'scroll',
        containerSelector: a.containerSelector || '', loadMoreButtonSelector: a.loadMoreButtonSelector || '',
        maxIterations: a.maxIterations ?? 10, waitAfterMs: a.waitAfterMs ?? 1000, framePath,
      };
    }
    return {
      kind: 'click', selector: a.selector || '', framePath,
      target: String(a.target || 'first').toLowerCase() === 'all' ? 'all' : String(a.target || '').toLowerCase() === 'last' ? 'last' : 'first',
      waitAfterMs: a.waitAfterMs ?? 250,
    };
  });
}

// Reverse of buildChangeDetectionConfig; defaults are spread first and the wire values written on top.
/**
 * @param {SFWire.ChangeDetectionConfig | null | undefined} wire
 * @returns {object}
 */
function applyChangeDetectionConfig(wire) {
  const defaults = {
    enabled: false,
    notify: 'Email',
    email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
    webhook: { urlEnvVar: '' },
  };
  if (!wire) return defaults;
  return {
    enabled: true,
    notify: wire.notify || 'Email',
    email: { ...defaults.email, ...(wire.email || {}) },
    webhook: { ...defaults.webhook, ...(wire.webhook || {}) },
  };
}

// Reverse of buildProxyConfig.
/**
 * @param {SFWire.ProxyConfig | null | undefined} wire
 * @returns {{enabled: boolean, envVar: string}}
 */
function applyProxyConfig(wire) {
  return wire ? { enabled: true, envVar: wire.environmentVariableName || '' } : { enabled: false, envVar: '' };
}

// Issue #222: reverse of buildRequestDelayConfig — milliseconds back into
// the popup's two "seconds" text inputs (a fixed pause leaves "to" blank).
/**
 * @param {SFWire.RequestDelayConfig | null | undefined} wire
 * @returns {SFDraft.RequestDelayState}
 */
function applyRequestDelayConfig(wire) {
  if (!wire) return { enabled: false, minSecondsText: '1', maxSecondsText: '' };
  const seconds = (/** @type {number} */ ms) => String(Math.round(ms) / 1000);
  return {
    enabled: true,
    minSecondsText: seconds(wire.minMs ?? 0),
    maxSecondsText: (wire.maxMs ?? wire.minMs) === wire.minMs ? '' : seconds(wire.maxMs ?? 0),
  };
}

// Issue #333: reverse of the robotsDisallow wire object — absent = off.
/**
 * @param {SFWire.RobotsDisallowConfig | null | undefined} wire
 * @returns {SFDraft.RobotsDisallowState}
 */
function applyRobotsDisallowConfig(wire) {
  if (!wire) return { enabled: false, action: 'Skip' };
  const action = wire.action === 'Warn' || wire.action === 'Abort' ? wire.action : 'Skip';
  return { enabled: true, action };
}

// Issue #223: reverse of buildRetryConfig.
/**
 * @param {SFWire.RetryConfig | null | undefined} wire
 * @returns {SFDraft.RetryState}
 */
function applyRetryConfig(wire) {
  const defaults = { enabled: false, maxAttemptsText: '3', delaySecondsText: '2', exponential: true, statusCodesText: '429, 502, 503, 504' };
  if (!wire) return defaults;
  return {
    enabled: true,
    maxAttemptsText: String(wire.maxAttempts ?? 3),
    delaySecondsText: String((wire.delayMs ?? 2000) / 1000),
    exponential: wire.exponential !== false,
    statusCodesText: wire.retryOnStatusCodes?.length ? wire.retryOnStatusCodes.join(', ') : defaults.statusCodesText,
  };
}

// Reverse of buildPaginationConfig.
/**
 * @param {SFWire.PaginationConfig | null | undefined} wire
 * @returns {object}
 */
function applyPaginationConfig(wire) {
  const defaults = { enabled: false, kind: 'nextLink', nextLinkSelector: '', urlTemplate: '', maxPages: 50 };
  if (!wire) return defaults;
  // Reads both branches' fields through an `any` cast and keeps the one `kind` selects.
  const w = /** @type {any} */ (wire);
  return {
    enabled: true,
    kind: wire.kind === 'pageNumber' ? 'pageNumber' : 'nextLink',
    nextLinkSelector: w.nextLinkSelector || '',
    urlTemplate: w.urlTemplate || '',
    maxPages: Number.isFinite(wire.maxPages) && (wire.maxPages ?? 0) > 0 ? wire.maxPages : 50,
  };
}

// Reverse of buildDiscoveredUrlsConfig (Issue #218) — mirrors
// applyPaginationConfig's own shape exactly, just with no polymorphic
// kind to narrow.
/**
 * @param {SFWire.DiscoveredUrlsConfig | null | undefined} wire
 * @returns {object}
 */
function applyDiscoveredUrlsConfig(wire) {
  const defaults = { enabled: false, pageUrl: '', linkSelector: '', maxUrls: 100 };
  if (!wire) return defaults;
  return {
    enabled: true,
    pageUrl: wire.pageUrl || '',
    linkSelector: wire.linkSelector || '',
    maxUrls: Number.isFinite(wire.maxUrls) && (wire.maxUrls ?? 0) > 0 ? wire.maxUrls : 100,
  };
}

// Reverse of buildHardeningConfig: each wire kind goes into its slot of _state.hardening; the 0.0-1.0 fraction becomes
// a whole percent again.
/**
 * @param {SFWire.HardeningCheck[] | null | undefined} wire
 * @returns {SFDraft.HardeningState}
 */
function applyHardeningConfig(wire) {
  /** @type {SFDraft.HardeningState} */
  const result = {
    noResult: { enabled: false, severity: 'Warning' },
    nullRate: [],
    baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
    blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
    requiredFields: { enabled: false, severity: 'Warning', fields: [] },
  };
  for (const check of wire || []) {
    if (check.kind === 'noResult') {
      result.noResult = { enabled: true, severity: check.severity };
    } else if (check.kind === 'nullRate') {
      result.nullRate.push({
        fieldName: check.fieldName || '', threshold: Math.round((check.threshold ?? 0.5) * 100), severity: check.severity,
      });
    } else if (check.kind === 'baseline') {
      result.baseline = { enabled: true, severity: check.severity, dropThresholdPercent: Math.round((check.dropThreshold ?? 0.2) * 100) };
    } else if (check.kind === 'blocking') {
      result.blocking = {
        enabled: true, severity: check.severity,
        minBodyLengthText: check.minBodyLength != null ? String(check.minBodyLength) : '',
        phrasesText: (check.blockPhrases || []).join('\n'),
      };
    } else if (check.kind === 'requiredFields') {
      result.requiredFields = { enabled: true, severity: check.severity, fields: check.fieldNames || [] };
    }
  }
  return result;
}

// Reverse of buildOutputBlueprintMapping. No round trip to the companion is needed: the wire mapping carries the whole
// target list / tree; a tree is walked in lockstep with its path-keyed draft (createTreeMappingDraft).
/** @type {{selectedOutputBlueprintId: string, selectedOutputBlueprintFieldNames: string[], outputBlueprintMapping: Record<string, string>, selectedOutputBlueprintSchemaKind: SFWire.OutputBlueprintSchemaKind, selectedOutputBlueprintTree: SFDraft.OutputBlueprintTreeNode[], outputBlueprintTreeMapping: Record<string, string>}} */
const EMPTY_OUTPUT_BLUEPRINT_STATE = {
  selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
  selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
};

/**
 * @param {SFWire.OutputBlueprintTreeMappingNode[]} wireNodes
 * @param {string} prefix
 * @param {SFDraft.OutputBlueprintTreeNode[]} tree
 * @param {Record<string, string>} draft
 */
function applyOutputBlueprintTreeMapping(wireNodes, prefix, tree, draft) {
  wireNodes.forEach((wireNode, i) => {
    const path = prefix ? `${prefix}.${i}` : `${i}`;
    // Same structural group-vs-leaf discriminator as the companion's own
    // OutputBlueprintTreeMappingNodeJsonConverter.
    const n = /** @type {any} */ (wireNode);
    if (Array.isArray(n.children)) {
      /** @type {SFDraft.OutputBlueprintTreeNode} */
      const groupNode = { name: n.name, children: [] };
      tree.push(groupNode);
      applyOutputBlueprintTreeMapping(n.children, path, /** @type {SFDraft.OutputBlueprintTreeNode[]} */ (groupNode.children), draft);
    } else {
      tree.push({ name: n.name });
      draft[path] = n.sourceField;
    }
  });
}

/**
 * @param {SFWire.OutputBlueprintMapping | null | undefined} wire
 * @returns {object}
 */
function applyOutputBlueprintConfig(wire) {
  if (!wire) return { ...EMPTY_OUTPUT_BLUEPRINT_STATE };

  if (wire.schemaKind === 'Tree') {
    /** @type {SFDraft.OutputBlueprintTreeNode[]} */
    const tree = [];
    /** @type {Record<string, string>} */
    const mapping = {};
    applyOutputBlueprintTreeMapping(wire.tree || [], '', tree, mapping);
    return {
      selectedOutputBlueprintId: wire.blueprintId != null ? String(wire.blueprintId) : '',
      selectedOutputBlueprintFieldNames: [],
      outputBlueprintMapping: {},
      selectedOutputBlueprintSchemaKind: 'Tree',
      selectedOutputBlueprintTree: tree,
      outputBlueprintTreeMapping: mapping,
    };
  }

  const wireFields = wire.fields || [];
  const fieldNames = wireFields.map(f => f.targetField);
  /** @type {Record<string, string>} */
  const mapping = {};
  for (const f of wireFields) mapping[f.targetField] = f.sourceField;
  return {
    selectedOutputBlueprintId: wire.blueprintId != null ? String(wire.blueprintId) : '',
    selectedOutputBlueprintFieldNames: fieldNames,
    outputBlueprintMapping: mapping,
    selectedOutputBlueprintSchemaKind: 'Flat',
    selectedOutputBlueprintTree: [],
    outputBlueprintTreeMapping: {},
  };
}

// The entry point: a wire ScrapingConfig (buildScrapingConfig's output) in, a full setState patch out. It never includes
// `url`: the live tab's URL stays authoritative, so loading only replaces the extraction setup and settings.
/**
 * @param {SFWire.ScrapingConfig} config
 * @returns {object}
 */
function applyConfigToState(config) {
  // Combined mode only restores combinedComponents (each component's config is resolved live from its own saved
  // configuration). The cross-session global preferences (JSON output, preview, full file, external config) are never part
  // of this patch: loading a config must not change them.
  if (config.combined) {
    return {
      mode: 'combined',
      fields: [], groups: [], apiConfig: null,
      combinedComponents: config.combined.map(c => ({ savedConfigId: c.savedConfigId ?? null, name: c.name })),
      engine: 'Static',
      browserActions: [],
      scriptFileName: config.scriptFileName || '',
      outputFileName: config.outputFileName || '',
      additionalStartUrls: [],
      changeDetection: applyChangeDetectionConfig(null),
      proxy: applyProxyConfig(null),
      requestDelay: applyRequestDelayConfig(null),
      retry: applyRetryConfig(null),
      deduplication: applyDeduplicationConfig(null),
      requestHeaders: applyRequestHeadersConfig(null),
      pagination: applyPaginationConfig(null),
      discoveredUrls: applyDiscoveredUrlsConfig(null),
      hardening: applyHardeningConfig(null),
      persistentSession: false,
      // Issue #219: never present on a Combined wire config either (same
      // outer-level rejection as discoveredUrls above).
      preflight: false,
      respectRobotsDelay: false,
      robotsDisallow: applyRobotsDisallowConfig(null),
      appendOutput: false,
      ...applyOutputBlueprintConfig(null),
    };
  }

  // Blocks mode restores each block into _state.blocks (the shared draft slots only hold the block being edited). A
  // block's own ChangeDetection / Hardening / OutputFormat are not tracked in _state.blocks yet, so a reloaded block
  // loses them (documented gap).
  if (config.blocks) {
    return {
      mode: 'blocks',
      fields: [], groups: [], apiConfig: null,
      combinedComponents: [],
      blocks: config.blocks.map(b => ({
        name: b.name || '',
        outputFileName: b.outputFileName || '',
        shape: b.groups ? 'group' : 'flat',
        fields: b.groups ? [] : (b.fields || []).map(f => ({
          name: f.name, selector: f.selector, attribute: f.attribute ?? null,
          framePath: f.framePath || null, transforms: f.transforms && f.transforms.length > 0 ? f.transforms : null,
        })),
        groups: b.groups ? deserializeGroupTree(b.groups) : [],
      })),
      blocksDraftShape: 'flat', blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null,
      engine: config.engine || 'Static',
      browserActions: deserializeBrowserActions(config.browserActions),
      scriptFileName: config.scriptFileName || '',
      outputFileName: '',
      additionalStartUrls: config.additionalUrls || [],
      changeDetection: applyChangeDetectionConfig(null),
      proxy: applyProxyConfig(config.proxy),
      requestDelay: applyRequestDelayConfig(config.requestDelay),
      retry: applyRetryConfig(config.retry),
      // Issue #225: never present on a Blocks wire config (rejected server-side).
      deduplication: applyDeduplicationConfig(null),
      // Issue #226: the shared request headers do apply to Blocks.
      requestHeaders: applyRequestHeadersConfig(config.headers),
      pagination: applyPaginationConfig(config.pagination),
      // Issue #218: never present on a Blocks wire config (rejected
      // server-side, not designed for this mode's multi-output shape yet).
      discoveredUrls: applyDiscoveredUrlsConfig(null),
      hardening: applyHardeningConfig(null),
      persistentSession: config.persistentSession === true,
      // Issue #219: never present on a Blocks wire config (rejected
      // server-side, not designed for this mode's multi-output shape yet —
      // same reasoning as discoveredUrls above).
      preflight: false,
      // Issue #228: allowed on a Blocks request (one shared navigation).
      respectRobotsDelay: config.respectRobotsDelay === true,
      robotsDisallow: applyRobotsDisallowConfig(config.robotsDisallow),
      appendOutput: config.appendOutput === true,
      ...applyOutputBlueprintConfig(null),
    };
  }

  const mode = config.groups ? 'container' : config.api ? 'api' : 'flat';
  return {
    mode,
    fields: mode === 'flat'
      ? (config.fields || []).map(f => ({
          name: f.name, selector: f.selector, attribute: f.attribute ?? null,
          framePath: f.framePath || null, transforms: f.transforms && f.transforms.length > 0 ? f.transforms : null,
          // Issue #214: same "only meaningful with an attribute set" gate
          // container mode's own deserializeGroupTree already uses.
          download: !!f.attribute && !!f.download,
          maxDownloadSizeBytes: f.attribute && f.download ? (f.maxDownloadSizeBytes ?? null) : null,
          allowedContentTypes: f.attribute && f.download ? (f.allowedContentTypes || []) : [],
          // Issue #206 follow-up: absent on the wire = false.
          hiddenFromOutput: !!f.hiddenFromOutput,
        }))
      : [],
    groups: mode === 'container' ? deserializeGroupTree(config.groups) : [],
    apiConfig: mode === 'api' ? config.api : null,
    combinedComponents: [],
    engine: config.engine || 'Static',
    browserActions: deserializeBrowserActions(config.browserActions),
    scriptFileName: config.scriptFileName || '',
    outputFileName: config.outputFileName || '',
    additionalStartUrls: config.additionalUrls || [],
    changeDetection: applyChangeDetectionConfig(config.changeDetection),
    proxy: applyProxyConfig(config.proxy),
    requestDelay: applyRequestDelayConfig(config.requestDelay),
    retry: applyRetryConfig(config.retry),
    deduplication: applyDeduplicationConfig(config.deduplication),
    // Issue #226: an Api config never carries these (it has its own headers).
    requestHeaders: applyRequestHeadersConfig(config.api ? null : config.headers),
    pagination: applyPaginationConfig(config.pagination),
    discoveredUrls: applyDiscoveredUrlsConfig(config.discoveredUrls),
    hardening: applyHardeningConfig(config.hardening),
    persistentSession: config.persistentSession === true,
    // Issue #219: plain bool, same convention as persistentSession above —
    // absent on the wire (an older companion/export, or Api mode) = false.
    preflight: config.preflight === true,
    // Issue #228: plain bool, same convention as preflight above.
    respectRobotsDelay: config.respectRobotsDelay === true,
    robotsDisallow: applyRobotsDisallowConfig(config.robotsDisallow),
    appendOutput: config.appendOutput === true,
    // Issue #191: only ever present on the wire for flat mode/Api's flat
    // shape — applyOutputBlueprintConfig(undefined) already resets to
    // "none" for every other mode, so no per-mode branching is needed here.
    ...applyOutputBlueprintConfig(config.outputBlueprint),
  };
}

module.exports = {
  deserializeGroupTree, deserializeBrowserActions,
  applyChangeDetectionConfig, applyProxyConfig, applyPaginationConfig, applyDiscoveredUrlsConfig, applyHardeningConfig,
  applyOutputBlueprintConfig,
  applyConfigToState,
};

