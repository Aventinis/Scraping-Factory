// @ts-check
/** @import * as SFWire from '../types/wire' */
/** @import * as SFDraft from '../types/drafts' */
// Pure, DOM-free helpers for Container mode's group tree: draft build/resolve/insert/remove, the repeating-ancestor
// check, node labels and serialization to the wire format. The tree nodes are a popup-internal draft shape
// (`kind: 'group'|'field'`, lowercase `mode`), typed as SFDraft.* in types/drafts.ts; serializeGroupTree
// produces SFWire.ContainerNode.

const { t } = require('../i18n/i18n');

// ── Container-mode tree ──
// A group node scopes its children to matches of its selector, a field node is the extraction leaf. `path` addresses a
// node as an array of child indices (like the DOM tree view's `node.path`).

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

// selector may be null: the combine/split flow creates derived fields with selector=null and mode='text' (the mode is
// irrelevant; groupNodeSuffix shows a distinguishing label). hiddenFromOutput defaults to false and is set only by that
// flow's "remove original field(s)" option.
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
    // Not meaningful for Exists mode: dropped here rather than trusting every caller.
    transforms: mode !== 'exists' && transforms.length > 0 ? transforms : null,
    // Only meaningful for Attribute mode (the raw value is a URL only then); gated here like attribute / transforms.
    download: isDownload,
    // Issue #214: the optional safety net alongside download — same
    // "only meaningful when download is actually on" gate.
    maxDownloadSizeBytes: isDownload ? (maxDownloadSizeBytes || null) : null,
    allowedContentTypes: isDownload && allowedContentTypes.length > 0 ? allowedContentTypes : [],
    hiddenFromOutput,
  };
}

// Shared by the container and flat field modals: a comma-separated content-type allowlist, split, trimmed, blanks dropped.
/**
 * @param {string} text
 * @returns {string[]}
 */
function parseAllowedContentTypes(text) {
  return (text || '').split(',').map(part => part.trim()).filter(part => part.length > 0);
}

// The max-size input is MB (friendlier), the wire format is bytes. null / non-positive means "no limit".
/**
 * @param {string} value
 * @returns {number | null}
 */
function megabytesToBytes(value) {
  const mb = parseFloat(value);
  return Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : null;
}

// Guesses which of the clicked element's attributes most likely holds a downloadable resource URL, so the picker can
// preselect it. Only a convenience: every attribute stays listed and pickable.
const RESOURCE_LIKE_EXTENSION_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|pdf|mp4|webm|mp3)(\?|#|$)/i;

// A "data:" URI is inline content, not a fetchable resource (typically a tracking-pixel placeholder in `src` while the
// real URL sits in a lazy-load data-* attribute).
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

// Returns the best-guess attribute name, or null when nothing looks like a resource URL.
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

// True if the node at `path` or an ancestor is a repeating group: content-script then skips its id-selector shortcut
// (an id is page-unique and would starve the other repetitions).
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

// Field-name options a new combine/split field may reference: the field children directly under `parentPath`, in
// declared order. Same-immediate-parent, not global-by-name like collectFieldNames; the new field is appended last, so
// every current sibling is "declared earlier" (ScrapingPlanValidator's ordering rule).
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

// Replaces the node at `path` with `updater(node)` (like api-config.js's updateApiTreeNode).
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

// Swaps the node at `path` with its adjacent sibling (-1 up, 1 down, like moveTransform); a no-op past either end, so
// a button can call it unconditionally.
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

// The part of formatGroupNodeLabel that is not the name, so the tree row can show an editable name and this suffix.
/**
 * @param {SFDraft.ContainerNode} node
 * @returns {string}
 */
function groupNodeSuffix(node) {
  if (node.kind === 'group') {
    return `(${t(node.repeating ? 'group.repeating' : 'group.single')})`;
  }
  // Branches on the transform kind first: a derived field carries mode='text', which would mislead.
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

// Strips the internal `kind` tag and shapes each node like the wire format (children only for groups, attribute only
// for Attribute mode).
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
        // Omitted (not false) when off, like transforms / framePath.
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

module.exports = {
  buildGroupNode, buildFieldNode, resolveGroupNode, hasRepeatingAncestor,
  insertContainerNode, removeGroupTreeNode, updateGroupTreeNode, moveGroupTreeNode,
  groupNodeSuffix, formatGroupNodeLabel, serializeGroupTree,
  guessUrlAttribute, parseAllowedContentTypes, megabytesToBytes,
  collectSiblingFieldNames,
};

