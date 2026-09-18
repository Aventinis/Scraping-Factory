// ── Logging ───────────────────────────────────────────────────────────────────

const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { initI18n, setLanguage, getLanguage, t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { initTheme, getTheme, cycleTheme } =
  typeof require !== 'undefined' ? require('../shared/theme') : self.SFTheme;

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
  insertContainerNode, removeGroupTreeNode, updateGroupTreeNode, moveGroupTreeNode,
  formatGroupNodeLabel, serializeGroupTree,
} = typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

const {
  renderApiTree, renderApiCandidates, renderApiEntriesList,
  renderApiConfigScreen, renderBodyTree,
  startApiFieldSearch, confirmApiFieldCandidate, loadInitialBodyTreeForCandidate,
  startEmbeddedJsonFieldSearch,
  startApiTreeFieldSearch,
  toggleBodyLeafToVariable, toggleBodyLeafToFixed, setBodyLeafParameter, setBodyLeafCoerceTo,
  openBodyParameterModal, confirmBodyParameterModal, confirmApiConfig,
  renderApiConfigModals, wireApiConfigEvents,
} = typeof require !== 'undefined' ? require('./api-config-ui') : self.SFApiConfigUI;

const {
  renderGroupTree,
  renderContainerFieldModal, wireContainerModeEvents,
} = typeof require !== 'undefined' ? require('./container-tree-ui') : self.SFContainerTreeUI;

const {
  renderFields, renderFlatFieldModal, wireFlatModeEvents,
} = typeof require !== 'undefined' ? require('./flat-mode-ui') : self.SFFlatModeUI;

const {
  renderBrowserActions, wireBrowserActionsEvents,
} = typeof require !== 'undefined' ? require('./browser-actions-ui') : self.SFBrowserActionsUI;

const { wireMessageListener } =
  typeof require !== 'undefined' ? require('./message-router') : self.SFMessageRouter;

const { applyStoredSessionState, restorePendingSelection } =
  typeof require !== 'undefined' ? require('./session-restore') : self.SFSessionRestore;

const {
  renderIdleScreen, wireIdleScreenEvents,
} = typeof require !== 'undefined' ? require('./idle-screen-ui') : self.SFIdleScreenUI;

const {
  createDefaultTransform, addTransform, removeTransform, updateTransform, changeTransformKind,
  moveTransform, transformsAreValid, applyTransformsPreview, toNumberPreview,
} = typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;

const { renderTransformList, renderTransformPreview } =
  typeof require !== 'undefined' ? require('./field-transforms-ui') : self.SFFieldTransformsUI;

const { applyConfigToState } =
  typeof require !== 'undefined' ? require('./config-import') : self.SFConfigImport;

const { showToast, setLastError } =
  typeof require !== 'undefined' ? require('./toast') : self.SFToast;

const {
  formatLogSection, buildGithubIssueUrl, reportBug,
} = typeof require !== 'undefined' ? require('./bug-report') : self.SFBugReport;

const {
  sanitizeFileNameBase, parseAdditionalUrls,
  buildChangeDetectionConfig, buildProxyConfig, buildPaginationConfig, buildHardeningConfig,
  computeInitialMonitoringSectionOpen, collectFieldNames,
  buildScrapingConfig, buildConfigExport,
  addField, removeField,
  addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions,
  buildVerificationValues,
  addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
  addRequiredField, removeRequiredField,
  frameBadgeHtml,
} = typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

const {
  requestDomTree, cancelPendingDomTreeRequest,
  formatTreeLabel, renderDomTree,
  highlightHover, highlightSelected,
  renderDomTreeViewState, wireDomTreeViewEvents,
} = typeof require !== 'undefined' ? require('./dom-tree-ui') : self.SFDomTreeUI;

const { stopPreviewIfActive } =
  typeof require !== 'undefined' ? require('./preview') : self.SFPreview;

const {
  checkCompanion, buildVerificationErrorMessage, generate,
  renderCompanionErrorScreen, wireCompanionErrorEvents,
} = typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;

const { triggerDownload, downloadFile, triggerOutputFileDownload, downloadConfigExport } =
  typeof require !== 'undefined' ? require('./download-helpers') : self.SFDownloadHelpers;

const {
  renderSavedConfigsList,
  fetchSavedConfigs, saveCurrentConfig, loadSavedConfig,
  requestDeleteSavedConfig, cancelDeleteSavedConfig, deleteSavedConfig,
  openSaveConfigModal,
  saveCurrentOutput, fetchSavedOutputs, toggleSavedConfigOutputs, downloadSavedOutput,
  requestDeleteSavedOutput, cancelDeleteSavedOutput, deleteSavedOutput,
  renderSaveOutputModal, wireSavedConfigsEvents,
} = typeof require !== 'undefined' ? require('./saved-configs-ui') : self.SFSavedConfigsUI;

const { wireSettingsPanelEvents } =
  typeof require !== 'undefined' ? require('./settings-panel-ui') : self.SFSettingsPanelUI;

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));

  // Issue #140 modernization: the side panel is user-resizable (see #138),
  // and .mode-toggle-thumb's position/width is measured in pixels — without
  // this it would stay wherever it was drawn at the last render() until the
  // next state change recomputes it, visibly detached from its button while
  // the panel is being dragged. rAF-throttled (not debounced) so it tracks
  // the drag continuously instead of only snapping into place once dragging
  // stops.
  let resizeSyncScheduled = false;
  window.addEventListener('resize', () => {
    if (resizeSyncScheduled) return;
    resizeSyncScheduled = true;
    requestAnimationFrame(() => {
      resizeSyncScheduled = false;
      syncModeToggleThumbs();
    });
  });
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
  // Issue #174: opt-in classic multi-page pagination — mode-independent
  // like additionalStartUrls/changeDetection/proxy above (Fields/Groups
  // only; hidden entirely for API mode, which already has its own page-
  // parameter mechanism via a Number RangeSource), persisted the same way.
  // kind is 'nextLink' (follow a "next page" link's href, extracted via
  // nextLinkSelector) or 'pageNumber' (substitute {url}/{page} into
  // urlTemplate) — see buildPaginationConfig. maxPages is a whole-number
  // safety cap, always active regardless of kind.
  pagination: { enabled: false, kind: 'nextLink', nextLinkSelector: '', urlTemplate: '', maxPages: 50 },
  // Issue #175: opt-in persistent session/cookie handling — Browser-engine
  // only, persisted the same way as proxy/pagination above (real
  // scrape-target configuration, not a per-generate toggle). Unlike proxy/
  // pagination, this has no sub-fields of its own (just an on/off switch —
  // see buildScrapingConfig's "only send the key when true" handling), so
  // it's a plain boolean rather than an { enabled, ... } object.
  persistentSession: false,
  // Issue #178: opt-in external XML config file — mode-independent (Fields/
  // Groups/Api alike), persisted the same way as persistentSession above
  // (real scrape-target configuration, not a per-generate toggle). Also a
  // plain boolean with no sub-fields: which values end up editable depends
  // entirely on the current mode/shape, nothing the user chooses here.
  externalConfig: false,
  // Issue #129: opt-in script hardening checks — mode-independent like
  // engine/changeDetection/proxy above, persisted the same way (real
  // scrape-target configuration, not a per-generate toggle). Nested one
  // level per check (`noResult`, `nullRate` since Issue #130, `baseline`
  // since Issue #131) so the two still-planned checks (see CLAUDE.md) can
  // each add their own key without restructuring this or
  // buildHardeningConfig. `severity` is 'Warning' or 'Error', matching the
  // wire format's own PascalCase enum values exactly (see
  // buildHardeningConfig) — no client-side translation needed. Issue #130's
  // `nullRate` is an array, not a single object like `noResult`/`baseline`
  // — unlike NoResultCheck/BaselineCheck, more than one is expected (one
  // per monitored field); each row is `{ fieldName, threshold, severity }`,
  // `threshold` a whole percent (0-100) for the UI — buildHardeningConfig
  // divides by 100 to reach the wire format's 0.0-1.0 fraction. Issue
  // #131's `baseline` mirrors `noResult`'s single-object shape (only one
  // "the" result count makes sense to track) plus its own
  // `dropThresholdPercent`, converted the same way `nullRate.threshold` is.
  // Issue #132's `blocking` mirrors `baseline`'s single-object shape (only
  // one blocking check ever makes sense) plus its own `minBodyLengthText`
  // (raw number-input text, '' = signal disabled — kept as text rather
  // than a number so a cleared input round-trips to '' instead of NaN/0)
  // and `phrasesText` (one block phrase per line, same raw-textarea-text
  // convention as `_state.additionalStartUrls`/API mode's own value-list
  // inputs — parsed into an array only in buildHardeningConfig).
  // Issue #133's `requiredFields` is closer in shape to `blocking` than
  // `nullRate` — one shared severity, not per-field — but unlike
  // `blocking`'s free-text phrase list, `fields` holds field names picked
  // from a dropdown (collectFieldNames), the same source `nullRate`'s own
  // per-row field picker already reads from. Supported for every mode/shape
  // (flat, container, and — since Issue #204 — Api-mode's tree shape too,
  // on top of Api-mode's already-supported flat shape) — collectFieldNames
  // already walks container mode's live GroupNode/DataFieldNode tree and
  // Api mode's tree/flat `apiConfig`, so no extra plumbing was needed here.
  hardening: {
    noResult: { enabled: false, severity: 'Warning' },
    nullRate: [],
    baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
    blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
    requiredFields: { enabled: false, severity: 'Warning', fields: [] },
  },
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
  // Issue #169: same treatment as pendingRawText/pendingElementAttributes
  // above, for OwnText mode's own live preview.
  pendingOwnText:            null,
  // Issue #84: the transform chain (trim/regexExtract/replace/toNumber, in
  // order) being built up while modal-field-name/modal-field-extended is
  // open — form state, not underlying-selection state, so unlike
  // pendingSelector/pendingMatchCount it's deliberately NOT carried through
  // the session-storage popup-reopen recovery path (same "typed-but-
  // unconfirmed input is lost on reopen" treatment the field-name input
  // itself already gets). Written onto the resulting field/node once
  // confirmed (see confirmField/confirmExtendedField).
  pendingTransforms:   [],
  selectionKind:       null,  // 'field' | 'container' | 'browserAction' | 'pagination' | null — which kind the current SELECTING round is for
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
  // Issue #183: collapsible "Monitoring" section (change detection +
  // hardening) — not persisted across popup close/reopen the way
  // apiEntriesPanelOpen above isn't either, but init() below overrides
  // this default to `true` (once, at startup) if change detection or any
  // hardening check is already configured, via
  // computeInitialMonitoringSectionOpen — a returning user isn't forced to
  // re-expand it just to see their own settings. After that one-time
  // computation, this behaves like a plain toggle for the rest of the
  // session.
  monitoringSectionOpen: false,
  // Issue #184: collapsible "Settings" section (Json output toggle, trial-
  // run data preview toggle, DOM-highlight "Vorschau" button) — unlike
  // monitoringSectionOpen above, there's no auto-expand-on-load override in
  // init(): all three toggles inside are non-persisted, per-generate
  // opt-ins that reset to off on every popup open anyway, so there's no
  // "returning user's existing settings" this would ever need to reveal.
  // Always starts (and stays, until clicked) collapsed.
  settingsSectionOpen: false,
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
  // Issue #161: opt-in full trial-run output download — the complete,
  // uncapped counterpart to includeDataPreview/dataPreview above (they're
  // independent, either/both/neither may be on). Not persisted, always off
  // on popup reopen, same per-generate-opt-in treatment as includeDataPreview.
  includeOutputFile:  false,
  outputFile:         null, // {fileName, content} from the last successful /generate with includeOutputFile on, or null
  // Issue #86: opt-in Json output, mode-independent (like includeDataPreview
  // above) — not persisted, always off on popup reopen; a per-generate
  // choice, not a sticky preference. See buildScrapingConfig for exactly
  // what this adds/replaces per mode.
  useJsonOutput:      false,
  // Issue #141: local SQLite-backed configuration history. savedConfigs is
  // null before the first GET /configs?url=... for the current tab
  // completes (or if it fails — an older companion without this route, a
  // network hiccup — the panel just stays empty, non-fatal, same
  // "optional companion capability" treatment robots.txt checking gets),
  // else the list of {id, url, name, savedAt} summaries scoped to the
  // current page's hostname. Re-fetched fresh each time the IDLE screen's
  // url becomes known (see checkCompanion) — pull-based, not persisted,
  // same reasoning as apiEntries above (this list can change on the
  // companion side, e.g. from a config saved in a previous popup session).
  savedConfigs:              null,
  savedConfigsLoading:       false,
  // Set to a saved config's id right after its own "Delete" button is first
  // clicked, turning that one row into an inline "Delete? Yes/No" — a
  // second confirming click is required before DELETE /configs/{id} is
  // actually sent, since this is the one destructive action in the popup
  // that's persisted outside the current session (every other "Remove"/"−"
  // button here acts on in-memory draft state only). Reset on confirm,
  // cancel, or navigating away from IDLE.
  savedConfigsPendingDeleteId: null,
  saveConfigModalOpen:       false,
  // Issue #202: a saved run's actual output data, linked to a saved config.
  // saveOutputModalOpen opens modal-save-output from the DONE screen's
  // "Save output" button (only shown alongside btn-download-output, i.e.
  // only once _state.outputFile is actually set). savedConfigsExpandedId is
  // the id of whichever saved-configs-list row currently has its own
  // outputs sub-panel open (accordion-style, at most one at a time);
  // savedOutputs holds that row's fetched {id, savedConfigId, name,
  // fileName, savedAt} summaries (null while collapsed/not yet loaded, same
  // "pull-based, not persisted" treatment savedConfigs itself already
  // gets). savedOutputsPendingDeleteId mirrors savedConfigsPendingDeleteId's
  // own inline-confirm pattern, scoped to a row inside that sub-panel.
  saveOutputModalOpen:         false,
  savedConfigsExpandedId:      null,
  savedOutputs:                null,
  savedOutputsLoading:         false,
  savedOutputsPendingDeleteId: null,
};

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
      pagination: _state.pagination,
      persistentSession: _state.persistentSession,
      externalConfig: _state.externalConfig,
      hardening: _state.hardening,
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
// Issue #140: one hand-drawn inline SVG per theme state — 'system' (the
// null/no-override state) gets its own half-filled-circle glyph, distinct
// from the sun/moon icons already established for status glyphs/tree
// toggles (#139). Keyed by string 'system' rather than null since object
// keys can't be null anyway, and this is purely a private rendering lookup.
const THEME_TOGGLE_ICONS = {
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.5"></circle>' +
    '<line x1="12" y1="2.5" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="21.5"></line>' +
    '<line x1="2.5" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="21.5" y2="12"></line>' +
    '<line x1="5" y1="5" x2="6.8" y2="6.8"></line><line x1="17.2" y1="17.2" x2="19" y2="19"></line>' +
    '<line x1="5" y1="19" x2="6.8" y2="17.2"></line><line x1="17.2" y1="6.8" x2="19" y2="5"></line></svg>',
  dark:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">' +
    '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"></path></svg>',
  system:
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>' +
    '<path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"></path></svg>',
};

function renderThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const theme = getTheme();
  btn.innerHTML = THEME_TOGGLE_ICONS[theme === null ? 'system' : theme];
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  const langSelect = document.getElementById('lang-select');
  if (langSelect) langSelect.value = getLanguage();
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = getLanguage();
  renderThemeToggle();
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
  hide('modal-save-config');
  hide('modal-save-output');

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

  // modal-save-config is a global overlay, not scoped to the IDLE screen's
  // own render block below — Issue #202's "save configuration first"
  // shortcut (openSaveConfigModal) can now also open it from the DONE
  // screen, so this check must run regardless of which screen is current.
  if (_state.saveConfigModalOpen) show('modal-save-config');

  if (_state.current === STATES.COMPANION_ERROR) {
    renderCompanionErrorScreen();
  }

  if (_state.current === STATES.IDLE) {
    renderIdleScreen(bridge);
  }

  if (_state.current === STATES.API_CONFIG && _state.apiConfigDraft) {
    renderApiConfigModals(bridge);
  }

  if (_state.current === STATES.DONE) {
    const downloadBtn = document.getElementById('btn-download');
    if (downloadBtn) {
      const filename = `${sanitizeFileNameBase(_state.scriptFileName, 'scraper')}.py`;
      downloadBtn.textContent = t('done.downloadBtn', { filename });
    }
    // Issue #161: only shown at all when includeOutputFile actually
    // produced a file — an older/incompatible companion, or the toggle
    // simply being off, both look identical here (outputFile stays null).
    const downloadOutputBtn = document.getElementById('btn-download-output');
    if (downloadOutputBtn) {
      downloadOutputBtn.classList.toggle('hidden', !_state.outputFile);
      if (_state.outputFile) downloadOutputBtn.textContent = t('done.downloadOutputBtn', { filename: _state.outputFile.fileName });
    }
    // Issue #202: same visibility gate as btn-download-output — saving a
    // run's output only makes sense once one was actually produced.
    const saveOutputBtn = document.getElementById('btn-save-output');
    if (saveOutputBtn) saveOutputBtn.classList.toggle('hidden', !_state.outputFile);
    renderDataPreview(_state.dataPreview);

    if (_state.saveOutputModalOpen) {
      show('modal-save-output');
      renderSaveOutputModal(bridge);
    }
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
      renderContainerFieldModal(bridge, isNewPick);
    } else {
      renderFlatFieldModal(bridge, isNewPick);
    }
  } else {
    lastFieldModalSelector = null;
  }

  if (_state.current === STATES.SELECTING) {
    renderDomTreeViewState(bridge);
  }

  syncModeToggleThumbs();
}

// Issue #140 modernization: positions every .mode-toggle-thumb behind its
// container's current .active .mode-btn (mode/engine/notify-method toggles
// all share this markup pattern) — see popup.html's own doc comment on
// .mode-toggle-thumb for why this is JS rather than CSS-only. A no-op
// (0-width thumb) for any toggle currently inside a hidden .screen, since
// offsetWidth/offsetLeft read 0 while display: none — harmless, the next
// render() call after that screen becomes visible again recomputes it
// correctly. Called at the end of every render() rather than only after a
// mode/engine/notify-method change specifically, since that's simpler than
// threading a "did the active button change" flag through every one of
// those call sites for a cheap, idempotent DOM read.
function syncModeToggleThumbs() {
  document.querySelectorAll('.mode-toggle').forEach((toggleEl) => {
    const thumb = toggleEl.querySelector('.mode-toggle-thumb');
    const active = toggleEl.querySelector('.mode-btn.active');
    if (!thumb || !active) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  });
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

// Passed to every api-config-ui.js/container-tree-ui.js/dom-tree-ui.js/
// preview.js/companion-client.js/saved-configs-ui.js handler, instead of
// those functions closing over this file's own module-level state — see
// api-config-ui.js's own doc comment for why. Declared at module scope
// (not just inside wireEvents()) so popup.js's own top-level functions
// (generate, ...) can use it too; safe to
// reference functions defined further down in this file because they're
// only ever called through the arrow functions below, never at bridge-
// construction time itself.
const bridge = {
  getState: () => _state,
  setState,
  patchState,
  stopPreviewIfActive: () => stopPreviewIfActive(bridge),
  requestDomTree: () => requestDomTree(bridge),
  showToast,
  fetchSavedConfigs: (url) => fetchSavedConfigs(bridge, url),
};

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('lang-select')?.addEventListener('change', async (e) => {
    log('LANG_SELECT change', e.target.value);
    await setLanguage(e.target.value);
    applyStaticTranslations();
    render(); // re-render currently-visible dynamic content (group tree, API candidates, …) in the new language
  });

  // Issue #140: system -> light -> dark -> system, see shared/theme.js's
  // own doc comment. Applying/persisting the new theme is all synchronous-
  // feeling from the user's perspective (cycleTheme sets the data-theme
  // attribute immediately, the chrome.storage.local write just happens to
  // also be awaited here) — only the icon needs a re-render, no full render().
  document.getElementById('theme-toggle')?.addEventListener('click', async () => {
    const next = await cycleTheme();
    log('THEME_TOGGLE click', next ?? 'system');
    renderThemeToggle();
  });

  document.getElementById('btn-report-bug-error')?.addEventListener('click', () => reportBug(_state.url));
  document.getElementById('btn-report-bug-toast')?.addEventListener('click', () => reportBug(_state.url));
  document.getElementById('btn-report-bug-domtree')?.addEventListener('click', () => reportBug(_state.url));

  wireCompanionErrorEvents(bridge);

  wireSettingsPanelEvents(bridge);

  wireApiConfigEvents(bridge);

  wireFlatModeEvents(bridge);

  wireIdleScreenEvents(bridge);

  wireContainerModeEvents(bridge);

  document.getElementById('btn-cancel-selection')?.addEventListener('click', () => {
    log('BTN cancel-selection → STOP_SELECTION');
    chrome.runtime.sendMessage({ type: 'STOP_SELECTION' });
    cancelPendingDomTreeRequest();
    // A Discovery search (see startDiscoverySearch) is started *from*
    // STATES.API_CONFIG — cancelling it must return there, not to IDLE,
    // or the in-progress apiConfigDraft would appear to have vanished.
    const returnTo = _state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE;
    setState(returnTo, {
      selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', apiSearchTarget: null,
    });
  });

  wireDomTreeViewEvents(bridge);

  document.getElementById('btn-generate')?.addEventListener('click', () => {
    log('BTN generate');
    generate(bridge);
  });
  document.getElementById('btn-download')?.addEventListener('click', () => triggerDownload(bridge));
  document.getElementById('btn-download-output')?.addEventListener('click', () => triggerOutputFileDownload(bridge));
  document.getElementById('btn-export-config')?.addEventListener('click', () => downloadConfigExport(bridge));

  wireSavedConfigsEvents(bridge);

  document.getElementById('btn-new-scraper')?.addEventListener('click', () => {
    log('BTN new-scraper → reset state');
    stopPreviewIfActive(bridge);
    chrome.storage.session.set({ fields: [], url: '', groups: [], apiConfig: null });
    setState(STATES.CHECKING_COMPANION, { fields: [], groups: [], apiConfig: null, scriptText: '', url: '' });
    checkCompanion(bridge);
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

  wireBrowserActionsEvents(bridge);

  wireMessageListener(bridge);
}

// ── Init ──────────────────────────────────────────────────────────────────────

// popup.html's #screen-idle/#screen-api-config/#modals-mount ship empty —
// their markup lives in screens/*.html instead, fetched here at startup
// rather than inlined into popup.html's own ~875 (now ~170) lines, via
// chrome.runtime.getURL — the extension's own page fetching its own bundled
// resource, needing neither a real network request nor a
// web_accessible_resources manifest entry (that only gates access from
// content scripts/web pages reaching in). Same dual-environment convention
// i18n.js's own fetchDictionary/loadDictionary already established for
// exactly this "real chrome.runtime.getURL+fetch in the browser, skip
// entirely under Jest" split (see that file's own doc comment): under Jest,
// `require` is defined and this is a deliberate, untested no-op — every
// existing test builds its own minimal document.body.innerHTML fixture for
// whichever ids it needs (no test ever loads the real popup.html), and
// actually injecting the real production markup here would silently
// overwrite that fixture instead of leaving it alone. It would also consume
// fetch-mock call slots (mockResolvedValueOnce chains keyed to call order)
// that plenty of existing tests already reserve for the real /health and
// /generate calls checkCompanion()/generate() make later in the same
// startup sequence.
async function loadScreenPartial(elementId, path) {
  if (typeof require !== 'undefined') return;
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) return;
    el.innerHTML = await response.text();
  } catch (err) {
    log('SCREEN_PARTIAL_LOAD_FAIL', { elementId, path, error: String(err) });
  }
}

async function loadScreenPartials() {
  await Promise.all([
    loadScreenPartial('screen-idle', 'popup/screens/idle.html'),
    loadScreenPartial('screen-api-config', 'popup/screens/api-config.html'),
    loadScreenPartial('modals-mount', 'popup/screens/modals.html'),
  ]);
}

async function init() {
  // Must happen before applyStaticTranslations()/wireEvents()/the first
  // render() — all three depend on this markup already being in the DOM.
  await loadScreenPartials();

  const language = await initI18n(typeof navigator !== 'undefined' ? navigator.language : '');
  log('INIT language', language);

  const theme = await initTheme();
  log('INIT theme', theme ?? 'system');

  applyStaticTranslations();

  wireEvents();

  log('INIT reading session storage');
  const stored = await chrome.storage.session.get([
    'fields', 'url', 'pendingSelector', 'pendingFramePath', 'pendingMatchCount',
    'pendingRawText', 'pendingElementAttributes', 'pendingOwnText', 'mode', 'groups',
    'engine', 'browserActions', 'additionalStartUrls', 'changeDetection', 'proxy', 'hardening', 'pagination', 'persistentSession', 'externalConfig', 'pendingBrowserActionIndex', 'pendingBrowserActionField',
    'selectionKind', 'pendingParentPath', 'pendingNewContainer',
    'apiSearchTarget', 'apiConfigDraft', 'apiConfig',
    'scriptFileName', 'outputFileName',
  ]);
  log('INIT restored', stored);

  _state = applyStoredSessionState(_state, stored);
  if (await restorePendingSelection(bridge, stored)) return;

  setState(STATES.CHECKING_COMPANION);
  await checkCompanion(bridge);
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
    updateGroupTreeNode, moveGroupTreeNode,
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
    buildPaginationConfig,
    buildHardeningConfig, collectFieldNames, addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
    addRequiredField, removeRequiredField,
    computeInitialMonitoringSectionOpen,
    addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions, renderBrowserActions,
    buildVerificationValues,
    frameBadgeHtml,
    jsonValueToBodyDraft, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId,
    bodyTreeLeavesAreBound, serializeBodyTree, allParameterParts, renderBodyTree,
    confirmApiFieldCandidate, loadInitialBodyTreeForCandidate,
    toggleBodyLeafToVariable, toggleBodyLeafToFixed, setBodyLeafParameter, setBodyLeafCoerceTo,
    openBodyParameterModal, confirmBodyParameterModal, confirmApiConfig,
    renderDataPreview,
    createDefaultTransform, addTransform, removeTransform, updateTransform, changeTransformKind,
    moveTransform, transformsAreValid, renderTransformList,
    applyTransformsPreview, toNumberPreview, renderTransformPreview,
    renderThemeToggle, syncModeToggleThumbs,
    applyConfigToState, renderSavedConfigsList, fetchSavedConfigs, saveCurrentConfig, loadSavedConfig,
    deleteSavedConfig, requestDeleteSavedConfig, cancelDeleteSavedConfig, openSaveConfigModal,
    triggerOutputFileDownload, downloadFile,
    saveCurrentOutput, fetchSavedOutputs, toggleSavedConfigOutputs, downloadSavedOutput,
    requestDeleteSavedOutput, cancelDeleteSavedOutput, deleteSavedOutput, renderSaveOutputModal,
  };
}
