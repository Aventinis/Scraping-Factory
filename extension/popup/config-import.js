// Issue #141: reverses buildScrapingConfig's wire-format output back into a
// _state patch — the "Laden" half of local saved-config history (see
// popup.js's applyConfigImport / saved-configs panel). Split out of popup.js
// the same way container-tree.js/api-config.js already are: a pure, DOM-free
// module, no behavior beyond the mapping itself. Same IIFE-wrapped-single-
// global pattern as those (see their own doc comments) — popup.html loads
// this as a classic <script> before popup.js.
// @ts-check
// Issue #238: JSDoc-annotated and typechecked via `// @ts-check` + tsconfig
// (`npm run typecheck`) — inputs are typed against types/companion-ir.d.ts's
// `SFWire` namespace (the exact wire shape this module reverses), outputs
// against types/popup-drafts.d.ts's `SFDraft` namespace for the
// popup-internal draft shapes it reconstructs (`SFDraft.HardeningState`,
// `SFDraft.OutputBlueprintTreeNode`, etc. — shared there, not a local
// `@typedef` here, so scraping-config-builder.js's own JSDoc can reference
// the same shapes this module reverses them from — see that file's own
// top-of-file comment and types/popup-drafts.d.ts's). `applyConfigToState`'s
// own return type is intentionally loose (`object`) — it's a `_state` patch
// spanning every mode's own slice at once (mode/fields/groups/apiConfig/
// combinedComponents/blocks/engine/...), and no single interface here would
// usefully describe five mutually-exclusive branches without fighting
// TypeScript's excess-property checks for little real benefit; its own
// per-branch helpers (deserializeGroupTree, applyHardeningConfig, etc.) are
// each typed precisely instead, which is where a real shape mismatch would
// actually get caught.
const SFConfigImport = (function () {
  // Inverse of container-tree.js's FIELD_MODE_WIRE_NAMES — kept as its own
  // copy rather than importing that module, the same "small, hand-kept
  // mirror" tradeoff already made elsewhere in this codebase (e.g.
  // sanitizeFileNameBase vs. FileNameSanitizer) rather than adding a
  // cross-module dependency for four constant strings.
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
      // Same structural discriminator the companion's own
      // ContainerNodeJsonConverter uses (children present = group); a
      // DataFieldNode's own type has none of GroupNode's fields (or vice
      // versa) at all, so reading whichever one applies here goes through
      // an `any` view rather than narrowing the union field by field.
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
      return { kind: 'click', selector: a.selector || '', framePath };
    });
  }

  // Reverse of buildChangeDetectionConfig — wire is null (or absent) when
  // disabled; a present wire config's optional sub-fields (smtpPortEnvVar
  // etc.) may themselves be absent, so defaults are spread first and the
  // wire values written on top, never the other way round.
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

  // Reverse of buildPaginationConfig.
  /**
   * @param {SFWire.PaginationConfig | null | undefined} wire
   * @returns {object}
   */
  function applyPaginationConfig(wire) {
    const defaults = { enabled: false, kind: 'nextLink', nextLinkSelector: '', urlTemplate: '', maxPages: 50 };
    if (!wire) return defaults;
    // Cross-branch field access (a NextLinkPagination has no urlTemplate,
    // a PageNumberPagination has no nextLinkSelector) — reading both
    // unconditionally and keeping only the relevant one (via `kind` below)
    // is simpler than narrowing twice, so this one spot reads through an
    // `any` cast rather than fighting the union.
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

  // Reverse of buildHardeningConfig — wire is a flat list of `{kind, ...}`
  // checks (or null/absent); each kind writes into its own slot of the
  // nested per-check state shape (see _state.hardening's own doc comment),
  // converting the wire's 0.0-1.0 fraction back to a 0-100 whole percent for
  // the UI, the exact inverse of buildHardeningConfig's own `/ 100`.
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

  // Reverse of buildOutputBlueprintMapping — wire is null (or absent) when
  // no blueprint was mapped. Unlike the fetch-based selectOutputBlueprint
  // (output-blueprints-ui.js), neither shape needs a round trip back to the
  // companion here: the wire mapping's own `fields` (Flat) or `tree` (Tree)
  // already carries everything needed to reproduce the picker's own state
  // — Issue #244's tree shape reuses createTreeMappingDraft/
  // updateTreeMappingSource's own path-keyed draft convention, walking the
  // wire tree and the (structurally identical, since it was built FROM that
  // tree) draft in lockstep.
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

  // The one entry point: takes a wire-format ScrapingConfig (the exact
  // shape buildScrapingConfig produces, and /generate's request body itself
  // — see buildConfigExport's own `config` field) and returns a full
  // setState patch reproducing it. Deliberately does NOT include `url` —
  // the current browser tab's URL stays authoritative (see popup.js's
  // loadSavedConfig), so a loaded config only ever replaces the extraction
  // setup/settings, never navigates the popup away from the page it's
  // actually looking at.
  /**
   * @param {SFWire.ScrapingConfig} config
   * @returns {object}
   */
  function applyConfigToState(config) {
    // Issue #239: Combined mode has none of Fields/Groups/Api/engine/
    // browserActions/changeDetection/proxy/pagination/hardening/
    // persistentSession of its own (the companion rejects all of those at
    // this outer level) — reloading one only ever restores
    // combinedComponents (each entry's own full config lives in its own,
    // separately-saved configuration, resolved live at generate/save/export
    // time, never re-imported into ad-hoc fields/groups/apiConfig here).
    // Issue-driven follow-up: outputAsJson/includeDataPreview/
    // includeOutputFile/externalConfig are no longer part of this patch at
    // all — they're cross-session global preferences now (shared/
    // global-settings.js), so loading a saved/exported config must not
    // touch them.
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
        pagination: applyPaginationConfig(null),
        discoveredUrls: applyDiscoveredUrlsConfig(null),
        hardening: applyHardeningConfig(null),
        persistentSession: false,
        // Issue #219: never present on a Combined wire config either (same
        // outer-level rejection as discoveredUrls above).
        preflight: false,
        ...applyOutputBlueprintConfig(null),
      };
    }

    // Issue #182: Blocks mode has no ad-hoc fields/groups/apiConfig of its
    // own either — each block's own Fields-or-Groups content is restored
    // into _state.blocks directly (never into the shared draft slots, which
    // only ever hold whichever block is currently being *edited* — see
    // blocks-config-ui.js). Per-block ChangeDetection/Hardening/
    // OutputFormat aren't tracked in _state.blocks yet (no UI to edit them
    // — see CLAUDE.md), so a re-loaded block that had one of those loses it,
    // the same kind of documented v1 gap Combined mode's own
    // VerificationValues round-trip already has.
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
      pagination: applyPaginationConfig(config.pagination),
      discoveredUrls: applyDiscoveredUrlsConfig(config.discoveredUrls),
      hardening: applyHardeningConfig(config.hardening),
      persistentSession: config.persistentSession === true,
      // Issue #219: plain bool, same convention as persistentSession above —
      // absent on the wire (an older companion/export, or Api mode) = false.
      preflight: config.preflight === true,
      // Issue #191: only ever present on the wire for flat mode/Api's flat
      // shape — applyOutputBlueprintConfig(undefined) already resets to
      // "none" for every other mode, so no per-mode branching is needed here.
      ...applyOutputBlueprintConfig(config.outputBlueprint),
    };
  }

  return {
    deserializeGroupTree, deserializeBrowserActions,
    applyChangeDetectionConfig, applyProxyConfig, applyPaginationConfig, applyDiscoveredUrlsConfig, applyHardeningConfig,
    applyOutputBlueprintConfig,
    applyConfigToState,
  };
})();

if (typeof module !== 'undefined') module.exports = SFConfigImport;
if (typeof self !== 'undefined') self.SFConfigImport = SFConfigImport;
