// Pure, DOM-free helpers for API mode (Issue #53/#54/#55): URL-template
// parsing/building, value-list parsing/merging, parameter-source builders
// (static list/discovery/range), range-format presets/detection, the
// ApiGroup/ApiField response-tree draft (build/resolve/insert/remove/
// serialize/update/validate), the ApiBodyNode request-body draft (build/
// resolve/update/reference-check/bound-check/serialize), and top-level
// ApiConfig assembly. Split out of popup.ts (which had grown past 3800 loc)
// purely for readability — no behavior change.
import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';
import { BOOTSTRAP_SOURCE_KIND, buildApiBootstrap, bootstrapDraftIsComplete } from './api-bootstrap';
import { buildApiCursorPagination, cursorDraftIsComplete } from './api-cursor-pagination';
import { buildApiLinkHeaderPagination, linkDraftIsComplete } from './api-link-pagination';
import { t } from '../i18n/i18n';
import type { Screen } from '../types/popup';

// The API-mode drafts are declared here rather than in types/drafts.ts: only
// this module and api-bootstrap.ts read them (scraping-config-builder.ts sees
// the already-serialized SFWire.ApiConfig, never these).

export interface PathSegmentPart {
  value: string;
  variable: boolean;
  name: string;
}

export interface QueryParamPart {
  key: string;
  value: string;
  variable: boolean;
  name: string;
}

export type UrlTemplatePart = PathSegmentPart | QueryParamPart;

export interface UrlParts {
  origin: string;
  pathSegments: PathSegmentPart[];
  queryParams: QueryParamPart[];
}

// What parameterSources holds while the API_CONFIG screen is open; confirmApiConfig turns each into its SFWire.ApiParameterSource. A part
// whose source kind is not chosen yet has no entry at all.
export type ApiParameterSourceDraft =
  | { kind: 'staticList'; valuesText: string }
  | { kind: 'range'; type: SFWire.RangeType; from: string; to: string; format?: string | null }
  // Incomplete until confirmDiscoveryCandidate fills in the three paths.
  | { kind: 'discovery'; method?: 'GET'; urlTemplate?: string; itemsPath?: string; valuePath?: string }
  | { kind: 'browserDiscovery'; discoveryUrl: string; actions: SFDraft.BrowserAction[] }
  // The part carries the bootstrap value; never a declared parameter (see api-bootstrap.ts).
  | { kind: 'bootstrap' };

export type SourceOf<K extends ApiParameterSourceDraft['kind']> = Extract<ApiParameterSourceDraft, { kind: K }>;

export interface ApiGroupDraft {
  kind: 'group';
  name: string;
  path: string;
  children: ApiNodeDraft[];
}

export interface ApiFieldDraft {
  kind: 'field';
  name: string;
  path: string | null;
  transforms: SFWire.FieldTransform[] | null;
  /** Popup-internal, never sent: drives the transform modal's live preview. */
  sampleValue?: unknown;
  hiddenFromOutput: boolean;
}

export type ApiNodeDraft = ApiGroupDraft | ApiFieldDraft;

export interface ApiBodyObjectDraft {
  kind: 'object';
  properties: Record<string, ApiBodyNodeDraft>;
}

export interface ApiBodyArrayDraft {
  kind: 'array';
  items: ApiBodyNodeDraft[];
}

export interface ApiBodyLiteralDraft {
  kind: 'literal';
  literalKind: SFWire.ApiBodyLiteralKind;
  value: unknown;
}

export interface ApiBodyVariableDraft {
  kind: 'variable';
  literalKind: SFWire.ApiBodyLiteralKind;
  value: unknown;
  parameterId: string | null;
  coerceTo?: SFWire.ApiBodyLiteralKind | null;
}

export type ApiBodyNodeDraft = ApiBodyObjectDraft | ApiBodyArrayDraft | ApiBodyLiteralDraft | ApiBodyVariableDraft;

export interface ParameterPart {
  id: string;
  name: string;
}

export interface HeaderDecision {
  include: boolean;
  mode: 'literal' | 'env' | 'bootstrap';
  envName?: string;
  template?: string;
}

export interface ApiConfigDraft {
  urlParts: UrlParts;
  itemsPath?: string;
  fields?: ApiFieldDraft[];
  groups?: ApiNodeDraft[];
  parameterSources: Record<string, ApiParameterSourceDraft>;
  capturedHeaders: Array<{ name: string; value: string }>;
  headerDecisions: Record<string, HeaderDecision>;
  method?: 'GET' | 'POST';
  bodyTree?: ApiBodyNodeDraft | null;
  bodyParameterNames?: string[];
  parameterIdToName?: Record<string, string>;
  embeddedJsonSource?: SFWire.EmbeddedJsonSource | null;
  bodyParameters?: ParameterPart[];
  bootstrap?: SFDraft.ApiBootstrap | null;
  cursorPagination?: SFDraft.ApiCursorPagination | null;
  linkHeaderPagination?: SFDraft.ApiLinkHeaderPagination | null;
  sourceHasNextLink?: boolean;
  sourceEntryId?: number;
  sourceUrl?: string;
  nextBodyParameterSeq?: number;
}

// What buildApiConfig assembles: the draft with every parameter source already in its wire form.
export type ApiConfigBuildInput = Omit<ApiConfigDraft, 'parameterSources'> & { parameterSources: Record<string, SFWire.ApiParameterSource> };

/**
 * The message content-script.js sends back after a click-based search. It is a
 * cross-context shape this module only reads, so only the parts
 * buildApiSubtreeFromCandidate uses are declared.
 */
export interface ApiSubtreeCandidate {
  treeSkeleton: Array<{ path: string }>;
  value?: unknown;
  siblings?: Array<{ name: string; value?: unknown }>;
}

// Popup screen names. Lives here (rather than in popup.ts, which loads
// after this module) purely so api-config-ui.ts/container-tree-ui.js's
// event handlers can reference it too; it has no other tie to API mode
// specifically.
export const STATES: { readonly [K in Screen]: K } = {
  CHECKING_COMPANION: 'CHECKING_COMPANION',
  COMPANION_ERROR:    'COMPANION_ERROR',
  IDLE:               'IDLE',
  SELECTING:          'SELECTING',
  API_CONFIG:         'API_CONFIG', // Issue #53 Phase 5 — configuring a confirmed candidate into an ApiConfig
  GENERATING:         'GENERATING',
  DONE:               'DONE',
  // The global Settings tab — reachable from the persistent header
  // (outside any .screen), independent of `mode`/switchMode's own
  // MODE_SWITCH_CLEARS, since it isn't a scraping mode and must never
  // clear in-progress fields/groups/apiConfig. "Back" returns to IDLE
  // with no patch, mirroring btn-back-to-config.
  SETTINGS:           'SETTINGS',
};

// Generic, dependency-free HTML-escaping helper — lives here for the same
// reason as STATES above.
export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
export function parseUrlTemplateParts(urlString: string): UrlParts {
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
export function buildUrlTemplate({ origin, pathSegments, queryParams }: UrlParts): string {
  const path = pathSegments.map(seg => (seg.variable ? `{${seg.name}}` : seg.value)).join('/');
  const query = queryParams
    .map(p => `${encodeURIComponent(p.key)}=${p.variable ? `{${p.name}}` : encodeURIComponent(p.value)}`)
    .join('&');
  return `${origin}/${path}${query ? `?${query}` : ''}`;
}

// Werteliste source: comma- or newline-separated free text → trimmed,
// non-empty values.
export function parseValueListInput(text: string | null | undefined): string[] {
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
export function findUrlTemplateMatches(urlParts: UrlParts, targetPartId: string, entries: Array<{ url: string }>): string[] {
  const [targetScope, targetKey] = targetPartId.split(':');
  const seen = new Set<string>();
  const values: string[] = [];

  (entries || []).forEach((entry) => {
    let candidate: UrlParts;
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
export function mergeValueListValues(existingText: string, newValues: string[]): { text: string; addedCount: number } {
  const existing = new Set(parseValueListInput(existingText));
  const added = newValues.filter(v => !existing.has(v));
  if (added.length === 0) return { text: existingText || '', addedCount: 0 };
  const prefix = existingText && existingText.trim() ? `${existingText.replace(/\s+$/, '')}\n` : '';
  return { text: prefix + added.join('\n'), addedCount: added.length };
}

export function buildStaticListSource(valuesText: string): SFWire.StaticListSource {
  return { kind: 'staticList', values: parseValueListInput(valuesText) };
}

// urlTemplate here is deliberately the confirmed candidate's raw URL, not
// built from segments/params like the main request — DiscoverySource is
// expected to be fully static (see ScrapingPlanValidator.ValidateDiscoverySource:
// no cross-checking against the main request's parameters, by design, since
// Phase 1 rules out dependencies between parameters).
export function buildDiscoverySource(urlTemplate: string, itemsPath: string, valuePath: string): SFWire.DiscoverySource {
  return { kind: 'discovery', urlTemplate, itemsPath, valuePath };
}

// `format` is omitted from the wire object entirely when unset (Number has
// no format concept, and an empty/undetected one shouldn't override the
// backend's own default) — mirrors PythonApiConfigLiteral's RenderFormatSuffix
// on the companion side, which does the same for the same reason: the
// runtime's own hardcoded default (RangeFormat.Resolve) stays the single
// source of truth for "what ISO-Standard actually means" when nothing was
// explicitly chosen.
export function buildRangeSource(type: SFWire.RangeType, from: string, to: string, format?: string | null): SFWire.RangeSource {
  return { kind: 'range', type, from, to, ...(format ? { format } : {}) };
}

// Issue #216: deliberately no URL-match-pattern field — the runtime
// matches captured requests against the main request's own UrlTemplate
// (see BrowserDiscoverySource's own doc comment on the companion side),
// so this only ever needs DiscoveryUrl plus the action list. While being
// edited, the action list is kept in the same draft shape (SFDraft.
// BrowserAction[]) the top-level login-flow editor already uses — reusing
// addBrowserAction/removeBrowserAction/updateBrowserAction from
// scraping-config-builder.ts directly (api-config.ts can't import that
// module itself: scraping-config-builder.ts already imports THIS module,
// and the reverse would be a circular require) — so `actions` here is
// already serialized to wire shape (via that module's
// serializeBrowserActions) by the caller (confirmApiConfig in
// api-config-ui.ts), exactly mirroring how staticList/range's own drafts
// are converted to wire shape at that same call site.
export function buildBrowserDiscoverySource(discoveryUrl: string, actions?: SFWire.BrowserAction[]): SFWire.BrowserDiscoverySource {
  return { kind: 'browserDiscovery', discoveryUrl, ...(actions && actions.length ? { actions } : {}) };
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
export const RANGE_FORMAT_PRESETS: Partial<Record<SFWire.RangeType, Array<{ format: string; labelKey: string }>>> = {
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

// Same format mini-template as RangeFormat.CompilePattern (companion) and
// _compile_range_format (generated script); test-vectors/range-format.json
// pins all three to the same matches, so a value this accepts parses there too.
export function compileRangeFormatPattern(format: string): RegExp {
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
export function detectRangeFormat(type: SFWire.RangeType, rawValue: string | null | undefined): string | null {
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
export function findUrlPartValue(urlParts: UrlParts, partId: string): string | undefined {
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
export function rangeFormatExample(format: string | null | undefined, fromValue: string | null | undefined): string | null {
  if (!format) return null;
  if (fromValue && compileRangeFormatPattern(format).test(fromValue)) return fromValue;
  return format;
}

// capturedHeaders: [{name, value}] from the confirmed candidate's recorded
// request (api-capture.ts's requestHeaders). decisions: {[headerName]:
// {include, mode: 'literal'|'env', envName}} — the header-adoption table's
// per-row choice. Mirrors FillStep's env-var pattern: a header adopted via
// an environment variable is never embedded literally.
export function buildApiHeaders(capturedHeaders: Array<{ name: string; value: string }>, decisions: Record<string, HeaderDecision>): SFWire.ApiHeader[] {
  return capturedHeaders
    .filter(h => decisions[h.name]?.include)
    .map((h) => {
      const decision = decisions[h.name];
      // Issue #220: 'bootstrap' builds the header from the freshly
      // fetched bootstrap value at runtime, e.g. "Bearer {token}".
      if (decision.mode === 'bootstrap') return { name: h.name, template: decision.template || '' };
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
//
// Issue #55, Phase B4: `method` is omitted for a plain "GET" (matches the
// companion's own default, ApiConfig.Method) — today's callers never pass
// anything else, so this is purely forward-looking. `bodyParameterNames`
// are body-only parameters (declared via the "+ Neuer Parameter" picker,
// see openBodyParameterModal) that never appear in the URL at all — the
// wire format's flat `parameters` list has no concept of "where" a
// parameter is used, so these are simply unioned with the URL-derived ones.
// `parameterIdToName` is only needed to serialize `bodyTree` (see
// serializeBodyTree) — a variable leaf's draft-only `parameterId` doesn't
// otherwise appear anywhere in this function.
// Issue #136: embeddedJsonSource ({scriptSelector}, or null/undefined for
// an ordinary live API request) is included as-is when set — mirrors
// IR/ApiConfig.cs's own EmbeddedJsonSource property, a plain optional
// object with no serialization of its own to do here (unlike groups/body,
// which are draft shapes needing conversion to the wire format).
export function buildApiConfig({
  urlParts, itemsPath, fields, groups, parameterSources, capturedHeaders, headerDecisions,
  method, bodyTree, bodyParameterNames = [], parameterIdToName = {}, embeddedJsonSource = null, bootstrap = null,
  cursorPagination = null, linkHeaderPagination = null,
}: ApiConfigBuildInput): SFWire.ApiConfig {
  const urlTemplate = buildUrlTemplate(urlParts);
  // Issue #220: a variable URL part carrying the bootstrap value (already
  // renamed to the bootstrap's own name by resolveBootstrapUrlParts) is a
  // placeholder, not a declared parameter — see api-bootstrap.ts.
  const bootstrapWire = buildApiBootstrap(bootstrap);
  const cursorWire = buildApiCursorPagination(cursorPagination);
  const linkWire = buildApiLinkHeaderPagination(linkHeaderPagination);
  const variableParts = [...urlParts.pathSegments, ...urlParts.queryParams]
    .filter(p => p.variable && !(bootstrapWire && p.name === bootstrapWire.name));
  const parameterNames = [...variableParts.map(p => p.name), ...bodyParameterNames];
  const parameters = parameterNames.map(name => ({ name, source: parameterSources[name] }));
  const headers = buildApiHeaders(capturedHeaders, headerDecisions);

  return {
    urlTemplate,
    ...(method && method !== 'GET' ? { method } : {}),
    // The tree's own root is always ApiGroup nodes (never a bare ApiField
    // at the top level) — see confirmApiTreeFieldCandidate/
    // buildApiSubtreeFromCandidate, which only ever insert a leaf nested
    // under at least one root group — so this cast just narrows
    // serializeApiTree's generic ApiNode[] return to what ApiConfig.Groups
    // itself requires.
    ...(groups ? { groups: serializeApiTree(groups) as SFWire.ApiGroup[] } : { itemsPath, fields }),
    parameters,
    ...(headers.length > 0 ? { headers } : {}),
    ...(bodyTree ? { body: serializeBodyTree(bodyTree, parameterIdToName) } : {}),
    ...(embeddedJsonSource ? { embeddedJsonSource } : {}),
    ...(bootstrapWire ? { bootstrap: bootstrapWire } : {}),
    ...(cursorWire ? { cursorPagination: cursorWire } : {}),
    ...(linkWire ? { linkHeaderPagination: linkWire } : {}),
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

export function buildApiGroupDraft(name: string, path: string): ApiGroupDraft {
  return { kind: 'group', name, path, children: [] };
}

// transforms mirrors Container-Mode's own buildFieldNode default (Issue
// #84) — null means "no chain configured", the same value the field-
// transforms modal (see api-config-ui.ts's openApiFieldTransformsModal)
// resets it to when the chain is emptied back out.
//
// sampleValue (Issue #147): the raw JSON value this field resolved to at
// candidate-confirm time — popup-internal only, never sent to the
// companion (serializeApiTree below doesn't carry it over), it exists
// purely to drive the transform-chain modal's live preview the same way
// pendingRawText does for flat/container mode. undefined (not null) when
// no sample was ever available — e.g. a field added by hand via
// modal-api-group-new's sibling flows some day — so the preview can tell
// "no sample" apart from a real JSON `null` (which the runtime turns into
// an empty string, see scraper_api.py.j2's own "value is None" check).
// Issue #206 follow-up: path may be null — the dedicated combine/split
// creation flow (combine-split-fields-ui.ts) always calls this with
// path=null, since a derived field has no JSON path of its own (its
// value comes entirely from other already-resolved sibling fields).
// hiddenFromOutput defaults false, set only via that same flow's own
// "remove original field(s)" checkbox (updateApiTreeNode elsewhere).
export function buildApiFieldDraft(
  name: string, path: string | null, transforms: SFWire.FieldTransform[] | null = null, sampleValue: unknown = undefined, hiddenFromOutput = false,
): ApiFieldDraft {
  return { kind: 'field', name, path, transforms, sampleValue, hiddenFromOutput };
}

export function resolveApiTreeNode(groups: ApiNodeDraft[], path: number[] | null | undefined): ApiNodeDraft | null {
  if (!path || path.length === 0) return null;
  let node: ApiNodeDraft = groups[path[0]];
  for (let i = 1; i < path.length; i++) node = (node as ApiGroupDraft).children[path[i]];
  return node;
}

// Appends `node` as the last child at `parentPath` (or at root level when
// `parentPath` is null) — immutable, like insertContainerNode below.
export function insertApiTreeNode(groups: ApiNodeDraft[], parentPath: number[] | null | undefined, node: ApiNodeDraft): ApiNodeDraft[] {
  const path = parentPath || [];
  if (path.length === 0) return [...groups, node];
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head
    ? { ...n, children: insertApiTreeNode((n as ApiGroupDraft).children, rest, node) }
    : n));
}

// Issue #206: preceding sibling field names (own parent group, indices
// strictly before this node's own position) an already-inserted ApiField
// leaf's own combineFields/splitField transform may reference — unlike
// container-tree.ts's collectSiblingFieldNames, this modal reopens
// against an *already-placed* leaf (see openApiFieldTransformsModal), so
// only siblings actually declared before it count; a later sibling isn't
// offered at all here, rather than being offered and then rejected only
// once "Apply" reaches the companion's own ordering check.
export function collectPrecedingApiFieldSiblingNames(groups: ApiNodeDraft[], path: number[] | null | undefined): string[] {
  if (!path || path.length === 0) return [];
  const parentPath = path.slice(0, -1);
  const ownIndex = path[path.length - 1];
  const parent = parentPath.length === 0 ? null : resolveApiTreeNode(groups, parentPath);
  const siblings = parentPath.length === 0
    ? groups
    : (parent && parent.kind === 'group' ? parent.children : []);
  return siblings.slice(0, ownIndex).filter(n => n.kind === 'field').map(n => n.name);
}

// Issue #206 follow-up: every existing field child directly under
// groupPath (or at root when null/empty) — the dedicated combine/split
// creation flow always inserts its new field as the group's own last
// child, so (mirroring container-tree.ts's own collectSiblingFieldNames)
// every current field sibling here already counts as "declared earlier"
// with no slicing needed, unlike collectPrecedingApiFieldSiblingNames
// above (which targets an already-placed leaf's own position instead).
export function collectApiGroupFieldNames(groups: ApiNodeDraft[], groupPath: number[] | null | undefined): string[] {
  const group = !groupPath || groupPath.length === 0 ? null : resolveApiTreeNode(groups, groupPath);
  const children = !groupPath || groupPath.length === 0
    ? groups
    : (group && group.kind === 'group' ? group.children : []);
  return children.filter(n => n.kind === 'field').map(n => n.name);
}

// Removes the node (and its subtree) at `path` — always non-empty, unlike
// insertApiTreeNode's parentPath.
export function removeApiTreeNode(groups: ApiNodeDraft[], path: number[]): ApiNodeDraft[] {
  if (path.length === 1) return groups.filter((_, i) => i !== path[0]);
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head
    ? { ...n, children: removeApiTreeNode((n as ApiGroupDraft).children, rest) }
    : n));
}

// Strips the popup's internal `kind` tag and shapes each node exactly like
// the wire format the companion expects (IR/ApiConfig.cs's
// ApiGroup/ApiField, discriminated structurally by ApiNodeJsonConverter via
// presence of `children` — see PythonApiConfigLiteral.RenderGroups on the
// codegen side for the same discriminator). transforms (Issue #84) is only
// included when non-empty, the same "omit rather than send an empty/null
// key" convention Container-Mode's own serializeGroupTree already uses.
export function serializeApiTree(groups: ApiNodeDraft[]): SFWire.ApiNode[] {
  return groups.map((node): SFWire.ApiNode => (node.kind === 'group'
    ? { name: node.name, path: node.path, children: serializeApiTree(node.children) }
    : {
        name: node.name, path: node.path,
        ...(node.transforms && node.transforms.length > 0 ? { transforms: node.transforms } : {}),
        // Issue #206 follow-up: same "incomplete/off = key omitted"
        // convention container mode's own serializeGroupTree already uses.
        ...(node.hiddenFromOutput ? { hiddenFromOutput: true } : {}),
      }));
}

// The idle screen's "API-Konfiguration bereit: N Feld(er), …" summary wants
// a leaf-field count regardless of shape: the older flat ApiConfig.Fields is
// already flat, but a tree-shaped ApiConfig.Groups (Issue #54) needs
// counting recursively — every ApiField anywhere in the tree, at any depth.
export function countApiConfigFields(apiConfig: SFWire.ApiConfig): number {
  if (!apiConfig.groups) return (apiConfig.fields || []).length;
  const countNodes = (nodes: SFWire.ApiNode[]): number => nodes.reduce((sum, node) => {
    const children = 'children' in node ? node.children : undefined;
    return sum + (children ? countNodes(children) : 1);
  }, 0);
  return countNodes(apiConfig.groups);
}

// Immutable "map the one node at `path`" — the third tree-shape primitive
// alongside insert/remove, needed once node names became editable in place
// (Phase A5, see setApiTreeNodeName) rather than only ever chosen once at
// creation time.
export function updateApiTreeNode(groups: ApiNodeDraft[], path: number[], updater: (node: ApiNodeDraft) => ApiNodeDraft): ApiNodeDraft[] {
  const [head, ...rest] = path;
  return groups.map((node, i) => {
    if (i !== head) return node;
    return rest.length === 0
      ? updater(node)
      : { ...node, children: updateApiTreeNode((node as ApiGroupDraft).children, rest, updater) };
  });
}

// Every node in the tree (recursively) has a non-blank name — gates
// "Übernehmen" the same way apiConfigDraftHasAllSourcesChosen's flat-mode
// check does, generalized: intermediate groups are auto-named (see
// buildApiSubtreeFromCandidate) but that name is editable like any other and
// so can still be blanked out.
export function apiTreeNodesHaveNonBlankNames(nodes: ApiNodeDraft[]): boolean {
  return nodes.every(node => !!node.name?.trim() && (node.kind !== 'group' || apiTreeNodesHaveNonBlankNames(node.children)));
}

// ── API-Mode request body (ApiBodyNode, Issue #55 Phase B4) ─────────────────
// The write-side mirror of the tree above: describes what JSON to WRITE into
// the outgoing request body rather than where to read one FROM a response.
// Unlike the response tree, the shape is never edited structurally by the
// user — it's derived once from the one already-captured request body
// (jsonValueToBodyDraft) and all further editing just toggles a leaf between
// 'literal' (fixed) and 'variable' (bound to one of ApiConfig.Parameters by
// id, see allParameterParts) — so there's no insert/remove/scoped-search
// machinery to mirror here, only a generic recursive walk/update pair.
//
// A draft node is one of:
//   { kind: 'object', properties: { [key]: node, ... } }
//   { kind: 'array', items: [node, ...] }
//   { kind: 'literal', literalKind: 'String'|'Number'|'Boolean'|'Null', value }
//   { kind: 'variable', literalKind, value, parameterId, coerceTo }
// A 'variable' node keeps its own literalKind/value around unused so
// toggling back to 'literal' (see toggleBodyLeafToFixed) restores the
// original captured value exactly, instead of losing it.

// Converts one already-JSON.parsed request body into an all-literal draft
// tree — object/array recurse, anything else becomes a 'literal' leaf typed
// by JS's own typeof (JSON has no separate "integer"/"float", so every
// number becomes ApiBodyLiteralKind.Number regardless of ApiBodyLiteral's
// own C#-side double NumberValue).
export function jsonValueToBodyDraft(value: unknown): ApiBodyNodeDraft {
  if (Array.isArray(value)) return { kind: 'array', items: value.map(jsonValueToBodyDraft) };
  if (value !== null && typeof value === 'object') {
    const properties: Record<string, ApiBodyNodeDraft> = {};
    for (const [key, child] of Object.entries(value)) properties[key] = jsonValueToBodyDraft(child);
    return { kind: 'object', properties };
  }
  if (value === null) return { kind: 'literal', literalKind: 'Null', value: null };
  if (typeof value === 'number') return { kind: 'literal', literalKind: 'Number', value };
  if (typeof value === 'boolean') return { kind: 'literal', literalKind: 'Boolean', value };
  return { kind: 'literal', literalKind: 'String', value: String(value) };
}

// path steps are either a string (an object property key) or a number (an
// array index) — object/array are never mixed at the same tree level, so
// this is an unambiguous discriminator for which branch to take.
export function resolveBodyTreeNode(node: ApiBodyNodeDraft, path: Array<string | number>): ApiBodyNodeDraft {
  let current = node;
  for (const step of path) {
    if (typeof step === 'number' && current.kind === 'array') current = current.items[step];
    else if (typeof step === 'string' && current.kind === 'object') current = current.properties[step];
    else throw new Error(`Body tree path step "${step}" does not fit a ${current.kind} node`);
  }
  return current;
}

// Immutable "map the one node at `path`" — the body tree's only edit
// primitive (see this section's own doc comment on why there's no
// insert/remove here, unlike the response tree's updateApiTreeNode).
export function updateBodyTreeNode(
  node: ApiBodyNodeDraft, path: Array<string | number>, updater: (node: ApiBodyNodeDraft) => ApiBodyNodeDraft,
): ApiBodyNodeDraft {
  if (path.length === 0) return updater(node);
  const [step, ...rest] = path;
  if (typeof step === 'number' && node.kind === 'array') {
    return { ...node, items: node.items.map((item, i) => (i === step ? updateBodyTreeNode(item, rest, updater) : item)) };
  }
  if (typeof step === 'string' && node.kind === 'object') {
    return { ...node, properties: { ...node.properties, [step]: updateBodyTreeNode(node.properties[step], rest, updater) } };
  }
  throw new Error(`Body tree path step "${step}" does not fit a ${node.kind} node`);
}

// Whether any 'variable' leaf anywhere in the tree is still bound to
// `parameterId` — used to decide whether reverting one such leaf back to
// 'literal' also orphans the body-only parameter it referenced (see
// toggleBodyLeafToFixed).
export function bodyTreeReferencesParameterId(node: ApiBodyNodeDraft, parameterId: string): boolean {
  if (node.kind === 'object') return Object.values(node.properties).some(child => bodyTreeReferencesParameterId(child, parameterId));
  if (node.kind === 'array') return node.items.some(child => bodyTreeReferencesParameterId(child, parameterId));
  return node.kind === 'variable' && node.parameterId === parameterId;
}

// Gates "Übernehmen" alongside apiConfigDraftHasAllSourcesChosen's own
// per-parameter check: a leaf toggled to 'variable' but not yet bound to a
// parameter (parameterId still null, see toggleBodyLeafToVariable) must
// block confirmation the same way an unchosen source kind already does.
export function bodyTreeLeavesAreBound(node: ApiBodyNodeDraft): boolean {
  if (node.kind === 'object') return Object.values(node.properties).every(bodyTreeLeavesAreBound);
  if (node.kind === 'array') return node.items.every(bodyTreeLeavesAreBound);
  if (node.kind === 'variable') return !!node.parameterId;
  return true; // literal
}

// Strips the popup's internal draft shape and shapes each node exactly like
// the wire format the companion expects (IR/ApiBodyNode.cs's
// ApiBodyObject/ApiBodyArray/ApiBodyLiteral/ApiBodyVariable, discriminated
// structurally by ApiBodyNodeJsonConverter via presence of
// properties/items/parameterName). `parameterIdToName` resolves a variable
// leaf's draft-only `parameterId` to the actual declared parameter name the
// wire format references it by — built once by the caller (confirmApiConfig)
// from the same allParameterParts list the parameter-source cards render
// from, since a draft-only id has no meaning outside this popup.
export function serializeBodyTree(node: ApiBodyNodeDraft, parameterIdToName: Record<string, string>): SFWire.ApiBodyNode {
  if (node.kind === 'object') {
    const properties: Record<string, SFWire.ApiBodyNode> = {};
    for (const [key, child] of Object.entries(node.properties)) properties[key] = serializeBodyTree(child, parameterIdToName);
    return { properties };
  }
  if (node.kind === 'array') {
    return { items: node.items.map(item => serializeBodyTree(item, parameterIdToName)) };
  }
  if (node.kind === 'variable') {
    return {
      parameterName: parameterIdToName[node.parameterId as string],
      ...(node.coerceTo ? { coerceTo: node.coerceTo } : {}),
    };
  }
  // literal — IR/ApiBodyNode.cs's ApiBodyLiteral has three separate typed
  // properties (StringValue/NumberValue/BoolValue), not one generic "value"
  // like the companion's own internal Python-runtime literal shape
  // (PythonApiConfigLiteral.RenderBody) uses — the wire format and that
  // runtime-internal shape are two different things that happen to share a
  // "kind" field. Null has no value property to set at all.
  switch (node.literalKind) {
    case 'String': return { kind: 'String', stringValue: node.value as string };
    case 'Number': return { kind: 'Number', numberValue: node.value as number };
    case 'Boolean': return { kind: 'Boolean', boolValue: node.value as boolean };
    default: return { kind: 'Null' };
  }
}

// Phase A5: JSON keys, unlike CSS selectors, already carry a meaningful name
// — so a group auto-derived from a confirmed search candidate's path is
// named after its own last path segment (e.g. "data.categories" →
// "categories") instead of asking the user, the same way a sibling field is
// already named after its own JSON key. Returns null for an empty path (the
// array-of-arrays case, see ApiGroup.Path) or a path with no plain key
// segment at all — callers fall back to a generic placeholder.
export function lastPathSegmentName(path: string | null | undefined): string | null {
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
// message (findApiCandidates) — popup.ts runs in a different execution
// context and has no access to content-script.js's own functions, the same
// reason candidate.itemsPath/valuePath are pre-derived there too. Auto-names
// intermediate groups (see lastPathSegmentName); siblings are always direct
// properties of the same matched record, so (exactly like flat mode before
// it) each sibling's own JSON key doubles as its relative path. Returns an
// array of one or more new sibling nodes to insert at the target
// parentPath — one node if the click landed inside an already-represented
// scope (the "sibling field" case), possibly several nested levels wrapped
// in one outer node otherwise.
// Issue #147: candidate.value (the leaf) and each picked sibling's own
// .value (from candidate.siblings, see content-script.js's siblingFields)
// are carried onto the new field drafts as sampleValue — the raw JSON
// value the transform-chain modal's live preview runs against later.
export function buildApiSubtreeFromCandidate(
  candidate: ApiSubtreeCandidate, fieldName: string, siblingNames: string[], skipSegments = 0,
): ApiNodeDraft[] {
  const skeleton = candidate.treeSkeleton.slice(skipSegments);
  const leafField = buildApiFieldDraft(fieldName, skeleton[skeleton.length - 1].path, null, candidate.value);
  const siblingDrafts = siblingNames.map((name) => {
    const sibling = (candidate.siblings || []).find(s => s.name === name);
    return buildApiFieldDraft(name, name, null, sibling ? sibling.value : undefined);
  });
  const groupSegments = skeleton.slice(0, -1);
  const leaves: ApiNodeDraft[] = [leafField, ...siblingDrafts];
  return groupSegments.reduceRight<ApiNodeDraft[]>((children, seg) => [
    { ...buildApiGroupDraft(lastPathSegmentName(seg.path) || t('apiTree.defaultGroupName'), seg.path), children },
  ], leaves);
}

// The absolute JSON path to scope an "add sub-field"/"add sub-group" search
// to an existing ApiGroup at tree `path` — every ancestor's own (relative,
// index-free) path segment gets its first-instance index appended, the same
// "first instance is the template" assumption Container-Mode's own
// scopeSelector already relies on (see content-script.js's
// pathStartsWithScope). E.g. tree path [0, 1] under {path:'categories'} →
// {path:'subcategories'} resolves to "categories[0].subcategories[0]".
export function resolveApiGroupScopePath(groups: ApiNodeDraft[], path: number[]): string {
  let scope = '';
  let nodes = groups;
  for (const index of path) {
    const node = nodes[index] as ApiGroupDraft;
    scope = node.path ? (scope ? `${scope}.${node.path}[0]` : `${node.path}[0]`) : `${scope}[0]`;
    nodes = node.children;
  }
  return scope;
}

// Every {variable: true} part, tagged with its partId — the single source
// of truth for "which parameter cards exist" (independent of whether a
// name has been typed for it yet).
export function variableUrlParts(urlParts: UrlParts): Array<UrlTemplatePart & { id: string }> {
  return [
    ...urlParts.pathSegments.map((seg, i) => ({ ...seg, id: `path:${i}` })),
    ...urlParts.queryParams.map(p => ({ ...p, id: `query:${p.key}` })),
  ].filter(p => p.variable);
}

// Every parameter-source card the API_CONFIG screen shows, regardless of
// where it's actually used from: a variable URL part (variableUrlParts) or
// a body-only parameter declared purely to be referenced from the request
// body (draft.bodyParameters, Issue #55 Phase B4 — see
// openBodyParameterModal/confirmBodyParameterModal). Both shapes carry
// `{id, name}`, which is all renderApiConfigParameters/
// apiConfigDraftHasAllSourcesChosen/confirmApiConfig actually need — a
// body-only entry needs no more than that since its "value" (unlike a URL
// part's) was never itself part of anything else to preserve.
export function allParameterParts(draft: ApiConfigDraft): ParameterPart[] {
  return [...variableUrlParts(draft.urlParts), ...(draft.bodyParameters || [])];
}

// Issue #217: which already-declared parameter names a given part's own
// DiscoverySource.UrlTemplate/BrowserDiscoverySource.DiscoveryUrl could
// legally reference via a "{name}" placeholder — ScrapingPlanValidator
// rejects a reference to the same or a later-declared one, so this is the
// exact set the extension's own "insert parameter" picker should offer.
// allParameterParts(draft) is already in declaration order (URL path
// segments, then query params, then body parameters — the same order
// ApiConfig.Parameters itself ends up in, see buildApiConfig), so "earlier"
// simply means "every named part before partId's own index", with no
// separate reordering concept needed (declaration order IS dependency
// order, per the issue's own deliberately simpler scope). A part not found
// at all (e.g. one just removed) yields an empty list rather than every
// part, the safer default for an already-stale caller.
export function earlierParameterNames(draft: ApiConfigDraft, partId: string): string[] {
  const parts = allParameterParts(draft);
  const index = parts.findIndex(p => p.id === partId);
  if (index < 0) return [];
  return parts.slice(0, index).map(p => p.name?.trim()).filter((name): name is string => !!name);
}

// Gates "Übernehmen" — also the single place guarding against a blank
// field/group name reaching buildApiConfig: a name could always be blanked
// out again on the API_CONFIG screen (renderApiTree's editable name inputs;
// the flat list before Phase A5 had the same gap), so nothing else enforces
// this. draft.groups (Phase A5's tree shape) takes over from the older
// draft.fields shape whenever present — see apiTreeNodesHaveNonBlankNames.
//
// Zero parameters (every URL part left "fest", no body-only parameter
// declared) is a valid config — a fully static endpoint with nothing to
// enumerate over, confirmable the same as a single "fixed" endpoint address
// typed under a variable part would already be. `parts.every(...)` is
// vacuously true on an empty list, so this only needs to validate whatever
// parameters actually exist (Issue #55, Phase B4: `parts` includes
// body-only parameters alongside URL ones, see allParameterParts — a body
// leaf toggled to 'variable' but not yet bound to any parameter still blocks
// confirmation the same way an unchosen source kind already does).
export function apiConfigDraftHasAllSourcesChosen(draft: ApiConfigDraft): boolean {
  const namesOk = draft.groups
    ? apiTreeNodesHaveNonBlankNames(draft.groups)
    : !(draft.fields || []).some(f => !f.name?.trim());
  if (!namesOk) return false;
  const parts = allParameterParts(draft);
  // Issue #220: a bootstrap-sourced URL part takes the bootstrap's own name
  // (see resolveBootstrapUrlParts), so its own name may stay blank — but
  // it, and any header in bootstrap mode, need a bootstrap to exist.
  const partOk = (p: ParameterPart) => draft.parameterSources[p.id]?.kind === BOOTSTRAP_SOURCE_KIND
    ? !!draft.bootstrap
    : !!p.name?.trim() && !!draft.parameterSources[p.id]?.kind;
  if (!parts.every(partOk)) return false;
  if (!bootstrapDraftIsComplete(draft.bootstrap)) return false;
  const bootstrapHeadersOk = Object.values(draft.headerDecisions || {}).every(decision =>
    !decision.include || decision.mode !== 'bootstrap' ||
    (!!draft.bootstrap && (decision.template || '').includes(`{${draft.bootstrap.name.trim()}}`)));
  if (!bootstrapHeadersOk) return false;
  if (!cursorDraftIsComplete(draft.cursorPagination, { method: draft.method, hasBodyTree: !!draft.bodyTree })) return false;
  if (!linkDraftIsComplete(draft.linkHeaderPagination, {
    method: draft.method, embeddedJsonSource: draft.embeddedJsonSource, cursorPagination: draft.cursorPagination,
  })) return false;
  return draft.bodyTree ? bodyTreeLeavesAreBound(draft.bodyTree) : true;
}
