// Resolved fresh in checkCompanion() (default or the user's persisted
// override, see shared/companion-config.js) and reused by generate() below —
// module-level rather than re-resolved per fetch since it only ever changes
// via a full CHECKING_COMPANION -> checkCompanion() round trip anyway.
let companionUrl = null;

// ── Logging ───────────────────────────────────────────────────────────────────

const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { SUPPORTED_LANGUAGES, initI18n, setLanguage, getLanguage, t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { DEFAULT_COMPANION_URL, getCompanionUrl, setCompanionUrlOverride, resetCompanionUrlOverride, normalizeUrl } =
  typeof require !== 'undefined' ? require('../shared/companion-config') : self.SFCompanionConfig;

const {
  STATES, escapeHtml,
  parseUrlTemplateParts, buildUrlTemplate, parseValueListInput, findUrlTemplateMatches, mergeValueListValues,
  buildStaticListSource, buildDiscoverySource, buildRangeSource, RANGE_FORMAT_PRESETS,
  detectRangeFormat, findUrlPartValue, rangeFormatExample,
  buildApiHeaders, buildApiConfig,
  buildApiGroupDraft, buildApiFieldDraft, resolveApiTreeNode, insertApiTreeNode, removeApiTreeNode,
  serializeApiTree, countApiConfigFields, updateApiTreeNode, apiTreeNodesHaveNonBlankNames,
  jsonValueToBodyDraft, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId,
  bodyTreeLeavesAreBound, serializeBodyTree, lastPathSegmentName, buildApiSubtreeFromCandidate,
  resolveApiGroupScopePath, variableUrlParts, allParameterParts, apiConfigDraftHasAllSourcesChosen,
} = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

const {
  buildGroupNode, buildFieldNode, resolveGroupNode, hasRepeatingAncestor,
  insertContainerNode, removeGroupTreeNode, formatGroupNodeLabel, serializeGroupTree,
} = typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

const {
  renderApiTree, renderApiCandidates, renderApiEntriesList,
  renderApiConfigScreen, renderBodyTree,
  startApiCapture, stopApiCapture, toggleApiCapture,
  startApiFieldSearch, confirmApiFieldCandidate, loadInitialBodyTreeForCandidate, cancelApiConfig,
  startApiTreeFieldSearch, confirmApiTreeFieldCandidate,
  openApiGroupModal, confirmApiGroupModal, cancelApiGroupModal, setApiTreeNodeName,
  openApiFieldTransformsModal, confirmApiFieldTransformsModal, cancelApiFieldTransformsModal,
  startDiscoverySearch, confirmDiscoveryCandidate,
  toggleApiConfigPartVariable, setApiConfigPartName, setApiConfigSourceKind,
  patchApiConfigSource, setApiConfigHeaderDecision,
  toggleBodyLeafToVariable, toggleBodyLeafToFixed, setBodyLeafParameter, setBodyLeafCoerceTo,
  openBodyParameterModal, confirmBodyParameterModal, cancelBodyParameterModal, confirmApiConfig,
  toggleApiEntriesPanel, fillStaticListFromPool,
} = typeof require !== 'undefined' ? require('./api-config-ui') : self.SFApiConfigUI;

const {
  renderGroupTree,
  openContainerModal, confirmContainerModal, cancelContainerModal,
  startFieldSelection, confirmExtendedField, cancelExtendedField,
} = typeof require !== 'undefined' ? require('./container-tree-ui') : self.SFContainerTreeUI;

const {
  createDefaultTransform, addTransform, removeTransform, updateTransform, changeTransformKind,
  moveTransform, transformsAreValid, applyTransformsPreview, toNumberPreview,
} = typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;

const { renderTransformList, wireTransformList, renderTransformPreview } =
  typeof require !== 'undefined' ? require('./field-transforms-ui') : self.SFFieldTransformsUI;

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));
}

let _state = {
  current:             STATES.CHECKING_COMPANION,
  url:                 '',
  mode:                'flat', // 'flat' (Fields → Csv) | 'container' (Groups → Xml) — mutually exclusive
  fields:              [],   // [{name, selector, attribute}]
  groups:              [],   // container-mode tree: {kind:'group', name, selector, repeating, children} | {kind:'field', name, selector, mode, attribute}
  // Issue #41/#42, Phase 5: mode-independent (applies regardless of Fields/
  // Groups/Api, see A) in PLAN-issues-41-42.md's Phase 5 research) — never
  // touched by switchMode/MODE_SWITCH_CLEARS, unlike fields/groups/apiConfig.
  engine:              'Static', // 'Static' | 'Browser' — only sent to /generate when 'Browser' (see buildScrapingConfig)
  // [{kind:'waitFor'|'fill'|'click', selector, timeoutMs?, environmentVariableName?} |
  //  {kind:'scroll', containerSelector, loadMoreButtonSelector, maxIterations, waitAfterMs}],
  // executed in order before extraction — Browser-engine only. Issue #41
  // Phase 6 added 'scroll' — see also pendingBrowserActionField below, since
  // it's the only kind with more than one pickable selector per card.
  browserActions:      [],
  // Issue #83: extra start URLs the same Fields/Groups extraction config
  // runs against, in addition to `url` above — mode-independent like
  // engine/browserActions, but rejected server-side for API mode (which
  // builds its own request URL from apiConfig.urlTemplate and never reads
  // `url`/this list at all), so the UI hides the input there instead of
  // silently sending something the companion would reject. Persisted like
  // fields/groups/scriptFileName (real scrape-target configuration, not a
  // per-generate opt-in toggle like includeDataPreview/useJsonOutput below).
  additionalStartUrls: [],
  // Issue #87: opt-in change detection + notification — mode-independent
  // like engine/additionalStartUrls above, persisted the same way (real
  // scrape-target configuration, not a per-generate toggle). Every
  // credential/target field is an environment-variable *name* the user
  // types, never a literal value — mirrors FillAction's own
  // environmentVariableName input, read by the generated script at
  // runtime via os.environ[...] (see buildChangeDetectionConfig).
  changeDetection: {
    enabled: false,
    notify: 'Email', // 'Email' | 'Webhook'
    email: {
      smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '',
      fromEnvVar: '', toEnvVar: '',
    },
    webhook: { urlEnvVar: '' },
  },
  // Issue #88: opt-in proxy support — mode-independent like engine/
  // additionalStartUrls/changeDetection above, persisted the same way (real
  // scrape-target configuration, not a per-generate toggle). envVar is the
  // *name* of an environment variable holding a comma-separated proxy URL
  // list, never a literal address — same environmentVariableName pattern as
  // FillAction/ChangeDetection (see buildProxyConfig).
  proxy: { enabled: false, envVar: '' },
  // Issue #43: one-time Fill test values for the /generate verification
  // trial run only — keyed by FillAction.environmentVariableName. Deliberately
  // absent from persistState()'s chrome.storage.session write and from
  // init()'s restore list below — must not survive a popup close/reopen or be
  // logged/exported. See buildVerificationValues.
  fillTestValues:      {},
  scriptFileName:      '', // base name (no extension) for the downloaded .py — empty = use the "scraper" placeholder/default
  outputFileName:      '', // base name (no extension) for the script's own output.csv/output.xml — empty = use the "output" placeholder/default
  scriptText:          '',
  pendingSelector:     null,  // set while field-name modal (flat) or extended field modal (container) is open
  // Issue #42, Phase 7: the framePath ELEMENT_SELECTED reported alongside
  // pendingSelector above — null for a top-level pick, carried through the
  // same modal round trip and written onto the resulting field/node once
  // confirmed (see confirmField/confirmExtendedField).
  pendingFramePath:    null,
  // Issue #85: how many elements the just-picked selector matches on the
  // page right now (scoped to the container instance, when applicable) — the
  // content script's own document.querySelectorAll(selector).length,
  // reported alongside pendingSelector on the same ELEMENT_SELECTED message.
  // null before any pick, or if the content script couldn't compute it.
  pendingMatchCount:   null,
  // Issue #143: the just-picked element's own trimmed text/attribute map,
  // reported alongside pendingSelector on the same ELEMENT_SELECTED message
  // — underlying-selection state like pendingMatchCount above (not
  // user-typed form input), so it's carried through the same session-storage
  // popup-reopen recovery path. Feeds the transform-chain live preview
  // (see refreshFlatTransformPreview/refreshExtendedTransformPreview) —
  // null before any pick.
  pendingRawText:            null,
  pendingElementAttributes:  null,
  // Issue #84: the transform chain (trim/regexExtract/replace/toNumber, in
  // order) being built up while modal-field-name/modal-field-extended is
  // open — form state, not underlying-selection state, so unlike
  // pendingSelector/pendingMatchCount it's deliberately NOT carried through
  // the session-storage popup-reopen recovery path (same "typed-but-
  // unconfirmed input is lost on reopen" treatment the field-name input
  // itself already gets). Written onto the resulting field/node once
  // confirmed (see confirmField/confirmExtendedField).
  pendingTransforms:   [],
  selectionKind:       null,  // 'field' | 'container' | 'browserAction' | null — which kind the current SELECTING round is for
  pendingParentPath:   null,  // number[] | null — where the next inserted group-tree node goes; null = root level
  pendingNewContainer: null,  // {name, repeating} captured by modal-container-new before element-selection starts
  pendingBrowserActionIndex: null, // number | null — which browserActions entry the current SELECTING round's result is written into (selectionKind === 'browserAction')
  // 'selector' | 'containerSelector' | 'loadMoreButtonSelector' — which
  // property of that entry gets the picked value; only a ScrollStep action
  // has more than one pickable field, everything else always uses 'selector'.
  pendingBrowserActionField: 'selector',
  containerModalOpen:  false, // modal-container-new visibility
  domViewEnabled:    false, // user preference, kept across selection rounds
  domTree:           null,  // serialized tree from the content script, or null while loading/errored
  domTreeTruncated:  false,
  domTreeError:      null,  // set if no DOM_TREE response arrives within DOM_TREE_TIMEOUT_MS
  previewActive:     false, // Vorschau toggle — not persisted, always off on popup reopen (like domViewEnabled)
  previewSummary:    null,  // {total, empty, truncated} from the content script's last PREVIEW_RESULT, or null
  apiCaptureActive:  false, // Netzwerk-Aufzeichnung toggle (Issue #53 Phase 3) — not persisted, always off on popup reopen
  apiCaptureCount:   0,     // number of API_CAPTURE_ENTRY messages since the current recording started — kept after stop, only reset on the next start (Phase 4 searches what was recorded, after stopping)
  // API-mode follow-up: inline "view recorded endpoints" panel — not
  // persisted, always closed on popup reopen (like previewActive above).
  // apiEntries is re-fetched fresh (via GET_API_CAPTURE_ENTRIES) each time
  // the panel is opened, not accumulated from the live API_CAPTURE_ENTRY
  // stream — that stream is dropped entirely while the popup is closed, so
  // a pull-based fetch is the only way to reliably see the whole pool.
  apiEntriesPanelOpen: false,
  apiEntries:          null,
  // Issue #53 Phase 4/5 — null while no "find in recording" selection round is
  // in progress; 'field' while searching for the primary field (from IDLE);
  // {parameter: name} while searching a Discovery source's example value for
  // one of apiConfigDraft's variable parts (from API_CONFIG). Persisted (see
  // persistState) so a popup closed mid-click doesn't come back thinking a
  // leftover selector is a normal flat-field pick.
  // Issue #54, Phase A5: also {treeParentPath} while adding a new
  // independent root group (treeParentPath: null) or a sub-field/sub-group
  // under an already-confirmed ApiGroup (treeParentPath: number[]) — see
  // startApiTreeFieldSearch.
  apiSearchTarget:   null,
  apiCandidates:      null, // {target, candidates} from the last primary-field search, or null
  apiDiscoveryCandidates: null, // {target, candidates} from the last in-progress Discovery search, or null
  // {treeParentPath, target, candidates} from the last in-progress "add root
  // group"/"add sub-field" search (Issue #54) — not persisted, same as
  // apiCandidates/apiDiscoveryCandidates above (see persistState's comment).
  apiTreeSearchResult: null,
  // modal-api-group-new visibility, and which tree path its typed group gets
  // inserted at (null = root) — mirrors containerModalOpen/pendingParentPath,
  // but unlike those, not persisted: this modal never involves a
  // content-script round trip (no click-based search — see
  // confirmApiGroupModal), so there's no risk of losing it to a popup close.
  apiGroupModalOpen:  false,
  pendingApiTreeParentPath: null,
  // modal-api-body-parameter-new visibility, and which body-tree path (see
  // updateBodyTreeNode) its typed parameter name gets bound to — same
  // "not persisted, no content-script round trip involved" reasoning as
  // apiGroupModalOpen above (Issue #55, Phase B4).
  bodyParameterModalOpen: false,
  pendingBodyVariablePath: null,
  // modal-api-field-transforms visibility, and which tree path's chain is
  // being edited — same "not persisted, no content-script round trip"
  // reasoning as apiGroupModalOpen/bodyParameterModalOpen above (Issue #84
  // follow-up). The chain itself reuses pendingTransforms, the same slot
  // flat/container mode's own field modals already use — API_CONFIG and
  // those two modals are never open at once.
  apiFieldTransformModalOpen: false,
  pendingApiFieldTransformPath: null,
  apiConfigDraft:     null, // set once a candidate is confirmed as the primary field — the in-progress ApiConfig being built, see buildApiConfig/confirmApiFieldCandidate
  apiConfig:          null, // the "Apply"-confirmed ApiConfig wire object — Phase 6 will read this; persisted like fields/groups
  robotsTxtChecking: false, // not persisted, always off on popup reopen (like previewActive/apiCaptureActive)
  robotsTxtResult:   null,  // {ok, robotsUrl, path, notFound, allowed, matchedRule} | {ok:false, error} from the content script's CHECK_ROBOTS_TXT response, or null before the first check
  // Issue #122: opt-in trial-run data preview — deliberately named
  // "dataPreview" throughout, not "preview", to avoid any confusion with
  // the unrelated DOM-highlight feature above (previewActive/togglePreview/
  // #btn-preview) — that one highlights matched elements on the live page;
  // this one shows a sample of what the last /generate trial run actually
  // scraped. includeDataPreview is the checkbox's own state (not persisted,
  // always off on popup reopen, same as previewActive/apiCaptureActive —
  // it's a per-generate opt-in, not a sticky preference).
  includeDataPreview: false,
  dataPreview:        null, // the companion's ScriptPreviewData from the last successful /generate with includeDataPreview on, or null
  // Issue #86: opt-in Json output, mode-independent (like includeDataPreview
  // above) — not persisted, always off on popup reopen; a per-generate
  // choice, not a sticky preference. See buildScrapingConfig for exactly
  // what this adds/replaces per mode.
  useJsonOutput:      false,
};

const DOM_TREE_TIMEOUT_MS = 5000;
let domTreeTimeoutId = null;

// Sends ENABLE_DOM_VIEW and arms a timeout so a lost/slow response shows an
// error instead of spinning forever (see feature/dom-tree-view regression:
// an unthrottled content script could stall the message channel entirely).
function requestDomTree() {
  clearTimeout(domTreeTimeoutId);
  patchState({ domTree: null, domTreeTruncated: false, domTreeError: null });
  chrome.runtime.sendMessage({ type: 'ENABLE_DOM_VIEW' });
  domTreeTimeoutId = setTimeout(() => {
    log('DOM_TREE timeout — no response');
    setLastError('DOM tree request timed out', 'DOM tree view');
    patchState({ domTreeError: 'Tree could not be loaded.' });
  }, DOM_TREE_TIMEOUT_MS);
}

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
function buildScrapingConfig(
  url, mode, fields, groups, apiConfig = null, scriptFileName = null, outputFileName = null,
  engine = 'Static', browserActions = [], includePreview = false, useJsonOutput = false,
  additionalUrls = [], changeDetection = null, proxy = null,
) {
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

  if (mode === 'container') {
    return {
      version: '1', url, groups: serializeGroupTree(groups),
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields,
    };
  }
  if (mode === 'api') {
    return {
      version: '1', url, api: apiConfig,
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields, ...previewFields, ...outputFormatFields, ...additionalUrlsFields, ...changeDetectionFields,
      ...proxyFields,
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
  changeDetection = null, proxy = null,
) {
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: manifest.version || '?',
    config: buildScrapingConfig(
      url, mode, fields, groups, apiConfig, scriptFileName, outputFileName, engine, browserActions, includePreview,
      useJsonOutput, additionalUrls, changeDetection, proxy,
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

// Issue #85: existence/quantity feedback next to the name input in
// modal-field-name/modal-field-extended, the instant a selector is picked —
// mirrors previewSummary's own count/warn-styling pattern (idle.
// previewSummaryMatched + .preview-summary.warn), just scoped to a single
// in-flight pick instead of every configured field/group at once. count is
// null before any pick, or if the content script couldn't compute it — the
// hint simply stays hidden then, same as it would if this feature didn't exist.
function renderMatchCountHint(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (count === null || count === undefined) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = t('modals.matchCount.found', { count });
  el.classList.toggle('warn', count === 0);
  el.classList.remove('hidden');
}

// Issue #143: live preview of the transform chain's output — flat mode has
// no attribute/exists mode, so the raw value is always the picked element's
// trimmed text.
function refreshFlatTransformPreview() {
  renderTransformPreview('field-transform-preview', _state.pendingRawText, _state.pendingTransforms);
}

// Issue #143: container mode's raw value depends on the mode/attribute the
// user is currently typing into the modal — read directly from those DOM
// inputs (like the attribute-row visibility toggle already does), not from
// _state, since neither is state-managed. "exists" mode always passes null
// (its own transforms section is hidden, see the select-field-mode change
// handler below) and attribute mode passes null until an attribute name has
// actually been typed, so the hint doesn't show a misleading result before
// then.
function refreshExtendedTransformPreview() {
  const mode = document.getElementById('select-field-mode')?.value ?? 'text';
  let rawValue = null;
  if (mode === 'text') {
    rawValue = _state.pendingRawText;
  } else if (mode === 'attribute') {
    const attrName = document.getElementById('input-field-attribute')?.value.trim();
    if (attrName) rawValue = (_state.pendingElementAttributes?.[attrName] ?? '').trim();
  }
  renderTransformPreview('field-extended-transform-preview', rawValue, _state.pendingTransforms);
}

// ── State ────────────────────────────────────────────────────────────────────

function setState(newState, patch = {}) {
  const prev = _state.current;
  _state = { ..._state, current: newState, ...patch };
  log('STATE', `${prev} → ${newState}`, Object.keys(patch).length ? patch : undefined);
  persistState();
  if (typeof document !== 'undefined') render();
}

// Updates state without a screen transition (e.g. DOM-tree-view bookkeeping)
// — skips persistState() since none of this needs to survive popup reopen.
function patchState(patch) {
  _state = { ..._state, ...patch };
  if (typeof document !== 'undefined') render();
}

// Persists the parts of state that must survive popup close/reopen.
function persistState() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
  chrome.storage.session
    .set({
      fields: _state.fields,
      url: _state.url,
      mode: _state.mode,
      groups: _state.groups,
      engine: _state.engine,
      browserActions: _state.browserActions,
      additionalStartUrls: _state.additionalStartUrls,
      changeDetection: _state.changeDetection,
      proxy: _state.proxy,
      scriptFileName: _state.scriptFileName,
      outputFileName: _state.outputFileName,
      selectionKind: _state.selectionKind,
      pendingParentPath: _state.pendingParentPath,
      pendingNewContainer: _state.pendingNewContainer,
      pendingBrowserActionIndex: _state.pendingBrowserActionIndex,
      pendingBrowserActionField: _state.pendingBrowserActionField,
      apiSearchTarget: _state.apiSearchTarget,
      apiConfigDraft: _state.apiConfigDraft,
      apiConfig: _state.apiConfig,
    })
    .catch(err => log('STORAGE_ERR', err.message));
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

// Fills every static, always-present element (popup.html's data-i18n*
// attributes) with the current language's text. Only needs to run once at
// init and again after an explicit language switch — render() rebuilds
// dynamic subtrees (group tree, API candidates, …) itself and those call
// t() directly, so they don't rely on this sweep at all.
function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  const langSelect = document.getElementById('lang-select');
  if (langSelect) langSelect.value = getLanguage();
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = getLanguage();
}

// Issue #84: render() hides every modal unconditionally at its own top
// (see below) and re-shows modal-field-name/-extended each pass while a
// pick is pending — so a DOM-visibility check can't tell "just reopened"
// apart from "already open, re-rendering because a transform row changed".
// Tracks the last pendingSelector the modal-open block actually reset
// inputs for; null whenever that block didn't run (mirrors the modal being
// closed), so the same selector picked again after a cancel still resets on
// its next genuine open.
let lastFieldModalSelector = null;

function render() {
  ['checking', 'error', 'idle', 'selecting', 'api-config', 'generating', 'done'].forEach(s =>
    hide(`screen-${s}`)
  );
  hide('modal-field-name');
  hide('modal-field-extended');
  hide('modal-container-new');
  hide('modal-api-group-new');
  hide('modal-api-body-parameter-new');
  hide('modal-api-field-transforms');

  const screenKey = {
    [STATES.CHECKING_COMPANION]: 'checking',
    [STATES.COMPANION_ERROR]:    'error',
    [STATES.IDLE]:               'idle',
    [STATES.SELECTING]:          'selecting',
    [STATES.API_CONFIG]:         'api-config',
    [STATES.GENERATING]:         'generating',
    [STATES.DONE]:               'done',
  }[_state.current];

  if (screenKey) show(`screen-${screenKey}`);

  if (_state.current === STATES.COMPANION_ERROR) {
    const currentUrlEl = document.getElementById('error-current-url');
    if (currentUrlEl) currentUrlEl.textContent = t('error.currentUrl', { url: companionUrl || DEFAULT_COMPANION_URL });
    const urlInput = document.getElementById('input-companion-url');
    if (urlInput && !urlInput.value) urlInput.value = companionUrl && companionUrl !== DEFAULT_COMPANION_URL ? companionUrl : '';
  }

  if (_state.current === STATES.IDLE) {
    const urlEl = document.getElementById('url-display');
    if (urlEl) urlEl.textContent = _state.url || '—';

    const robotsBtn = document.getElementById('btn-check-robots');
    if (robotsBtn) {
      robotsBtn.disabled = _state.robotsTxtChecking;
      robotsBtn.textContent = t(_state.robotsTxtChecking ? 'idle.robotsCheckBtnChecking' : 'idle.robotsCheckBtn');
    }
    const robotsResultEl = document.getElementById('robots-txt-result');
    if (robotsResultEl) {
      const r = _state.robotsTxtResult;
      if (!r) {
        robotsResultEl.className = 'robots-txt-result hidden';
      } else if (!r.ok) {
        robotsResultEl.textContent = t('robots.checkFailed', { error: r.error });
        robotsResultEl.className = 'robots-txt-result robots-txt-unknown';
      } else if (r.notFound) {
        robotsResultEl.textContent = t('robots.notFound');
        robotsResultEl.className = 'robots-txt-result robots-txt-allowed';
      } else if (r.allowed) {
        robotsResultEl.textContent = r.matchedRule
          ? t('robots.allowedWithRule', { path: r.path, pattern: r.matchedRule.pattern })
          : t('robots.allowed', { path: r.path });
        robotsResultEl.className = 'robots-txt-result robots-txt-allowed';
      } else {
        robotsResultEl.textContent = t('robots.disallowed', { path: r.path, pattern: r.matchedRule.pattern });
        robotsResultEl.className = 'robots-txt-result robots-txt-disallowed';
      }
    }

    document.getElementById('btn-mode-flat')?.classList.toggle('active', _state.mode === 'flat');
    document.getElementById('btn-mode-container')?.classList.toggle('active', _state.mode === 'container');
    document.getElementById('btn-mode-api')?.classList.toggle('active', _state.mode === 'api');
    document.getElementById('flat-mode-section')?.classList.toggle('hidden', _state.mode !== 'flat');
    document.getElementById('container-mode-section')?.classList.toggle('hidden', _state.mode !== 'container');
    document.getElementById('api-mode-section')?.classList.toggle('hidden', _state.mode !== 'api');
    // Vorschau highlights matched DOM elements — meaningless for API-Mode.
    document.getElementById('preview-section')?.classList.toggle('hidden', _state.mode === 'api');

    // Engine + browser actions (Issue #41/#42, Phase 5) — mode-independent,
    // so this sits alongside the mode toggle above rather than inside any
    // of the three mode-specific blocks.
    document.getElementById('btn-engine-static')?.classList.toggle('active', _state.engine === 'Static');
    document.getElementById('btn-engine-browser')?.classList.toggle('active', _state.engine === 'Browser');
    document.getElementById('browser-actions-section')?.classList.toggle('hidden', _state.engine !== 'Browser');
    if (_state.engine === 'Browser') renderBrowserActions();

    if (_state.mode === 'container') {
      renderGroupTree(_state.groups);
    } else {
      renderFields();
    }

    const hasConfig = _state.mode === 'container' ? _state.groups.length > 0
      : _state.mode === 'api' ? !!_state.apiConfig
      : _state.fields.length > 0;
    const genBtn = document.getElementById('btn-generate');
    if (genBtn) genBtn.disabled = !hasConfig;
    const exportBtn = document.getElementById('btn-export-config');
    if (exportBtn) exportBtn.disabled = !hasConfig;

    const previewBtn = document.getElementById('btn-preview');
    if (previewBtn) {
      previewBtn.disabled = !hasConfig;
      previewBtn.classList.toggle('active', _state.previewActive);
      previewBtn.textContent = t(_state.previewActive ? 'idle.previewHideBtn' : 'idle.previewShowBtn');
    }
    const previewSummaryEl = document.getElementById('preview-summary');
    if (previewSummaryEl) {
      if (_state.previewActive && _state.previewSummary) {
        const { total, empty, truncated } = _state.previewSummary;
        const parts = [t('idle.previewSummaryMatched', { count: total })];
        if (empty.length > 0) parts.push(t('idle.previewSummaryEmpty', { names: empty.join(', ') }));
        if (truncated) parts.push(t('idle.previewSummaryTruncated'));
        previewSummaryEl.textContent = parts.join(' — ');
        previewSummaryEl.classList.toggle('warn', empty.length > 0);
        previewSummaryEl.classList.remove('hidden');
      } else {
        previewSummaryEl.classList.add('hidden');
      }
    }

    const apiCaptureBtn = document.getElementById('btn-api-capture');
    if (apiCaptureBtn) {
      apiCaptureBtn.classList.toggle('active', _state.apiCaptureActive);
      apiCaptureBtn.textContent = t(_state.apiCaptureActive ? 'idle.apiCaptureStopBtn' : 'idle.apiCaptureStartBtn');
    }
    const apiCaptureSummaryEl = document.getElementById('api-capture-summary');
    if (apiCaptureSummaryEl) {
      // Shown whenever there's something recorded, not just while active —
      // Phase 4's search below runs *after* the user stops recording, so
      // this is the user's only confirmation that there's something to search.
      if (_state.apiCaptureCount > 0) {
        apiCaptureSummaryEl.textContent = t('idle.apiCaptureSummary', { count: _state.apiCaptureCount });
        apiCaptureSummaryEl.classList.remove('hidden');
      } else {
        apiCaptureSummaryEl.classList.add('hidden');
      }
    }

    const apiSearchBtn = document.getElementById('btn-api-search');
    if (apiSearchBtn) apiSearchBtn.disabled = _state.apiCaptureCount === 0;

    const apiEntriesToggleBtn = document.getElementById('btn-api-entries-toggle');
    if (apiEntriesToggleBtn) {
      apiEntriesToggleBtn.disabled = _state.apiCaptureCount === 0;
      apiEntriesToggleBtn.textContent = _state.apiEntriesPanelOpen
        ? t('idle.apiEntriesHideBtn')
        : t('idle.apiEntriesShowBtn', { count: _state.apiCaptureCount });
    }
    const apiEntriesPanel = document.getElementById('api-entries-panel');
    if (apiEntriesPanel) {
      if (_state.apiEntriesPanelOpen) {
        renderApiEntriesList(_state.apiEntries);
        apiEntriesPanel.classList.remove('hidden');
      } else {
        apiEntriesPanel.classList.add('hidden');
      }
    }

    const apiCandidatesPanel = document.getElementById('api-candidates-panel');
    if (apiCandidatesPanel) {
      if (_state.apiCandidates) {
        renderApiCandidates(_state.apiCandidates);
        apiCandidatesPanel.classList.remove('hidden');
      } else {
        apiCandidatesPanel.classList.add('hidden');
      }
    }

    const apiConfigPanel = document.getElementById('api-config-panel');
    if (apiConfigPanel) {
      if (_state.apiConfig) {
        const summaryEl = document.getElementById('api-config-summary');
        if (summaryEl) {
          const { parameters, headers } = _state.apiConfig;
          summaryEl.textContent = t('idle.apiConfigSummary', {
            fields: countApiConfigFields(_state.apiConfig),
            parameters: parameters.length,
            headers: headers ? t('idle.apiConfigSummaryHeaders', { count: headers.length }) : '',
          });
        }
        apiConfigPanel.classList.remove('hidden');
      } else {
        apiConfigPanel.classList.add('hidden');
      }
    }

    // Only overwrite an input's value while it isn't the one the user is
    // currently typing in — otherwise every keystroke's setState()/render()
    // round-trip would reset the cursor to the end of the field.
    const scriptNameInput = document.getElementById('input-script-filename');
    if (scriptNameInput && document.activeElement !== scriptNameInput) scriptNameInput.value = _state.scriptFileName;
    const outputNameInput = document.getElementById('input-output-filename');
    if (outputNameInput && document.activeElement !== outputNameInput) outputNameInput.value = _state.outputFileName;
    // Container mode always forces Xml server-side (absent Json); API mode
    // forces Xml too, but only for its tree shape (Groups) — its flat shape
    // forces Csv, same as flat mode itself. Issue #86's useJsonOutput
    // toggle overrides whichever of those would otherwise apply.
    const isTreeShapedMode = _state.mode === 'container'
      || (_state.mode === 'api' && !!_state.apiConfig?.groups?.length);
    const outputExtEl = document.getElementById('output-filename-ext');
    if (outputExtEl) {
      outputExtEl.textContent = _state.useJsonOutput ? '.json' : (isTreeShapedMode ? '.xml' : '.csv');
    }

    const outputJsonToggle = document.getElementById('toggle-output-json');
    if (outputJsonToggle) outputJsonToggle.checked = _state.useJsonOutput;

    const dataPreviewToggle = document.getElementById('toggle-include-data-preview');
    if (dataPreviewToggle) dataPreviewToggle.checked = _state.includeDataPreview;

    // Issue #83: hidden for API mode — Api builds its own request URL from
    // apiConfig.urlTemplate and never reads this list at all (the companion
    // rejects the combination outright, see Program.cs).
    document.getElementById('additional-urls-row')?.classList.toggle('hidden', _state.mode === 'api');
    const additionalUrlsInput = document.getElementById('input-additional-urls');
    if (additionalUrlsInput && document.activeElement !== additionalUrlsInput) {
      additionalUrlsInput.value = _state.additionalStartUrls.join('\n');
    }

    // Issue #87: opt-in change detection + notification.
    const changeDetectionToggle = document.getElementById('toggle-change-detection');
    if (changeDetectionToggle) changeDetectionToggle.checked = _state.changeDetection.enabled;
    document.getElementById('change-detection-config')?.classList.toggle('hidden', !_state.changeDetection.enabled);
    document.getElementById('btn-notify-email')?.classList.toggle('active', _state.changeDetection.notify === 'Email');
    document.getElementById('btn-notify-webhook')?.classList.toggle('active', _state.changeDetection.notify === 'Webhook');
    document.getElementById('notify-email-fields')?.classList.toggle('hidden', _state.changeDetection.notify !== 'Email');
    document.getElementById('notify-webhook-fields')?.classList.toggle('hidden', _state.changeDetection.notify !== 'Webhook');
    const changeDetectionInputs = {
      'input-cd-smtp-host': _state.changeDetection.email.smtpHostEnvVar,
      'input-cd-smtp-port': _state.changeDetection.email.smtpPortEnvVar,
      'input-cd-smtp-username': _state.changeDetection.email.smtpUsernameEnvVar,
      'input-cd-smtp-password': _state.changeDetection.email.smtpPasswordEnvVar,
      'input-cd-email-from': _state.changeDetection.email.fromEnvVar,
      'input-cd-email-to': _state.changeDetection.email.toEnvVar,
      'input-cd-webhook-url': _state.changeDetection.webhook.urlEnvVar,
    };
    for (const [id, value] of Object.entries(changeDetectionInputs)) {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = value;
    }

    // Issue #88: opt-in proxy support.
    const proxyToggle = document.getElementById('toggle-proxy');
    if (proxyToggle) proxyToggle.checked = _state.proxy.enabled;
    document.getElementById('proxy-config')?.classList.toggle('hidden', !_state.proxy.enabled);
    const proxyEnvVarInput = document.getElementById('input-proxy-env-var');
    if (proxyEnvVarInput && document.activeElement !== proxyEnvVarInput) {
      proxyEnvVarInput.value = _state.proxy.envVar;
    }

    if (_state.containerModalOpen) {
      show('modal-container-new');
      const nameInput = document.getElementById('input-container-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const singleRadio = document.getElementById('radio-container-single');
      if (singleRadio) singleRadio.checked = true;
    }
  }

  if (_state.current === STATES.API_CONFIG && _state.apiConfigDraft) {
    renderApiConfigScreen(_state.apiConfigDraft, _state.apiDiscoveryCandidates);

    const apiTreeSearchPanel = document.getElementById('api-tree-search-panel');
    if (apiTreeSearchPanel) {
      if (_state.apiTreeSearchResult) {
        renderApiCandidates(_state.apiTreeSearchResult, { targetEl: 'api-tree-search-target', listEl: 'api-tree-search-list' });
        apiTreeSearchPanel.classList.remove('hidden');
      } else {
        apiTreeSearchPanel.classList.add('hidden');
      }
    }

    if (_state.apiGroupModalOpen) {
      show('modal-api-group-new');
      const nameInput = document.getElementById('input-api-group-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const pathInput = document.getElementById('input-api-group-path');
      if (pathInput) pathInput.value = '';
    }

    if (_state.bodyParameterModalOpen) {
      show('modal-api-body-parameter-new');
      const nameInput = document.getElementById('input-api-body-parameter-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    }

    if (_state.apiFieldTransformModalOpen) {
      show('modal-api-field-transforms');
      renderTransformList('api-field-transform-list', _state.pendingTransforms);
      // Issue #147: live preview against the node's own sampleValue, threaded
      // through as pendingRawText by openApiFieldTransformsModal — reuses the
      // same renderTransformPreview flat mode's own preview already calls.
      renderTransformPreview('api-field-transform-preview', _state.pendingRawText, _state.pendingTransforms);
    }
  }

  if (_state.current === STATES.DONE) {
    const downloadBtn = document.getElementById('btn-download');
    if (downloadBtn) {
      const filename = `${sanitizeFileNameBase(_state.scriptFileName, 'scraper')}.py`;
      downloadBtn.textContent = t('done.downloadBtn', { filename });
    }
    renderDataPreview(_state.dataPreview);
  }

  // Show modal when an element has been captured during selection. Editing
  // the transform chain (Issue #84) re-renders while this modal stays open
  // (each row edit goes through patchState) — the reset-to-defaults/focus
  // block below must therefore only run on the actual closed→open
  // transition, not on every one of those re-renders, or it would wipe the
  // name/mode the user already typed on every transform edit. See
  // lastFieldModalSelector's own doc comment for why this can't just check
  // the modal's current DOM visibility instead.
  if (_state.current === STATES.SELECTING && _state.pendingSelector !== null) {
    const isNewPick = _state.pendingSelector !== lastFieldModalSelector;
    lastFieldModalSelector = _state.pendingSelector;

    if (_state.mode === 'container') {
      show('modal-field-extended');
      if (isNewPick) {
        const nameInput = document.getElementById('input-field-extended-name');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        const modeSelect = document.getElementById('select-field-mode');
        if (modeSelect) modeSelect.value = 'text';
        document.getElementById('field-attribute-row')?.classList.add('hidden');
        document.getElementById('field-extended-transforms-section')?.classList.remove('hidden');
        const attrInput = document.getElementById('input-field-attribute');
        if (attrInput) attrInput.value = '';
      }
      renderMatchCountHint('field-extended-match-count', _state.pendingMatchCount);
      renderTransformList('field-extended-transform-list', _state.pendingTransforms);
      refreshExtendedTransformPreview();
    } else {
      show('modal-field-name');
      if (isNewPick) {
        const input = document.getElementById('input-field-name');
        if (input) { input.value = ''; input.focus(); }
      }
      renderMatchCountHint('field-name-match-count', _state.pendingMatchCount);
      renderTransformList('field-transform-list', _state.pendingTransforms);
      refreshFlatTransformPreview();
    }
  } else {
    lastFieldModalSelector = null;
  }

  if (_state.current === STATES.SELECTING) {
    const toggle = document.getElementById('toggle-dom-view');
    if (toggle) toggle.checked = _state.domViewEnabled;

    const wrapper = document.getElementById('dom-tree-wrapper');
    if (wrapper) wrapper.classList.toggle('hidden', !_state.domViewEnabled);

    const loading = document.getElementById('dom-tree-loading');
    if (loading) loading.classList.toggle('hidden', _state.domTree !== null || !!_state.domTreeError);

    const error = document.getElementById('dom-tree-error');
    if (error) error.classList.toggle('hidden', !_state.domTreeError);

    const truncated = document.getElementById('dom-tree-truncated');
    if (truncated) truncated.classList.toggle('hidden', !_state.domTreeTruncated);
  }
}

function renderFields(fields = _state.fields) {
  const listEl = document.getElementById('fields-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  fields.forEach((field, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML =
      `<span class="field-name" title="${escapeHtml(field.name)}">${escapeHtml(field.name)}</span>` +
      `<span class="field-selector" title="${escapeHtml(field.selector)}">${escapeHtml(field.selector)}</span>` +
      frameBadgeHtml(field.framePath) +
      `<button class="btn-danger btn-remove-field" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
    listEl.appendChild(row);
  });
}

// Issue #41/#42, Phase 5/6. One card per action, kind fixed at creation time
// (via btn-add-action-wait/-fill/-click/-scroll) — unlike the API-config
// parameter cards, there's no "change the kind afterward" control, since an
// action is created from scratch by the user rather than pre-existing (see
// renderApiConfigParameters for that different case).
function renderBrowserActions(actions = _state.browserActions, testValues = _state.fillTestValues) {
  const container = document.getElementById('browser-actions-list');
  if (!container) return;
  container.innerHTML = '';

  const kindLabels = {
    waitFor: t('browserActions.kindWaitFor'),
    fill: t('browserActions.kindFill'),
    click: t('browserActions.kindClick'),
    scroll: t('browserActions.kindScroll'),
  };

  // A single "pick element" row bound to a specific property of `action`
  // (data-field) — every kind but 'scroll' has exactly one such row
  // (property 'selector'); 'scroll' has two (containerSelector/
  // loadMoreButtonSelector), both optional, see buildSelectorRow's callers.
  function buildSelectorRow(index, field, value, label) {
    const row = document.createElement('div');
    row.className = 'browser-action-selector-row';
    const selectorText = value || t('browserActions.noSelector');
    const labelHtml = label ? `<label>${escapeHtml(label)}</label>` : '';
    row.innerHTML =
      labelHtml +
      `<span class="field-selector" title="${escapeHtml(selectorText)}">${escapeHtml(selectorText)}</span>` +
      `<button type="button" class="btn-secondary btn-tiny btn-pick-action-selector" data-index="${index}" data-field="${field}">${escapeHtml(t('browserActions.pickSelectorBtn'))}</button>`;
    return row;
  }

  actions.forEach((action, i) => {
    const card = document.createElement('div');
    card.className = 'browser-action-card';
    card.dataset.index = i;

    const header = document.createElement('div');
    header.className = 'browser-action-header';
    header.innerHTML =
      `<span class="row-label">${escapeHtml(kindLabels[action.kind] || action.kind)}</span>` +
      frameBadgeHtml(action.framePath) +
      `<button type="button" class="btn-danger btn-remove-action" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
    card.appendChild(header);

    if (action.kind === 'scroll') {
      card.appendChild(buildSelectorRow(i, 'containerSelector', action.containerSelector, t('browserActions.containerSelectorLabel')));
      card.appendChild(buildSelectorRow(i, 'loadMoreButtonSelector', action.loadMoreButtonSelector, t('browserActions.loadMoreButtonSelectorLabel')));

      const row = document.createElement('div');
      row.className = 'browser-action-field-row';
      row.innerHTML =
        `<label>${escapeHtml(t('browserActions.maxIterationsLabel'))}</label>` +
        `<input type="number" min="1" class="browser-action-max-iterations" data-index="${i}" value="${action.maxIterations}" />` +
        `<label>${escapeHtml(t('browserActions.waitAfterMsLabel'))}</label>` +
        `<input type="number" min="0" class="browser-action-wait-after-ms" data-index="${i}" value="${action.waitAfterMs}" />`;
      card.appendChild(row);

      container.appendChild(card);
      return;
    }

    card.appendChild(buildSelectorRow(i, 'selector', action.selector, null));

    if (action.kind === 'waitFor') {
      const row = document.createElement('div');
      row.className = 'browser-action-field-row';
      row.innerHTML =
        `<label>${escapeHtml(t('browserActions.timeoutLabel'))}</label>` +
        `<input type="number" min="1" class="browser-action-timeout" data-index="${i}" value="${action.timeoutMs}" />`;
      card.appendChild(row);
    } else if (action.kind === 'fill') {
      const row = document.createElement('div');
      row.className = 'browser-action-field-row';
      row.innerHTML =
        `<label>${escapeHtml(t('browserActions.envVarLabel'))}</label>` +
        `<input type="text" class="browser-action-env-name" data-index="${i}" placeholder="${escapeHtml(t('browserActions.envNamePlaceholder'))}" value="${escapeHtml(action.environmentVariableName || '')}" />`;
      card.appendChild(row);

      const hint = document.createElement('p');
      hint.className = 'browser-action-hint';
      hint.textContent = t('browserActions.envVarHint');
      card.appendChild(hint);

      // Issue #43: one-time test value for the /generate verification trial
      // run only — keyed by env-var name (not action index) so the change
      // handler doesn't need to look the action up by position. Only shown
      // once the env var name is actually set, since that's the join key.
      const envName = (action.environmentVariableName || '').trim();
      if (envName) {
        const testValueRow = document.createElement('div');
        testValueRow.className = 'browser-action-field-row';
        testValueRow.innerHTML =
          `<label>${escapeHtml(t('browserActions.testValueLabel'))}</label>` +
          `<input type="password" class="browser-action-test-value" data-env-name="${escapeHtml(envName)}" ` +
          `placeholder="${escapeHtml(t('browserActions.testValuePlaceholder'))}" value="${escapeHtml(testValues[envName] || '')}" />`;
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

// ── DOM tree view ────────────────────────────────────────────────────────────
// Rendered imperatively (not through render()) so a user's expand/collapse
// clicks survive unrelated state updates (e.g. adding/removing a field).

// Issue #139: one static inline chevron per row instead of swapping between
// two different Unicode glyphs (▸/▾) on click — see container-tree-ui.js's
// own copy of this constant for the full rationale. Unlike the group/api
// trees, this one starts *collapsed* (see buildTreeNodeEl/expandAncestors
// below), so the .collapsed class is applied at build time here too.
const TREE_TOGGLE_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"></polyline></svg>';

function formatTreeLabel(node) {
  let label = node.tag;
  if (node.id) label += `#${node.id}`;
  if (node.classes.length) label += `.${node.classes.join('.')}`;
  return label;
}

function buildTreeNodeEl(node, depth) {
  const li = document.createElement('li');
  li.className = 'dom-tree-node';
  li.dataset.path = JSON.stringify(node.path);

  const row = document.createElement('div');
  row.className = 'dom-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'dom-tree-toggle';
  if (hasChildren) toggle.innerHTML = TREE_TOGGLE_CHEVRON_SVG;
  toggle.classList.toggle('collapsed', hasChildren); // starts collapsed, unlike the group/api trees
  row.appendChild(toggle);

  const label = document.createElement('span');
  label.textContent = formatTreeLabel(node);
  row.appendChild(label);

  li.appendChild(row);

  if (hasChildren) {
    const childUl = document.createElement('ul');
    childUl.className = 'dom-tree-children hidden';
    node.children.forEach(child => childUl.appendChild(buildTreeNodeEl(child, depth + 1)));
    li.appendChild(childUl);

    toggle.addEventListener('click', () => {
      const collapsed = childUl.classList.toggle('hidden');
      toggle.classList.toggle('collapsed', collapsed);
    });
  }

  return li;
}

function renderDomTree(tree) {
  const root = document.getElementById('dom-tree-root');
  if (!root || !tree) return;
  root.innerHTML = '';
  root.appendChild(buildTreeNodeEl(tree, 0));
}

function findTreeNode(path) {
  return document.querySelector(`#dom-tree-root li[data-path='${JSON.stringify(path)}']`);
}

// Un-collapses every ancestor <ul> of `li` so it becomes visible/scrollable-to.
function expandAncestors(li) {
  let ul = li.parentElement;
  while (ul && ul.classList.contains('dom-tree-children')) {
    ul.classList.remove('hidden');
    const ownerLi = ul.parentElement;
    const toggle = ownerLi.firstElementChild.querySelector('.dom-tree-toggle');
    if (toggle) toggle.classList.remove('collapsed');
    ul = ownerLi.parentElement;
  }
}

let _lastHoverRow = null;

function highlightHover(path) {
  if (_lastHoverRow) _lastHoverRow.classList.remove('hover');
  const li = findTreeNode(path);
  const row = li?.firstElementChild ?? null;
  if (li && row) {
    row.classList.add('hover');
    expandAncestors(li);
    li.scrollIntoView?.({ block: 'nearest' });
  }
  _lastHoverRow = row;
}

function highlightSelected(path) {
  document.querySelectorAll('#dom-tree-root .dom-tree-row.selected')
    .forEach(el => el.classList.remove('selected'));
  const li = findTreeNode(path);
  const row = li?.firstElementChild ?? null;
  if (li && row) {
    row.classList.add('selected');
    expandAncestors(li);
    li.scrollIntoView?.({ block: 'nearest' });
  }
}

// ── Preview mode ──────────────────────────────────────────────────────────────
// Sends the current Fields/Groups to the content script so it can match them
// against the live DOM and highlight the results directly on the page — see
// content-script.js's computePreviewMatches/startPreview for the matching
// semantics (mirrors the backend codegen exactly).

function startPreview() {
  const hasConfig = _state.mode === 'container' ? _state.groups.length > 0 : _state.fields.length > 0;
  if (!hasConfig) return;

  const payload = _state.mode === 'container'
    ? { groups: serializeGroupTree(_state.groups) }
    : { fields: _state.fields.map(f => ({ name: f.name, selector: f.selector })) };
  log('PREVIEW_START', { mode: _state.mode, ...payload });
  chrome.runtime.sendMessage({ type: 'PREVIEW_START', mode: _state.mode, ...payload });
  patchState({ previewActive: true, previewSummary: null });
}

function stopPreview() {
  log('PREVIEW_STOP');
  chrome.runtime.sendMessage({ type: 'PREVIEW_STOP' });
  patchState({ previewActive: false, previewSummary: null });
}

function togglePreview() {
  if (_state.previewActive) stopPreview(); else startPreview();
}

// Called wherever the Fields/Groups configuration changes or a new selection
// starts — an active preview would otherwise keep showing highlights for a
// configuration that no longer matches the current state.
function stopPreviewIfActive() {
  if (_state.previewActive) stopPreview();
}

// ── Async actions ─────────────────────────────────────────────────────────────

async function checkCompanion() {
  companionUrl = await getCompanionUrl();
  log('HEALTH_CHECK start', companionUrl);
  try {
    const res = await fetch(`${companionUrl}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('HEALTH_CHECK OK');

    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    const url = tabs[0]?.url ?? '';
    log('TAB_URL', url);
    setState(STATES.IDLE, { url });
  } catch (err) {
    log('HEALTH_CHECK FAIL', err.message);
    setLastError(err.message, 'Companion connection');
    setState(STATES.COMPANION_ERROR);
  }
}

// Manual override entry point for the COMPANION_ERROR screen — lets the user
// point at a companion instance running on another host/port (e.g. a custom
// Companion:Port in its own appsettings.json) when the default address isn't
// reachable. Persisted via setCompanionUrlOverride so it's remembered for
// the next session (see shared/companion-config.js), then re-runs the same
// health check a plain retry would.
async function useCustomCompanionUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  let parsed = null;
  try {
    parsed = new URL(normalized);
  } catch {
    // parsed stays null — reported as invalid below, same as an empty input.
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    showToast(t('toast.invalidCompanionUrl'));
    return;
  }
  log('COMPANION_URL_OVERRIDE set', normalized);
  await setCompanionUrlOverride(normalized);
  setState(STATES.CHECKING_COMPANION);
  await checkCompanion();
}

async function resetCustomCompanionUrl() {
  log('COMPANION_URL_OVERRIDE reset');
  await resetCompanionUrlOverride();
  setState(STATES.CHECKING_COMPANION);
  await checkCompanion();
}

// robots.txt is fetched by the content script (same-origin relative to the
// inspected page, see checkRobotsTxt in content-script.js) — the side panel
// only relays the request/response through the service worker, same
// request/response shape as GET_LOGS above.
async function checkRobotsTxt() {
  log('ROBOTS_TXT_CHECK start');
  patchState({ robotsTxtChecking: true, robotsTxtResult: null });
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_ROBOTS_TXT' });
    log('ROBOTS_TXT_CHECK result', result);
    patchState({ robotsTxtChecking: false, robotsTxtResult: result });
  } catch (err) {
    log('ROBOTS_TXT_CHECK failed', err.message);
    patchState({ robotsTxtChecking: false, robotsTxtResult: { ok: false, error: err.message } });
  }
}

// The companion actually generates and runs the script against the live
// page before handing it out (same rendering stage, and now the exact
// artifact the user would download) and responds 422 with a message when
// that run fails or errors — is the page unreachable, does the script raise
// an exception, or does it run cleanly but write no data (all selectors
// found nothing). `data` is logged separately so it ends up in the bug
// report if the user reports it.
function buildVerificationErrorMessage(data) {
  return data?.error || t('toast.verificationFailed');
}

async function generate() {
  stopPreviewIfActive();
  setState(STATES.GENERATING);
  const config = buildScrapingConfig(
    _state.url, _state.mode, _state.fields, _state.groups, _state.apiConfig,
    _state.scriptFileName, _state.outputFileName, _state.engine, _state.browserActions, _state.includeDataPreview,
    _state.useJsonOutput, _state.additionalStartUrls, _state.changeDetection, _state.proxy,
  );
  // Issue #43: one-time login/test values, sent only in this request body —
  // deliberately kept out of `config` (and therefore out of the log line
  // below, buildConfigExport, and the "Report bug" log export) since none of
  // those are meant to ever see them. See fillTestValues/buildVerificationValues.
  const verificationValues = _state.engine === 'Browser'
    ? buildVerificationValues(_state.browserActions, _state.fillTestValues)
    : {};
  log('GENERATE request', config);
  try {
    const res = await fetch(`${companionUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        Object.keys(verificationValues).length > 0 ? { ...config, verificationValues } : config,
      ),
    });
    if (res.status === 400) {
      // A structural config rejection (bad URL, mutually exclusive Fields/
      // Groups/Api, a FramePath without Engine=Browser, ...) — always a
      // deterministic, pre-execution validation failure caused by the
      // current configuration, never a companion/script malfunction. Unlike
      // the 422/network-error cases below, no "Report bug" prompt is
      // offered — showToast's context arg is intentionally omitted, since
      // inviting a bug report here would just fill GitHub issues with
      // non-bugs (an invalid config, not a defect).
      const data = await res.json().catch(() => null);
      log('GENERATE CONFIG INVALID', data);
      setState(STATES.IDLE);
      showToast(t('toast.configInvalid', { message: data?.error || t('toast.verificationFailed') }));
      return;
    }
    if (res.status === 422) {
      const data = await res.json().catch(() => null);
      log('GENERATE VERIFICATION FAIL', data);
      throw new Error(buildVerificationErrorMessage(data));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Issue #122: only when includeDataPreview asked for it does the
    // companion respond with a JSON envelope ({ script, preview }) instead
    // of the plain script text — the client already knows which one it
    // requested, no need to sniff the response's Content-Type.
    let scriptText;
    let dataPreview = null;
    if (_state.includeDataPreview) {
      const data = await res.json();
      scriptText = data.script;
      dataPreview = data.preview ?? null;
    } else {
      scriptText = await res.text();
    }
    log('GENERATE OK', `${scriptText.length} chars` + (dataPreview ? `, preview: ${dataPreview.totalCount} rows/elements` : ''));
    setState(STATES.DONE, { scriptText, dataPreview });
  } catch (err) {
    log('GENERATE FAIL', err.message);
    setState(STATES.IDLE);
    showToast(t('toast.generationError', { message: err.message }), 'Script generation');
  }
}

function triggerDownload() {
  const fileName = `${sanitizeFileNameBase(_state.scriptFileName, 'scraper')}.py`;
  log('DOWNLOAD', fileName);
  const blob = new Blob([_state.scriptText], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Lets a user hand over the current Fields/Groups configuration when
// reporting a selector problem, without having to describe their setup by
// hand — e.g. attached to a "Report bug" GitHub issue or shared directly.
function downloadConfigExport() {
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};
  const exportObj = buildConfigExport(
    _state.url, _state.mode, _state.fields, _state.groups, manifest, _state.apiConfig,
    _state.scriptFileName, _state.outputFileName, _state.engine, _state.browserActions, _state.includeDataPreview,
    _state.useJsonOutput, _state.additionalStartUrls, _state.changeDetection, _state.proxy,
  );
  log('DOWNLOAD scraping-config.json', exportObj);

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `scraping-config-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Issue #122: renders the last successful /generate's trial-run data
// sample on the DONE screen. `preview` is the companion's ScriptPreviewData
// (see companion/ScrapingFactory.Compiler/Backends/ScriptPreviewData.cs),
// or null — the checkbox was off, or (older companion) IncludePreview isn't
// supported yet. Named "renderDataPreview"/"dataPreview" throughout, not
// bare "preview" — that name already belongs to the unrelated DOM-highlight
// feature (previewActive/togglePreview/#btn-preview above), which
// highlights matched elements on the live page and has nothing to do with
// the generated script's actual trial-run output.
// Builds the table via DOM APIs + textContent (not innerHTML), so scraped
// values never need HTML-escaping here at all.
// Issue #86: Json covers two shapes (flat array → table, tree → text
// sample), so which renderer to use is decided by which sample field is
// actually populated (xmlSample/jsonSample vs. columns/rows) rather than by
// outputFormat alone — outputFormat is still shown to the user via i18n
// copy, but no longer drives the branch itself.
function renderDataPreview(preview) {
  const panel = document.getElementById('data-preview-panel');
  if (!panel) return;
  if (!preview) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const tableWrap = document.getElementById('data-preview-table-wrap');
  const textWrap = document.getElementById('data-preview-text');
  const truncatedNote = document.getElementById('data-preview-truncated');
  const textSample = preview.xmlSample ?? preview.jsonSample;

  if (textSample != null) {
    tableWrap?.classList.add('hidden');
    if (textWrap) {
      textWrap.classList.remove('hidden');
      textWrap.textContent = textSample;
    }
    if (truncatedNote) {
      truncatedNote.classList.toggle('hidden', !preview.truncated);
      truncatedNote.textContent = preview.truncated ? t('done.dataPreviewTruncatedXml') : '';
    }
    return;
  }

  textWrap?.classList.add('hidden');
  if (tableWrap) {
    tableWrap.classList.remove('hidden');
    tableWrap.innerHTML = '';

    const columns = preview.columns || [];
    const rows = preview.rows || [];

    const table = document.createElement('table');
    table.className = 'data-preview-table';

    const headRow = document.createElement('tr');
    columns.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col;
      headRow.appendChild(th);
    });
    const thead = document.createElement('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      columns.forEach((col) => {
        const td = document.createElement('td');
        td.textContent = row[col] ?? '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  if (truncatedNote) {
    truncatedNote.classList.toggle('hidden', !preview.truncated);
    truncatedNote.textContent = preview.truncated
      ? t('done.dataPreviewTruncatedCsv', { shown: (preview.rows || []).length, total: preview.totalCount })
      : '';
  }
}

// `context` is a short human label (e.g. "Script generation"); passing it
// marks the error as reportable — the toast then also offers "Report
// bug" and the message/context are attached to the next bug report.
// `variant` ('info' | 'warn') is Issue #85's own non-error use of this same
// toast (container-group match-count feedback, see showMatchCountToast) —
// omitted, it's the original red error styling, unchanged.
function showToast(message, context, variant) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;

  const msgEl = document.getElementById('error-toast-message');
  if (msgEl) msgEl.textContent = message; else toast.textContent = message;

  const reportBtn = document.getElementById('btn-report-bug-toast');
  if (reportBtn) reportBtn.classList.toggle('hidden', !context);
  if (context) setLastError(message, context);

  toast.classList.remove('toast-info', 'toast-warn');
  if (variant === 'info') toast.classList.add('toast-info');
  if (variant === 'warn') toast.classList.add('toast-warn');

  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), context ? 8000 : 4000);
}

// Issue #85: existence/quantity feedback for a container-group's own
// selector, right after it was inserted straight into the tree (see the
// ELEMENT_SELECTED handler above) — the direct-insert flow has no
// confirmation modal to show a match-count hint in the way
// renderMatchCountHint does for a flat/container field pick, so a toast is
// the next best surfacing. Amber for a 0-match pick (the exact case this
// issue exists to catch early, instead of only failing much later at
// /generate), green otherwise. Silently skipped if the content script
// couldn't compute a count at all (matchCount === null).
function showMatchCountToast(containerName, matchCount) {
  if (matchCount === null) return;
  showToast(t('toast.containerAdded', { name: containerName, count: matchCount }), null, matchCount === 0 ? 'warn' : 'info');
}

// ── Bug reporting ─────────────────────────────────────────────────────────────
// Combines this side panel's own log buffer with the service worker's and
// (best-effort, via the service worker) the active tab's content script's,
// so a user hitting an error can attach real diagnostic context to a GitHub
// issue in one click instead of having to copy devtools console output by hand.

const GITHUB_REPO_URL = 'https://github.com/Aventinis/Scraping-Factory';
const BUG_REPORT_LOG_EXCERPT_LIMIT = 5000; // chars embedded directly in the GitHub issue body

let lastReportedError = null; // { message, context, ts } — feeds the next bug report

function setLastError(message, context) {
  lastReportedError = { message, context, ts: new Date().toISOString() };
}

async function collectLogs() {
  const popup = getLogBuffer();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    return { popup, background: response?.background ?? [], content: response?.content ?? null, contentError: response?.contentError ?? null };
  } catch (err) {
    log('GET_LOGS failed', err.message);
    return { popup, background: [], content: null, contentError: err.message };
  }
}

// This log/bug-report format is always English, independent of the popup's
// selected UI language — it's a diagnostic artifact for maintainers on the
// public, English-language GitHub repo, not conversational UI a
// multilingual end user reads day-to-day (see CLAUDE.md's Language policy).
function formatLogSection(title, entries) {
  if (!entries || entries.length === 0) return `## ${title}\n(no entries)\n`;
  const lines = entries.map(e => `${e.ts} ${e.event}${e.data !== null ? ' ' + JSON.stringify(e.data) : ''}`);
  return `## ${title}\n${lines.join('\n')}\n`;
}

async function buildBugReport() {
  const { popup, background, content, contentError } = await collectLogs();
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};

  const header = [
    '# Scraping Factory — Bug Report',
    `Timestamp: ${new Date().toISOString()}`,
    `Extension version: ${manifest.version || '?'}`,
    `Page: ${_state.url || '—'}`,
    lastReportedError ? `Last error: ${lastReportedError.message} (${lastReportedError.context})` : null,
  ].filter(Boolean).join('\n');

  const sections = [
    formatLogSection('Side Panel', popup),
    formatLogSection('Service Worker', background),
    contentError ? `## Content Script\n(unavailable: ${contentError})\n` : formatLogSection('Content Script', content),
  ].join('\n');

  return `${header}\n\n${sections}`;
}

function downloadBugReport(text) {
  log('DOWNLOAD bug-report.log');
  const blob = new Blob([text], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `bug-report-${Date.now()}.log`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// GitHub (and browsers) reject a new-issue URL past a certain length outright
// ("the URI you submitted is too long") instead of silently truncating it —
// so unlike BUG_REPORT_LOG_EXCERPT_LIMIT (a raw-character budget for the log
// excerpt), this is checked against the *actual* encoded URL, since percent-
// encoding (quotes/braces/newlines in JSON log data, in particular) can
// inflate length well past what the raw excerpt accounts for.
const GITHUB_ISSUE_URL_LIMIT = 8000;

function buildIssueTitle() {
  return lastReportedError ? `Error: ${lastReportedError.message}` : 'Bug report';
}

function buildIssueUrl(title, body) {
  return `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

// Prefills a new GitHub issue. Short reports are embedded in full so the
// issue is ready to submit as-is; longer ones are trailed off with a note
// pointing at the downloaded bug-report.log. If the resulting URL would
// still exceed GitHub's practical length limit (e.g. the error message
// itself is a huge traceback), we degrade further rather than hand back a
// broken link — down to an entirely unfilled issue as the last resort. An
// issue is always opened either way; the full log is already on disk via
// downloadBugReport() for the user to attach manually.
function buildGithubIssueUrl(reportText) {
  const title = buildIssueTitle();
  const truncated = reportText.length > BUG_REPORT_LOG_EXCERPT_LIMIT;
  const excerpt = truncated ? reportText.slice(-BUG_REPORT_LOG_EXCERPT_LIMIT) : reportText;

  const body = [
    'Please briefly describe what you were doing when the error occurred.',
    '',
    '<details><summary>Log</summary>',
    '',
    '```',
    excerpt,
    '```',
    '</details>',
    truncated ? '\n_(Log truncated — please also attach the downloaded bug-report.log file to this issue.)_' : '',
  ].filter(Boolean).join('\n');

  const prefilledUrl = buildIssueUrl(title, body);
  if (prefilledUrl.length <= GITHUB_ISSUE_URL_LIMIT) return prefilledUrl;

  const fallbackBody = [
    'Please briefly describe what you were doing when the error occurred.',
    '',
    '_(The automatically collected log was too long to prefill here — please attach the downloaded bug-report.log file to this issue instead.)_',
  ].join('\n');
  const fallbackUrl = buildIssueUrl(title, fallbackBody);
  if (fallbackUrl.length <= GITHUB_ISSUE_URL_LIMIT) return fallbackUrl;

  // Even the title alone (e.g. a huge error message used as-is) pushes past
  // the limit — open a fully blank issue.
  return `${GITHUB_REPO_URL}/issues/new`;
}

async function reportBug() {
  log('BTN report-bug');
  const reportText = await buildBugReport();
  downloadBugReport(reportText);
  chrome.tabs.create({ url: buildGithubIssueUrl(reportText) });
}

// ── Field-name modal ──────────────────────────────────────────────────────────

function confirmField() {
  const name = document.getElementById('input-field-name')?.value.trim();
  if (!name) return;
  if (!transformsAreValid(_state.pendingTransforms)) return;
  log('FIELD_ADD', { name, selector: _state.pendingSelector, framePath: _state.pendingFramePath, transforms: _state.pendingTransforms });
  setState(STATES.IDLE, {
    fields:           addField(_state.fields, name, _state.pendingSelector, _state.pendingFramePath, _state.pendingTransforms),
    pendingSelector:  null,
    pendingFramePath: null,
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingTransforms: [],
  });
}

// ── Container-Mode: mode switch, container/field add flows ─────────────────

// Strictly separate — switching modes clears the *other* modes' configs
// rather than keeping all three around.
// apiConfigDraft is cleared defensively alongside apiConfig when switching
// *away* from api mode — unreachable in practice today (the mode buttons
// only live on screen-idle, and a non-null apiConfigDraft means
// screen-api-config is showing instead), but keeps this table's own
// "switching modes clears the other modes' configuration" contract honest
// regardless of that.
const MODE_SWITCH_CLEARS = {
  flat:      { groups: [], apiConfig: null, apiConfigDraft: null },
  container: { fields: [], apiConfig: null, apiConfigDraft: null },
  api:       { fields: [], groups: [] },
};

function switchMode(mode) {
  if (mode === _state.mode) return;
  log('MODE_SWITCH', mode);
  stopPreviewIfActive();
  setState(_state.current, { mode, ...MODE_SWITCH_CLEARS[mode] });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  // Passed to every api-config-ui.js/container-tree-ui.js handler below,
  // instead of those functions closing over this file's own module-level
  // state — see api-config-ui.js's own doc comment for why.
  const bridge = {
    getState: () => _state,
    setState,
    patchState,
    stopPreviewIfActive,
    requestDomTree,
    showToast,
  };

  document.getElementById('lang-select')?.addEventListener('change', async (e) => {
    log('LANG_SELECT change', e.target.value);
    await setLanguage(e.target.value);
    applyStaticTranslations();
    render(); // re-render currently-visible dynamic content (group tree, API candidates, …) in the new language
  });

  document.getElementById('btn-report-bug-error')?.addEventListener('click', reportBug);
  document.getElementById('btn-report-bug-toast')?.addEventListener('click', reportBug);
  document.getElementById('btn-report-bug-domtree')?.addEventListener('click', reportBug);

  document.getElementById('btn-retry')?.addEventListener('click', () => {
    log('BTN retry');
    setState(STATES.CHECKING_COMPANION);
    checkCompanion();
  });

  document.getElementById('btn-use-companion-url')?.addEventListener('click', () => {
    log('BTN use-companion-url');
    const input = document.getElementById('input-companion-url');
    useCustomCompanionUrl(input?.value || '');
  });

  document.getElementById('btn-reset-companion-url')?.addEventListener('click', () => {
    log('BTN reset-companion-url');
    resetCustomCompanionUrl();
  });

  document.getElementById('btn-preview')?.addEventListener('click', () => {
    log('BTN preview');
    togglePreview();
  });

  document.getElementById('btn-check-robots')?.addEventListener('click', () => {
    log('BTN check-robots');
    checkRobotsTxt();
  });

  document.getElementById('btn-api-capture')?.addEventListener('click', () => {
    log('BTN api-capture');
    toggleApiCapture(bridge);
  });

  document.getElementById('input-script-filename')?.addEventListener('input', (e) => {
    setState(_state.current, { scriptFileName: e.target.value });
  });
  document.getElementById('input-output-filename')?.addEventListener('input', (e) => {
    setState(_state.current, { outputFileName: e.target.value });
  });
  document.getElementById('input-additional-urls')?.addEventListener('input', (e) => {
    setState(_state.current, { additionalStartUrls: parseAdditionalUrls(e.target.value) });
  });

  // Issue #87: opt-in change detection + notification.
  document.getElementById('toggle-change-detection')?.addEventListener('change', (e) => {
    setState(_state.current, { changeDetection: { ..._state.changeDetection, enabled: e.target.checked } });
  });
  document.getElementById('btn-notify-email')?.addEventListener('click', () => {
    setState(_state.current, { changeDetection: { ..._state.changeDetection, notify: 'Email' } });
  });
  document.getElementById('btn-notify-webhook')?.addEventListener('click', () => {
    setState(_state.current, { changeDetection: { ..._state.changeDetection, notify: 'Webhook' } });
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
      setState(_state.current, {
        changeDetection: { ..._state.changeDetection, email: { ..._state.changeDetection.email, [field]: e.target.value } },
      });
    });
  }
  document.getElementById('input-cd-webhook-url')?.addEventListener('input', (e) => {
    setState(_state.current, {
      changeDetection: { ..._state.changeDetection, webhook: { ..._state.changeDetection.webhook, urlEnvVar: e.target.value } },
    });
  });

  // Issue #88: opt-in proxy support.
  document.getElementById('toggle-proxy')?.addEventListener('change', (e) => {
    setState(_state.current, { proxy: { ..._state.proxy, enabled: e.target.checked } });
  });
  document.getElementById('input-proxy-env-var')?.addEventListener('input', (e) => {
    setState(_state.current, { proxy: { ..._state.proxy, envVar: e.target.value } });
  });

  document.getElementById('toggle-include-data-preview')?.addEventListener('change', (e) => {
    log('BTN toggle-include-data-preview', e.target.checked);
    patchState({ includeDataPreview: e.target.checked });
  });

  document.getElementById('toggle-output-json')?.addEventListener('change', (e) => {
    log('BTN toggle-output-json', e.target.checked);
    patchState({ useJsonOutput: e.target.checked });
  });

  document.getElementById('btn-api-search')?.addEventListener('click', () => {
    log('BTN api-search');
    startApiFieldSearch(bridge);
  });

  document.getElementById('btn-api-entries-toggle')?.addEventListener('click', () => {
    log('BTN api-entries-toggle');
    toggleApiEntriesPanel(bridge);
  });

  // Event delegation for the sibling-field suggestion chips and the "Use"
  // row — shared by both candidate-search panels (the primary/root search's
  // #api-candidates-list and Phase A5's "add root group"/"add sub-field"
  // search's #api-tree-search-list, see renderApiCandidates' own `ids` doc
  // comment): identical markup and interaction, only getCandidates/onConfirm
  // differ per caller.
  function wireApiCandidateListEvents(listElId, getCandidates, onConfirm) {
    document.getElementById(listElId)?.addEventListener('click', (e) => {
      const chip = e.target.closest('.api-sibling-chip');
      if (chip) {
        chip.classList.toggle('picked');
        log('API_CANDIDATE sibling toggled', chip.dataset.siblingName);
        return;
      }

      const selectAllBtn = e.target.closest('.api-sibling-select-all');
      if (selectAllBtn) {
        const chips = selectAllBtn.closest('.api-candidate-siblings').querySelectorAll('.api-sibling-chip');
        const allPicked = Array.from(chips).every(c => c.classList.contains('picked'));
        chips.forEach(c => c.classList.toggle('picked', !allPicked));
        selectAllBtn.textContent = t(allPicked ? 'apiCandidates.selectAllChips' : 'apiCandidates.deselectAllChips');
        log('API_CANDIDATE siblings select-all', { toggledTo: !allPicked });
        return;
      }

      const confirmBtn = e.target.closest('.api-candidate-confirm');
      if (confirmBtn) {
        const index = parseInt(confirmBtn.dataset.candidateIndex, 10);
        const candidate = getCandidates()?.[index];
        if (!candidate) return;
        const li = confirmBtn.closest('.api-candidate');
        const fieldName = li.querySelector('.api-candidate-field-name')?.value.trim();
        if (!fieldName) return;
        const siblingNames = Array.from(li.querySelectorAll('.api-sibling-chip.picked')).map(c => c.dataset.siblingName);
        onConfirm(candidate, fieldName, siblingNames);
      }
    });

    // Enables "Use" once a field name has been typed for that row.
    document.getElementById(listElId)?.addEventListener('input', (e) => {
      const input = e.target.closest('.api-candidate-field-name');
      if (!input) return;
      const li = input.closest('.api-candidate');
      const confirmBtn = li?.querySelector('.api-candidate-confirm');
      if (confirmBtn) confirmBtn.disabled = input.value.trim() === '';
    });
  }

  wireApiCandidateListEvents(
    'api-candidates-list', () => _state.apiCandidates?.candidates,
    (candidate, fieldName, siblingNames) => confirmApiFieldCandidate(bridge, candidate, fieldName, siblingNames),
  );
  wireApiCandidateListEvents(
    'api-tree-search-list', () => _state.apiTreeSearchResult?.candidates,
    (candidate, fieldName, siblingNames) => confirmApiTreeFieldCandidate(bridge, candidate, fieldName, siblingNames),
  );

  document.getElementById('btn-api-tree-add-root')?.addEventListener('click', () => startApiTreeFieldSearch(bridge, null));

  // Event delegation for the API-tree's per-row add/remove buttons and name
  // input — mirrors the Container-tree's own delegation below.
  document.getElementById('api-tree-root')?.addEventListener('click', (e) => {
    const li = e.target.closest('.api-tree-node');
    if (!li) return;
    const path = JSON.parse(li.dataset.path);

    if (e.target.closest('.btn-add-api-subgroup')) { openApiGroupModal(bridge, path); return; }
    if (e.target.closest('.btn-add-api-subfield')) { startApiTreeFieldSearch(bridge, path); return; }
    if (e.target.closest('.btn-api-field-transforms')) { openApiFieldTransformsModal(bridge, path); return; }
    if (e.target.closest('.btn-remove-api-node')) {
      log('API_TREE_NODE_REMOVE', { path });
      setState(_state.current, { apiConfigDraft: { ..._state.apiConfigDraft, groups: removeApiTreeNode(_state.apiConfigDraft.groups, path) } });
    }
  });

  document.getElementById('api-tree-root')?.addEventListener('change', (e) => {
    const nameInput = e.target.closest('.api-tree-name');
    if (nameInput) setApiTreeNodeName(bridge, JSON.parse(nameInput.dataset.path), nameInput.value.trim());
  });

  document.getElementById('btn-api-group-confirm')?.addEventListener('click', () => confirmApiGroupModal(bridge));
  document.getElementById('input-api-group-path')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmApiGroupModal(bridge);
  });
  document.getElementById('btn-api-group-cancel')?.addEventListener('click', () => cancelApiGroupModal(bridge));

  // Issue #84 follow-up: API-mode field transforms modal — reuses the same
  // transform-chain editor (field-transforms.js/field-transforms-ui.js) the
  // flat/container field modals already wire up above.
  document.getElementById('btn-api-field-transforms-add')?.addEventListener('click', () => {
    patchState({ pendingTransforms: addTransform(_state.pendingTransforms) });
  });
  wireTransformList(
    'api-field-transform-list',
    () => _state.pendingTransforms,
    (transforms) => patchState({ pendingTransforms: transforms }),
  );
  document.getElementById('btn-api-field-transforms-confirm')?.addEventListener('click', () => confirmApiFieldTransformsModal(bridge));
  document.getElementById('btn-api-field-transforms-cancel')?.addEventListener('click', () => cancelApiFieldTransformsModal(bridge));

  // ── API-Mode config screen (Issue #53 Phase 5) ─────────────────────────────
  // Delegated `change` listeners (not `input`) so typing in a text field
  // doesn't trigger a re-render — and thus lose focus — on every keystroke;
  // see renderApiConfigScreen's doc comment for the trade-off this implies.

  const handleUrlPartControlChange = (e) => {
    const toggle = e.target.closest('.api-config-part-toggle');
    if (toggle) { toggleApiConfigPartVariable(bridge, toggle.dataset.partId); return; }
    const nameInput = e.target.closest('.api-config-part-name');
    if (nameInput) setApiConfigPartName(bridge, nameInput.dataset.partId, nameInput.value.trim());
  };
  document.getElementById('api-config-segments')?.addEventListener('change', handleUrlPartControlChange);
  document.getElementById('api-config-query-params')?.addEventListener('change', handleUrlPartControlChange);

  document.getElementById('api-config-parameters')?.addEventListener('change', (e) => {
    const kindRadio = e.target.closest('.api-config-source-kind-radio');
    if (kindRadio) {
      setApiConfigSourceKind(bridge, kindRadio.dataset.partId, kindRadio.value);
      // Best-effort, automatic first pass — picking "Werteliste" is exactly
      // the moment a user would otherwise go hunting through DevTools for
      // sibling requests, so try the pool first and let them refine/refresh
      // via the button rendered alongside the textarea (see
      // fillStaticListFromPool's own doc comment).
      if (kindRadio.value === 'staticList') fillStaticListFromPool(bridge, kindRadio.dataset.partId);
      return;
    }
    const staticList = e.target.closest('.api-config-static-list');
    if (staticList) { patchApiConfigSource(bridge, staticList.dataset.partId, { valuesText: staticList.value }); return; }
    const rangeType = e.target.closest('.api-config-range-type');
    if (rangeType) {
      const partId = rangeType.dataset.partId;
      // Re-detect on every Type change, not just the initial "Range" pick
      // — switching e.g. IsoWeek → Date should re-match the same captured
      // raw value against Date's own presets instead of keeping a format
      // string that no longer means anything for the new Type.
      const rawValue = findUrlPartValue(_state.apiConfigDraft.urlParts, partId);
      patchApiConfigSource(bridge, partId, { type: rangeType.value, format: detectRangeFormat(rangeType.value, rawValue) });
      return;
    }
    const rangeFrom = e.target.closest('.api-config-range-from');
    if (rangeFrom) { patchApiConfigSource(bridge, rangeFrom.dataset.partId, { from: rangeFrom.value.trim() }); return; }
    const rangeTo = e.target.closest('.api-config-range-to');
    if (rangeTo) { patchApiConfigSource(bridge, rangeTo.dataset.partId, { to: rangeTo.value.trim() }); return; }
    const formatPreset = e.target.closest('.api-config-range-format-preset');
    if (formatPreset) { patchApiConfigSource(bridge, formatPreset.dataset.partId, { format: formatPreset.value === 'custom' ? '' : formatPreset.value }); return; }
    const formatCustom = e.target.closest('.api-config-range-format-custom');
    if (formatCustom) patchApiConfigSource(bridge, formatCustom.dataset.partId, { format: formatCustom.value.trim() });
  });

  document.getElementById('api-config-parameters')?.addEventListener('click', (e) => {
    const searchBtn = e.target.closest('.api-config-discovery-search');
    if (searchBtn) { startDiscoverySearch(bridge, searchBtn.dataset.partId); return; }
    const confirmBtn = e.target.closest('.api-config-discovery-confirm');
    if (confirmBtn) {
      const index = parseInt(confirmBtn.dataset.candidateIndex, 10);
      const candidate = _state.apiDiscoveryCandidates?.candidates?.[index];
      if (candidate) confirmDiscoveryCandidate(bridge, confirmBtn.dataset.partId, candidate);
      return;
    }
    const autofillBtn = e.target.closest('.api-config-autofill-pool');
    if (autofillBtn) fillStaticListFromPool(bridge, autofillBtn.dataset.partId);
  });

  document.getElementById('api-config-headers')?.addEventListener('change', (e) => {
    const include = e.target.closest('.api-config-header-include');
    if (include) { setApiConfigHeaderDecision(bridge, include.dataset.headerName, { include: include.checked }); return; }
    const modeRadio = e.target.closest('.api-config-header-mode-radio');
    if (modeRadio) { setApiConfigHeaderDecision(bridge, modeRadio.dataset.headerName, { mode: modeRadio.value }); return; }
    const envName = e.target.closest('.api-config-env-name');
    if (envName) setApiConfigHeaderDecision(bridge, envName.dataset.headerName, { envName: envName.value.trim() });
  });

  // ── API-Mode request-body tree (Issue #55, Phase B4) ─────────────────────
  document.getElementById('body-tree-root')?.addEventListener('click', (e) => {
    const toVariableBtn = e.target.closest('.btn-body-to-variable');
    if (toVariableBtn) {
      toggleBodyLeafToVariable(bridge, JSON.parse(toVariableBtn.closest('.body-tree-node').dataset.path));
      return;
    }
    const toFixedBtn = e.target.closest('.btn-body-to-fixed');
    if (toFixedBtn) toggleBodyLeafToFixed(bridge, JSON.parse(toFixedBtn.closest('.body-tree-node').dataset.path));
  });

  document.getElementById('body-tree-root')?.addEventListener('change', (e) => {
    const picker = e.target.closest('.body-tree-parameter-picker');
    if (picker) {
      const path = JSON.parse(picker.closest('.body-tree-node').dataset.path);
      if (picker.value === '__new__') { openBodyParameterModal(bridge, path); return; }
      setBodyLeafParameter(bridge, path, picker.value);
      return;
    }
    const coerceTo = e.target.closest('.body-tree-coerce-to');
    if (coerceTo) setBodyLeafCoerceTo(bridge, JSON.parse(coerceTo.closest('.body-tree-node').dataset.path), coerceTo.value);
  });

  document.getElementById('btn-api-body-parameter-confirm')?.addEventListener('click', () => confirmBodyParameterModal(bridge));
  document.getElementById('input-api-body-parameter-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBodyParameterModal(bridge);
  });
  document.getElementById('btn-api-body-parameter-cancel')?.addEventListener('click', () => cancelBodyParameterModal(bridge));

  document.getElementById('btn-api-config-cancel')?.addEventListener('click', () => {
    log('BTN api-config-cancel');
    cancelApiConfig(bridge);
  });

  document.getElementById('btn-api-config-confirm')?.addEventListener('click', () => {
    log('BTN api-config-confirm');
    confirmApiConfig(bridge);
  });

  document.getElementById('btn-api-config-discard')?.addEventListener('click', () => {
    log('BTN api-config-discard');
    setState(STATES.IDLE, { apiConfig: null });
  });

  document.getElementById('btn-add-field')?.addEventListener('click', () => {
    log('BTN add-field → START_SELECTION');
    stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    setState(STATES.SELECTING, {
      pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [],
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (_state.domViewEnabled) {
      log('DOM view was enabled → re-requesting tree');
      requestDomTree();
    }
  });

  document.getElementById('btn-mode-flat')?.addEventListener('click', () => switchMode('flat'));
  document.getElementById('btn-mode-container')?.addEventListener('click', () => switchMode('container'));
  document.getElementById('btn-mode-api')?.addEventListener('click', () => switchMode('api'));

  document.getElementById('btn-add-root-container')?.addEventListener('click', () => openContainerModal(bridge, null));

  // Event delegation for the container tree's per-row add/remove buttons
  document.getElementById('group-tree-root')?.addEventListener('click', (e) => {
    const li = e.target.closest('.group-tree-node');
    if (!li) return;
    const path = JSON.parse(li.dataset.path);

    if (e.target.closest('.btn-add-subcontainer')) { openContainerModal(bridge, path); return; }
    if (e.target.closest('.btn-add-subfield')) { startFieldSelection(bridge, path); return; }
    if (e.target.closest('.btn-remove-group-node')) {
      log('GROUP_NODE_REMOVE', { path });
      stopPreviewIfActive();
      setState(_state.current, { groups: removeGroupTreeNode(_state.groups, path) });
    }
  });

  document.getElementById('btn-container-confirm')?.addEventListener('click', () => confirmContainerModal(bridge));
  document.getElementById('input-container-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmContainerModal(bridge);
  });
  document.getElementById('btn-container-cancel')?.addEventListener('click', () => cancelContainerModal(bridge));

  document.getElementById('btn-field-extended-confirm')?.addEventListener('click', () => confirmExtendedField(bridge));
  document.getElementById('input-field-extended-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmExtendedField(bridge);
  });
  document.getElementById('btn-field-extended-cancel')?.addEventListener('click', () => cancelExtendedField(bridge));
  document.getElementById('select-field-mode')?.addEventListener('change', (e) => {
    document.getElementById('field-attribute-row')?.classList.toggle('hidden', e.target.value !== 'attribute');
    // Issue #84: transforms are a string post-processing pipeline — not
    // meaningful for "Vorhanden?" (a boolean-ish presence check).
    document.getElementById('field-extended-transforms-section')?.classList.toggle('hidden', e.target.value === 'exists');
    // Issue #143: the raw value the preview runs against depends on the mode.
    refreshExtendedTransformPreview();
  });
  // Issue #143: typing an attribute name updates the preview live, without
  // requiring a transform edit first.
  document.getElementById('input-field-attribute')?.addEventListener('input', refreshExtendedTransformPreview);

  // Issue #84: transform-chain editor, shared between the flat and
  // container field modals — both read/write the same _state.pendingTransforms.
  document.getElementById('btn-field-transform-add')?.addEventListener('click', () => {
    patchState({ pendingTransforms: addTransform(_state.pendingTransforms) });
  });
  document.getElementById('btn-field-extended-transform-add')?.addEventListener('click', () => {
    patchState({ pendingTransforms: addTransform(_state.pendingTransforms) });
  });
  wireTransformList(
    'field-transform-list',
    () => _state.pendingTransforms,
    (transforms) => patchState({ pendingTransforms: transforms }),
  );
  wireTransformList(
    'field-extended-transform-list',
    () => _state.pendingTransforms,
    (transforms) => patchState({ pendingTransforms: transforms }),
  );

  document.getElementById('btn-cancel-selection')?.addEventListener('click', () => {
    log('BTN cancel-selection → STOP_SELECTION');
    chrome.runtime.sendMessage({ type: 'STOP_SELECTION' });
    clearTimeout(domTreeTimeoutId);
    // A Discovery search (see startDiscoverySearch) is started *from*
    // STATES.API_CONFIG — cancelling it must return there, not to IDLE,
    // or the in-progress apiConfigDraft would appear to have vanished.
    const returnTo = _state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE;
    setState(returnTo, {
      selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [],
      pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', apiSearchTarget: null,
    });
  });

  document.getElementById('toggle-dom-view')?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    log('BTN toggle-dom-view', enabled);
    if (enabled) {
      patchState({ domViewEnabled: true });
      requestDomTree();
    } else {
      chrome.runtime.sendMessage({ type: 'DISABLE_DOM_VIEW' });
      clearTimeout(domTreeTimeoutId);
      patchState({ domViewEnabled: false });
    }
  });

  document.getElementById('btn-field-confirm')?.addEventListener('click', confirmField);

  document.getElementById('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField();
  });

  document.getElementById('btn-field-cancel')?.addEventListener('click', () => {
    log('BTN field-cancel');
    setState(STATES.IDLE, { pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [] });
  });

  // Event delegation for "Remove" buttons in the field list
  document.getElementById('fields-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    log('FIELD_REMOVE', { index, name: _state.fields[index]?.name });
    stopPreviewIfActive();
    setState(_state.current, { fields: removeField(_state.fields, index) });
  });

  document.getElementById('btn-generate')?.addEventListener('click', () => {
    log('BTN generate');
    generate();
  });
  document.getElementById('btn-download')?.addEventListener('click', triggerDownload);
  document.getElementById('btn-export-config')?.addEventListener('click', downloadConfigExport);

  document.getElementById('btn-new-scraper')?.addEventListener('click', () => {
    log('BTN new-scraper → reset state');
    stopPreviewIfActive();
    chrome.storage.session.set({ fields: [], url: '', groups: [], apiConfig: null });
    setState(STATES.CHECKING_COMPANION, { fields: [], groups: [], apiConfig: null, scriptText: '', url: '' });
    checkCompanion();
  });

  // Unlike btn-new-scraper above, this keeps fields/groups/apiConfig/url/
  // output-settings exactly as they were — the same "no patch" pattern
  // generate()'s own error paths already use to fall back to IDLE without
  // losing the current configuration (see generate()'s 400/422/catch
  // branches). Lets the user tweak a selector/transform and regenerate
  // instead of starting over when the sample data preview isn't right yet.
  document.getElementById('btn-back-to-config')?.addEventListener('click', () => {
    log('BTN back-to-config');
    setState(STATES.IDLE);
  });

  // ── Engine + browser actions (Issue #41/#42, Phase 5) ────────────────────
  // Mode-independent, unlike fields/groups/apiConfig — no interaction with
  // switchMode/MODE_SWITCH_CLEARS.

  document.getElementById('btn-engine-static')?.addEventListener('click', () => {
    log('BTN engine-static');
    setState(_state.current, { engine: 'Static' });
  });
  document.getElementById('btn-engine-browser')?.addEventListener('click', () => {
    log('BTN engine-browser');
    setState(_state.current, { engine: 'Browser' });
  });

  document.getElementById('btn-add-action-wait')?.addEventListener('click', () => {
    log('BTN add-action-wait');
    setState(_state.current, { browserActions: addBrowserAction(_state.browserActions, 'waitFor') });
  });
  document.getElementById('btn-add-action-fill')?.addEventListener('click', () => {
    log('BTN add-action-fill');
    setState(_state.current, { browserActions: addBrowserAction(_state.browserActions, 'fill') });
  });
  document.getElementById('btn-add-action-click')?.addEventListener('click', () => {
    log('BTN add-action-click');
    setState(_state.current, { browserActions: addBrowserAction(_state.browserActions, 'click') });
  });
  document.getElementById('btn-add-action-scroll')?.addEventListener('click', () => {
    log('BTN add-action-scroll');
    setState(_state.current, { browserActions: addBrowserAction(_state.browserActions, 'scroll') });
  });

  document.getElementById('browser-actions-list')?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.btn-remove-action');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index, 10);
      log('BROWSER_ACTION_REMOVE', { index });
      setState(_state.current, { browserActions: removeBrowserAction(_state.browserActions, index) });
      return;
    }
    const pickBtn = e.target.closest('.btn-pick-action-selector');
    if (pickBtn) {
      const index = parseInt(pickBtn.dataset.index, 10);
      const field = pickBtn.dataset.field; // 'selector' | 'containerSelector' | 'loadMoreButtonSelector' — see buildSelectorRow
      log('BTN pick-action-selector → START_SELECTION', { index, field });
      stopPreviewIfActive();
      chrome.runtime.sendMessage({ type: 'START_SELECTION' });
      setState(STATES.SELECTING, {
        pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [], selectionKind: 'browserAction', pendingBrowserActionIndex: index, pendingBrowserActionField: field,
        domTree: null, domTreeTruncated: false, domTreeError: null,
      });
    }
  });

  // change (not input) — same reasoning as the API-config screen's text
  // inputs: a re-render on every keystroke would reset the cursor position.
  document.getElementById('browser-actions-list')?.addEventListener('change', (e) => {
    const timeoutInput = e.target.closest('.browser-action-timeout');
    if (timeoutInput) {
      const index = parseInt(timeoutInput.dataset.index, 10);
      const timeoutMs = parseInt(timeoutInput.value, 10);
      setState(_state.current, {
        browserActions: updateBrowserAction(_state.browserActions, index, {
          timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
        }),
      });
      return;
    }
    const envInput = e.target.closest('.browser-action-env-name');
    if (envInput) {
      const index = parseInt(envInput.dataset.index, 10);
      setState(_state.current, {
        browserActions: updateBrowserAction(_state.browserActions, index, { environmentVariableName: envInput.value.trim() }),
      });
      return;
    }
    const testValueInput = e.target.closest('.browser-action-test-value');
    if (testValueInput) {
      // patchState (not setState): fillTestValues must never reach
      // persistState()/chrome.storage.session — see its _state comment.
      const envName = testValueInput.dataset.envName;
      patchState({ fillTestValues: { ..._state.fillTestValues, [envName]: testValueInput.value } });
      return;
    }
    const maxIterationsInput = e.target.closest('.browser-action-max-iterations');
    if (maxIterationsInput) {
      const index = parseInt(maxIterationsInput.dataset.index, 10);
      const maxIterations = parseInt(maxIterationsInput.value, 10);
      setState(_state.current, {
        browserActions: updateBrowserAction(_state.browserActions, index, {
          maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : 10,
        }),
      });
      return;
    }
    const waitAfterMsInput = e.target.closest('.browser-action-wait-after-ms');
    if (waitAfterMsInput) {
      const index = parseInt(waitAfterMsInput.dataset.index, 10);
      const waitAfterMs = parseInt(waitAfterMsInput.value, 10);
      setState(_state.current, {
        browserActions: updateBrowserAction(_state.browserActions, index, {
          waitAfterMs: Number.isFinite(waitAfterMs) && waitAfterMs >= 0 ? waitAfterMs : 1000,
        }),
      });
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    log('MSG_IN', message);
    if (message.type === 'SELECTION_UNAVAILABLE' && _state.current === STATES.SELECTING) {
      log('SELECTION_UNAVAILABLE', message.reason);
      setLastError(message.reason, 'Element selection');
      const returnTo = _state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE;
      setState(returnTo, {
        selectionKind: null, pendingParentPath: null, pendingNewContainer: null,
        pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', apiSearchTarget: null,
      });
      showToast(t('toast.selectionUnavailable'));
    }
    if (message.type === 'ELEMENT_SELECTED' && _state.current === STATES.SELECTING) {
      log('ELEMENT_SELECTED received (real-time)', message.selector);
      if (_state.apiSearchTarget) {
        // API-mode search: content-script.js always sends this too (same
        // click), but the actual result arrives as a separate API_CANDIDATES
        // message right after — handled below, nothing to do with the plain
        // selector here.
        return;
      }
      // Clear the storage entry the service worker wrote — we have it now.
      chrome.storage.session.remove('pendingSelector');
      const framePath = message.framePath || null;
      const matchCount = typeof message.matchCount === 'number' ? message.matchCount : null;
      if (_state.mode === 'container' && _state.selectionKind === 'container') {
        // Name/type were already collected by modal-container-new — insert
        // the new group node straight away, no further modal needed. There's
        // no modal left open at this point to show the match count in (Issue
        // #85), so it's surfaced as a toast instead — read the name before
        // setState() clears pendingNewContainer.
        const containerName = _state.pendingNewContainer.name;
        const node = buildGroupNode(_state.pendingNewContainer.name, message.selector, _state.pendingNewContainer.repeating, framePath);
        setState(STATES.IDLE, {
          groups: insertContainerNode(_state.groups, _state.pendingParentPath, node),
          selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [],
        });
        showMatchCountToast(containerName, matchCount);
      } else if (_state.selectionKind === 'browserAction' && _state.pendingBrowserActionIndex !== null) {
        // The action card already exists (kind chosen when it was added via
        // btn-add-action-*) — write the selector straight into the field
        // the pick button was for (pendingBrowserActionField — always
        // 'selector' except for a ScrollStep's two optional selectors), no
        // naming modal needed, same shape as the container branch above.
        // framePath is written unconditionally (even to null) rather than
        // merged: the backend models exactly one FramePath per ScrollStep,
        // shared by both ContainerSelector and LoadMoreButtonSelector (see
        // IR/BrowserAction.cs), so re-picking either selector re-records
        // which frame the *step* now targets.
        setState(STATES.IDLE, {
          browserActions: updateBrowserAction(_state.browserActions, _state.pendingBrowserActionIndex, {
            [_state.pendingBrowserActionField]: message.selector,
            framePath,
          }),
          selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [],
        });
      } else {
        setState(STATES.SELECTING, {
          pendingSelector: message.selector, pendingFramePath: framePath, pendingMatchCount: matchCount,
          pendingRawText: typeof message.rawText === 'string' ? message.rawText : null,
          pendingElementAttributes: message.attributes ?? null,
          pendingTransforms: [],
        });
      }
      if (message.path) highlightSelected(message.path);
    }
    if (message.type === 'DOM_TREE') {
      log('DOM_TREE received', { nodes: message.tree, truncated: message.truncated });
      clearTimeout(domTreeTimeoutId);
      if (message.tree) {
        patchState({ domTree: message.tree, domTreeTruncated: !!message.truncated, domTreeError: null });
        renderDomTree(message.tree);
      } else {
        const reason = message.error || 'Tree could not be loaded.';
        setLastError(reason, 'DOM tree view');
        patchState({ domTreeError: reason });
      }
    }
    if (message.type === 'HOVER_ELEMENT') {
      highlightHover(message.path);
    }
    if (message.type === 'PREVIEW_RESULT' && _state.previewActive) {
      log('PREVIEW_RESULT received', message);
      patchState({ previewSummary: { total: message.total, empty: message.empty, truncated: message.truncated } });
    }
    if (message.type === 'PREVIEW_UNAVAILABLE') {
      log('PREVIEW_UNAVAILABLE', message.reason);
      setLastError(message.reason, 'Preview');
      patchState({ previewActive: false, previewSummary: null });
      showToast(t('toast.previewUnavailable'));
    }
    if (message.type === 'API_CAPTURE_ENTRY' && _state.apiCaptureActive) {
      log('API_CAPTURE_ENTRY received', message.entry?.url);
      patchState({ apiCaptureCount: _state.apiCaptureCount + 1 });
    }
    if (message.type === 'API_CAPTURE_UNAVAILABLE') {
      log('API_CAPTURE_UNAVAILABLE', message.reason);
      setLastError(message.reason, 'Network recording');
      patchState({ apiCaptureActive: false, apiCaptureCount: 0 });
      showToast(t('toast.captureUnavailable'));
    }
    if (message.type === 'API_CANDIDATES' && _state.apiSearchTarget) {
      log('API_CANDIDATES received', { target: message.target, count: message.candidates?.length, for: _state.apiSearchTarget });
      chrome.storage.session.remove('pendingSelector');
      const result = { target: message.target, candidates: message.candidates || [] };
      if (_state.apiSearchTarget === 'field') {
        setState(STATES.IDLE, { apiSearchTarget: null, apiCandidates: result });
      } else if (_state.apiSearchTarget.treeParentPath !== undefined) {
        // Issue #54, Phase A5 — "add root group"/"add sub-field", started
        // from STATES.API_CONFIG (see startApiTreeFieldSearch), returns there.
        setState(STATES.API_CONFIG, { apiSearchTarget: null, apiTreeSearchResult: { ...result, treeParentPath: _state.apiSearchTarget.treeParentPath } });
      } else {
        // {parameter: partId} — the search was started from STATES.API_CONFIG
        // (see startDiscoverySearch), so it returns there, not to IDLE.
        setState(STATES.API_CONFIG, { apiSearchTarget: null, apiDiscoveryCandidates: { ...result, parameter: _state.apiSearchTarget.parameter } });
      }
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const language = await initI18n(typeof navigator !== 'undefined' ? navigator.language : '');
  log('INIT language', language);
  applyStaticTranslations();

  wireEvents();

  log('INIT reading session storage');
  const stored = await chrome.storage.session.get([
    'fields', 'url', 'pendingSelector', 'pendingFramePath', 'pendingMatchCount',
    'pendingRawText', 'pendingElementAttributes', 'mode', 'groups',
    'engine', 'browserActions', 'additionalStartUrls', 'changeDetection', 'proxy', 'pendingBrowserActionIndex', 'pendingBrowserActionField',
    'selectionKind', 'pendingParentPath', 'pendingNewContainer',
    'apiSearchTarget', 'apiConfigDraft', 'apiConfig',
    'scriptFileName', 'outputFileName',
  ]);
  log('INIT restored', stored);

  // Always restore persisted fields/groups and URL.
  if (Array.isArray(stored.fields)) _state = { ..._state, fields: stored.fields };
  if (Array.isArray(stored.groups)) _state = { ..._state, groups: stored.groups };
  if (stored.url)                   _state = { ..._state, url: stored.url };
  if (stored.mode)                  _state = { ..._state, mode: stored.mode };
  if (stored.engine)                _state = { ..._state, engine: stored.engine };
  if (Array.isArray(stored.browserActions)) _state = { ..._state, browserActions: stored.browserActions };
  if (Array.isArray(stored.additionalStartUrls)) _state = { ..._state, additionalStartUrls: stored.additionalStartUrls };
  if (stored.changeDetection) _state = { ..._state, changeDetection: stored.changeDetection };
  if (stored.proxy)                 _state = { ..._state, proxy: stored.proxy };
  if (stored.scriptFileName)        _state = { ..._state, scriptFileName: stored.scriptFileName };
  if (stored.outputFileName)        _state = { ..._state, outputFileName: stored.outputFileName };
  if (stored.selectionKind)         _state = { ..._state, selectionKind: stored.selectionKind };
  if (stored.pendingParentPath !== undefined) _state = { ..._state, pendingParentPath: stored.pendingParentPath };
  if (stored.pendingNewContainer)   _state = { ..._state, pendingNewContainer: stored.pendingNewContainer };
  if (stored.pendingBrowserActionIndex !== undefined) _state = { ..._state, pendingBrowserActionIndex: stored.pendingBrowserActionIndex };
  if (stored.pendingBrowserActionField)   _state = { ..._state, pendingBrowserActionField: stored.pendingBrowserActionField };
  if (stored.apiConfigDraft)        _state = { ..._state, apiConfigDraft: stored.apiConfigDraft };
  if (stored.apiConfig)             _state = { ..._state, apiConfig: stored.apiConfig };

  if (stored.pendingSelector) {
    // The user clicked an element while the side panel was closed (e.g. it
    // hadn't finished loading yet, or was closed manually).
    await chrome.storage.session.remove('pendingSelector');

    if (stored.apiSearchTarget) {
      // Unlike the other pending-selector cases below, there's nothing to
      // recover here: the actual search result (API_CANDIDATES) is a
      // transient message content-script.js never persists anywhere, so a
      // leftover selector alone can't be turned into a candidate list —
      // discard it rather than misinterpret it as a flat-field pick.
      log('INIT pending API-search selector found, but candidates were never persisted — discarding');
      setState(_state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE, {});
      return;
    }

    if (stored.mode === 'container' && stored.selectionKind === 'container' && stored.pendingNewContainer) {
      // Same as the live ELEMENT_SELECTED path: name/type were already
      // collected before selection started, so insert straight away.
      log('INIT pending container selector found → inserting node', stored.pendingSelector);
      const node = buildGroupNode(stored.pendingNewContainer.name, stored.pendingSelector, stored.pendingNewContainer.repeating, stored.pendingFramePath);
      const groups = insertContainerNode(_state.groups, stored.pendingParentPath, node);
      await chrome.storage.session.set({ groups });
      setState(STATES.IDLE, {
        groups, selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [],
      });
      showMatchCountToast(stored.pendingNewContainer.name, typeof stored.pendingMatchCount === 'number' ? stored.pendingMatchCount : null);
      return;
    }

    if (stored.selectionKind === 'browserAction' && stored.pendingBrowserActionIndex !== null && stored.pendingBrowserActionIndex !== undefined) {
      // Same as the live ELEMENT_SELECTED path: the action card already
      // exists (kind chosen when it was added) — write the selector
      // straight into it, no naming modal needed.
      const field = stored.pendingBrowserActionField || 'selector';
      log('INIT pending browser-action selector found → updating action', { field, selector: stored.pendingSelector });
      const browserActions = updateBrowserAction(_state.browserActions, stored.pendingBrowserActionIndex, {
        [field]: stored.pendingSelector, framePath: stored.pendingFramePath || null,
      });
      await chrome.storage.session.set({ browserActions });
      setState(STATES.IDLE, {
        browserActions, selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingTransforms: [],
      });
      return;
    }

    // Flat field or container field — show the (extended, in container
    // mode) field-name modal without re-checking the companion. The
    // transform chain itself is never persisted (see pendingTransforms'
    // own doc comment) — a reopened popup shows the modal with an empty
    // chain, same as the name input itself starting blank again.
    log('INIT pending selector found → show modal', stored.pendingSelector);
    setState(STATES.SELECTING, {
      pendingSelector: stored.pendingSelector, pendingFramePath: stored.pendingFramePath || null,
      pendingMatchCount: typeof stored.pendingMatchCount === 'number' ? stored.pendingMatchCount : null,
      pendingRawText: typeof stored.pendingRawText === 'string' ? stored.pendingRawText : null,
      pendingElementAttributes: stored.pendingElementAttributes ?? null,
      pendingTransforms: [],
    });
    return;
  }

  setState(STATES.CHECKING_COMPANION);
  await checkCompanion();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildScrapingConfig, addField, removeField, escapeHtml, renderFields, STATES,
    formatTreeLabel, renderDomTree, highlightHover, highlightSelected,
    formatLogSection, buildGithubIssueUrl, setLastError, buildVerificationErrorMessage,
    buildGroupNode, buildFieldNode, resolveGroupNode, insertContainerNode, removeGroupTreeNode,
    formatGroupNodeLabel, serializeGroupTree, renderGroupTree, buildConfigExport, hasRepeatingAncestor,
    buildApiGroupDraft, buildApiFieldDraft, resolveApiTreeNode, insertApiTreeNode, removeApiTreeNode,
    updateApiTreeNode, apiTreeNodesHaveNonBlankNames, lastPathSegmentName, buildApiSubtreeFromCandidate,
    resolveApiGroupScopePath, countApiConfigFields,
    serializeApiTree, renderApiTree,
    renderApiCandidates, renderApiEntriesList,
    parseUrlTemplateParts, buildUrlTemplate, parseValueListInput,
    buildStaticListSource, buildDiscoverySource, buildRangeSource, buildApiHeaders, buildApiConfig,
    findUrlTemplateMatches, mergeValueListValues,
    variableUrlParts, apiConfigDraftHasAllSourcesChosen, renderApiConfigScreen,
    detectRangeFormat, findUrlPartValue, rangeFormatExample, RANGE_FORMAT_PRESETS,
    applyStaticTranslations, sanitizeFileNameBase, parseAdditionalUrls, buildChangeDetectionConfig, buildProxyConfig,
    addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions, renderBrowserActions,
    buildVerificationValues,
    frameBadgeHtml,
    jsonValueToBodyDraft, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId,
    bodyTreeLeavesAreBound, serializeBodyTree, allParameterParts, renderBodyTree,
    confirmApiFieldCandidate, loadInitialBodyTreeForCandidate,
    toggleBodyLeafToVariable, toggleBodyLeafToFixed, setBodyLeafParameter, setBodyLeafCoerceTo,
    openBodyParameterModal, confirmBodyParameterModal, cancelBodyParameterModal, confirmApiConfig,
    renderDataPreview,
    createDefaultTransform, addTransform, removeTransform, updateTransform, changeTransformKind,
    moveTransform, transformsAreValid, renderTransformList,
    applyTransformsPreview, toNumberPreview, renderTransformPreview,
    refreshFlatTransformPreview, refreshExtendedTransformPreview,
  };
}
