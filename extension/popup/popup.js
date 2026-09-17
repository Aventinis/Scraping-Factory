// ── Logging ───────────────────────────────────────────────────────────────────

const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { initI18n, setLanguage, getLanguage, t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { DEFAULT_COMPANION_URL } =
  typeof require !== 'undefined' ? require('../shared/companion-config') : self.SFCompanionConfig;

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
  insertContainerNode, removeGroupTreeNode, formatGroupNodeLabel, serializeGroupTree,
} = typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

const {
  renderApiTree, renderApiCandidates, renderApiEntriesList,
  renderApiConfigScreen, renderBodyTree,
  toggleApiCapture,
  startApiFieldSearch, confirmApiFieldCandidate, loadInitialBodyTreeForCandidate, cancelApiConfig,
  startEmbeddedJsonFieldSearch, confirmEmbeddedJsonFieldCandidate,
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

const { applyConfigToState } =
  typeof require !== 'undefined' ? require('./config-import') : self.SFConfigImport;

const { showToast, showMatchCountToast, setLastError } =
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
} = typeof require !== 'undefined' ? require('./dom-tree-ui') : self.SFDomTreeUI;

const { togglePreview, stopPreviewIfActive } =
  typeof require !== 'undefined' ? require('./preview') : self.SFPreview;

const {
  getResolvedCompanionUrl, checkCompanion, useCustomCompanionUrl, resetCustomCompanionUrl,
  checkRobotsTxt, buildVerificationErrorMessage, generate,
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
  renderSaveOutputModal,
} = typeof require !== 'undefined' ? require('./saved-configs-ui') : self.SFSavedConfigsUI;

const { renderSettingsPanel, wireSettingsPanelEvents } =
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
// then. Issue #169: "ownText" mode reads pendingOwnText, computed at click
// time by content-script.js's collectOwnText — no DOM input to wait on,
// unlike attribute mode's attribute-name field.
function refreshExtendedTransformPreview() {
  const mode = document.getElementById('select-field-mode')?.value ?? 'text';
  let rawValue = null;
  if (mode === 'text') {
    rawValue = _state.pendingRawText;
  } else if (mode === 'attribute') {
    const attrName = document.getElementById('input-field-attribute')?.value.trim();
    if (attrName) rawValue = (_state.pendingElementAttributes?.[attrName] ?? '').trim();
  } else if (mode === 'ownText') {
    // Issue #169
    rawValue = _state.pendingOwnText;
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
    const currentUrlEl = document.getElementById('error-current-url');
    if (currentUrlEl) currentUrlEl.textContent = t('error.currentUrl', { url: getResolvedCompanionUrl() || DEFAULT_COMPANION_URL });
    const urlInput = document.getElementById('input-companion-url');
    if (urlInput && !urlInput.value) urlInput.value = getResolvedCompanionUrl() && getResolvedCompanionUrl() !== DEFAULT_COMPANION_URL ? getResolvedCompanionUrl() : '';
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

    // Issue #175: opt-in persistent session/cookie handling — needs no
    // visibility gating of its own beyond browser-actions-section's own
    // Engine=Browser check above, since it's nested inside that section.
    const persistentSessionToggle = document.getElementById('toggle-persistent-session');
    if (persistentSessionToggle) persistentSessionToggle.checked = _state.persistentSession;

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
    const saveConfigBtn = document.getElementById('btn-save-config');
    if (saveConfigBtn) saveConfigBtn.disabled = !hasConfig;

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

    const outputFileToggle = document.getElementById('toggle-include-output-file');
    if (outputFileToggle) outputFileToggle.checked = _state.includeOutputFile;

    // Issue #83: hidden for API mode — Api builds its own request URL from
    // apiConfig.urlTemplate and never reads this list at all (the companion
    // rejects the combination outright, see Program.cs).
    document.getElementById('additional-urls-row')?.classList.toggle('hidden', _state.mode === 'api');
    const additionalUrlsInput = document.getElementById('input-additional-urls');
    if (additionalUrlsInput && document.activeElement !== additionalUrlsInput) {
      additionalUrlsInput.value = _state.additionalStartUrls.join('\n');
    }

    renderSettingsPanel(bridge);

    // Issue #141: saved-configs-section is scoped to the current page's
    // hostname (fetchSavedConfigs, kicked off from checkCompanion) —
    // rendered every pass like the other IDLE-only lists above rather than
    // only on state transitions, so an in-progress delete confirmation
    // (savedConfigsPendingDeleteId) re-renders correctly too.
    renderSavedConfigsList(bridge);

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
    pendingOwnText: null,
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
  stopPreviewIfActive(bridge);
  setState(_state.current, { mode, ...MODE_SWITCH_CLEARS[mode] });
}

// Passed to every api-config-ui.js/container-tree-ui.js/dom-tree-ui.js/
// preview.js/companion-client.js/saved-configs-ui.js handler, instead of
// those functions closing over this file's own module-level state — see
// api-config-ui.js's own doc comment for why. Declared at module scope
// (not just inside wireEvents()) so popup.js's own top-level functions
// (confirmField, generate, switchMode, ...) can use it too; safe to
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

  document.getElementById('btn-retry')?.addEventListener('click', () => {
    log('BTN retry');
    setState(STATES.CHECKING_COMPANION);
    checkCompanion(bridge);
  });

  document.getElementById('btn-use-companion-url')?.addEventListener('click', () => {
    log('BTN use-companion-url');
    const input = document.getElementById('input-companion-url');
    useCustomCompanionUrl(bridge, input?.value || '');
  });

  document.getElementById('btn-reset-companion-url')?.addEventListener('click', () => {
    log('BTN reset-companion-url');
    resetCustomCompanionUrl(bridge);
  });

  document.getElementById('btn-preview')?.addEventListener('click', () => {
    log('BTN preview');
    togglePreview(bridge);
  });

  document.getElementById('btn-check-robots')?.addEventListener('click', () => {
    log('BTN check-robots');
    checkRobotsTxt(bridge);
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

  // Issue #183: collapsible "Monitoring" section toggle — a plain click
  // (and Enter/Space, since the header is a div with role="button", not a
  // real <button>) flips monitoringSectionOpen; nothing else about
  // change-detection/hardening's own state is touched.
  document.getElementById('monitoring-section-toggle')?.addEventListener('click', () => {
    setState(_state.current, { monitoringSectionOpen: !_state.monitoringSectionOpen });
  });
  document.getElementById('monitoring-section-toggle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setState(_state.current, { monitoringSectionOpen: !_state.monitoringSectionOpen });
    }
  });

  // Issue #184: collapsible "Settings" section toggle — same click/Enter/
  // Space pattern as Monitoring above.
  document.getElementById('settings-section-toggle')?.addEventListener('click', () => {
    setState(_state.current, { settingsSectionOpen: !_state.settingsSectionOpen });
  });
  document.getElementById('settings-section-toggle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setState(_state.current, { settingsSectionOpen: !_state.settingsSectionOpen });
    }
  });

  wireSettingsPanelEvents(bridge);

  document.getElementById('toggle-include-data-preview')?.addEventListener('change', (e) => {
    log('BTN toggle-include-data-preview', e.target.checked);
    patchState({ includeDataPreview: e.target.checked });
  });

  document.getElementById('toggle-include-output-file')?.addEventListener('change', (e) => {
    log('BTN toggle-include-output-file', e.target.checked);
    patchState({ includeOutputFile: e.target.checked });
  });

  document.getElementById('toggle-output-json')?.addEventListener('change', (e) => {
    log('BTN toggle-output-json', e.target.checked);
    patchState({ useJsonOutput: e.target.checked });
  });

  document.getElementById('btn-api-search')?.addEventListener('click', () => {
    log('BTN api-search');
    startApiFieldSearch(bridge);
  });

  document.getElementById('btn-embedded-json-search')?.addEventListener('click', () => {
    log('BTN embedded-json-search');
    startEmbeddedJsonFieldSearch(bridge);
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

  // Issue #136: the same #api-candidates-list serves both a network search
  // (startApiFieldSearch) and an embedded-JSON search (startEmbeddedJsonField
  // Search) — dispatch to the matching confirm function purely by candidate
  // shape (only an embedded-JSON candidate ever carries scriptSelector, see
  // content-script.js's findEmbeddedJsonCandidates vs. findApiCandidates).
  wireApiCandidateListEvents(
    'api-candidates-list', () => _state.apiCandidates?.candidates,
    (candidate, fieldName, siblingNames) => (candidate.scriptSelector
      ? confirmEmbeddedJsonFieldCandidate(bridge, candidate, fieldName, siblingNames)
      : confirmApiFieldCandidate(bridge, candidate, fieldName, siblingNames)),
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
    stopPreviewIfActive(bridge);
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    setState(STATES.SELECTING, {
      pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (_state.domViewEnabled) {
      log('DOM view was enabled → re-requesting tree');
      requestDomTree(bridge);
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
      stopPreviewIfActive(bridge);
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

  document.getElementById('toggle-dom-view')?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    log('BTN toggle-dom-view', enabled);
    if (enabled) {
      patchState({ domViewEnabled: true });
      requestDomTree(bridge);
    } else {
      chrome.runtime.sendMessage({ type: 'DISABLE_DOM_VIEW' });
      cancelPendingDomTreeRequest();
      patchState({ domViewEnabled: false });
    }
  });

  document.getElementById('btn-field-confirm')?.addEventListener('click', confirmField);

  document.getElementById('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField();
  });

  document.getElementById('btn-field-cancel')?.addEventListener('click', () => {
    log('BTN field-cancel');
    setState(STATES.IDLE, { pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [] });
  });

  // Event delegation for "Remove" buttons in the field list
  document.getElementById('fields-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    log('FIELD_REMOVE', { index, name: _state.fields[index]?.name });
    stopPreviewIfActive(bridge);
    setState(_state.current, { fields: removeField(_state.fields, index) });
  });

  document.getElementById('btn-generate')?.addEventListener('click', () => {
    log('BTN generate');
    generate(bridge);
  });
  document.getElementById('btn-download')?.addEventListener('click', () => triggerDownload(bridge));
  document.getElementById('btn-download-output')?.addEventListener('click', () => triggerOutputFileDownload(bridge));
  document.getElementById('btn-export-config')?.addEventListener('click', () => downloadConfigExport(bridge));

  // Issue #202: "Save output" (DONE screen) opens modal-save-output — a
  // config picker + name input when there's at least one saved config for
  // this hostname already, or a hint + shortcut into modal-save-config
  // otherwise (see renderSaveOutputModal, called from render()).
  document.getElementById('btn-save-output')?.addEventListener('click', () => {
    log('BTN save-output → open modal');
    patchState({ saveOutputModalOpen: true });
  });
  document.getElementById('btn-save-output-cancel')?.addEventListener('click', () => {
    log('BTN save-output-cancel');
    patchState({ saveOutputModalOpen: false });
  });
  document.getElementById('btn-save-output-confirm')?.addEventListener('click', () => {
    const configId = parseInt(document.getElementById('select-save-output-config')?.value, 10);
    const name = document.getElementById('input-save-output-name')?.value.trim();
    if (!configId || !name) return;
    log('BTN save-output-confirm', configId, name);
    saveCurrentOutput(bridge, configId, name);
  });
  document.getElementById('input-save-output-name')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const configId = parseInt(document.getElementById('select-save-output-config')?.value, 10);
    const name = e.target.value.trim();
    if (!configId || !name) return;
    saveCurrentOutput(bridge, configId, name);
  });
  document.getElementById('btn-save-output-go-to-save-config')?.addEventListener('click', () => openSaveConfigModal(bridge));

  // Issue #141: "Save configuration" opens modal-save-config (name input,
  // prefilled with the current page's hostname); Load/Delete are wired via
  // delegation on saved-configs-list below since rows are rebuilt on every
  // render() (see renderSavedConfigsList).
  document.getElementById('btn-save-config')?.addEventListener('click', () => openSaveConfigModal(bridge));
  document.getElementById('btn-save-config-cancel')?.addEventListener('click', () => {
    log('BTN save-config-cancel');
    patchState({ saveConfigModalOpen: false });
  });
  document.getElementById('btn-save-config-confirm')?.addEventListener('click', () => {
    const name = document.getElementById('input-save-config-name')?.value.trim();
    if (!name) return;
    log('BTN save-config-confirm', name);
    saveCurrentConfig(bridge, name);
  });
  document.getElementById('input-save-config-name')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const name = e.target.value.trim();
    if (!name) return;
    saveCurrentConfig(bridge, name);
  });

  document.getElementById('saved-configs-list')?.addEventListener('click', (e) => {
    const loadBtn = e.target.closest('.btn-saved-config-load');
    if (loadBtn) {
      const id = parseInt(loadBtn.dataset.id, 10);
      log('BTN saved-config-load', id);
      loadSavedConfig(bridge, id);
      return;
    }
    const deleteBtn = e.target.closest('.btn-saved-config-delete');
    if (deleteBtn) {
      requestDeleteSavedConfig(bridge, parseInt(deleteBtn.dataset.id, 10));
      return;
    }
    const confirmBtn = e.target.closest('.btn-saved-config-delete-confirm');
    if (confirmBtn) {
      deleteSavedConfig(bridge, parseInt(confirmBtn.dataset.id, 10));
      return;
    }
    const cancelBtn = e.target.closest('.btn-saved-config-delete-cancel');
    if (cancelBtn) {
      cancelDeleteSavedConfig(bridge);
      return;
    }

    // Issue #202: a saved config row's own "Outputs" toggle and, once
    // expanded, its Download/Delete actions — same delegated-listener
    // treatment as the config-level buttons above, since these rows are
    // also rebuilt on every render() (see renderSavedConfigsList).
    const outputsToggleBtn = e.target.closest('.btn-saved-config-outputs-toggle');
    if (outputsToggleBtn) {
      toggleSavedConfigOutputs(bridge, parseInt(outputsToggleBtn.dataset.id, 10));
      return;
    }
    const outputDownloadBtn = e.target.closest('.btn-saved-output-download');
    if (outputDownloadBtn) {
      downloadSavedOutput(
        parseInt(outputDownloadBtn.dataset.configId, 10), parseInt(outputDownloadBtn.dataset.id, 10));
      return;
    }
    const outputDeleteBtn = e.target.closest('.btn-saved-output-delete');
    if (outputDeleteBtn) {
      requestDeleteSavedOutput(bridge, parseInt(outputDeleteBtn.dataset.id, 10));
      return;
    }
    const outputConfirmBtn = e.target.closest('.btn-saved-output-delete-confirm');
    if (outputConfirmBtn) {
      deleteSavedOutput(
        bridge, parseInt(outputConfirmBtn.dataset.configId, 10), parseInt(outputConfirmBtn.dataset.id, 10));
      return;
    }
    const outputCancelBtn = e.target.closest('.btn-saved-output-delete-cancel');
    if (outputCancelBtn) cancelDeleteSavedOutput(bridge);
  });

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
      stopPreviewIfActive(bridge);
      chrome.runtime.sendMessage({ type: 'START_SELECTION' });
      setState(STATES.SELECTING, {
        pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [], selectionKind: 'browserAction', pendingBrowserActionIndex: index, pendingBrowserActionField: field,
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
      // Issue #137 follow-up: content-script.js's retryScopeSelector tags
      // its own "retried and still nothing" case with unavailableKind —
      // distinct from the other SELECTION_UNAVAILABLE sender (service-
      // worker.js, when chrome.tabs.sendMessage itself fails — no content
      // script running at all). A scope selector legitimately, repeatedly
      // failing to resolve can have entirely page-specific causes outside
      // the extension's control (confirmed via a real report: a class only
      // present while the element is actually hovered, gone the instant the
      // cursor leaves the page for the side panel) — not a plugin
      // malfunction, so it's shown as a softer warning with no "Report bug"
      // button (no context passed to showToast) instead of the harder error
      // styling the other, genuinely unexpected case still gets.
      if (message.unavailableKind === 'scopeSelectorNotFound') {
        showToast(t('toast.scopeSelectorNotFound'), null, 'warn');
      } else {
        showToast(t('toast.selectionUnavailable'), 'Element selection');
      }
    }
    // Issue #167: a click that landed outside every instance of the
    // container being edited — selection stays active (unlike
    // SELECTION_UNAVAILABLE above, which is a hard failure), this is just a
    // brief nudge so the user isn't left guessing why nothing happened.
    if (message.type === 'SELECTION_CLICK_OUT_OF_SCOPE' && _state.current === STATES.SELECTING) {
      showToast(t('toast.clickOutsideScope'), null, 'warn');
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
          selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
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
          selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
      } else if (_state.selectionKind === 'pagination') {
        // Issue #174 follow-up: lets a non-developer pick the "next page"
        // link by clicking it instead of having to know/type a CSS
        // selector — same "write straight into the one field, no naming
        // modal needed" shape as the browserAction branch above, just with
        // no index (there's only ever one nextLinkSelector).
        setState(STATES.IDLE, {
          pagination: { ..._state.pagination, nextLinkSelector: message.selector },
          selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
      } else {
        setState(STATES.SELECTING, {
          pendingSelector: message.selector, pendingFramePath: framePath, pendingMatchCount: matchCount,
          pendingRawText: typeof message.rawText === 'string' ? message.rawText : null,
          pendingElementAttributes: message.attributes ?? null,
          pendingOwnText: typeof message.ownText === 'string' ? message.ownText : null,
          pendingTransforms: [],
        });
      }
      if (message.path) highlightSelected(message.path);
    }
    if (message.type === 'DOM_TREE') {
      log('DOM_TREE received', { nodes: message.tree, truncated: message.truncated });
      cancelPendingDomTreeRequest();
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
      showToast(t('toast.previewUnavailable'), 'Preview');
    }
    if (message.type === 'API_CAPTURE_ENTRY' && _state.apiCaptureActive) {
      log('API_CAPTURE_ENTRY received', message.entry?.url);
      patchState({ apiCaptureCount: _state.apiCaptureCount + 1 });
    }
    if (message.type === 'API_CAPTURE_UNAVAILABLE') {
      log('API_CAPTURE_UNAVAILABLE', message.reason);
      setLastError(message.reason, 'Network recording');
      patchState({ apiCaptureActive: false, apiCaptureCount: 0 });
      showToast(t('toast.captureUnavailable'), 'Network recording');
    }
    // Issue #136: EMBEDDED_JSON_CANDIDATES is content-script.js's
    // findEmbeddedJsonCandidates counterpart to API_CANDIDATES — handled
    // identically here, since dispatch is entirely keyed off the shape of
    // _state.apiSearchTarget (set by either startApiFieldSearch/
    // startEmbeddedJsonFieldSearch for 'field', or startApiTreeFieldSearch
    // for the tree-extension case), not off which message type arrived.
    if ((message.type === 'API_CANDIDATES' || message.type === 'EMBEDDED_JSON_CANDIDATES') && _state.apiSearchTarget) {
      log(`${message.type} received`, { target: message.target, count: message.candidates?.length, for: _state.apiSearchTarget });
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
  if (stored.pagination)            _state = { ..._state, pagination: stored.pagination };
  if (stored.persistentSession !== undefined) _state = { ..._state, persistentSession: stored.persistentSession };
  if (stored.externalConfig !== undefined) _state = { ..._state, externalConfig: stored.externalConfig };
  if (stored.hardening)             _state = { ..._state, hardening: stored.hardening };
  if (stored.scriptFileName)        _state = { ..._state, scriptFileName: stored.scriptFileName };
  if (stored.outputFileName)        _state = { ..._state, outputFileName: stored.outputFileName };
  if (stored.selectionKind)         _state = { ..._state, selectionKind: stored.selectionKind };
  if (stored.pendingParentPath !== undefined) _state = { ..._state, pendingParentPath: stored.pendingParentPath };
  if (stored.pendingNewContainer)   _state = { ..._state, pendingNewContainer: stored.pendingNewContainer };
  if (stored.pendingBrowserActionIndex !== undefined) _state = { ..._state, pendingBrowserActionIndex: stored.pendingBrowserActionIndex };
  if (stored.pendingBrowserActionField)   _state = { ..._state, pendingBrowserActionField: stored.pendingBrowserActionField };
  if (stored.apiConfigDraft)        _state = { ..._state, apiConfigDraft: stored.apiConfigDraft };
  if (stored.apiConfig)             _state = { ..._state, apiConfig: stored.apiConfig };

  // Issue #183: one-time default-open computation, now that changeDetection/
  // hardening have been restored from storage above — a returning user with
  // something already configured in the "Monitoring" section shouldn't have
  // to re-expand it just to see it.
  if (computeInitialMonitoringSectionOpen(_state.changeDetection, _state.hardening)) {
    _state = { ..._state, monitoringSectionOpen: true };
  }

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
        groups, selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
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
        browserActions, selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      });
      return;
    }

    if (stored.selectionKind === 'pagination' && stored.pendingSelector) {
      // Same as the live ELEMENT_SELECTED path: write the picked selector
      // straight into pagination.nextLinkSelector, no naming modal needed.
      log('INIT pending pagination selector found → updating pagination', stored.pendingSelector);
      const pagination = { ..._state.pagination, nextLinkSelector: stored.pendingSelector };
      await chrome.storage.session.set({ pagination });
      setState(STATES.IDLE, {
        pagination, selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
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
      pendingOwnText: typeof stored.pendingOwnText === 'string' ? stored.pendingOwnText : null,
      pendingTransforms: [],
    });
    return;
  }

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
    openBodyParameterModal, confirmBodyParameterModal, cancelBodyParameterModal, confirmApiConfig,
    renderDataPreview,
    createDefaultTransform, addTransform, removeTransform, updateTransform, changeTransformKind,
    moveTransform, transformsAreValid, renderTransformList,
    applyTransformsPreview, toNumberPreview, renderTransformPreview,
    refreshFlatTransformPreview, refreshExtendedTransformPreview,
    renderThemeToggle, syncModeToggleThumbs,
    applyConfigToState, renderSavedConfigsList, fetchSavedConfigs, saveCurrentConfig, loadSavedConfig,
    deleteSavedConfig, requestDeleteSavedConfig, cancelDeleteSavedConfig, openSaveConfigModal,
    triggerOutputFileDownload, downloadFile,
    saveCurrentOutput, fetchSavedOutputs, toggleSavedConfigOutputs, downloadSavedOutput,
    requestDeleteSavedOutput, cancelDeleteSavedOutput, deleteSavedOutput, renderSaveOutputModal,
  };
}
