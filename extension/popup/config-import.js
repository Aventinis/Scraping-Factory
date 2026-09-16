// Issue #141: reverses buildScrapingConfig's wire-format output back into a
// _state patch — the "Laden" half of local saved-config history (see
// popup.js's applyConfigImport / saved-configs panel). Split out of popup.js
// the same way container-tree.js/api-config.js already are: a pure, DOM-free
// module, no behavior beyond the mapping itself. Same IIFE-wrapped-single-
// global pattern as those (see their own doc comments) — popup.html loads
// this as a classic <script> before popup.js.
const SFConfigImport = (function () {
  // Inverse of container-tree.js's FIELD_MODE_WIRE_NAMES — kept as its own
  // copy rather than importing that module, the same "small, hand-kept
  // mirror" tradeoff already made elsewhere in this codebase (e.g.
  // sanitizeFileNameBase vs. FileNameSanitizer) rather than adding a
  // cross-module dependency for four constant strings.
  const FIELD_MODE_INTERNAL_NAMES = { Text: 'text', Attribute: 'attribute', Exists: 'exists', OwnText: 'ownText' };

  // Reverse of container-tree.js's serializeGroupTree — a wire GroupNode is
  // told apart from a DataFieldNode structurally (children present vs. not),
  // exactly like the companion's own ContainerNodeJsonConverter.
  function deserializeGroupTree(wireNodes) {
    return (wireNodes || []).map((node) => (
      Array.isArray(node.children)
        ? {
            kind: 'group', name: node.name, selector: node.selector, repeating: !!node.repeating,
            children: deserializeGroupTree(node.children), framePath: node.framePath || null,
          }
        : {
            kind: 'field', name: node.name, selector: node.selector,
            mode: FIELD_MODE_INTERNAL_NAMES[node.mode] || 'text',
            attribute: node.mode === 'Attribute' ? (node.attribute ?? null) : null,
            framePath: node.framePath || null,
            transforms: node.transforms && node.transforms.length > 0 ? node.transforms : null,
          }
    ));
  }

  // Reverse of popup.js's serializeBrowserActions — fills back in each
  // kind's own defaults (mirroring addBrowserAction) for whichever fields
  // a wire action of that kind doesn't carry.
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
      return { kind: 'click', selector: a.selector || '', framePath };
    });
  }

  // Reverse of buildChangeDetectionConfig — wire is null (or absent) when
  // disabled; a present wire config's optional sub-fields (smtpPortEnvVar
  // etc.) may themselves be absent, so defaults are spread first and the
  // wire values written on top, never the other way round.
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
  function applyProxyConfig(wire) {
    return wire ? { enabled: true, envVar: wire.environmentVariableName || '' } : { enabled: false, envVar: '' };
  }

  // Reverse of buildPaginationConfig.
  function applyPaginationConfig(wire) {
    const defaults = { enabled: false, kind: 'nextLink', nextLinkSelector: '', urlTemplate: '', maxPages: 50 };
    if (!wire) return defaults;
    return {
      enabled: true,
      kind: wire.kind === 'pageNumber' ? 'pageNumber' : 'nextLink',
      nextLinkSelector: wire.nextLinkSelector || '',
      urlTemplate: wire.urlTemplate || '',
      maxPages: Number.isFinite(wire.maxPages) && wire.maxPages > 0 ? wire.maxPages : 50,
    };
  }

  // Reverse of buildHardeningConfig — wire is a flat list of `{kind, ...}`
  // checks (or null/absent); each kind writes into its own slot of the
  // nested per-check state shape (see _state.hardening's own doc comment),
  // converting the wire's 0.0-1.0 fraction back to a 0-100 whole percent for
  // the UI, the exact inverse of buildHardeningConfig's own `/ 100`.
  function applyHardeningConfig(wire) {
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

  // The one entry point: takes a wire-format ScrapingConfig (the exact
  // shape buildScrapingConfig produces, and /generate's request body itself
  // — see buildConfigExport's own `config` field) and returns a full
  // setState patch reproducing it. Deliberately does NOT include `url` —
  // the current browser tab's URL stays authoritative (see popup.js's
  // loadSavedConfig), so a loaded config only ever replaces the extraction
  // setup/settings, never navigates the popup away from the page it's
  // actually looking at.
  function applyConfigToState(config) {
    const mode = config.groups ? 'container' : config.api ? 'api' : 'flat';
    return {
      mode,
      fields: mode === 'flat'
        ? (config.fields || []).map(f => ({
            name: f.name, selector: f.selector, attribute: f.attribute ?? null,
            framePath: f.framePath || null, transforms: f.transforms && f.transforms.length > 0 ? f.transforms : null,
          }))
        : [],
      groups: mode === 'container' ? deserializeGroupTree(config.groups) : [],
      apiConfig: mode === 'api' ? config.api : null,
      engine: config.engine || 'Static',
      browserActions: deserializeBrowserActions(config.browserActions),
      scriptFileName: config.scriptFileName || '',
      outputFileName: config.outputFileName || '',
      useJsonOutput: config.outputFormat === 'Json',
      additionalStartUrls: config.additionalUrls || [],
      changeDetection: applyChangeDetectionConfig(config.changeDetection),
      proxy: applyProxyConfig(config.proxy),
      pagination: applyPaginationConfig(config.pagination),
      hardening: applyHardeningConfig(config.hardening),
      persistentSession: config.persistentSession === true,
    };
  }

  return {
    deserializeGroupTree, deserializeBrowserActions,
    applyChangeDetectionConfig, applyProxyConfig, applyPaginationConfig, applyHardeningConfig,
    applyConfigToState,
  };
})();

if (typeof module !== 'undefined') module.exports = SFConfigImport;
if (typeof self !== 'undefined') self.SFConfigImport = SFConfigImport;
