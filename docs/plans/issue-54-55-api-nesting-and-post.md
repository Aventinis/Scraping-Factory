# Implementation Plan — Issue #54 (nested JSON API responses) + Issue #55 (POST/GraphQL request bodies)

> Status: planning only, no code written yet. Both source issues (#54, #55) explicitly say "don't implement until a real use case arises — just documenting the decision." This plan exists because the repo owner wants the extension ready for heavy use on another project before that need materializes, and is knowingly overriding that guidance for preparatory reasons. Each phase below is independently useful/shippable, with a sensible stop-and-reassess point after every phase — implementation is not assumed to land in one sitting, and may be picked up by a different session than the one that wrote this plan.

This plan is grounded in a reading of the current source — `ApiConfig.cs`, `ContainerNode.cs`, `ContainerNodeJsonConverter.cs`, `ScrapingPlanValidator.cs`, `ScrapingPlanBuilder.cs`, `ScrapingConfig.cs`, `PythonApiCodeGenerator.cs`, `PythonApiConfigLiteral.cs`, `scraper_api.py.j2`, `PythonGroupTreeLiteral.cs`, `scraper_grouped.py.j2`, `Program.cs`, `api-capture.js`, `content-script.js`, `popup.js`, `LocalTestServer.cs`, `PythonApiScriptVerifierTests.cs`, `ApiParameterSourceJsonTests.cs`, `ScrapingPlanValidatorTests.cs`/`ScrapingPlanBuilderTests.cs`, and the `test-pages/` directory (confirmed: no existing test page performs `fetch()`/XHR against a local JSON API — API mode was manually tested against real public APIs, so Phase 0 below is genuinely new infrastructure, not a rename of something existing).

Every phase below is scoped to be finishable and leave the repo in a green (`dotnet test` + `npm test`/Jest) state on its own. Each phase's "Done" section doubles as the stop-and-reassess checkpoint.

Confirmed ordering decisions (already made by the repo owner, not open for re-litigation):

- A shared local test-fixture server comes first, as its own Phase 0, before any product code changes.
- Track A (Issue #54, nested JSON responses) is designed/implemented before Track B (Issue #55, POST/GraphQL), because GraphQL (the main motivator for #55) almost always returns nested JSON anyway, so #54 lands as a complete, independently useful improvement first, and its tree-editor UI can conceptually be reused for #55's request-body marking UI later.

---

## Phase 0 — Shared local test-fixture server

**Files added:**
- `test-pages/api-nested-and-post/server.py` (new)
- `test-pages/api-nested-and-post/index.html` (new)

**Why a new kind of test fixture.** Every existing `test-pages/*` entry (`login-flow`, `speisekarte`, `infinite-scroll`, `iframe-shadow-dom`) is static HTML with no server-side logic — opened directly, no backend needed. Nested JSON and POST/GraphQL responses need actual server logic (filter by query param / body / GraphQL variables, return realistically deep nesting), so this fixture needs a real, tiny HTTP server. Per CLAUDE.md, `python3` is already a hard runtime requirement for the companion app itself, so a **stdlib-only `http.server` subclass** is the correct choice — it adds no dependency beyond what's already mandatory, and (unlike, say, spinning up a Node/Express fixture) it means anyone who can already run the companion can run this fixture.

**Design — `server.py`:**
- `ThreadingHTTPServer` + a `BaseHTTPRequestHandler` subclass, hardcoded port (recommend `8600`, clearly outside the companion's `5000` and any typical dev-server range), started via `python3 test-pages/api-nested-and-post/server.py`.
- Serves `index.html` (read from the same directory via `Path(__file__).parent`) at `GET /` and `GET /index.html` — so the fixture page and the JSON API it calls are **same-origin**, sidestepping any CORS/`file://`-origin complications entirely (mirrors why the companion itself binds a fixed local port rather than relying on `file://`).
- One shared in-memory "catalog" dataset and one `_filter_catalog(category=None, max_price=None)` function reused by every endpoint below, so GET-query-param, POST-body, and GraphQL-variables filtering all exercise identical server logic instead of three copies that could drift.
- **`GET /api/catalog[?category=&maxPrice=]`** → three levels of real nesting, deliberately exercising every structural case the issue calls out:
  ```json
  {
    "meta": { "generatedAt": "2026-09-04T00:00:00Z" },
    "categories": [
      {
        "id": "electronics", "name": "Elektronik",
        "subcategories": [
          {
            "id": "phones", "name": "Telefone",
            "products": [
              { "sku": "P-100", "title": "Smartphone X", "price": 499.0, "tags": ["neu", "bestseller"] },
              { "sku": "P-101", "title": "Smartphone Y", "price": 299.0, "tags": ["sale"] }
            ]
          },
          { "id": "laptops", "name": "Laptops", "products": [ /* … */ ] }
        ]
      },
      { "id": "books", "name": "Bücher", "subcategories": [ /* … */ ] }
    ]
  }
  ```
  `categories[*]` → `subcategories[*]` → `products[*]` gives three independent repeating levels, and `products[*].tags[*]` gives a plain array-of-scalars leaf, covering the issue's "arrays of arrays / objects with nested arrays" cases in one payload without over-engineering a second endpoint.
- **`POST /api/search`** — body `{"category": "electronics", "maxPrice": 500}` (any subset), response is the same catalog shape, filtered — exercises a plain arbitrary-JSON POST.
- **`POST /graphql`** — body `{"query": "...", "variables": {"category": "electronics"}}`, response `{"data": {"categoryProducts": <filtered catalog>}}` — reuses the identical filter function, wrapped in a GraphQL envelope, making concrete exactly the case the issue describes: fixed query text + a separate, genuinely variable `variables` object.
- Also returns a real `404` for an unknown `category` value on `/api/catalog`, so the fixture can be used to manually re-confirm API-mode's existing "404 = skip this combination" behavior still holds once nested/POST codegen changes the request path.

**Design — `index.html`:** A plain page (no framework) that on load performs three `fetch()` calls (`GET /api/catalog`, `POST /api/search` with a fixed demo body, `POST /graphql` with a fixed demo query+variables) and renders each result as nested `<ul>`/`<li>` markup — so every leaf value (a product title, a price, a tag) is visible, clickable page text, which is what API-mode's click-based candidate search (`onClick`/`findApiCandidates`) needs to correlate against the recorded network traffic. Also exposes three buttons ("Katalog neu laden", "Suche (POST)", "GraphQL-Query") to re-fire each call on demand (useful for re-triggering a request after starting recording, since the page's own `onload` fetches would otherwise race extension recording start).

**Open decision — should this fixture also back the companion's automated tests?** No. Recommend keeping it a **manual QA fixture only**, exactly like `test-pages/login-flow`. Companion tests use `LocalTestServer` (C#, in-process, no separate process to manage, request-aware responder lambdas) and should keep doing so for every new automated test in Tracks A/B — `LocalTestServer` is faster, has no port-conflict/startup-race concerns in CI, and is already the established pattern (`PythonApiScriptVerifierTests`). This fixture's job is giving a human a realistic, repeatable, non-flaky target to record real extension traffic against, and giving every later phase a single documented JSON shape to reference instead of inventing ad hoc examples.

**Done when:**
- `python3 test-pages/api-nested-and-post/server.py` starts cleanly and `http://127.0.0.1:8600/` loads in a real browser tab with the unpacked extension installed.
- Starting API-mode recording, using the page's buttons, and stopping recording shows exactly 3 entries (GET catalog, POST search, POST graphql) in the existing "Aufgezeichnete Anfragen anzeigen" panel, with correct methods/content-types.
- Manually clicking a product title 2+ levels deep (e.g. inside `categories[*].subcategories[*].products[*].title`) with API search active demonstrates **today's existing limitation** end-to-end: `findApiCandidates`/`deriveItemsAndValuePath` still only splits at the *last* array boundary, so the candidate's derived `itemsPath` collapses the outer `categories[n]`/`subcategories[n]` indices into literals instead of describing two more repeating levels. Confirming this concretely (not just via the issue text) is the actual point of doing Phase 0 first — it gives every later phase a reproducible "before" baseline to diff against.

---

# Track A — Issue #54: nested JSON API responses

## A1 — Companion IR, wire format, and validation

**Files touched:**
- `companion/ScrapingFactory.Compiler/IR/ApiConfig.cs`
- `companion/ScrapingFactory.Compiler/IR/ApiNodeJsonConverter.cs` (new)
- `companion/ScrapingFactory.Compiler/IR/ScrapingPlanBuilder.cs`
- `companion/ScrapingFactory.Compiler/IR/ScrapingPlanValidator.cs`
- `companion/ScrapingFactory.Companion/Program.cs`
- `companion/ScrapingFactory.Tests/ApiNodeJsonConverterTests.cs` (new)
- `companion/ScrapingFactory.Tests/ScrapingPlanValidatorTests.cs`, `ScrapingPlanBuilderTests.cs`

**Type design (the central decision of this whole track).**

```csharp
public abstract class ApiNode { public required string Name { get; init; } }

// Existing type, made a leaf variant of ApiNode. Zero shape change — still
// exactly {Name, Path} — so the legacy ApiConfig.Fields: List<ApiField>
// path is 100% source- and wire-compatible.
public sealed class ApiField : ApiNode { public required string Path { get; init; } }

public sealed class ApiGroup : ApiNode
{
    // Relative to the parent scope: the whole parsed response body for a
    // root group, or one already-matched instance of the parent group's own
    // resolved value for a nested one — same "relative to parent scope"
    // convention GroupNode.Selector already uses for CSS. May be "" to mean
    // "operate directly on the parent scope itself", needed to express two
    // directly-nested repeating levels with no object key between them
    // (a raw array-of-arrays).
    public required string Path { get; init; }
    public required List<ApiNode> Children { get; init; }
    // Deliberately NO Repeating flag — see Architecture Decision below.
}

public sealed class ApiConfig
{
    public string Method { get; init; } = "GET";
    public required string UrlTemplate { get; init; }
    public List<ApiHeader>? Headers { get; init; }
    public List<ApiParameter> Parameters { get; init; } = [];

    // Legacy flat shape (Issue #53 Phase 1). Now optional — see migration
    // decision below. Both null together, or both set together.
    public string? ItemsPath { get; init; }
    public List<ApiField>? Fields { get; init; }

    // New recursive shape (Issue #54). Mutually exclusive with ItemsPath/
    // Fields. Root must be a group (mirrors ScrapingConfig.Groups: List
    // <GroupNode>, never a bare field) — a group's own Path is evaluated
    // directly against the parsed response body, exactly where ItemsPath
    // used to be evaluated. A single root ApiGroup with Path == the old
    // ItemsPath and one ApiField child per old Fields entry is exactly
    // equivalent to the legacy flat shape.
    public List<ApiGroup>? Groups { get; init; }
}
```

**Open decision 1 — "Repeating": explicit flag vs. inferred from JSON structure.**
Recommendation: **inferred, no flag at all** — a stronger version of what the issue tentatively suggests. `GroupNode.Repeating` exists specifically because a CSS selector's match *count* is a transient runtime fact that could change page to page (the doc comment says exactly this: "chosen explicitly by the user, never inferred from match count"). JSON doesn't have that ambiguity: whether resolving a given path yields an array or an object/scalar is a structural property of the API's schema, stable across requests, not a count that could vary. So `ApiGroup` simply has no `Repeating` property — at runtime, resolving `Path` against the parent scope either yields a JSON array (iterate every element, N instances) or doesn't (treat as a single instance, 0 or 1). This is strictly simpler than `GroupNode` and is directly justified by the CSS/JSON asymmetry the issue itself raises — a good, citable "Architecture Decision" entry for CLAUDE.md.

**Open decision 2 — discriminator: structural (`ContainerNodeJsonConverter`-style) vs. explicit `"kind"` tag (`ApiParameterSource`-style).**
Recommendation: **structural**, i.e. write `ApiNodeJsonConverter` as a close copy of `ContainerNodeJsonConverter` (sniff for a `"children"` property to distinguish `ApiGroup` from `ApiField`). `ApiParameterSource` needed an explicit tag specifically because its three variants (`StaticListSource`/`DiscoverySource`/`RangeSource`) have *no* natural structural tell from each other. `ApiGroup` vs. `ApiField` has the exact same asymmetry as `GroupNode` vs. `DataFieldNode` (branch has `Children`, leaf doesn't) — the reason that pushed `ApiParameterSource` toward an explicit tag simply doesn't apply here, so reusing the cheaper structural approach is the more consistent call. Note precisely **where** the converter is needed: only for `ApiGroup.Children: List<ApiNode>` (a mixed list) — the outer `ApiConfig.Groups: List<ApiGroup>` is non-polymorphic and needs no converter, exactly mirroring how `ScrapingConfig.Groups: List<GroupNode>` needs none but `GroupNode.Children: List<ContainerNode>` does.

**Open decision 3 — migration: breaking vs. additive.**
Recommendation: **additive**, at the cost of one source-level (not wire-level) breaking change: `ApiConfig.ItemsPath`/`Fields` go from `required` to nullable. This is not a wire/JSON break — every existing extension payload and every already-recorded config keeps parsing and behaving identically. It *is* a source break for any direct C# object-initializer that relied on `required` — acceptable: it avoids ever having two redundant, potentially-drifting representations of the same config, and mirrors the existing pattern one level up (`ScrapingConfig.Fields`/`Groups`/`Api` are mutually exclusive optional alternatives, not layered on top of each other).

**`ScrapingPlanValidator.ValidateApiConfig` changes:**
1. Compute `hasFlat = ItemsPath is not null || Fields is not null` and `hasGroups = Groups is { Count: > 0 }`. Reject if both, reject if neither. Reject a partially-set flat shape (`ItemsPath` set but `Fields` null, or vice versa) as a distinct, clearer error than letting it fall through to a null-ref.
2. If `hasFlat`: keep every existing check #2–#9 verbatim (unchanged).
3. If `hasGroups`: new recursive `ValidateApiNodes(IEnumerable<ApiNode> nodes)`, mirroring `ValidateContainerNodes` closely:
   - Non-empty `Name` per node.
   - `ApiGroup`: `Path` may be `""` but not null; `Children.Count > 0` (an empty group produces nothing — reject).
   - `ApiField`: `Path` non-empty.
   - Recurse into `ApiGroup.Children`.
   - After the recursive walk: require **at least one `ApiField` reachable anywhere in the tree**.
   - **Do not** port the flat-mode duplicate-field-name check or the field/parameter name collision check into the tree path — both existed only because flat mode's output is CSV, where column names must be globally unique. Once tree mode outputs XML (see A2), duplicate sibling names are exactly as fine as they already are in container mode. This is a deliberate, explicit non-port, worth a one-line comment.
   - JSON-path syntax itself stays deliberately unvalidated, same laissez-faire as everywhere else in this file.
4. `Parameters`/`UrlTemplate` placeholder cross-checks (existing checks #10–#12) are unaffected either way.

**`ScrapingPlanBuilder` change:** the `Api` branch currently hardcodes `OutputFormat.Csv`. Change to:
```csharp
var outputFormat = api.Groups is { Count: > 0 } ? OutputFormat.Xml : OutputFormat.Csv;
```
and use `outputFormat` in the returned `ScrapingPlan` — everything else in that branch is unchanged.

**`Program.cs` change:** register `new ApiNodeJsonConverter()` in `ConfigureHttpJsonOptions`, alongside the existing `ContainerNodeJsonConverter`. No change to the `/generate` mutual-exclusivity gate — `Groups` lives *inside* `ApiConfig`, not as a new top-level `ScrapingConfig` field.

**Done when:** `dotnet test` green, including: `ApiNodeJsonConverterTests` (round-trip a 3-level `ApiGroup` tree, confirm `ApiField` still round-trips unchanged standalone), new `ScrapingPlanValidatorTests`/`ScrapingPlanBuilderTests` cases (both-set/neither-set rejection, empty-children rejection, no-leaf-anywhere rejection, `OutputFormat.Xml` forced when `Groups` is set, `OutputFormat.Csv` still forced for the flat shape). No codegen exists yet — a `Groups`-based `/generate` request would pass validation but fail at codegen (A2 not done yet); that's an expected, temporary state, exactly mirroring how Issue #53's own Phase 1 shipped IR+validation before Phase 2's codegen.

---

## A2 — Companion codegen and verification

**Files touched:**
- `language-modules/python/templates/scraper_api_grouped.py.j2` (new)
- `companion/ScrapingFactory.Compiler/Backends/Python/PythonApiCodeGenerator.cs`
- `companion/ScrapingFactory.Compiler/Backends/Python/PythonApiConfigLiteral.cs`
- `companion/ScrapingFactory.Tests/PythonApiCodeGeneratorTests.cs`, `PythonApiScriptVerifierTests.cs`

**Why a second template file, not an `if` inside `scraper_api.py.j2`.** Exactly the precedent `PythonCodeGenerator` already set for container mode: `scraper.py.j2` (flat) and `scraper_grouped.py.j2` (tree) are two separate templates, and `PythonCodeGenerator.Generate()` picks between them by checking for an `ExtractGroupStep`. `PythonApiCodeGenerator` (registered once for `("python", Api)`) must do the same internal branch: check `api.Groups is { Count: > 0 }` and pick `scraper_api_grouped.py.j2` instead of `scraper_api.py.j2`.

**Runtime design — key insight to reuse, not reinvent.** `scraper_api.py.j2` already has `_resolve_items(data, path)`, which resolves `path` and, if the result is a list (or a list of lists), flattens one level; otherwise returns the single match as-is. This function *already has exactly the right semantics* for "N instances if the resolved value is an array, at most 1 instance otherwise" — the same semantics A1 assigns to `ApiGroup`'s inferred repeating-ness, and it already handles the `Path == ""` array-of-arrays case correctly. So the new grouped template needs **no new path-resolution primitive** — only a new recursive tree-walk driver, mirroring `extract_group()`:

```python
def _extract_api_group(scope, node):
    if "children" in node:
        instances = _resolve_items(scope, node["path"]) if node["path"] else _resolve_items(scope, "")
        elements = []
        for instance in instances:
            el = ET.Element(node["name"])
            for child in node["children"]:
                result = _extract_api_group(instance, child)
                (el.extend(result) if isinstance(result, list) else el.append(result))
            elements.append(el)
        return elements

    el = ET.Element(node["name"])
    value = _resolve_field(scope, node["path"])   # existing helper: first match or None
    el.text = "" if value is None else str(value)
    return el
```
(API-mode fields have no `Mode`/`Attribute`/`Exists` concept — `ApiField` only ever has `Name`+`Path` — so the leaf branch is simpler than container mode's.) Multiple root groups are wrapped in the same `<Ergebnis>` element container mode already uses.

**`PythonApiConfigLiteral.RenderGroups(List<ApiGroup>)`**: new method, structurally a direct copy of `PythonGroupTreeLiteral.Render`, emitting `{"name": ..., "path": ..., "children": [...]}` for groups and `{"name": ..., "path": ...}` for fields — "children" present/absent is the exact discriminator the runtime `_extract_api_group` reads.

**`PythonApiCodeGenerator.Generate()`**: branch on `api.Groups is { Count: > 0 }`; for the grouped path, load `scraper_api_grouped.py.j2` and pass `groups_literal = PythonApiConfigLiteral.RenderGroups(api.Groups)`, `root_names`, plus the same `url_template_literal`/`parameters_literal`/`headers_literal`/`needs_os_import`/filenames the flat template already gets (parameter/URL/header handling is completely unchanged).

**Done when:** `PythonApiCodeGeneratorTests` cover a 3-level tree's generated source (substring assertions). `PythonApiScriptVerifierTests` add real end-to-end cases against `LocalTestServer` serving a shape mirroring Phase 0's catalog, asserting `result.Success` and inspecting `output.xml`'s element count/nesting the way `PythonScriptVerifierTests` already inspects container-mode XML output. At this point, hand-crafting an `ApiConfig` with `Groups` set and POSTing it directly to `/generate` already produces a working nested-XML scraper — **a genuine, independently useful stop-and-reassess point**: the backend half of #54 is fully provable before any extension UI work starts.

---

## A3 — Extension: multi-level JSON path derivation (content-script.js)

**Files touched:**
- `extension/content/content-script.js`
- `extension/content/content-script.test.js` (if present — same pattern as other pure-function `describe` blocks)

**What changes.** `deriveItemsAndValuePath(matchPath)` today finds only the *last* `[n]` bracket in a match path and splits there. Replace it with a function that finds **every** bracket boundary and returns a full tree skeleton:

```js
// Generalizes deriveItemsAndValuePath: walks every "[n]" boundary in
// matchPath (not just the last), producing one segment per repetition
// level plus a final leaf segment. E.g. "data.categories[2].subcategories
// [0].products[5].title" becomes:
//   [ { kind: 'group', path: 'data.categories' },
//     { kind: 'group', path: 'subcategories' },
//     { kind: 'group', path: 'products' },
//     { kind: 'field', path: 'title' } ]
// path fields are always relative to the *previous* segment's matched
// instance, mirroring ApiGroup.Path's own "relative to parent scope"
// convention. Returns null when matchPath never enters an array at all
// (same as deriveItemsAndValuePath today).
function deriveApiTreeSkeleton(matchPath) { /* ... */ }
```
Algorithm: tokenize with the existing `pathTokens`; find every array-bracket token; for each boundary in order, emit a `group` segment whose `path` spans from just after the previous array index to just before the current array's index token; after the last bracket, the remaining tail becomes the final `field` segment. **Keep `deriveItemsAndValuePath` itself unchanged** and reimplement it as a one-line special case of the new function — `DiscoverySource.ItemsPath`/`ValuePath` are still genuinely single-level by design (A1 didn't touch `DiscoverySource`), so that call site keeps using the 2-segment form unchanged.

**`siblingFields` becomes ancestor-chain-aware.** Generalize into `siblingFieldsAt(data, scopeTokens)`; `siblingFields(data, matchPath)` becomes a thin wrapper calling `siblingFieldsAt(data, pathTokens(matchPath).slice(0, -1))`, so existing callers/tests keep working unchanged.

**Scoped candidate search for adding nested nodes.** Extend `findApiCandidates(entries, targetText, scopePath = null)` — when set, only matches whose own path starts with `scopePath` are kept. This is the direct JSON-side analogue of container mode's `scopeSelector` mechanism.

**Message wiring:** `START_SELECTION`'s `apiSearch` boolean gains a companion `scopePath`/`apiScopePath` field, passed through `onClick` to `findApiCandidates`. Keep additive — undefined/null must reproduce today's whole-pool-search behavior exactly.

**Done when:** new Jest unit tests cover: a 3-level match producing a 4-segment skeleton against Phase 0's catalog shape; a 1-level match still producing the old 2-segment form; `siblingFieldsAt` at a non-root scope; `findApiCandidates` with a `scopePath` correctly excluding a same-named field under a *different* category/subcategory. No UI yet — pure-function phase, directly testable in isolation.

---

## A4 — Extension: API-mode tree-editor UI (rendering + pure draft helpers)

**Files touched:**
- `extension/popup/popup.js`
- `extension/popup/popup.html` (new screen elements)
- `extension/popup/popup.css` (or wherever `.group-tree-*` styles live)
- `extension/popup/popup.test.js`

**Draft shape**, mirroring the container-mode draft:
```js
function buildApiGroupDraft(name, path)              { return { kind: 'group', name, path, children: [] }; }
function buildApiFieldDraft(name, path)               { return { kind: 'field', name, path }; }
function resolveApiTreeNode(groups, path)              { /* mirrors resolveGroupNode */ }
function insertApiTreeNode(groups, parentPath, node)   { /* mirrors insertContainerNode, immutable */ }
function removeApiTreeNode(groups, path)               { /* mirrors removeGroupTreeNode, immutable */ }
function serializeApiTree(groups)                      { /* strips draft-only kind, shapes exactly like wire ApiGroup/ApiField */ }
```
These are near-verbatim renames of the existing container-mode helpers — the tree machinery is generic over "a node has a name, is a group-with-children or a leaf" and needed essentially no new *shape* thinking, only new field names (`path` instead of `selector`, no `mode`/`attribute`/`repeating`/`framePath`).

**Rendering**, mirroring `renderGroupTree`/`buildGroupTreeNodeEl`:
```js
function buildApiTreeNodeEl(node, path, depth) { /* same <li>/expand-collapse/add-buttons pattern */ }
function renderApiTree(groups)                 { /* same root rebuild pattern */ }
```
Row content differs (`node.path` shown instead of `node.selector`; no repeating/attribute/mode label). Per-group "add sub-group"/"add sub-field" buttons and a per-row remove button carried over unchanged in spirit.

**Done when:** popup tests cover the pure helpers (insert/remove/resolve/serialize round-tripping a 3-level hand-built draft tree into exactly the A1 wire shape) and a render-only test confirming a 3-level tree renders the right nesting/indentation and the right buttons per node kind. No event wiring or mode integration yet (that's A5).

---

## A5 — Extension: wiring the tree editor into API mode

**Files touched:**
- `extension/popup/popup.js` (event wiring, `buildApiConfig`, `apiConfigDraftHasAllSourcesChosen`, `MODE_SWITCH_CLEARS`, `persistState`)
- `extension/content/content-script.js` (message handler wiring for A3's scoped search)
- `extension/popup/popup.test.js` (integration tests)

**Root/primary field flow** (replaces today's `confirmApiFieldCandidate`): use A3's `deriveApiTreeSkeleton(candidate.path)` to build a full nested draft with the clicked value's field name applied to the final leaf, and any picked sibling chips added as extra `ApiField` leaves at the *innermost* group's scope.

**Adding nested groups/fields to an already-confirmed tree**: a "add sub-field"/"add sub-container" button on an `ApiGroup` row starts a new click-based JSON search (`scopePath` computed from the target group's own resolved path prefix), and the confirmed candidate is inserted via `insertApiTreeNode` — using the same two UX orders container mode already established: a new **group** asks name first, a new **field** asks name after picking a value.

**`buildApiConfig`** gains a tree-vs-flat branch: when the draft has a tree, emit `{ urlTemplate, groups: serializeApiTree(...), parameters, headers }` (no `itemsPath`/`fields`); otherwise keep emitting today's flat shape unchanged. `apiConfigDraftHasAllSourcesChosen` needs a tree-aware recursive "every node has a non-blank name" check.

**Open decision — does the popup keep exposing *both* the old flat single-level UI and this new tree UI, or does the tree UI fully replace it?** Recommend: **the tree UI subsumes the flat case, no separate UI mode.** A single top-level match renders as a one-node-deep tree — visually almost identical to today's flat list, just wrapped in the same tree-editor chrome. This avoids maintaining two parallel API-mode config screens indefinitely and matches container mode's own precedent. The A1 wire format keeps the legacy `ItemsPath`/`Fields` shape *available*, but the popup only ever emits the new `Groups` shape going forward.

**Done when:** end-to-end popup integration tests cover: recording against a 3-level fixture-shaped payload → clicking a deep value → confirming → adding a sibling field at the innermost level via a scoped search → adding an entirely separate second root group → confirming the whole config → asserting the exact `Groups` JSON sent to `/generate` matches A1's wire shape. Manual verification against Phase 0's live fixture end-to-end (record → click → build tree → generate → run) is the real acceptance bar for this phase, since it's the first point the whole vertical slice exists together.

---

## A6 — Documentation

**Files touched:** `CLAUDE.md`

- Move "recursive tree like in container mode" out of "Planned for Future Releases," add a Feature Scope bullet describing nested API-mode extraction (tree editor, XML output, multi-level scoped search).
- New Architecture Decision entries: (1) `ApiGroup`'s repeating-ness is inferred from JSON array-ness, not an explicit flag, with the CSS-vs-JSON structural-ambiguity justification; (2) `ApiNode` uses the structural discriminator, contrasted explicitly with `ApiParameterSource`'s tag-based approach; (3) API-mode output format is now conditional on shape (flat → Csv, tree → Xml), reconciled with the existing CLAUDE.md line, clarifying the real rule was always "flat data → CSV, tree data → XML."
- Update the Python Templates section to mention `scraper_api_grouped.py.j2` alongside `scraper_grouped.py.j2`.

**Done when:** CLAUDE.md accurately describes the shipped feature with no remaining "GET only / one repetition level" caveats for the tree path.

---

# Track B — Issue #55: POST/GraphQL request bodies

## B1 — Extension: request-body capture

**Files touched:**
- `extension/content/api-capture.js`
- `extension/content/api-capture.test.js`
- `extension/popup/popup.js` (`renderApiEntriesList`)

**Fetch interception**: today, `window.fetch`'s patch reads headers but never touches `args[1]?.body` or the `Request`'s own body. Add the same precedence pattern already used for headers: read `args[1]?.body` first; if absent and `args[0] instanceof Request`, read the body via `request.clone().text()` (mirrors how the response body is already read). A `body` that isn't a string (FormData/Blob/ArrayBuffer/URLSearchParams) is recorded as **not capturable** — mirror the existing `bodySkipped` convention with a new `requestBodySkipped: true`. Deliberate v1 scope line: JSON-string bodies are captured; form-encoded/multipart bodies are not, flagged explicitly next to the file's existing "Known limitations" comment.

**XHR interception**: `XMLHttpRequest.prototype.send(body)` today passes `args` straight through untouched. Capture `args[0]` the same way (string body only; anything else → `requestBodySkipped`).

**New captured-entry fields**: `requestBody`, `requestBodyTruncated`, `requestBodySkipped` — reuse the existing `MAX_BODY_CHARS`/`truncateBody` for the request side too rather than a second magic number.

**Popup surface**: extend `renderApiEntriesList` to show a captured POST/PUT entry's body (or a "[nicht erfasst]" note when skipped) — independently useful with zero backend/config changes.

**Done when:** `api-capture.test.js` covers a `fetch(url, {method:'POST', body: JSON.stringify(...)})` call, a `Request`-object-with-body call, an XHR `.send(jsonString)` call, and a `FormData` body correctly setting `requestBodySkipped`. Manual check against Phase 0's fixture (`/api/search`, `/graphql`) confirms both captured bodies show up in the popup's recorded-entries panel.

---

## B2 — Companion IR, wire format, and validation

**Files touched:**
- `companion/ScrapingFactory.Compiler/IR/ApiConfig.cs`
- `companion/ScrapingFactory.Compiler/IR/ApiBodyNode.cs` (new)
- `companion/ScrapingFactory.Compiler/IR/ApiBodyNodeJsonConverter.cs` (new)
- `companion/ScrapingFactory.Compiler/IR/ScrapingPlanValidator.cs`
- `companion/ScrapingFactory.Companion/Program.cs`
- `companion/ScrapingFactory.Tests/ApiBodyNodeJsonConverterTests.cs` (new), `ScrapingPlanValidatorTests.cs`

**Open decision — is a "variable body value" just another `ApiParameter`, or a new concept?** Recommend: **it's just another `ApiParameter`**, referenced from inside the body tree by name — reusing 100% of the existing `ApiParameterSource` machinery unchanged. The only genuinely new concept is *where else* a parameter can be referenced from.

**Open decision — flat string template or a typed tree?** Recommend: **a typed tree**, specifically because of GraphQL's `variables` object — GraphQL variables are genuinely typed JSON (numbers, booleans, arrays, objects), and a text-splicing approach forces every substituted value to be a JSON *string*, wrong for numeric/boolean variables. A typed tree also composes naturally with a tree-shaped editor UI (B4), reusing Track A's pattern — worth stating explicitly that this is the "overlap, not identity" the issue itself flags between #54 and #55.

```csharp
// Request-body construction tree (Issue #55) — the mirror image of
// ApiGroup/ApiField's response-extraction tree: describes what JSON value
// to WRITE at this position of the outgoing request body, not where to
// read one FROM an already-received response. A leaf is either a fixed
// literal (ApiBodyLiteral) or a reference to one of ApiConfig.Parameters
// by name (ApiBodyVariable), resolved per request from that parameter's
// Source — reusing the identical ApiParameter/ApiParameterSource
// machinery rather than inventing a second, body-specific value-source.
public abstract class ApiBodyNode { }

public sealed class ApiBodyObject : ApiBodyNode
{ public required Dictionary<string, ApiBodyNode> Properties { get; init; } }

public sealed class ApiBodyArray : ApiBodyNode
{ public required List<ApiBodyNode> Items { get; init; } }

public enum ApiBodyLiteralKind { String, Number, Boolean, Null }

public sealed class ApiBodyLiteral : ApiBodyNode
{
    public required ApiBodyLiteralKind Kind { get; init; }
    public string? StringValue { get; init; }
    public double? NumberValue { get; init; }
    public bool? BoolValue { get; init; }
}

public sealed class ApiBodyVariable : ApiBodyNode
{
    public required string ParameterName { get; init; } // cross-checked against ApiConfig.Parameters
    // Best-effort: an unparsable resolved value falls back to a plain JSON
    // string at runtime rather than crashing the run (see _render_body's
    // coercion branch, B3) — a strictly-typed GraphQL server rejecting a
    // stringified number is a target-site problem this can only mitigate,
    // since every ApiParameterSource value is string-typed end to end.
    public ApiBodyLiteralKind? CoerceTo { get; init; }
}
```
`ApiConfig` gains `public ApiBodyNode? Body { get; init; }`.

**Discriminator**: structural for the outer 4-way split (`ApiBodyNodeJsonConverter`: presence of `"properties"` → object, `"items"` → array, `"parameterName"` → variable, else → literal), with `ApiBodyLiteral` internally keeping its own explicit `Kind` tag (structural sniffing can't safely distinguish "no value" from "literal null" or reliably tell a number from a numeric-looking string without one).

**`ScrapingPlanValidator.ValidateApiConfig` changes:**
1. Method check relaxes from `!= "GET"` to `is not ("GET" or "POST")`. `DiscoverySource`'s own method check is **not** relaxed — discovery endpoints stay GET-only, explicitly flagged as an intentional non-goal to keep scope bounded.
2. New: `Body is not null && Method != "POST"` → reject. `Method == "POST"` with `Body == null` stays valid (a bodyless POST).
3. New recursive `ValidateApiBodyNode` — walks Object/Array (recurse), Literal (Kind/value-field consistency), Variable (`ParameterName` must be a known parameter name; collect into a "referenced-by-body" set).
4. The existing UrlTemplate placeholder-vs-parameter cross-check's *unused-parameter* half generalizes to: every declared parameter must be referenced by `UrlTemplate` **or** the body tree. The *unknown-placeholder* half stays untouched — body references get their own direct "unknown parameter referenced by body" check.
5. `Body` (request-side) and `Groups`/tree-vs-flat (response-side, Track A) are fully orthogonal — all four combinations (GET+flat, GET+tree, POST+flat, POST+tree) are valid, no extra cross-validation needed.

**`Program.cs`**: register `new ApiBodyNodeJsonConverter()` alongside the others.

**Done when:** `dotnet test` green, including round-trip tests for a GraphQL-shaped body and validator cases for every new rule above. No codegen yet.

---

## B3 — Companion codegen and verification

**Files touched:**
- `language-modules/python/templates/scraper_api.py.j2`, `scraper_api_grouped.py.j2` (both need the request-sending change — orthogonal to Track A's flat/tree branch)
- `companion/ScrapingFactory.Compiler/Backends/Python/PythonApiCodeGenerator.cs`, `PythonApiConfigLiteral.cs`
- `companion/ScrapingFactory.Tests/PythonApiCodeGeneratorTests.cs`, `PythonApiScriptVerifierTests.cs`

**Runtime**: new constants `METHOD`, `BODY` (or `None`). New helpers:
```python
def _coerce_body_value(value, coerce_to):
    if coerce_to == "Number":
        try:
            return float(value) if "." in value else int(value)
        except ValueError:
            return value  # best-effort — see ApiBodyVariable.CoerceTo
    if coerce_to == "Boolean":
        return value.strip().lower() in ("true", "1", "yes")
    return value

def _render_body(node, combo):
    if node is None:
        return None
    if "properties" in node:
        return {key: _render_body(child, combo) for key, child in node["properties"].items()}
    if "items" in node:
        return [_render_body(item, combo) for item in node["items"]]
    if "parameterName" in node:
        return _coerce_body_value(combo[node["parameterName"]], node.get("coerceTo"))
    kind = node["kind"]
    return None if kind == "Null" else node["value"]
```
`scrape()`'s single `requests.get(...)` call becomes conditional on `METHOD`:
```python
body = _render_body(BODY, combo)
response = (requests.post(url, headers=headers, json=body, timeout=10) if METHOD == "POST"
            else requests.get(url, headers=headers, timeout=10))
```
No new looping structure — `_render_body` runs once per already-iterated cartesian-product `combo`. The existing 404-skip / other-status-aborts / "at least one row" logic is completely unaffected.

**`PythonApiConfigLiteral.RenderBody(ApiBodyNode?)`**: new method, same recursive dict/list-literal-building style as `RenderGroups`.

**`PythonApiCodeGenerator`**: pass `method_literal`/`body_literal` into both templates.

**Answering the explicitly-asked question — does `LocalTestServer` need extending to inspect request bodies?** **No.** `HttpListenerRequest.InputStream` is already available inside every existing responder lambda — a new test can read it directly, exactly the way current tests already read `QueryString`/`Headers` from the same object. Zero changes needed to `LocalTestServer.cs` itself.

**Done when:** new `PythonApiScriptVerifierTests` cases cover: a fixed-literal-only POST body sent and asserted server-side; a body containing an `ApiBodyVariable` substituted per cartesian-product combo (assert the server received a *different* body per request); a GraphQL-shaped test mirroring Phase 0's `/graphql` endpoint, confirming the query text never varies while `variables.category` does.

---

## B4 — Extension: request-body UI (fixed/variable marking)

**Files touched:**
- `extension/popup/popup.js`, `popup.html`, styles
- `extension/popup/popup.test.js`

**Draft construction**: a confirmed POST candidate's captured `requestBody` (B1) is `JSON.parse`d once and converted into an all-literal draft tree via `jsonValueToBodyDraft(value)` (arrays → `{kind:'array', items}`, objects → `{kind:'object', properties}`, scalars → `{kind:'literal', literalKind, value}`).

**Editing**: `renderBodyTree`/`buildBodyTreeNodeEl`, visually mirroring A4's tree rendering — but simpler: unlike Track A, the **entire** body tree is derived once from the one already-captured request body, and all further editing is purely structural (toggle a leaf between fixed and variable) — no click-based/candidate-search machinery needed anywhere in this phase. A literal leaf row shows a "→ variable" action opening a picker: choose an existing `ApiConfig` parameter, or create a new one, routing into the *same* parameter-source configuration UI URL parts already use, rather than a second body-specific source-picker. A variable leaf row shows a "→ fixed" action to revert it. Optionally expose `CoerceTo` as a small dropdown, defaulting to "String."

**`buildApiConfig`/`buildScrapingConfig` changes**: a `bodyTree` param, serialized via `serializeBodyTree(node)` into `ApiConfig.Body`. `ApiConfig.Method` must now actually be sent (today `buildApiConfig` never emits `method` at all) — set from the confirmed candidate's own recorded `method`. `apiConfigDraftHasAllSourcesChosen` extends to require every `variable`-kind leaf to have a chosen parameter/complete source.

**Open decision — bespoke GraphQL UI or not?** Recommend: **no GraphQL-specific code path anywhere**, in the wire format or the UI. A GraphQL body is, structurally, just a POST body whose top-level JSON happens to have a `query` key (an ordinary fixed-literal leaf) and a `variables` key (an ordinary nested object subtree, edited with the same generic fixed/variable-marking UI as any other nested POST body). This directly resolves the "one unified mechanism or two?" question — one mechanism, GraphQL support "falls out" of the generic design for free. At most, add a short doc-comment/UI hint noting the common `query`/`variables` shape as an example, purely cosmetic.

**Done when:** popup integration tests cover: converting a captured GraphQL body into a draft tree, marking `variables.category` as variable (bound to a `StaticListSource` parameter) while `query` stays untouched, confirming, and asserting the exact `ApiConfig.Body`/`Method` JSON sent to `/generate` matches B2's wire shape. Manual end-to-end verification against Phase 0's `/graphql` and `/api/search` endpoints is this phase's real acceptance bar, mirroring A5.

---

## B5 — Documentation

**Files touched:** `CLAUDE.md`

- Remove "POST/GraphQL requests... deliberately deferred" from "Planned for Future Releases"; add a Feature Scope bullet describing POST support (fixed and variable body values, request-body capture, GraphQL handled as an ordinary nested body).
- New Architecture Decision entries: (1) a body "variable" is just another `ApiParameter`; (2) the body is a typed tree, not a flat string template like `UrlTemplate`, because of GraphQL variable typing; (3) GraphQL gets no dedicated UI/wire concept — handled entirely by the generic body tree, with reasoning.
- Note the relaxed `Method` validation (`GET`/`POST` only, `DiscoverySource` still GET-only) and the `Body`-requires-`POST` rule.

**Done when:** CLAUDE.md accurately reflects the shipped feature.

---

## Critical files for a fresh session to orient around

`companion/ScrapingFactory.Compiler/IR/ApiConfig.cs`, `ScrapingPlanValidator.cs`, `language-modules/python/templates/scraper_api.py.j2`, `extension/content/content-script.js`, `extension/popup/popup.js`, and the new `test-pages/api-nested-and-post/server.py` (Phase 0 — the foundation every later manual-verification step builds on).
