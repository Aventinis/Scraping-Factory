const COMPANION_URL = 'http://localhost:5000';

const STATES = {
  CHECKING_COMPANION: 'CHECKING_COMPANION',
  COMPANION_ERROR:    'COMPANION_ERROR',
  IDLE:               'IDLE',
  SELECTING:          'SELECTING',
  API_CONFIG:         'API_CONFIG', // Issue #53 Phase 5 — configuring a confirmed candidate into an ApiConfig
  GENERATING:         'GENERATING',
  DONE:               'DONE',
};

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
  apiConfigDraft:     null, // set once a candidate is confirmed as the primary field — the in-progress ApiConfig being built, see buildApiConfig/confirmApiFieldCandidate
  apiConfig:          null, // the "Apply"-confirmed ApiConfig wire object — Phase 6 will read this; persisted like fields/groups
  robotsTxtChecking: false, // not persisted, always off on popup reopen (like previewActive/apiCaptureActive)
  robotsTxtResult:   null,  // {ok, robotsUrl, path, notFound, allowed, matchedRule} | {ok:false, error} from the content script's CHECK_ROBOTS_TXT response, or null before the first check
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

// ── Logging ───────────────────────────────────────────────────────────────────

const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { SUPPORTED_LANGUAGES, initI18n, setLanguage, getLanguage, t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));
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

// `apiConfig` is only read when mode === 'api' — the confirmed ApiConfig
// wire object built by buildApiConfig (Issue #53 Phase 5), passed straight
// through as the request body's `api` field. Method/OutputFormat are forced
// server-side (see companion's ScrapingPlanBuilder), so nothing extra is
// added here the way outputFormat is for flat mode.
// `scriptFileName`/`outputFileName` are sent as-is (possibly blank) — the
// companion sanitizes and defaults them itself (see FileNameSanitizer),
// same "server is the source of truth" pattern as OutputFormat.
// `engine`/`browserActions` (Issue #41/#42, Phase 5) are mode-independent —
// only included at all when `engine === 'Browser'` (the server already
// defaults to Static when the key is absent, so the 'Static' case round-trips
// to byte-for-byte the same request body as before this existed), and
// `browserActions` only on top of that when non-empty.
function buildScrapingConfig(
  url, mode, fields, groups, apiConfig = null, scriptFileName = null, outputFileName = null,
  engine = 'Static', browserActions = [],
) {
  const engineFields = engine === 'Browser'
    ? { engine, ...(browserActions.length > 0 ? { browserActions: serializeBrowserActions(browserActions) } : {}) }
    : {};

  if (mode === 'container') {
    return {
      version: '1', url, groups: serializeGroupTree(groups),
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields,
    };
  }
  if (mode === 'api') {
    return {
      version: '1', url, api: apiConfig,
      scriptFileName: scriptFileName || null, outputFileName: outputFileName || null,
      ...engineFields,
    };
  }
  return {
    version: '1',
    url,
    fields: fields.map(f => ({
      name: f.name, selector: f.selector, attribute: f.attribute ?? null,
      ...(f.framePath ? { framePath: f.framePath } : {}),
    })),
    outputFormat: 'Csv',
    scriptFileName: scriptFileName || null,
    outputFileName: outputFileName || null,
    ...engineFields,
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
  engine = 'Static', browserActions = [],
) {
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: manifest.version || '?',
    config: buildScrapingConfig(url, mode, fields, groups, apiConfig, scriptFileName, outputFileName, engine, browserActions),
  };
}

function addField(fields, name, selector, framePath = null) {
  return [...fields, { name, selector, attribute: null, framePath: framePath || null }];
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

// ── API-Mode config assembly (Issue #53 Phase 5) ────────────────────────────
// Turns a confirmed Phase-4 candidate request into a parameterized ApiConfig
// (companion/ScrapingFactory.Compiler/IR/ApiConfig.cs) — URL decomposed into
// literal/variable path segments and query params, each variable part given
// a value source, captured request headers optionally adopted. Not wired
// into buildScrapingConfig/`/generate` yet — that's Phase 6, which also adds
// the third top-level mode; this only has to produce the right shape.

// One entry per non-empty path segment / query param, `variable`/`name`
// default to "not parameterized yet" so the URL-editor screen can render
// the decomposed request before the user has toggled anything.
function parseUrlTemplateParts(urlString) {
  const url = new URL(urlString);
  const pathSegments = url.pathname.split('/').filter(s => s !== '').map(value => ({ value, variable: false, name: '' }));
  const queryParams = Array.from(url.searchParams.entries()).map(([key, value]) => ({ key, value, variable: false, name: key }));
  return { origin: url.origin, pathSegments, queryParams };
}

// Inverse of parseUrlTemplateParts, given the (possibly since-edited)
// segments/params — a "variable" part becomes a "{name}" placeholder,
// otherwise its literal value is kept. Path segment values come straight
// from url.pathname (already percent-encoded, so used as-is); query values
// come from url.searchParams (percent-*decoded* by the URL API), so those
// need re-encoding when rebuilt.
function buildUrlTemplate({ origin, pathSegments, queryParams }) {
  const path = pathSegments.map(seg => (seg.variable ? `{${seg.name}}` : seg.value)).join('/');
  const query = queryParams
    .map(p => `${encodeURIComponent(p.key)}=${p.variable ? `{${p.name}}` : encodeURIComponent(p.value)}`)
    .join('&');
  return `${origin}/${path}${query ? `?${query}` : ''}`;
}

// Werteliste source: comma- or newline-separated free text → trimmed,
// non-empty values.
function parseValueListInput(text) {
  return String(text ?? '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
}

// API-mode follow-up: auto-fill a StaticListSource's value list from the
// recorded request pool. `urlParts` is the confirmed candidate's own
// decomposed URL (see parseUrlTemplateParts) with the user's current
// variable/name toggles; `targetPartId` ("path:<index>" or "query:<key>")
// is the one part being derived — every *other* fixed part must match
// exactly for an entry to count as "the same endpoint, different value",
// and every other *variable* part is left free (it's parameterized
// separately, so siblings may legitimately disagree on it too). Each
// candidate entry's URL is parsed with the same parseUrlTemplateParts used
// to build urlParts in the first place, so a matched value comes back in
// exactly the representation buildUrlTemplate expects to substitute back in
// (percent-encoded-as-is for a path segment, percent-decoded for a query
// param) — no extra normalization needed. Returns distinct values in
// first-seen order.
function findUrlTemplateMatches(urlParts, targetPartId, entries) {
  const [targetScope, targetKey] = targetPartId.split(':');
  const seen = new Set();
  const values = [];

  (entries || []).forEach((entry) => {
    let candidate;
    try {
      candidate = parseUrlTemplateParts(entry.url);
    } catch {
      return; // not a resolvable absolute URL — can't compare
    }
    if (candidate.origin !== urlParts.origin) return;
    if (candidate.pathSegments.length !== urlParts.pathSegments.length) return;

    for (let i = 0; i < urlParts.pathSegments.length; i++) {
      const partId = `path:${i}`;
      if (partId === targetPartId) continue;
      const seg = urlParts.pathSegments[i];
      if (seg.variable) continue; // parameterized independently — free to differ
      if (candidate.pathSegments[i].value !== seg.value) return;
    }

    const urlKeys = urlParts.queryParams.map(p => p.key).slice().sort().join(',');
    const candidateKeys = candidate.queryParams.map(p => p.key).slice().sort().join(',');
    if (urlKeys !== candidateKeys) return; // different query-key shape → not the same endpoint

    for (const p of urlParts.queryParams) {
      const partId = `query:${p.key}`;
      if (partId === targetPartId) continue;
      if (p.variable) continue;
      const match = candidate.queryParams.find(q => q.key === p.key);
      if (!match || match.value !== p.value) return;
    }

    const extracted = targetScope === 'path'
      ? candidate.pathSegments[parseInt(targetKey, 10)]?.value
      : candidate.queryParams.find(q => q.key === targetKey)?.value;

    if (extracted && !seen.has(extracted)) {
      seen.add(extracted);
      values.push(extracted);
    }
  });

  return values;
}

// Appends newly-derived values onto an existing value-list text without
// touching anything already there — including a value the user has since
// deleted, which a full re-derivation must not silently resurrect (see the
// "merge, don't replace" decision this mirrors). Dedupes against
// parseValueListInput's own reading of the existing text, the same split
// the textarea itself is interpreted with everywhere else.
function mergeValueListValues(existingText, newValues) {
  const existing = new Set(parseValueListInput(existingText));
  const added = newValues.filter(v => !existing.has(v));
  if (added.length === 0) return { text: existingText || '', addedCount: 0 };
  const prefix = existingText && existingText.trim() ? `${existingText.replace(/\s+$/, '')}\n` : '';
  return { text: prefix + added.join('\n'), addedCount: added.length };
}

function buildStaticListSource(valuesText) {
  return { kind: 'staticList', values: parseValueListInput(valuesText) };
}

// urlTemplate here is deliberately the confirmed candidate's raw URL, not
// built from segments/params like the main request — DiscoverySource is
// expected to be fully static (see ScrapingPlanValidator.ValidateDiscoverySource:
// no cross-checking against the main request's parameters, by design, since
// Phase 1 rules out dependencies between parameters).
function buildDiscoverySource(urlTemplate, itemsPath, valuePath) {
  return { kind: 'discovery', urlTemplate, itemsPath, valuePath };
}

// `format` is omitted from the wire object entirely when unset (Number has
// no format concept, and an empty/undetected one shouldn't override the
// backend's own default) — mirrors PythonApiConfigLiteral's RenderFormatSuffix
// on the companion side, which does the same for the same reason: the
// runtime's own hardcoded default (RangeFormat.Resolve) stays the single
// source of truth for "what ISO-Standard actually means" when nothing was
// explicitly chosen.
function buildRangeSource(type, from, to, format) {
  return { kind: 'range', type, from, to, ...(format ? { format } : {}) };
}

// ── Range format presets (bug/api-range-format follow-up) ──────────────────
// A target site can encode a year-week or date however it likes in its own
// URL — the reported bug: penny.de uses "2026-35" where the ISO-8601
// default "{yyyy}-W{ww}" expects "2026-W35", crashing the generated script.
// These presets cover the common shapes without the user ever typing the
// "{yyyy}"-style token syntax by hand; "custom" (any format not in this
// list) is the escape hatch for anything else. Order matters: the first
// entry per type is also the "nothing else matched" fallback in
// detectRangeFormat, so it must be the ISO-8601/RangeFormat.Resolve default.
const RANGE_FORMAT_PRESETS = {
  IsoWeek: [
    { format: '{yyyy}-W{ww}', labelKey: 'apiConfig.presetIsoWeekStandard' },
    { format: '{yyyy}-{ww}', labelKey: 'apiConfig.presetIsoWeekNoSeparator' },
  ],
  Date: [
    { format: '{yyyy}-{mm}-{dd}', labelKey: 'apiConfig.presetDateStandard' },
    { format: '{dd}.{mm}.{yyyy}', labelKey: 'apiConfig.presetDateGerman' },
    { format: '{yyyy}{mm}{dd}', labelKey: 'apiConfig.presetDateNoSeparator' },
  ],
};

const RANGE_FORMAT_TOKEN_PATTERNS = { yyyy: '\\d{4}', ww: '\\d{1,2}', mm: '\\d{1,2}', dd: '\\d{1,2}' };

// Mirrors, character for character, RangeFormat.CompilePattern on the
// companion side (companion/ScrapingFactory.Compiler/Backends/Python/RangeFormat.cs)
// and _compile_range_format in scraper_api.py.j2 — a value this matches is
// guaranteed to parse there too. Kept as its own small copy rather than
// shared code across the extension/companion boundary, same as every other
// piece of duplicated-but-consistent logic in this app (e.g. the JSON-path
// DSL, per CLAUDE.md).
function compileRangeFormatPattern(format) {
  let pattern = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [token, valuePattern] of Object.entries(RANGE_FORMAT_TOKEN_PATTERNS)) {
    pattern = pattern.replaceAll(`\\{${token}\\}`, valuePattern);
  }
  return new RegExp(`^${pattern}$`);
}

// Auto-suggests a format the moment "Range" is picked (or its Type is
// changed): matches `rawValue` — the literal example captured from the
// recording (see part.value below) — against each type's presets in order,
// falling back to the ISO-Standard preset (always first, see
// RANGE_FORMAT_PRESETS's doc comment) when nothing matches or there's no
// raw value yet. For the reported bug's exact case ("2026-35"), this picks
// "Jahr-Woche ohne Trennzeichen" with zero typing. Returns null for Number,
// which has no format concept.
function detectRangeFormat(type, rawValue) {
  const presets = RANGE_FORMAT_PRESETS[type];
  if (!presets) return null;
  if (rawValue) {
    const matched = presets.find(preset => compileRangeFormatPattern(preset.format).test(rawValue));
    if (matched) return matched.format;
  }
  return presets[0].format;
}

// The captured literal a variable URL part started out as (e.g. "2026-35")
// — parseUrlTemplateParts stores it in seg.value/p.value, the "variabel"
// toggle preserves it via object spread, and variableUrlParts carries it
// through as part.value; this just looks it up by partId for
// detectRangeFormat's benefit.
function findUrlPartValue(urlParts, partId) {
  return variableUrlParts(urlParts).find(p => p.id === partId)?.value;
}

// "Example: …" text next to From/To: echoes `fromValue` back verbatim once
// it actually matches `format` (proving the round-trip works), or shows the
// bare token template as a hint otherwise (not-yet-matching From) — or,
// null for an empty format (the "Custom format…" preset before anything's
// been typed into its revealed input), leaving it to the caller to show a
// translated "enter a format" prompt instead of silently falling back to a
// different preset's template. Kept translation-free (unlike the render
// functions that call it) so it stays a pure, load-order-independent
// function to unit-test directly.
function rangeFormatExample(format, fromValue) {
  if (!format) return null;
  if (fromValue && compileRangeFormatPattern(format).test(fromValue)) return fromValue;
  return format;
}

// capturedHeaders: [{name, value}] from the confirmed candidate's recorded
// request (api-capture.js's requestHeaders). decisions: {[headerName]:
// {include, mode: 'literal'|'env', envName}} — the header-adoption table's
// per-row choice. Mirrors FillStep's env-var pattern: a header adopted via
// an environment variable is never embedded literally.
function buildApiHeaders(capturedHeaders, decisions) {
  return capturedHeaders
    .filter(h => decisions[h.name]?.include)
    .map((h) => {
      const decision = decisions[h.name];
      return decision.mode === 'env'
        ? { name: h.name, environmentVariableName: decision.envName }
        : { name: h.name, value: h.value };
    });
}

// Top-level assembly: the ApiConfig wire object exactly as
// companion/ScrapingFactory.Compiler/IR/ApiConfig.cs expects it (method
// omitted — GET is the only supported value and also the backend default).
// `itemsPath`/`fields` are the confirmed candidate's own flat shape (derived
// once via content-script.js's deriveItemsAndValuePath when the candidate
// was confirmed, not re-derived here) — this function only assembles, it
// doesn't re-derive anything from a JSON body.
//
// Issue #54, Phase A5: `groups` (the tree draft, serialized via
// serializeApiTree) takes over from `itemsPath`/`fields` whenever present —
// the popup only ever builds tree drafts going forward (see
// confirmApiFieldCandidate), but this branch is kept so the flat wire shape
// stays directly testable/constructible here too, exactly mirroring how the
// wire format itself keeps both shapes available (IR/ApiConfig.cs).
function buildApiConfig({ urlParts, itemsPath, fields, groups, parameterSources, capturedHeaders, headerDecisions }) {
  const urlTemplate = buildUrlTemplate(urlParts);
  const variableParts = [...urlParts.pathSegments, ...urlParts.queryParams].filter(p => p.variable);
  const parameters = variableParts.map(p => ({ name: p.name, source: parameterSources[p.name] }));
  const headers = buildApiHeaders(capturedHeaders, headerDecisions);

  return {
    urlTemplate,
    ...(groups ? { groups: serializeApiTree(groups) } : { itemsPath, fields }),
    parameters,
    ...(headers.length > 0 ? { headers } : {}),
  };
}

// ── API-Mode tree (ApiGroup/ApiField, Issue #54 Phase A4) ───────────────────
// The JSON-path counterpart to the Container-Mode tree below: near-verbatim
// renames of the same helpers (`path` instead of `selector`, no
// mode/attribute/repeating/framePath concept at all — ApiGroup's own
// repeating-ness is inferred at runtime from JSON structure, never chosen
// here, see companion/.../IR/ApiConfig.cs's ApiGroup doc comment) — the tree
// machinery itself is generic over "a node has a name, is a
// group-with-children or a leaf" and needed no new *shape* thinking.
// Pure helpers only in this phase; event wiring into the API_CONFIG screen
// is Phase A5.

function buildApiGroupDraft(name, path) {
  return { kind: 'group', name, path, children: [] };
}

function buildApiFieldDraft(name, path) {
  return { kind: 'field', name, path };
}

function resolveApiTreeNode(groups, path) {
  if (!path || path.length === 0) return null;
  let node = groups[path[0]];
  for (let i = 1; i < path.length; i++) node = node.children[path[i]];
  return node;
}

// Appends `node` as the last child at `parentPath` (or at root level when
// `parentPath` is null) — immutable, like insertContainerNode below.
function insertApiTreeNode(groups, parentPath, node) {
  const path = parentPath || [];
  if (path.length === 0) return [...groups, node];
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head ? { ...n, children: insertApiTreeNode(n.children, rest, node) } : n));
}

// Removes the node (and its subtree) at `path` — always non-empty, unlike
// insertApiTreeNode's parentPath.
function removeApiTreeNode(groups, path) {
  if (path.length === 1) return groups.filter((_, i) => i !== path[0]);
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head ? { ...n, children: removeApiTreeNode(n.children, rest) } : n));
}

// Strips the popup's internal `kind` tag and shapes each node exactly like
// the wire format the companion expects (IR/ApiConfig.cs's
// ApiGroup/ApiField, discriminated structurally by ApiNodeJsonConverter via
// presence of `children` — see PythonApiConfigLiteral.RenderGroups on the
// codegen side for the same discriminator).
function serializeApiTree(groups) {
  return groups.map(node => node.kind === 'group'
    ? { name: node.name, path: node.path, children: serializeApiTree(node.children) }
    : { name: node.name, path: node.path });
}

// The idle screen's "API-Konfiguration bereit: N Feld(er), …" summary wants
// a leaf-field count regardless of shape: the older flat ApiConfig.Fields is
// already flat, but a tree-shaped ApiConfig.Groups (Issue #54) needs
// counting recursively — every ApiField anywhere in the tree, at any depth.
function countApiConfigFields(apiConfig) {
  if (!apiConfig.groups) return apiConfig.fields.length;
  const countNodes = nodes => nodes.reduce((sum, node) => sum + (node.children ? countNodes(node.children) : 1), 0);
  return countNodes(apiConfig.groups);
}

// Immutable "map the one node at `path`" — the third tree-shape primitive
// alongside insert/remove, needed once node names became editable in place
// (Phase A5, see setApiTreeNodeName) rather than only ever chosen once at
// creation time.
function updateApiTreeNode(groups, path, updater) {
  const [head, ...rest] = path;
  return groups.map((node, i) => {
    if (i !== head) return node;
    return rest.length === 0 ? updater(node) : { ...node, children: updateApiTreeNode(node.children, rest, updater) };
  });
}

// Every node in the tree (recursively) has a non-blank name — gates
// "Übernehmen" the same way apiConfigDraftHasAllSourcesChosen's flat-mode
// check does, generalized: intermediate groups are auto-named (see
// buildApiSubtreeFromCandidate) but that name is editable like any other and
// so can still be blanked out.
function apiTreeNodesHaveNonBlankNames(nodes) {
  return nodes.every(node => !!node.name?.trim() && (node.kind !== 'group' || apiTreeNodesHaveNonBlankNames(node.children)));
}

// Phase A5: JSON keys, unlike CSS selectors, already carry a meaningful name
// — so a group auto-derived from a confirmed search candidate's path is
// named after its own last path segment (e.g. "data.categories" →
// "categories") instead of asking the user, the same way a sibling field is
// already named after its own JSON key. Returns null for an empty path (the
// array-of-arrays case, see ApiGroup.Path) or a path with no plain key
// segment at all — callers fall back to a generic placeholder.
function lastPathSegmentName(path) {
  if (!path) return null;
  const tokens = path.match(/[^.[\]]+|\[\d+\]/g) || [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!tokens[i].startsWith('[')) return tokens[i];
  }
  return null;
}

// Builds the new tree node(s) a confirmed API-search candidate becomes —
// shared by the very first candidate (Phase A5's "root/primary field flow",
// skipSegments 0, parentPath null) and every later "add root group"/"add
// sub-field" search (skipSegments === the target group's own tree depth,
// since that many of candidate.treeSkeleton's leading segments are already
// represented by existing ancestor groups, see resolveApiGroupScopePath's
// doc comment). candidate.treeSkeleton is content-script.js's
// deriveApiTreeSkeleton output, pre-computed and attached to the candidate
// message (findApiCandidates) — popup.js runs in a different execution
// context and has no access to content-script.js's own functions, the same
// reason candidate.itemsPath/valuePath are pre-derived there too. Auto-names
// intermediate groups (see lastPathSegmentName); siblings are always direct
// properties of the same matched record, so (exactly like flat mode before
// it) each sibling's own JSON key doubles as its relative path. Returns an
// array of one or more new sibling nodes to insert at the target
// parentPath — one node if the click landed inside an already-represented
// scope (the "sibling field" case), possibly several nested levels wrapped
// in one outer node otherwise.
function buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames, skipSegments = 0) {
  const skeleton = candidate.treeSkeleton.slice(skipSegments);
  const leafField = buildApiFieldDraft(fieldName, skeleton[skeleton.length - 1].path);
  const siblingDrafts = siblingNames.map(name => buildApiFieldDraft(name, name));
  const groupSegments = skeleton.slice(0, -1);
  return groupSegments.reduceRight((children, seg) => [
    { ...buildApiGroupDraft(lastPathSegmentName(seg.path) || t('apiTree.defaultGroupName'), seg.path), children },
  ], [leafField, ...siblingDrafts]);
}

// The absolute JSON path to scope an "add sub-field"/"add sub-group" search
// to an existing ApiGroup at tree `path` — every ancestor's own (relative,
// index-free) path segment gets its first-instance index appended, the same
// "first instance is the template" assumption Container-Mode's own
// scopeSelector already relies on (see content-script.js's
// pathStartsWithScope). E.g. tree path [0, 1] under {path:'categories'} →
// {path:'subcategories'} resolves to "categories[0].subcategories[0]".
function resolveApiGroupScopePath(groups, path) {
  let scope = '';
  let nodes = groups;
  for (const index of path) {
    const node = nodes[index];
    scope = node.path ? (scope ? `${scope}.${node.path}[0]` : `${node.path}[0]`) : `${scope}[0]`;
    nodes = node.children;
  }
  return scope;
}

// Same visual pattern as the Container-Mode tree editor below (indentation,
// toggle arrow, add/remove buttons, nodes start expanded) — see
// buildGroupTreeNodeEl. Row content differs: an editable name input (Phase
// A5 — every node's name stays editable, same precedent the flat API-Mode
// field list already established) plus a read-only path display instead of
// a single selector label, and there's no repeating/attribute/mode label
// (see Container-Mode) or frame badge (JSON has no iframes) to add.
function buildApiTreeNodeEl(node, path, depth) {
  const li = document.createElement('li');
  li.className = 'api-tree-node';
  li.dataset.path = JSON.stringify(path);

  const row = document.createElement('div');
  row.className = 'api-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.kind === 'group' && node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'api-tree-toggle';
  toggle.textContent = hasChildren ? '▾' : '';
  row.appendChild(toggle);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'api-tree-name';
  nameInput.dataset.path = JSON.stringify(path);
  nameInput.value = node.name;
  row.appendChild(nameInput);

  const pathLabel = document.createElement('span');
  pathLabel.className = 'api-tree-path';
  pathLabel.textContent = node.path || '—';
  pathLabel.title = node.path;
  row.appendChild(pathLabel);

  if (node.kind === 'group') {
    const addSubgroupBtn = document.createElement('button');
    addSubgroupBtn.className = 'btn-secondary btn-tiny btn-add-api-subgroup';
    addSubgroupBtn.textContent = t('apiTree.addSubgroupBtn');
    row.appendChild(addSubgroupBtn);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-secondary btn-tiny btn-add-api-subfield';
    addFieldBtn.textContent = t('apiTree.addSubfieldBtn');
    row.appendChild(addFieldBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-danger btn-remove-api-node';
  removeBtn.textContent = t('common.remove');
  row.appendChild(removeBtn);

  li.appendChild(row);

  if (node.kind === 'group') {
    const childUl = document.createElement('ul');
    childUl.className = 'api-tree-children';
    node.children.forEach((child, i) => childUl.appendChild(buildApiTreeNodeEl(child, [...path, i], depth + 1)));
    li.appendChild(childUl);

    if (hasChildren) {
      toggle.addEventListener('click', () => {
        const collapsed = childUl.classList.toggle('hidden');
        toggle.textContent = collapsed ? '▸' : '▾';
      });
    }
  }

  return li;
}

function renderApiTree(groups) {
  const root = document.getElementById('api-tree-root');
  if (!root) return;
  root.innerHTML = '';
  groups.forEach((node, i) => root.appendChild(buildApiTreeNodeEl(node, [i], 0)));
}

// ── Container-Mode tree (GroupNode/DataFieldNode) ───────────────────────────
// Mirrors the backend IR (ContainerNode.cs): a group node scopes its
// children to matches of its own selector, a field node is the extraction
// leaf. `path` addresses a node the same way the DOM-tree-view already does
// (an array of child indices) — see buildTreeNodeEl's `node.path`.

function buildGroupNode(name, selector, repeating, framePath = null) {
  return { kind: 'group', name, selector, repeating, children: [], framePath: framePath || null };
}

function buildFieldNode(name, selector, mode, attribute, framePath = null) {
  return { kind: 'field', name, selector, mode, attribute: mode === 'attribute' ? attribute : null, framePath: framePath || null };
}

function resolveGroupNode(groups, path) {
  if (!path || path.length === 0) return null;
  let node = groups[path[0]];
  for (let i = 1; i < path.length; i++) node = node.children[path[i]];
  return node;
}

// True if the node at `path` (or any of its ancestors) is a repeating
// group — i.e. a selector added under this path will be re-evaluated once
// per matched instance, not just once. Used to tell content-script to skip
// its usual id-selector shortcut (see buildSelector's avoidId): an id is
// page-unique, so a selector built from one can only ever match a single
// instance, silently starving every other repetition of that field/nested
// container.
function hasRepeatingAncestor(groups, path) {
  if (!path) return false;
  let nodes = groups;
  for (const index of path) {
    const node = nodes[index];
    if (node.kind === 'group' && node.repeating) return true;
    nodes = node.children;
  }
  return false;
}

// Appends `node` as the last child at `parentPath` (or at root level when
// `parentPath` is null) — immutable, like addField above.
function insertContainerNode(groups, parentPath, node) {
  const path = parentPath || [];
  if (path.length === 0) return [...groups, node];
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head ? { ...n, children: insertContainerNode(n.children, rest, node) } : n));
}

// Removes the node (and its subtree) at `path` — always non-empty, unlike
// insertContainerNode's parentPath.
function removeGroupTreeNode(groups, path) {
  if (path.length === 1) return groups.filter((_, i) => i !== path[0]);
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head ? { ...n, children: removeGroupTreeNode(n.children, rest) } : n));
}

function formatGroupNodeLabel(node) {
  if (node.kind === 'group') {
    return `${node.name} (${t(node.repeating ? 'group.repeating' : 'group.single')})`;
  }
  const modeLabel = {
    text: t('group.textMode'),
    attribute: t('group.attributeMode', { attribute: node.attribute }),
    exists: t('group.existsMode'),
  }[node.mode];
  return `${node.name} — ${modeLabel}`;
}

const FIELD_MODE_WIRE_NAMES = { text: 'Text', attribute: 'Attribute', exists: 'Exists' };

// Strips the popup's internal `kind` tag and shapes each node exactly like
// the wire format the Companion expects (ContainerNode.cs / ContainerNodeJsonConverter):
// `children` present only for groups, `attribute` present only when mode is Attribute.
function serializeGroupTree(groups) {
  return groups.map(node => node.kind === 'group'
    ? {
        name: node.name, selector: node.selector, repeating: node.repeating,
        children: serializeGroupTree(node.children),
        ...(node.framePath ? { framePath: node.framePath } : {}),
      }
    : {
        name: node.name,
        selector: node.selector,
        mode: FIELD_MODE_WIRE_NAMES[node.mode],
        ...(node.mode === 'attribute' ? { attribute: node.attribute } : {}),
        ...(node.framePath ? { framePath: node.framePath } : {}),
      });
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function render() {
  ['checking', 'error', 'idle', 'selecting', 'api-config', 'generating', 'done'].forEach(s =>
    hide(`screen-${s}`)
  );
  hide('modal-field-name');
  hide('modal-field-extended');
  hide('modal-container-new');
  hide('modal-api-group-new');

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
    const outputExtEl = document.getElementById('output-filename-ext');
    if (outputExtEl) outputExtEl.textContent = _state.mode === 'container' ? '.xml' : '.csv';

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
  }

  if (_state.current === STATES.DONE) {
    const downloadBtn = document.getElementById('btn-download');
    if (downloadBtn) {
      const filename = `${sanitizeFileNameBase(_state.scriptFileName, 'scraper')}.py`;
      downloadBtn.textContent = t('done.downloadBtn', { filename });
    }
  }

  // Show modal when an element has been captured during selection
  if (_state.current === STATES.SELECTING && _state.pendingSelector !== null) {
    if (_state.mode === 'container') {
      show('modal-field-extended');
      const nameInput = document.getElementById('input-field-extended-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const modeSelect = document.getElementById('select-field-mode');
      if (modeSelect) modeSelect.value = 'text';
      document.getElementById('field-attribute-row')?.classList.add('hidden');
      const attrInput = document.getElementById('input-field-attribute');
      if (attrInput) attrInput.value = '';
    } else {
      show('modal-field-name');
      const input = document.getElementById('input-field-name');
      if (input) { input.value = ''; input.focus(); }
    }
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

// ── API-mode candidate search results (Issue #53 Phase 4) ──────────────────
// Renders content-script.js's findApiCandidates output: one row per
// candidate (request + JSON path + matched value), with the same object's
// sibling scalar keys offered as click-to-toggle suggestions for additional
// fields — purely a visual "picked" toggle for now, since there's no
// ApiConfig to feed them into yet (that's Phase 5+).

// ids (Phase A5): the primary-field search panel (#api-candidates-target/
// -list, the default) and the "add root group"/"add sub-field" search panel
// (#api-tree-search-target/-list) render the exact same candidate shape —
// only the confirm action differs (confirmApiFieldCandidate vs.
// confirmApiTreeFieldCandidate, see wireApiCandidateListEvents), so this one
// function serves both rather than duplicating the whole render.
function renderApiCandidates({ target, candidates }, ids = { targetEl: 'api-candidates-target', listEl: 'api-candidates-list' }) {
  const targetEl = document.getElementById(ids.targetEl);
  if (targetEl) targetEl.textContent = t('apiCandidates.searchedFor', { target });

  const listEl = document.getElementById(ids.listEl);
  if (!listEl) return;
  listEl.innerHTML = '';

  if (candidates.length === 0) {
    const li = document.createElement('li');
    li.className = 'api-candidates-empty';
    li.textContent = t('common.noMatches');
    listEl.appendChild(li);
    return;
  }

  candidates.forEach((candidate, i) => {
    const li = document.createElement('li');
    li.className = 'api-candidate';
    li.innerHTML =
      `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.method)} ${escapeHtml(candidate.url)}</div>` +
      `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
      `<div class="api-candidate-value">${escapeHtml(t('apiCandidates.matchLabel', { value: String(candidate.value) }))}</div>`;

    if (candidate.siblings.length > 0) {
      const siblingsEl = document.createElement('div');
      siblingsEl.className = 'api-candidate-siblings';

      // Picking one-by-one is fine for a handful of siblings, but a record
      // with many keys is exactly the "I want most of these" case a user
      // asked to no longer have to click through individually — one button
      // to pick all of them, toggling back to none on a second click
      // (mirrors this file's other state-reflecting toggle buttons, e.g.
      // preview show/hide). Picked state itself stays DOM-only (see the
      // click handler in wireEvents), so this button's own label is updated
      // directly on click rather than through a render() pass.
      const selectAllBtn = document.createElement('button');
      selectAllBtn.type = 'button';
      selectAllBtn.className = 'api-sibling-select-all';
      selectAllBtn.textContent = t('apiCandidates.selectAllChips');
      selectAllBtn.dataset.candidateIndex = String(i);
      siblingsEl.appendChild(selectAllBtn);

      candidate.siblings.forEach((sibling) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'api-sibling-chip';
        chip.textContent = t('apiCandidates.siblingChip', { name: sibling.name });
        chip.title = String(sibling.value);
        chip.dataset.candidateIndex = String(i);
        chip.dataset.siblingName = sibling.name;
        siblingsEl.appendChild(chip);
      });
      li.appendChild(siblingsEl);
    }

    // "Use" (Issue #53 Phase 5): only offered when the match sits
    // inside an actual repeating record (candidate.itemsPath truthy,
    // valuePath non-empty — see deriveItemsAndValuePath's doc comment for
    // why an empty-but-non-null valuePath also isn't usable) — Api-Mode's
    // whole model is "records extracted from a repeating array".
    if (candidate.itemsPath && candidate.valuePath) {
      const useRow = document.createElement('div');
      useRow.className = 'api-candidate-use';
      useRow.innerHTML =
        `<input type="text" class="api-candidate-field-name" placeholder="${escapeHtml(t('apiCandidates.useFieldNamePlaceholder'))}" data-candidate-index="${i}" />` +
        `<button type="button" class="btn-secondary btn-tiny api-candidate-confirm" data-candidate-index="${i}" disabled>${escapeHtml(t('common.use'))}</button>`;
      li.appendChild(useRow);
    } else {
      const note = document.createElement('div');
      note.className = 'api-candidate-unusable';
      note.textContent = t('common.noRecordArray');
      li.appendChild(note);
    }

    listEl.appendChild(li);
  });
}

// API-mode follow-up: the raw recorded pool, for whoever wants to see it
// directly instead of only going through a value-correlation search — e.g.
// to sanity-check that a variable part's other values were actually
// recorded before relying on the pool-derived autofill below. Reuses the
// same .api-candidate/.api-candidate-url/.api-candidate-path row styling
// renderApiCandidates already uses, just without the value/siblings/use
// parts that only apply to a JSON-body match.
function renderApiEntriesList(entries) {
  const listEl = document.getElementById('api-entries-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!entries || entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'api-candidates-empty';
    li.textContent = t('idle.apiEntriesEmpty');
    listEl.appendChild(li);
    return;
  }

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'api-candidate';
    li.innerHTML =
      `<div class="api-candidate-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.method)} ${escapeHtml(String(entry.status))} ${escapeHtml(entry.url)}</div>` +
      (entry.contentType ? `<div class="api-candidate-path">${escapeHtml(entry.contentType)}</div>` : '');
    listEl.appendChild(li);
  });
}

// ── API-Mode config screen (Issue #53 Phase 5) ──────────────────────────────
// Renders the in-progress apiConfigDraft: confirmed fields (read-only),
// URL path segments/query params with a fest/variabel toggle per part, one
// source-configuration card per variable part, and the header-adoption
// table. Structural choices (variable toggle, source kind, header
// include/mode) are reactive — patched into apiConfigDraft and immediately
// re-rendered — but committed via the `change` event, not `input`, so
// typing in a text field doesn't trigger a re-render (and thus lose focus)
// on every keystroke; only leaving the field (or picking a different
// control) does. A rerender triggered by one control can still visually
// reset another field's *not yet committed* typing elsewhere on the same
// screen — an accepted rough edge given how many independent inputs this
// screen has, not a bug in the reactive fields themselves.
//
// partId identifies a variable-part-in-progress independently of its
// (user-editable, only committed on blur) name — "path:<index>" or
// "query:<key>" — so apiConfigDraft.parameterSources can be keyed by
// something stable while the display name is still being typed.

// Issue #54, Phase A5: the tree UI subsumes the flat field list entirely —
// a single top-level match renders as a one-node-deep tree, visually almost
// identical to the old flat list but wrapped in the same tree-editor chrome
// every level beyond that reuses unchanged. renderApiConfigFieldsList is
// gone; renderApiTree (Phase A4) is the only rendering left for this part
// of the screen.
function renderApiConfigScreen(draft, discoveryCandidates) {
  renderApiTree(draft.groups);
  renderApiConfigUrlParts(draft.urlParts);
  renderApiConfigParameters(draft, discoveryCandidates);
  renderApiConfigHeaders(draft.capturedHeaders, draft.headerDecisions);

  const confirmBtn = document.getElementById('btn-api-config-confirm');
  if (confirmBtn) confirmBtn.disabled = !apiConfigDraftHasAllSourcesChosen(draft);
}

// `id` ("path:<index>" or "query:<key>") embeds the query param's own key
// for the query-param case — which, like every other piece of a recorded
// URL, came from the page being recorded and so must be treated as
// untrusted the same way candidate.url/value already are elsewhere in this
// file (escapeHtml, not raw interpolation into an innerHTML string).
function urlPartRowHtml(id, valueLabel, variable, name) {
  const safeId = escapeHtml(id);
  return (
    `<span class="api-config-part-value" title="${escapeHtml(valueLabel)}">${escapeHtml(valueLabel)}</span>` +
    `<label><input type="checkbox" class="api-config-part-toggle" data-part-id="${safeId}" ${variable ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.variableLabel'))}</label>` +
    (variable ? `<input type="text" class="api-config-part-name" data-part-id="${safeId}" placeholder="${escapeHtml(t('common.namePlaceholder'))}" value="${escapeHtml(name || '')}" />` : '')
  );
}

function renderApiConfigUrlParts(urlParts) {
  const segEl = document.getElementById('api-config-segments');
  if (segEl) {
    segEl.innerHTML = '';
    urlParts.pathSegments.forEach((seg, i) => {
      const li = document.createElement('li');
      li.className = 'api-config-part-row';
      li.innerHTML = urlPartRowHtml(`path:${i}`, `/${seg.value}`, seg.variable, seg.name);
      segEl.appendChild(li);
    });
  }

  const queryEl = document.getElementById('api-config-query-params');
  if (queryEl) {
    queryEl.innerHTML = '';
    urlParts.queryParams.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'api-config-part-row';
      li.innerHTML = urlPartRowHtml(`query:${p.key}`, `${p.key}=${p.value}`, p.variable, p.name);
      queryEl.appendChild(li);
    });
  }
}

// Every {variable: true} part, tagged with its partId — the single source
// of truth for "which parameter cards exist" (independent of whether a
// name has been typed for it yet).
function variableUrlParts(urlParts) {
  return [
    ...urlParts.pathSegments.map((seg, i) => ({ ...seg, id: `path:${i}` })),
    ...urlParts.queryParams.map(p => ({ ...p, id: `query:${p.key}` })),
  ].filter(p => p.variable);
}

// Gates "Übernehmen" — also the single place guarding against a blank
// field/group name reaching buildApiConfig: a name could always be blanked
// out again on the API_CONFIG screen (renderApiTree's editable name inputs;
// the flat list before Phase A5 had the same gap), so nothing else enforces
// this. draft.groups (Phase A5's tree shape) takes over from the older
// draft.fields shape whenever present — see apiTreeNodesHaveNonBlankNames.
function apiConfigDraftHasAllSourcesChosen(draft) {
  const namesOk = draft.groups
    ? apiTreeNodesHaveNonBlankNames(draft.groups)
    : !(draft.fields || []).some(f => !f.name?.trim());
  if (!namesOk) return false;
  const parts = variableUrlParts(draft.urlParts);
  if (parts.length === 0) return false; // Api-Mode's whole premise is enumerating over at least one variable part
  return parts.every(p => !!p.name?.trim() && !!draft.parameterSources[p.id]?.kind);
}

function renderApiConfigParameters(draft, discoveryCandidates) {
  const container = document.getElementById('api-config-parameters');
  if (!container) return;
  container.innerHTML = '';

  variableUrlParts(draft.urlParts).forEach((part) => {
    const source = draft.parameterSources[part.id];
    const safePartId = escapeHtml(part.id); // see urlPartRowHtml's doc comment — part.id can embed an untrusted query key
    const card = document.createElement('div');
    card.className = 'api-config-param-card';
    card.dataset.partId = part.id; // DOM property assignment, not HTML parsing — safe regardless

    const title = document.createElement('div');
    title.className = 'row-label';
    title.textContent = part.name ? part.name : t('apiConfig.unnamedPart');
    card.appendChild(title);

    const kindRow = document.createElement('div');
    kindRow.className = 'api-config-source-kind';
    const sourceKindLabels = {
      staticList: t('apiConfig.sourceKindStaticList'),
      discovery: t('apiConfig.sourceKindDiscovery'),
      range: t('apiConfig.sourceKindRange'),
    };
    kindRow.innerHTML = ['staticList', 'discovery', 'range'].map(kind => `
      <label>
        <input type="radio" name="source-kind-${safePartId}" class="api-config-source-kind-radio"
          data-part-id="${safePartId}" value="${kind}" ${source?.kind === kind ? 'checked' : ''} />
        ${escapeHtml(sourceKindLabels[kind])}
      </label>
    `).join('');
    card.appendChild(kindRow);

    const fieldsEl = document.createElement('div');
    fieldsEl.className = 'api-config-source-fields';
    if (source?.kind === 'staticList') {
      fieldsEl.innerHTML =
        `<textarea class="api-config-static-list" data-part-id="${safePartId}" rows="2" placeholder="${escapeHtml(t('apiConfig.valueListPlaceholder'))}">${escapeHtml(source.valuesText || '')}</textarea>` +
        `<button type="button" class="btn-secondary btn-tiny api-config-autofill-pool" data-part-id="${safePartId}" title="${escapeHtml(t('apiConfig.autoFillFromPoolTitle'))}">${escapeHtml(t('apiConfig.autoFillFromPoolBtn'))}</button>`;
    } else if (source?.kind === 'discovery') {
      fieldsEl.appendChild(renderDiscoverySourceFields(part, source, discoveryCandidates));
    } else if (source?.kind === 'range') {
      fieldsEl.innerHTML = `
        <div class="api-config-range-row">
          <select class="api-config-range-type" data-part-id="${safePartId}">
            ${['IsoWeek', 'Number', 'Date'].map(rangeType => `<option value="${rangeType}" ${source.type === rangeType ? 'selected' : ''}>${rangeType}</option>`).join('')}
          </select>
          <input type="text" class="api-config-range-from" data-part-id="${safePartId}" placeholder="${escapeHtml(t('apiConfig.rangeFromPlaceholder'))}" value="${escapeHtml(source.from || '')}" />
          <input type="text" class="api-config-range-to" data-part-id="${safePartId}" placeholder="${escapeHtml(t('apiConfig.rangeToPlaceholder'))}" value="${escapeHtml(source.to || '')}" />
        </div>
        ${renderRangeFormatFields(source, safePartId)}
      `;
    }
    card.appendChild(fieldsEl);

    container.appendChild(card);
  });
}

// The preset dropdown + revealed custom-format input + live "Example: …"
// text below From/To, for IsoWeek/Date only (Number has no format concept).
// `source.format` is always already set by the time this renders — either
// auto-detected (setApiConfigSourceKind/the Type-change handler both call
// detectRangeFormat) or explicitly chosen by the user — so "custom" here
// just means "not one of this Type's presets", not "unset".
function renderRangeFormatFields(source, safePartId) {
  if (source.type === 'Number') return '';

  const presets = RANGE_FORMAT_PRESETS[source.type];
  const isCustom = !presets.some(preset => preset.format === source.format);
  const options = presets
    .map(preset => `<option value="${escapeHtml(preset.format)}" ${preset.format === source.format ? 'selected' : ''}>${escapeHtml(t(preset.labelKey))}</option>`)
    .join('') + `<option value="custom" ${isCustom ? 'selected' : ''}>${escapeHtml(t('apiConfig.customFormatOption'))}</option>`;
  const example = rangeFormatExample(source.format, source.from) ?? t('apiConfig.formatEnterPrompt');

  return `
    <div class="api-config-range-format-row">
      <select class="api-config-range-format-preset" data-part-id="${safePartId}">${options}</select>
      ${isCustom ? `<input type="text" class="api-config-range-format-custom" data-part-id="${safePartId}" placeholder="{yyyy}-{ww}" value="${escapeHtml(source.format || '')}" />` : ''}
      <p class="api-config-range-format-example">${escapeHtml(t('apiConfig.formatExample', { example }))}</p>
    </div>
  `;
}

function renderDiscoverySourceFields(part, source, discoveryCandidates) {
  const wrap = document.createElement('div');

  if (source.urlTemplate) {
    const summary = document.createElement('p');
    summary.className = 'api-candidates-target';
    summary.textContent = t('apiConfig.discoverySource', { urlTemplate: source.urlTemplate, itemsPath: source.itemsPath, valuePath: source.valuePath });
    wrap.appendChild(summary);
  }

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'btn-secondary btn-tiny api-config-discovery-search';
  searchBtn.dataset.partId = part.id;
  searchBtn.textContent = t(source.urlTemplate ? 'apiConfig.discoverySearchAgainBtn' : 'apiConfig.discoverySearchBtn');
  wrap.appendChild(searchBtn);

  if (discoveryCandidates && discoveryCandidates.parameter === part.id) {
    const list = document.createElement('ul');
    list.className = 'api-candidates-list';
    if (discoveryCandidates.candidates.length === 0) {
      list.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('common.noMatches'))}</li>`;
    } else {
      discoveryCandidates.candidates.forEach((candidate, i) => {
        const li = document.createElement('li');
        li.className = 'api-candidate';
        const usable = candidate.itemsPath && candidate.valuePath;
        li.innerHTML =
          `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.method)} ${escapeHtml(candidate.url)}</div>` +
          `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
          (usable
            ? `<button type="button" class="btn-secondary btn-tiny api-config-discovery-confirm" data-part-id="${escapeHtml(part.id)}" data-candidate-index="${i}">${escapeHtml(t('common.use'))}</button>`
            : `<div class="api-candidate-unusable">${escapeHtml(t('common.noRecordArray'))}</div>`);
        list.appendChild(li);
      });
    }
    wrap.appendChild(list);
  }

  return wrap;
}

function renderApiConfigHeaders(capturedHeaders, headerDecisions) {
  const listEl = document.getElementById('api-config-headers');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (capturedHeaders.length === 0) {
    listEl.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('apiConfig.noHeadersRecorded'))}</li>`;
    return;
  }

  capturedHeaders.forEach((header) => {
    const decision = headerDecisions[header.name] || { include: false, mode: 'literal', envName: '' };
    const li = document.createElement('li');
    li.className = 'api-config-header-row';
    li.innerHTML =
      `<label><input type="checkbox" class="api-config-header-include" data-header-name="${escapeHtml(header.name)}" ${decision.include ? 'checked' : ''} /></label>` +
      `<span class="api-config-header-name" title="${escapeHtml(header.name)}: ${escapeHtml(header.value)}">${escapeHtml(header.name)}</span>` +
      (decision.include
        ? `<span class="api-config-header-mode">
             <label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="literal" ${decision.mode === 'literal' ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.headerModeValue'))}</label>
             <label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="env" ${decision.mode === 'env' ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.headerModeEnv'))}</label>
           </span>` +
          (decision.mode === 'env'
            ? `<input type="text" class="api-config-env-name" data-header-name="${escapeHtml(header.name)}" placeholder="${escapeHtml(t('apiConfig.envNamePlaceholder'))}" value="${escapeHtml(decision.envName || '')}" />`
            : '')
        : '');
    listEl.appendChild(li);
  });
}

// ── Container tree editor ────────────────────────────────────────────────────
// Same visual pattern as the DOM-tree-view below (indentation, toggle arrow,
// click-to-collapse — see buildTreeNodeEl) but editable: rows carry
// add-container/add-field/remove buttons, and nodes start expanded since
// this tree is user-authored and typically small, unlike a full page DOM.

function buildGroupTreeNodeEl(node, path, depth) {
  const li = document.createElement('li');
  li.className = 'group-tree-node';
  li.dataset.path = JSON.stringify(path);

  const row = document.createElement('div');
  row.className = 'group-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.kind === 'group' && node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'group-tree-toggle';
  toggle.textContent = hasChildren ? '▾' : '';
  row.appendChild(toggle);

  const label = document.createElement('span');
  label.className = 'group-tree-label';
  label.textContent = formatGroupNodeLabel(node);
  label.title = node.selector;
  row.appendChild(label);

  if (node.framePath) {
    const badge = document.createElement('span');
    badge.className = 'frame-badge';
    badge.title = t('frame.badgeTitle', { path: node.framePath.join(' > ') });
    badge.textContent = t('frame.badge');
    row.appendChild(badge);
  }

  if (node.kind === 'group') {
    const addContainerBtn = document.createElement('button');
    addContainerBtn.className = 'btn-secondary btn-tiny btn-add-subcontainer';
    addContainerBtn.textContent = t('group.addSubcontainerBtn');
    row.appendChild(addContainerBtn);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-secondary btn-tiny btn-add-subfield';
    addFieldBtn.textContent = t('group.addSubfieldBtn');
    row.appendChild(addFieldBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-danger btn-remove-group-node';
  removeBtn.textContent = t('common.remove');
  row.appendChild(removeBtn);

  li.appendChild(row);

  if (node.kind === 'group') {
    const childUl = document.createElement('ul');
    childUl.className = 'group-tree-children';
    node.children.forEach((child, i) => childUl.appendChild(buildGroupTreeNodeEl(child, [...path, i], depth + 1)));
    li.appendChild(childUl);

    if (hasChildren) {
      toggle.addEventListener('click', () => {
        const collapsed = childUl.classList.toggle('hidden');
        toggle.textContent = collapsed ? '▸' : '▾';
      });
    }
  }

  return li;
}

function renderGroupTree(groups) {
  const root = document.getElementById('group-tree-root');
  if (!root) return;
  root.innerHTML = '';
  groups.forEach((node, i) => root.appendChild(buildGroupTreeNodeEl(node, [i], 0)));
}

// ── DOM tree view ────────────────────────────────────────────────────────────
// Rendered imperatively (not through render()) so a user's expand/collapse
// clicks survive unrelated state updates (e.g. adding/removing a field).

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
  toggle.textContent = hasChildren ? '▸' : '';
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
      toggle.textContent = collapsed ? '▸' : '▾';
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
    if (toggle) toggle.textContent = '▾';
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

// ── API-Mode network recording (Issue #53 Phase 3) ───────────────────────────
// Unlike preview, this doesn't depend on Fields/Groups — it's a standalone
// recording of the page's own fetch/XHR traffic, meant to feed the future
// API-Mode's request-discovery flow (Phase 4+). See content-script.js's
// API_CAPTURE bridge and api-capture.js (MAIN world) for where the actual
// interception happens.

function startApiCapture() {
  log('API_CAPTURE_START');
  chrome.runtime.sendMessage({ type: 'API_CAPTURE_START' });
  patchState({ apiCaptureActive: true, apiCaptureCount: 0 });
}

function stopApiCapture() {
  log('API_CAPTURE_STOP');
  chrome.runtime.sendMessage({ type: 'API_CAPTURE_STOP' });
  // Keep apiCaptureCount — Phase 4's search below runs on what was recorded
  // *after* stopping, so the user still needs to see it stayed non-zero.
  patchState({ apiCaptureActive: false });
}

function toggleApiCapture() {
  if (_state.apiCaptureActive) stopApiCapture(); else startApiCapture();
}

// ── API-Mode candidate search (Issue #53 Phase 4) ───────────────────────────
// Reuses the existing click-selection mechanism (START_SELECTION/
// ELEMENT_SELECTED) with an extra apiSearch flag — content-script.js still
// sends ELEMENT_SELECTED as always (see the guard in the message listener
// below), but additionally correlates the clicked element's text against
// the entries buffered during the (now stopped) recording and reports
// candidates via a separate API_CANDIDATES message.

function startApiFieldSearch() {
  if (_state.apiCaptureCount === 0) return;
  log('API_SEARCH start → START_SELECTION(apiSearch)');
  stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true });
  setState(STATES.SELECTING, {
    apiSearchTarget: 'field', pendingSelector: null, apiCandidates: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

// ── API-Mode parameter configuration (Issue #53 Phase 5) ────────────────────
// Turns a confirmed primary-field candidate into an in-progress ApiConfig
// draft and enters STATES.API_CONFIG — see buildApiConfig (the pure wire-
// format assembly) for what this eventually becomes once the user finishes
// configuring URL segments/params/headers there.

// `siblingNames` are JSON keys the user picked as one-click extra fields —
// each already IS a valid field name/path (a sibling's own key, always a
// direct property of the same record, see content-script.js's
// siblingFields) so no separate naming step is needed for those, unlike the
// primary field which needs a user-chosen name.
//
// Issue #54, Phase A5: builds the full nested tree draft (buildApiSubtree
// FromCandidate, using A3's deriveApiTreeSkeleton) instead of a flat fields
// array — a single top-level match still ends up a one-node-deep tree, see
// buildApiConfig's own doc comment on why the flat wire shape stays
// available even though the popup only ever builds trees now.
function confirmApiFieldCandidate(candidate, fieldName, siblingNames) {
  const groups = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames);

  log('API_FIELD_CONFIRM', { url: candidate.url, groups });
  stopPreviewIfActive();
  setState(STATES.API_CONFIG, {
    apiCandidates: null,
    apiConfigDraft: {
      sourceUrl: candidate.url,
      urlParts: parseUrlTemplateParts(candidate.url),
      groups,
      capturedHeaders: candidate.requestHeaders || [],
      parameterSources: {},
      headerDecisions: {},
    },
  });
}

function cancelApiConfig() {
  log('API_CONFIG cancel');
  setState(STATES.IDLE, { apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null });
}

// ── API-Mode tree wiring (Issue #54, Phase A5) ──────────────────────────────
// Adding to an already-confirmed tree: a new independent root group
// (treeParentPath null) or a sub-field under an existing ApiGroup
// (treeParentPath its tree path) both start a click-based JSON search the
// same way startApiFieldSearch does above — scoped via resolveApiGroupScopePath
// for the nested case, unscoped for a new root (Groups is a list; a second,
// unrelated top-level array in the *same* response body is exactly as valid
// a root as the first, see ApiConfig.Groups's own doc comment) — and the
// confirmed candidate is inserted via insertApiTreeNode rather than
// replacing the draft outright.
//
// A *sub-group* is different: unlike a field/root search, there's no single
// clicked value to derive it from that wouldn't also imply a field the user
// never asked for — so modal-api-group-new collects name **and** path
// directly (no click at all), mirroring Container-Mode's "name first" order
// while side-stepping the "what would the click's own leaf field be called"
// question entirely. See openApiGroupModal/confirmApiGroupModal below.

function startApiTreeFieldSearch(parentPath) {
  const scopePath = parentPath ? resolveApiGroupScopePath(_state.apiConfigDraft.groups, parentPath) : null;
  log('API_TREE_FIELD_SEARCH start', { parentPath, scopePath });
  chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true, apiScopePath: scopePath });
  setState(STATES.SELECTING, {
    apiSearchTarget: { treeParentPath: parentPath }, pendingSelector: null, apiTreeSearchResult: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

// skipSegments = the target group's own tree depth: that many of the
// candidate's derived skeleton segments are already represented by existing
// ancestor groups (see resolveApiGroupScopePath) — 0 for a new root.
function confirmApiTreeFieldCandidate(candidate, fieldName, siblingNames) {
  const { treeParentPath } = _state.apiTreeSearchResult;
  const skipSegments = treeParentPath ? treeParentPath.length : 0;
  const newNodes = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames, skipSegments);
  log('API_TREE_FIELD_CONFIRM', { treeParentPath, fieldName, siblingNames });
  const groups = newNodes.reduce((acc, node) => insertApiTreeNode(acc, treeParentPath, node), _state.apiConfigDraft.groups);
  setState(STATES.API_CONFIG, { apiTreeSearchResult: null, apiConfigDraft: { ..._state.apiConfigDraft, groups } });
}

function openApiGroupModal(parentPath) {
  log('API_GROUP_MODAL open', { parentPath });
  patchState({ apiGroupModalOpen: true, pendingApiTreeParentPath: parentPath });
}

function confirmApiGroupModal() {
  const name = document.getElementById('input-api-group-name')?.value.trim();
  const path = document.getElementById('input-api-group-path')?.value.trim();
  // Unlike a CSS selector, a JSON path can legitimately be "" (see
  // ApiGroup.Path's array-of-arrays case) — but that's only ever reachable
  // through the automatic skeleton derivation above; requiring a non-empty
  // path here keeps this small, no-click modal unambiguous (was it really
  // meant to be empty, or just not filled in yet?).
  if (!name || !path) return;

  const node = buildApiGroupDraft(name, path);
  log('API_TREE_GROUP_ADD', { name, path, parentPath: _state.pendingApiTreeParentPath });
  setState(STATES.API_CONFIG, {
    apiConfigDraft: { ..._state.apiConfigDraft, groups: insertApiTreeNode(_state.apiConfigDraft.groups, _state.pendingApiTreeParentPath, node) },
    apiGroupModalOpen: false, pendingApiTreeParentPath: null,
  });
}

function cancelApiGroupModal() {
  log('API_GROUP_MODAL cancel');
  patchState({ apiGroupModalOpen: false, pendingApiTreeParentPath: null });
}

// Renames a tree node in place — Phase A5 generalization of
// setApiConfigFieldName (the old flat-only version), see updateApiTreeNode.
function setApiTreeNodeName(path, name) {
  patchApiConfigDraft({ groups: updateApiTreeNode(_state.apiConfigDraft.groups, path, node => ({ ...node, name })) });
}

// Starts a *second* search round, reusing the exact same click-selection
// mechanism as startApiFieldSearch (content-script.js doesn't need to know
// which purpose this one serves) — its result becomes a DiscoverySource for
// one specific variable part of the config being drafted, instead of the
// primary field. `partId` (not the user-editable display name — see the
// API-Mode config screen's own doc comment) identifies which one.
function startDiscoverySearch(partId) {
  log('API_DISCOVERY_SEARCH start', partId);
  chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true });
  setState(STATES.SELECTING, {
    apiSearchTarget: { parameter: partId }, pendingSelector: null, apiDiscoveryCandidates: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

function confirmDiscoveryCandidate(partId, candidate) {
  const source = buildDiscoverySource(candidate.url, candidate.itemsPath, candidate.valuePath);
  log('API_DISCOVERY_CONFIRM', { partId, source });
  setState(STATES.API_CONFIG, {
    apiDiscoveryCandidates: null,
    apiConfigDraft: {
      ..._state.apiConfigDraft,
      parameterSources: { ..._state.apiConfigDraft.parameterSources, [partId]: source },
    },
  });
}

// Persists every apiConfigDraft edit through setState (not patchState) so it
// survives a popup close/reopen mid-configuration, same as fields/groups.
function patchApiConfigDraft(patch) {
  setState(_state.current, { apiConfigDraft: { ..._state.apiConfigDraft, ...patch } });
}

function toggleApiConfigPartVariable(partId) {
  const draft = _state.apiConfigDraft;
  const [scope, key] = partId.split(':');
  const urlParts = scope === 'path'
    ? { ...draft.urlParts, pathSegments: draft.urlParts.pathSegments.map((seg, i) => (String(i) === key ? { ...seg, variable: !seg.variable } : seg)) }
    : { ...draft.urlParts, queryParams: draft.urlParts.queryParams.map(p => (p.key === key ? { ...p, variable: !p.variable } : p)) };

  // Toggling either way drops any source config for this part — avoids an
  // orphaned/stale parameterSources entry for a part that just became
  // "fest" again, or a half-configured one lingering under a name that no
  // longer means anything after a second toggle.
  const parameterSources = { ...draft.parameterSources };
  delete parameterSources[partId];

  patchApiConfigDraft({ urlParts, parameterSources });
}

function setApiConfigPartName(partId, name) {
  const draft = _state.apiConfigDraft;
  const [scope, key] = partId.split(':');
  const urlParts = scope === 'path'
    ? { ...draft.urlParts, pathSegments: draft.urlParts.pathSegments.map((seg, i) => (String(i) === key ? { ...seg, name } : seg)) }
    : { ...draft.urlParts, queryParams: draft.urlParts.queryParams.map(p => (p.key === key ? { ...p, name } : p)) };
  patchApiConfigDraft({ urlParts });
}

const API_CONFIG_SOURCE_DEFAULTS = {
  staticList: { kind: 'staticList', valuesText: '' },
  range: { kind: 'range', type: 'IsoWeek', from: '', to: '' },
  discovery: { kind: 'discovery' }, // incomplete until confirmDiscoveryCandidate fills in urlTemplate/itemsPath/valuePath
};

// Range sources get their format auto-detected from the part's own
// captured example value the moment "Range" is picked — see
// detectRangeFormat's doc comment.
function setApiConfigSourceKind(partId, kind) {
  const draft = _state.apiConfigDraft;
  const defaults = API_CONFIG_SOURCE_DEFAULTS[kind];
  const source = kind === 'range'
    ? { ...defaults, format: detectRangeFormat(defaults.type, findUrlPartValue(draft.urlParts, partId)) }
    : defaults;
  patchApiConfigDraft({ parameterSources: { ...draft.parameterSources, [partId]: source } });
}

function patchApiConfigSource(partId, patch) {
  const draft = _state.apiConfigDraft;
  patchApiConfigDraft({ parameterSources: { ...draft.parameterSources, [partId]: { ...draft.parameterSources[partId], ...patch } } });
}

function setApiConfigHeaderDecision(headerName, patch) {
  const draft = _state.apiConfigDraft;
  const current = draft.headerDecisions[headerName] || { include: false, mode: 'literal', envName: '' };
  patchApiConfigDraft({ headerDecisions: { ...draft.headerDecisions, [headerName]: { ...current, ...patch } } });
}

// Final assembly (Issue #53 Phase 5's "Apply"): staticList/range
// sources are only ever kept as raw UI state (valuesText / type+from+to) in
// apiConfigDraft, never as a built wire object — built here, once, from
// whatever's currently in state. discovery sources are already complete
// wire objects (built earlier by confirmDiscoveryCandidate) and passed
// through as-is.
function confirmApiConfig() {
  const draft = _state.apiConfigDraft;
  const parameterSources = {};
  variableUrlParts(draft.urlParts).forEach((part) => {
    const source = draft.parameterSources[part.id];
    parameterSources[part.name] = source.kind === 'staticList'
      ? buildStaticListSource(source.valuesText)
      : source.kind === 'range'
        ? buildRangeSource(source.type, source.from, source.to, source.format)
        : source;
  });

  const apiConfig = buildApiConfig({
    urlParts: draft.urlParts,
    groups: draft.groups,
    parameterSources,
    capturedHeaders: draft.capturedHeaders,
    headerDecisions: draft.headerDecisions,
  });

  log('API_CONFIG confirm', apiConfig);
  setState(STATES.IDLE, { apiConfig, apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null });
}

// ── Async actions ─────────────────────────────────────────────────────────────

async function checkCompanion() {
  log('HEALTH_CHECK start', COMPANION_URL);
  try {
    const res = await fetch(`${COMPANION_URL}/health`);
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

// Low-level GET_API_CAPTURE_ENTRIES round trip, shared by the "view
// recorded endpoints" panel below and the value-list autofill further down
// — same request/response shape as GET_LOGS/CHECK_ROBOTS_TXT, just no
// dedicated loading/result state of its own since both callers keep their
// own.
async function fetchApiCaptureEntries() {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_API_CAPTURE_ENTRIES' }) || [];
  } catch (err) {
    log('GET_API_CAPTURE_ENTRIES failed', err.message);
    return [];
  }
}

// API-mode follow-up: toggles the inline "view recorded endpoints" panel —
// fetches a fresh snapshot of the pool on every open (not just once) so a
// user who recorded more requests, closed the panel, and reopens it sees
// them without needing to stop/restart recording.
async function toggleApiEntriesPanel() {
  if (_state.apiEntriesPanelOpen) {
    log('API_ENTRIES_PANEL close');
    patchState({ apiEntriesPanelOpen: false });
    return;
  }
  log('API_ENTRIES_PANEL open');
  const entries = await fetchApiCaptureEntries();
  patchState({ apiEntriesPanelOpen: true, apiEntries: entries });
}

// API-mode follow-up: derives sibling values for one variable URL part from
// the recorded pool and merges them into that part's StaticListSource value
// list — see findUrlTemplateMatches/mergeValueListValues above for the
// actual matching/merging logic. Runs once automatically the moment
// "Werteliste" is picked as the source kind, and again on demand via the
// per-card "Aus Aufzeichnung übernehmen" button (e.g. after scrolling the
// inspected page further to trigger more recorded requests).
async function fillStaticListFromPool(partId) {
  log('API_AUTOFILL start', partId);
  const entries = await fetchApiCaptureEntries();

  // The round trip is async — re-read state instead of trusting a
  // closed-over draft, and bail if the screen/parameter moved on while it
  // was in flight (config screen left, part removed, or its source kind
  // switched away from staticList in the meantime).
  const draft = _state.apiConfigDraft;
  const source = draft?.parameterSources?.[partId];
  if (!draft || source?.kind !== 'staticList') return;

  const matches = findUrlTemplateMatches(draft.urlParts, partId, entries);
  const { text, addedCount } = mergeValueListValues(source.valuesText || '', matches);
  log('API_AUTOFILL result', { partId, found: matches.length, added: addedCount });

  // A successful fill is already visible in the textarea itself — no need
  // to also announce it via the (otherwise error-only, red) toast. Only the
  // no-op case gets one, since nothing else on screen would otherwise
  // confirm that the button/auto-run actually did something.
  if (addedCount > 0) {
    patchApiConfigSource(partId, { valuesText: text });
  } else {
    showToast(t('apiConfig.autoFillNoMatches'));
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
    _state.scriptFileName, _state.outputFileName, _state.engine, _state.browserActions,
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
    const res = await fetch(`${COMPANION_URL}/generate`, {
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
    const scriptText = await res.text();
    log('GENERATE OK', `${scriptText.length} chars`);
    setState(STATES.DONE, { scriptText });
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
    _state.scriptFileName, _state.outputFileName, _state.engine, _state.browserActions,
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

// `context` is a short human label (e.g. "Script generation"); passing it
// marks the error as reportable — the toast then also offers "Report
// bug" and the message/context are attached to the next bug report.
function showToast(message, context) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;

  const msgEl = document.getElementById('error-toast-message');
  if (msgEl) msgEl.textContent = message; else toast.textContent = message;

  const reportBtn = document.getElementById('btn-report-bug-toast');
  if (reportBtn) reportBtn.classList.toggle('hidden', !context);
  if (context) setLastError(message, context);

  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), context ? 8000 : 4000);
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
  log('FIELD_ADD', { name, selector: _state.pendingSelector, framePath: _state.pendingFramePath });
  setState(STATES.IDLE, {
    fields:           addField(_state.fields, name, _state.pendingSelector, _state.pendingFramePath),
    pendingSelector:  null,
    pendingFramePath: null,
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

function openContainerModal(parentPath) {
  log('CONTAINER_MODAL open', { parentPath });
  patchState({ containerModalOpen: true, pendingParentPath: parentPath });
}

// Container-add order is deliberately "name/type first, then click an
// element" (unlike field-add below) — see planning-container-scraping.md.
function confirmContainerModal() {
  const name = document.getElementById('input-container-name')?.value.trim();
  if (!name) return;
  const repeating = document.getElementById('radio-container-repeating')?.checked ?? false;
  const parentPath = _state.pendingParentPath;
  const scopeSelector = parentPath ? resolveGroupNode(_state.groups, parentPath)?.selector : null;
  // This container's own selector must itself be able to match N times when
  // repeating, on top of the usual "nested inside a repeating ancestor" case.
  const avoidId = repeating || hasRepeatingAncestor(_state.groups, parentPath);

  log('CONTAINER_ADD start', { name, repeating, parentPath, scopeSelector, avoidId });
  stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION', scopeSelector, avoidId });
  setState(STATES.SELECTING, {
    containerModalOpen:  false,
    selectionKind:       'container',
    pendingNewContainer: { name, repeating },
    pendingSelector:     null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

function cancelContainerModal() {
  log('CONTAINER_MODAL cancel');
  setState(_state.current, { containerModalOpen: false, pendingParentPath: null });
}

// Field-add within a container keeps the flat mode's order — click first,
// name/type after — since the field type doesn't affect what gets clicked.
function startFieldSelection(parentPath) {
  const scopeSelector = resolveGroupNode(_state.groups, parentPath)?.selector ?? null;
  const avoidId = hasRepeatingAncestor(_state.groups, parentPath);
  log('FIELD_ADD(container) start', { parentPath, scopeSelector, avoidId });
  stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION', scopeSelector, avoidId });
  setState(STATES.SELECTING, {
    selectionKind:       'field',
    pendingParentPath:   parentPath,
    pendingNewContainer: null,
    pendingSelector:     null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

function confirmExtendedField() {
  const name = document.getElementById('input-field-extended-name')?.value.trim();
  if (!name) return;
  const mode = document.getElementById('select-field-mode')?.value ?? 'text';
  const attribute = document.getElementById('input-field-attribute')?.value.trim();
  if (mode === 'attribute' && !attribute) return;

  const node = buildFieldNode(name, _state.pendingSelector, mode, attribute, _state.pendingFramePath);
  log('FIELD_ADD(container) confirm', node);
  setState(STATES.IDLE, {
    groups:            insertContainerNode(_state.groups, _state.pendingParentPath, node),
    pendingSelector:   null,
    pendingFramePath:  null,
    pendingParentPath: null,
    selectionKind:     null,
  });
}

function cancelExtendedField() {
  log('FIELD_ADD(container) cancel');
  setState(STATES.IDLE, { pendingSelector: null, pendingFramePath: null, pendingParentPath: null, selectionKind: null });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
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
    toggleApiCapture();
  });

  document.getElementById('input-script-filename')?.addEventListener('input', (e) => {
    setState(_state.current, { scriptFileName: e.target.value });
  });
  document.getElementById('input-output-filename')?.addEventListener('input', (e) => {
    setState(_state.current, { outputFileName: e.target.value });
  });

  document.getElementById('btn-api-search')?.addEventListener('click', () => {
    log('BTN api-search');
    startApiFieldSearch();
  });

  document.getElementById('btn-api-entries-toggle')?.addEventListener('click', () => {
    log('BTN api-entries-toggle');
    toggleApiEntriesPanel();
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

  wireApiCandidateListEvents('api-candidates-list', () => _state.apiCandidates?.candidates, confirmApiFieldCandidate);
  wireApiCandidateListEvents('api-tree-search-list', () => _state.apiTreeSearchResult?.candidates, confirmApiTreeFieldCandidate);

  document.getElementById('btn-api-tree-add-root')?.addEventListener('click', () => startApiTreeFieldSearch(null));

  // Event delegation for the API-tree's per-row add/remove buttons and name
  // input — mirrors the Container-tree's own delegation below.
  document.getElementById('api-tree-root')?.addEventListener('click', (e) => {
    const li = e.target.closest('.api-tree-node');
    if (!li) return;
    const path = JSON.parse(li.dataset.path);

    if (e.target.closest('.btn-add-api-subgroup')) { openApiGroupModal(path); return; }
    if (e.target.closest('.btn-add-api-subfield')) { startApiTreeFieldSearch(path); return; }
    if (e.target.closest('.btn-remove-api-node')) {
      log('API_TREE_NODE_REMOVE', { path });
      setState(_state.current, { apiConfigDraft: { ..._state.apiConfigDraft, groups: removeApiTreeNode(_state.apiConfigDraft.groups, path) } });
    }
  });

  document.getElementById('api-tree-root')?.addEventListener('change', (e) => {
    const nameInput = e.target.closest('.api-tree-name');
    if (nameInput) setApiTreeNodeName(JSON.parse(nameInput.dataset.path), nameInput.value.trim());
  });

  document.getElementById('btn-api-group-confirm')?.addEventListener('click', confirmApiGroupModal);
  document.getElementById('input-api-group-path')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmApiGroupModal();
  });
  document.getElementById('btn-api-group-cancel')?.addEventListener('click', cancelApiGroupModal);

  // ── API-Mode config screen (Issue #53 Phase 5) ─────────────────────────────
  // Delegated `change` listeners (not `input`) so typing in a text field
  // doesn't trigger a re-render — and thus lose focus — on every keystroke;
  // see renderApiConfigScreen's doc comment for the trade-off this implies.

  const handleUrlPartControlChange = (e) => {
    const toggle = e.target.closest('.api-config-part-toggle');
    if (toggle) { toggleApiConfigPartVariable(toggle.dataset.partId); return; }
    const nameInput = e.target.closest('.api-config-part-name');
    if (nameInput) setApiConfigPartName(nameInput.dataset.partId, nameInput.value.trim());
  };
  document.getElementById('api-config-segments')?.addEventListener('change', handleUrlPartControlChange);
  document.getElementById('api-config-query-params')?.addEventListener('change', handleUrlPartControlChange);

  document.getElementById('api-config-parameters')?.addEventListener('change', (e) => {
    const kindRadio = e.target.closest('.api-config-source-kind-radio');
    if (kindRadio) {
      setApiConfigSourceKind(kindRadio.dataset.partId, kindRadio.value);
      // Best-effort, automatic first pass — picking "Werteliste" is exactly
      // the moment a user would otherwise go hunting through DevTools for
      // sibling requests, so try the pool first and let them refine/refresh
      // via the button rendered alongside the textarea (see
      // fillStaticListFromPool's own doc comment).
      if (kindRadio.value === 'staticList') fillStaticListFromPool(kindRadio.dataset.partId);
      return;
    }
    const staticList = e.target.closest('.api-config-static-list');
    if (staticList) { patchApiConfigSource(staticList.dataset.partId, { valuesText: staticList.value }); return; }
    const rangeType = e.target.closest('.api-config-range-type');
    if (rangeType) {
      const partId = rangeType.dataset.partId;
      // Re-detect on every Type change, not just the initial "Range" pick
      // — switching e.g. IsoWeek → Date should re-match the same captured
      // raw value against Date's own presets instead of keeping a format
      // string that no longer means anything for the new Type.
      const rawValue = findUrlPartValue(_state.apiConfigDraft.urlParts, partId);
      patchApiConfigSource(partId, { type: rangeType.value, format: detectRangeFormat(rangeType.value, rawValue) });
      return;
    }
    const rangeFrom = e.target.closest('.api-config-range-from');
    if (rangeFrom) { patchApiConfigSource(rangeFrom.dataset.partId, { from: rangeFrom.value.trim() }); return; }
    const rangeTo = e.target.closest('.api-config-range-to');
    if (rangeTo) { patchApiConfigSource(rangeTo.dataset.partId, { to: rangeTo.value.trim() }); return; }
    const formatPreset = e.target.closest('.api-config-range-format-preset');
    if (formatPreset) { patchApiConfigSource(formatPreset.dataset.partId, { format: formatPreset.value === 'custom' ? '' : formatPreset.value }); return; }
    const formatCustom = e.target.closest('.api-config-range-format-custom');
    if (formatCustom) patchApiConfigSource(formatCustom.dataset.partId, { format: formatCustom.value.trim() });
  });

  document.getElementById('api-config-parameters')?.addEventListener('click', (e) => {
    const searchBtn = e.target.closest('.api-config-discovery-search');
    if (searchBtn) { startDiscoverySearch(searchBtn.dataset.partId); return; }
    const confirmBtn = e.target.closest('.api-config-discovery-confirm');
    if (confirmBtn) {
      const index = parseInt(confirmBtn.dataset.candidateIndex, 10);
      const candidate = _state.apiDiscoveryCandidates?.candidates?.[index];
      if (candidate) confirmDiscoveryCandidate(confirmBtn.dataset.partId, candidate);
      return;
    }
    const autofillBtn = e.target.closest('.api-config-autofill-pool');
    if (autofillBtn) fillStaticListFromPool(autofillBtn.dataset.partId);
  });

  document.getElementById('api-config-headers')?.addEventListener('change', (e) => {
    const include = e.target.closest('.api-config-header-include');
    if (include) { setApiConfigHeaderDecision(include.dataset.headerName, { include: include.checked }); return; }
    const modeRadio = e.target.closest('.api-config-header-mode-radio');
    if (modeRadio) { setApiConfigHeaderDecision(modeRadio.dataset.headerName, { mode: modeRadio.value }); return; }
    const envName = e.target.closest('.api-config-env-name');
    if (envName) setApiConfigHeaderDecision(envName.dataset.headerName, { envName: envName.value.trim() });
  });

  document.getElementById('btn-api-config-cancel')?.addEventListener('click', () => {
    log('BTN api-config-cancel');
    cancelApiConfig();
  });

  document.getElementById('btn-api-config-confirm')?.addEventListener('click', () => {
    log('BTN api-config-confirm');
    confirmApiConfig();
  });

  document.getElementById('btn-api-config-discard')?.addEventListener('click', () => {
    log('BTN api-config-discard');
    setState(STATES.IDLE, { apiConfig: null });
  });

  document.getElementById('btn-add-field')?.addEventListener('click', () => {
    log('BTN add-field → START_SELECTION');
    stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    setState(STATES.SELECTING, { pendingSelector: null, domTree: null, domTreeTruncated: false, domTreeError: null });
    if (_state.domViewEnabled) {
      log('DOM view was enabled → re-requesting tree');
      requestDomTree();
    }
  });

  document.getElementById('btn-mode-flat')?.addEventListener('click', () => switchMode('flat'));
  document.getElementById('btn-mode-container')?.addEventListener('click', () => switchMode('container'));
  document.getElementById('btn-mode-api')?.addEventListener('click', () => switchMode('api'));

  document.getElementById('btn-add-root-container')?.addEventListener('click', () => openContainerModal(null));

  // Event delegation for the container tree's per-row add/remove buttons
  document.getElementById('group-tree-root')?.addEventListener('click', (e) => {
    const li = e.target.closest('.group-tree-node');
    if (!li) return;
    const path = JSON.parse(li.dataset.path);

    if (e.target.closest('.btn-add-subcontainer')) { openContainerModal(path); return; }
    if (e.target.closest('.btn-add-subfield')) { startFieldSelection(path); return; }
    if (e.target.closest('.btn-remove-group-node')) {
      log('GROUP_NODE_REMOVE', { path });
      stopPreviewIfActive();
      setState(_state.current, { groups: removeGroupTreeNode(_state.groups, path) });
    }
  });

  document.getElementById('btn-container-confirm')?.addEventListener('click', confirmContainerModal);
  document.getElementById('input-container-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmContainerModal();
  });
  document.getElementById('btn-container-cancel')?.addEventListener('click', cancelContainerModal);

  document.getElementById('btn-field-extended-confirm')?.addEventListener('click', confirmExtendedField);
  document.getElementById('input-field-extended-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmExtendedField();
  });
  document.getElementById('btn-field-extended-cancel')?.addEventListener('click', cancelExtendedField);
  document.getElementById('select-field-mode')?.addEventListener('change', (e) => {
    document.getElementById('field-attribute-row')?.classList.toggle('hidden', e.target.value !== 'attribute');
  });

  document.getElementById('btn-cancel-selection')?.addEventListener('click', () => {
    log('BTN cancel-selection → STOP_SELECTION');
    chrome.runtime.sendMessage({ type: 'STOP_SELECTION' });
    clearTimeout(domTreeTimeoutId);
    // A Discovery search (see startDiscoverySearch) is started *from*
    // STATES.API_CONFIG — cancelling it must return there, not to IDLE,
    // or the in-progress apiConfigDraft would appear to have vanished.
    const returnTo = _state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE;
    setState(returnTo, {
      selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null,
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
    setState(STATES.IDLE, { pendingSelector: null });
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
        pendingSelector: null, selectionKind: 'browserAction', pendingBrowserActionIndex: index, pendingBrowserActionField: field,
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
      if (_state.mode === 'container' && _state.selectionKind === 'container') {
        // Name/type were already collected by modal-container-new — insert
        // the new group node straight away, no further modal needed.
        const node = buildGroupNode(_state.pendingNewContainer.name, message.selector, _state.pendingNewContainer.repeating, framePath);
        setState(STATES.IDLE, {
          groups: insertContainerNode(_state.groups, _state.pendingParentPath, node),
          selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null,
        });
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
          selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null,
        });
      } else {
        setState(STATES.SELECTING, { pendingSelector: message.selector, pendingFramePath: framePath });
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
    'fields', 'url', 'pendingSelector', 'pendingFramePath', 'mode', 'groups',
    'engine', 'browserActions', 'pendingBrowserActionIndex', 'pendingBrowserActionField',
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
        groups, selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null,
      });
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
        browserActions, selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null,
      });
      return;
    }

    // Flat field or container field — show the (extended, in container
    // mode) field-name modal without re-checking the companion.
    log('INIT pending selector found → show modal', stored.pendingSelector);
    setState(STATES.SELECTING, { pendingSelector: stored.pendingSelector, pendingFramePath: stored.pendingFramePath || null });
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
    applyStaticTranslations, sanitizeFileNameBase,
    addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions, renderBrowserActions,
    buildVerificationValues,
    frameBadgeHtml,
  };
}
