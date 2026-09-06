// Pure, DOM-free helpers for API mode (Issue #53/#54/#55): URL-template
// parsing/building, value-list parsing/merging, parameter-source builders
// (static list/discovery/range), range-format presets/detection, the
// ApiGroup/ApiField response-tree draft (build/resolve/insert/remove/
// serialize/update/validate), the ApiBodyNode request-body draft (build/
// resolve/update/reference-check/bound-check/serialize), and top-level
// ApiConfig assembly. Split out of popup.js (which had grown past 3800 loc)
// purely for readability — no behavior change. Same IIFE-wrapped-single-
// global pattern as shared/logger.js/shared/companion-config.js/i18n/i18n.js
// (see their own doc comments): popup.html loads this as a classic <script>
// before popup.js, which pulls the functions it needs off `self.SFApiConfig`
// — a bare top-level `const`/`function` here would collide with popup.js's
// own declarations, since classic scripts sharing one document all share one
// global scope.
const SFApiConfig = (function () {
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

  // Popup screen names. Lives here (rather than in popup.js, which loads
  // after this module) purely so api-config-ui.js/container-tree-ui.js's
  // event handlers can reference it too; it has no other tie to API mode
  // specifically.
  const STATES = {
    CHECKING_COMPANION: 'CHECKING_COMPANION',
    COMPANION_ERROR:    'COMPANION_ERROR',
    IDLE:               'IDLE',
    SELECTING:          'SELECTING',
    API_CONFIG:         'API_CONFIG', // Issue #53 Phase 5 — configuring a confirmed candidate into an ApiConfig
    GENERATING:         'GENERATING',
    DONE:               'DONE',
  };

  // Generic, dependency-free HTML-escaping helper — lives here for the same
  // reason as STATES above.
  function escapeHtml(str) {
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
  function buildApiConfig({
    urlParts, itemsPath, fields, groups, parameterSources, capturedHeaders, headerDecisions,
    method, bodyTree, bodyParameterNames = [], parameterIdToName = {},
  }) {
    const urlTemplate = buildUrlTemplate(urlParts);
    const variableParts = [...urlParts.pathSegments, ...urlParts.queryParams].filter(p => p.variable);
    const parameterNames = [...variableParts.map(p => p.name), ...bodyParameterNames];
    const parameters = parameterNames.map(name => ({ name, source: parameterSources[name] }));
    const headers = buildApiHeaders(capturedHeaders, headerDecisions);

    return {
      urlTemplate,
      ...(method && method !== 'GET' ? { method } : {}),
      ...(groups ? { groups: serializeApiTree(groups) } : { itemsPath, fields }),
      parameters,
      ...(headers.length > 0 ? { headers } : {}),
      ...(bodyTree ? { body: serializeBodyTree(bodyTree, parameterIdToName) } : {}),
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
  function jsonValueToBodyDraft(value) {
    if (Array.isArray(value)) return { kind: 'array', items: value.map(jsonValueToBodyDraft) };
    if (value !== null && typeof value === 'object') {
      const properties = {};
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
  function resolveBodyTreeNode(node, path) {
    let current = node;
    for (const step of path) current = typeof step === 'number' ? current.items[step] : current.properties[step];
    return current;
  }

  // Immutable "map the one node at `path`" — the body tree's only edit
  // primitive (see this section's own doc comment on why there's no
  // insert/remove here, unlike the response tree's updateApiTreeNode).
  function updateBodyTreeNode(node, path, updater) {
    if (path.length === 0) return updater(node);
    const [step, ...rest] = path;
    if (typeof step === 'number') {
      return { ...node, items: node.items.map((item, i) => (i === step ? updateBodyTreeNode(item, rest, updater) : item)) };
    }
    return { ...node, properties: { ...node.properties, [step]: updateBodyTreeNode(node.properties[step], rest, updater) } };
  }

  // Whether any 'variable' leaf anywhere in the tree is still bound to
  // `parameterId` — used to decide whether reverting one such leaf back to
  // 'literal' also orphans the body-only parameter it referenced (see
  // toggleBodyLeafToFixed).
  function bodyTreeReferencesParameterId(node, parameterId) {
    if (node.kind === 'object') return Object.values(node.properties).some(child => bodyTreeReferencesParameterId(child, parameterId));
    if (node.kind === 'array') return node.items.some(child => bodyTreeReferencesParameterId(child, parameterId));
    return node.kind === 'variable' && node.parameterId === parameterId;
  }

  // Gates "Übernehmen" alongside apiConfigDraftHasAllSourcesChosen's own
  // per-parameter check: a leaf toggled to 'variable' but not yet bound to a
  // parameter (parameterId still null, see toggleBodyLeafToVariable) must
  // block confirmation the same way an unchosen source kind already does.
  function bodyTreeLeavesAreBound(node) {
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
  function serializeBodyTree(node, parameterIdToName) {
    if (node.kind === 'object') {
      const properties = {};
      for (const [key, child] of Object.entries(node.properties)) properties[key] = serializeBodyTree(child, parameterIdToName);
      return { properties };
    }
    if (node.kind === 'array') {
      return { items: node.items.map(item => serializeBodyTree(item, parameterIdToName)) };
    }
    if (node.kind === 'variable') {
      return {
        parameterName: parameterIdToName[node.parameterId],
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
      case 'String': return { kind: 'String', stringValue: node.value };
      case 'Number': return { kind: 'Number', numberValue: node.value };
      case 'Boolean': return { kind: 'Boolean', boolValue: node.value };
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

  // Every {variable: true} part, tagged with its partId — the single source
  // of truth for "which parameter cards exist" (independent of whether a
  // name has been typed for it yet).
  function variableUrlParts(urlParts) {
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
  function allParameterParts(draft) {
    return [...variableUrlParts(draft.urlParts), ...(draft.bodyParameters || [])];
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
  function apiConfigDraftHasAllSourcesChosen(draft) {
    const namesOk = draft.groups
      ? apiTreeNodesHaveNonBlankNames(draft.groups)
      : !(draft.fields || []).some(f => !f.name?.trim());
    if (!namesOk) return false;
    const parts = allParameterParts(draft);
    if (!parts.every(p => !!p.name?.trim() && !!draft.parameterSources[p.id]?.kind)) return false;
    return draft.bodyTree ? bodyTreeLeavesAreBound(draft.bodyTree) : true;
  }

  return {
    STATES, escapeHtml,
    parseUrlTemplateParts, buildUrlTemplate, parseValueListInput, findUrlTemplateMatches, mergeValueListValues,
    buildStaticListSource, buildDiscoverySource, buildRangeSource, RANGE_FORMAT_PRESETS,
    compileRangeFormatPattern, detectRangeFormat, findUrlPartValue, rangeFormatExample,
    buildApiHeaders, buildApiConfig,
    buildApiGroupDraft, buildApiFieldDraft, resolveApiTreeNode, insertApiTreeNode, removeApiTreeNode,
    serializeApiTree, countApiConfigFields, updateApiTreeNode, apiTreeNodesHaveNonBlankNames,
    jsonValueToBodyDraft, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId,
    bodyTreeLeavesAreBound, serializeBodyTree, lastPathSegmentName, buildApiSubtreeFromCandidate,
    resolveApiGroupScopePath, variableUrlParts, allParameterParts, apiConfigDraftHasAllSourcesChosen,
  };
})();

if (typeof module !== 'undefined') module.exports = SFApiConfig;
if (typeof self !== 'undefined') self.SFApiConfig = SFApiConfig;
