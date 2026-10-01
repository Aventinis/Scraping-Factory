// Pure, DOM-free helpers for Container mode's group tree (GroupNode/
// DataFieldNode, mirrors the backend IR's ContainerNode.cs): draft
// build/resolve/insert/remove, the repeating-ancestor check, node-label
// formatting, and serialization to the wire format. Split out of popup.js
// (which had grown past 3800 loc) purely for readability — no behavior
// change. Same IIFE-wrapped-single-global pattern as shared/logger.js/
// shared/companion-config.js/i18n/i18n.js (see their own doc comments):
// popup.html loads this as a classic <script> before popup.js, which pulls
// the functions it needs off `self.SFContainerTree` — a bare top-level
// `const`/`function` here would collide with popup.js's own declarations,
// since classic scripts sharing one document all share one global scope.
// @ts-check
// Issue #238: JSDoc-annotated and typechecked via `// @ts-check` + tsconfig
// (`npm run typecheck`). This module's own tree nodes are a popup-internal
// "draft" shape, not the wire format itself (e.g. `kind: 'group'|'field'`
// instead of structural `children`-presence discrimination, lowercase
// `mode` values) — described by types/popup-drafts.d.ts's `SFDraft`
// namespace (`SFDraft.ContainerNode`/`GroupNode`/`FieldNode`/`FieldMode`)
// rather than types/companion-ir.d.ts's `SFWire`, which only models the
// wire shape `serializeGroupTree` actually produces. `SFDraft` lives in its
// own ambient file, not a local `@typedef` here, specifically so
// scraping-config-builder.js's own JSDoc can reference this module's tree
// shape too — see that file's own top-of-file comment and
// types/popup-drafts.d.ts's.

const SFContainerTree = (function () {
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

  // ── Container-Mode tree (GroupNode/DataFieldNode) ───────────────────────────
  // Mirrors the backend IR (ContainerNode.cs): a group node scopes its
  // children to matches of its own selector, a field node is the extraction
  // leaf. `path` addresses a node the same way the DOM-tree-view already does
  // (an array of child indices) — see buildTreeNodeEl's `node.path`.

  /**
   * @param {string} name
   * @param {string} selector
   * @param {boolean} repeating
   * @param {string[] | null} [framePath]
   * @returns {SFDraft.GroupNode}
   */
  function buildGroupNode(name, selector, repeating, framePath = null) {
    return { kind: 'group', name, selector, repeating, children: [], framePath: framePath || null };
  }

  // Issue #206 follow-up: selector may be null — the dedicated combine/split
  // creation flow (combine-split-fields-ui.js) always calls this with
  // selector=null and mode='text' (the mode/wire "Text" is functionally
  // irrelevant for a derived field, since its own extracted value is always
  // discarded — see groupNodeSuffix below for how the tree row still shows a
  // distinguishing label instead of "Text"). hiddenFromOutput defaults
  // false, set only via that same flow's own "remove original field(s)"
  // checkbox (updateGroupTreeNode elsewhere), never here.
  /**
   * @param {string} name
   * @param {string | null} selector
   * @param {SFDraft.FieldMode} mode
   * @param {string | null} attribute
   * @param {string[] | null} [framePath]
   * @param {SFWire.FieldTransform[]} [transforms]
   * @param {boolean} [download]
   * @param {number | null} [maxDownloadSizeBytes]
   * @param {string[]} [allowedContentTypes]
   * @param {boolean} [hiddenFromOutput]
   * @returns {SFDraft.FieldNode}
   */
  function buildFieldNode(
    name, selector, mode, attribute, framePath = null, transforms = [], download = false,
    maxDownloadSizeBytes = null, allowedContentTypes = [], hiddenFromOutput = false,
  ) {
    const isDownload = mode === 'attribute' && !!download;
    return {
      kind: 'field', name, selector, mode, attribute: mode === 'attribute' ? attribute : null,
      framePath: framePath || null,
      // Issue #84: not meaningful for Exists mode (see FieldTransform's own
      // doc comment) — dropped here rather than trusting every call site to
      // pass [] for that mode itself.
      transforms: mode !== 'exists' && transforms.length > 0 ? transforms : null,
      // Issue #213: only meaningful for Attribute mode (the raw value is a
      // URL only then) — same "gate on mode, don't trust the caller" pattern
      // attribute/transforms above already use.
      download: isDownload,
      // Issue #214: the optional safety net alongside download — same
      // "only meaningful when download is actually on" gate.
      maxDownloadSizeBytes: isDownload ? (maxDownloadSizeBytes || null) : null,
      allowedContentTypes: isDownload && allowedContentTypes.length > 0 ? allowedContentTypes : [],
      hiddenFromOutput,
    };
  }

  // Issue #214: shared by container mode's modal-field-extended and flat
  // mode's modal-field-name (both container-tree-ui.js/flat-mode-ui.js
  // import these from here rather than scraping-config-builder.js, which
  // loads too late in popup.html's actual <script> order to be usable from
  // container-tree-ui.js — see classic-script-loading.test.js) — a
  // comma-separated content-type allowlist, same "split, trim, drop blanks"
  // shape scraping-config-builder.js's own parseAdditionalUrls already uses
  // for a newline-separated list.
  /**
   * @param {string} text
   * @returns {string[]}
   */
  function parseAllowedContentTypes(text) {
    return (text || '').split(',').map(part => part.trim()).filter(part => part.length > 0);
  }

  // Issue #214: the download safety net's max-size input is collected as MB
  // (friendlier for a non-technical user) but the wire format/generated
  // script work in bytes — same "convert at the UI boundary" pattern
  // Hardening's own percent(UI)<->fraction(wire) conversion already uses.
  // null/non-positive input means "no limit", not zero.
  /**
   * @param {string} value
   * @returns {number | null}
   */
  function megabytesToBytes(value) {
    const mb = parseFloat(value);
    return Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : null;
  }

  // Issue #213 follow-up: guesses which of a clicked element's own
  // attributes most likely holds a downloadable resource URL, so the
  // extension can pre-select it in the attribute picker instead of leaving
  // a non-technical user to guess/inspect DevTools for an HTML attribute
  // name blind (per CLAUDE.md's "no programming knowledge" target audience
  // — the whole reason `select-field-attribute` lists the element's actual
  // attributes rather than being a free-text field at all). A convenience
  // default only — every attribute is still listed and pickable regardless
  // of what this guesses, so a wrong guess costs one click to correct, not
  // a dead end.
  const RESOURCE_LIKE_EXTENSION_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|pdf|mp4|webm|mp3)(\?|#|$)/i;

  // A "data:" URI is inline base64 content, not a fetchable resource — the
  // classic case being a 1x1 tracking-pixel placeholder sitting in `src`
  // while the real image URL waits in a lazy-load `data-*` attribute.
  /**
   * @param {string} value
   * @returns {boolean}
   */
  function looksLikeResourceUrl(value) {
    if (!value) return false;
    if (value.startsWith('data:')) return false;
    return value.includes('/') || RESOURCE_LIKE_EXTENSION_RE.test(value);
  }

  /**
   * @param {string} name
   * @param {string} value
   * @returns {number}
   */
  function scoreAttributeForDownload(name, value) {
    if (!looksLikeResourceUrl(value)) return -1;
    const lower = name.toLowerCase();
    if (lower === 'src') return 100;
    // Common lazy-loading conventions: the real URL sits in a data-*
    // attribute until the element actually scrolls into view.
    if (lower === 'data-src' || lower === 'data-original' || lower.includes('lazy')) return 90;
    if (lower === 'href') return 70;
    if (lower.startsWith('data-') && RESOURCE_LIKE_EXTENSION_RE.test(value)) return 60;
    if (RESOURCE_LIKE_EXTENSION_RE.test(value)) return 50;
    return 10; // contains a slash but nothing else recognizable
  }

  // Returns the best-guess attribute name, or null when nothing on the
  // element looks like a resource URL at all (the picker then simply lists
  // every attribute with no preselection).
  /**
   * @param {Record<string, string> | null | undefined} attributes
   * @returns {string | null}
   */
  function guessUrlAttribute(attributes) {
    if (!attributes) return null;
    let best = null;
    let bestScore = 0;
    for (const [name, value] of Object.entries(attributes)) {
      const score = scoreAttributeForDownload(name, value);
      if (score > bestScore) { best = name; bestScore = score; }
    }
    return best;
  }

  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[] | null | undefined} path
   * @returns {SFDraft.ContainerNode | null}
   */
  function resolveGroupNode(groups, path) {
    if (!path || path.length === 0) return null;
    /** @type {SFDraft.ContainerNode} */
    let node = groups[path[0]];
    for (let i = 1; i < path.length; i++) node = /** @type {SFDraft.GroupNode} */ (node).children[path[i]];
    return node;
  }

  // True if the node at `path` (or any of its ancestors) is a repeating
  // group — i.e. a selector added under this path will be re-evaluated once
  // per matched instance, not just once. Used to tell content-script to skip
  // its usual id-selector shortcut (see buildSelector's avoidId): an id is
  // page-unique, so a selector built from one can only ever match a single
  // instance, silently starving every other repetition of that field/nested
  // container.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[] | null | undefined} path
   * @returns {boolean}
   */
  function hasRepeatingAncestor(groups, path) {
    if (!path) return false;
    let nodes = groups;
    for (const index of path) {
      const node = nodes[index];
      if (node.kind === 'group' && node.repeating) return true;
      nodes = node.kind === 'group' ? node.children : [];
    }
    return false;
  }

  // Appends `node` as the last child at `parentPath` (or at root level when
  // `parentPath` is null) — immutable, like addField above.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[] | null | undefined} parentPath
   * @param {SFDraft.ContainerNode} node
   * @returns {SFDraft.ContainerNode[]}
   */
  function insertContainerNode(groups, parentPath, node) {
    const path = parentPath || [];
    if (path.length === 0) return [...groups, node];
    const [head, ...rest] = path;
    return groups.map((n, i) => (i === head
      ? { ...n, children: insertContainerNode(/** @type {SFDraft.GroupNode} */ (n).children, rest, node) }
      : n));
  }

  // Issue #206: the field-name options a new field's combineFields/
  // splitField transform may reference — every already-present *field*
  // child (kind === 'field') directly under `parentPath` (or at root level
  // when null), in declared order. Deliberately not global-by-name (unlike
  // collectFieldNames, used by the hardening null-rate/required-fields
  // pickers) — modal-field-extended only ever inserts a brand-new field as
  // the last child of this exact parent, so every current field sibling
  // here is already guaranteed to be "declared earlier" once the new one is
  // appended, matching ScrapingPlanValidator's own same-immediate-parent-
  // group ordering rule exactly, with no slicing needed.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[] | null | undefined} parentPath
   * @returns {string[]}
   */
  function collectSiblingFieldNames(groups, parentPath) {
    const parent = !parentPath || parentPath.length === 0 ? null : resolveGroupNode(groups, parentPath);
    const siblings = !parentPath || parentPath.length === 0
      ? groups
      : (parent && parent.kind === 'group' ? parent.children : []);
    return siblings.filter(n => n.kind === 'field').map(n => n.name);
  }

  // Removes the node (and its subtree) at `path` — always non-empty, unlike
  // insertContainerNode's parentPath.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[]} path
   * @returns {SFDraft.ContainerNode[]}
   */
  function removeGroupTreeNode(groups, path) {
    if (path.length === 1) return groups.filter((_, i) => i !== path[0]);
    const [head, ...rest] = path;
    return groups.map((n, i) => (i === head
      ? { ...n, children: removeGroupTreeNode(/** @type {SFDraft.GroupNode} */ (n).children, rest) }
      : n));
  }

  // Issue #177: replaces the node at `path` with `updater(node)` — same
  // recursive path-walk shape as api-config.js's own updateApiTreeNode, used
  // there for the API tree's own rename-in-place input.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[]} path
   * @param {(node: SFDraft.ContainerNode) => SFDraft.ContainerNode} updater
   * @returns {SFDraft.ContainerNode[]}
   */
  function updateGroupTreeNode(groups, path, updater) {
    const [head, ...rest] = path;
    return groups.map((n, i) => {
      if (i !== head) return n;
      return rest.length === 0
        ? updater(n)
        : { ...n, children: updateGroupTreeNode(/** @type {SFDraft.GroupNode} */ (n).children, rest, updater) };
    });
  }

  // Issue #177: swaps the node at `path` with its adjacent sibling —
  // direction is -1 (up) or 1 (down), same convention as field-transforms.js's
  // moveTransform. No-ops (returns `groups` unchanged) past either end of the
  // sibling list, so callers can wire this straight to an unconditional
  // button click without checking the boundary themselves first.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @param {number[]} path
   * @param {number} direction
   * @returns {SFDraft.ContainerNode[]}
   */
  function moveGroupTreeNode(groups, path, direction) {
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    const siblings = parentPath.length === 0
      ? groups
      : /** @type {SFDraft.GroupNode} */ (resolveGroupNode(groups, parentPath)).children;
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return groups;

    const swapped = [...siblings];
    [swapped[index], swapped[target]] = [swapped[target], swapped[index]];

    return parentPath.length === 0
      ? swapped
      : updateGroupTreeNode(groups, parentPath, (n) => ({ ...n, children: swapped }));
  }

  // Issue #177: the part of formatGroupNodeLabel below that isn't the name
  // itself — split out so the tree-row editor can render the name as an
  // editable input and this suffix as a separate, read-only label next to it.
  /**
   * @param {SFDraft.ContainerNode} node
   * @returns {string}
   */
  function groupNodeSuffix(node) {
    if (node.kind === 'group') {
      return `(${t(node.repeating ? 'group.repeating' : 'group.single')})`;
    }
    // Issue #206 follow-up: a field created through the dedicated combine/
    // split flow always carries mode='text' (see buildFieldNode's own doc
    // comment) — branching on the transform's own kind first, rather than
    // on node.mode, is what shows a distinguishing label instead of "Text"
    // for a field whose actual extracted value is always discarded.
    const firstTransform = node.transforms?.[0];
    const derivedKind = firstTransform?.kind;
    if (derivedKind === 'combineFields') {
      const combine = /** @type {SFWire.CombineFieldsTransform} */ (firstTransform);
      return `— ${t('group.combinedFieldMode', { sources: combine.sourceFieldNames.join(', ') })}`;
    }
    if (derivedKind === 'splitField') {
      const split = /** @type {SFWire.SplitFieldTransform} */ (firstTransform);
      return `— ${t('group.splitFieldMode', { source: split.sourceFieldName })}`;
    }
    const modeLabel = {
      text: t('group.textMode'),
      attribute: t('group.attributeMode', { attribute: node.attribute }),
      exists: t('group.existsMode'),
      ownText: t('group.ownTextMode'),
    }[node.mode];
    return `— ${modeLabel}`;
  }

  /**
   * @param {SFDraft.ContainerNode} node
   * @returns {string}
   */
  function formatGroupNodeLabel(node) {
    return `${node.name} ${groupNodeSuffix(node)}`;
  }

  /** @type {Record<SFDraft.FieldMode, SFWire.ExtractMode>} */
  const FIELD_MODE_WIRE_NAMES = { text: 'Text', attribute: 'Attribute', exists: 'Exists', ownText: 'OwnText' };

  // Strips the popup's internal `kind` tag and shapes each node exactly like
  // the wire format the Companion expects (ContainerNode.cs / ContainerNodeJsonConverter):
  // `children` present only for groups, `attribute` present only when mode is Attribute.
  /**
   * @param {SFDraft.ContainerNode[]} groups
   * @returns {SFWire.ContainerNode[]}
   */
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
          ...(node.transforms && node.transforms.length > 0 ? { transforms: node.transforms } : {}),
          // Issue #213: same "only meaningful under Attribute mode" gate as
          // attribute itself — omitted (not sent as false) when off, the
          // same "incomplete/off = key omitted" convention transforms/
          // framePath above already use.
          ...(node.mode === 'attribute' && node.download ? { download: true } : {}),
          // Issue #214: the optional safety net alongside download — only
          // sent when download is actually on and a value was configured.
          ...(node.mode === 'attribute' && node.download && node.maxDownloadSizeBytes
            ? { maxDownloadSizeBytes: node.maxDownloadSizeBytes } : {}),
          ...(node.mode === 'attribute' && node.download && node.allowedContentTypes?.length > 0
            ? { allowedContentTypes: node.allowedContentTypes } : {}),
          // Issue #206 follow-up: same "incomplete/off = key omitted"
          // convention as download above.
          ...(node.hiddenFromOutput ? { hiddenFromOutput: true } : {}),
        });
  }

  return {
    buildGroupNode, buildFieldNode, resolveGroupNode, hasRepeatingAncestor,
    insertContainerNode, removeGroupTreeNode, updateGroupTreeNode, moveGroupTreeNode,
    groupNodeSuffix, formatGroupNodeLabel, serializeGroupTree,
    guessUrlAttribute, parseAllowedContentTypes, megabytesToBytes,
    collectSiblingFieldNames,
  };
})();

if (typeof module !== 'undefined') module.exports = SFContainerTree;
if (typeof self !== 'undefined') self.SFContainerTree = SFContainerTree;
