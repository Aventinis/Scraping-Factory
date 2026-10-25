// Pure, DOM-free helpers for Container mode's group tree: draft build/resolve/insert/remove, the repeating-ancestor check, node
// labels and serialization to the wire format. The tree nodes are a popup-internal draft shape (`kind: 'group'|'field'`, lowercase
// `mode`), typed as SFDraft.* in types/drafts.ts; serializeGroupTree produces SFWire.ContainerNode.
import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';
import { t } from '../i18n/i18n';

// ── Container-mode tree ──
// A group node scopes its children to matches of its selector, a field node is the extraction leaf. `path` addresses a node as an
// array of child indices (like the DOM tree view's `node.path`).

type Nodes = SFDraft.ContainerNode[];

export function buildGroupNode(name: string, selector: string, repeating: boolean, framePath: string[] | null = null): SFDraft.GroupNode {
  return { kind: 'group', name, selector, repeating, children: [], framePath: framePath || null };
}

/**
 * `selector` may be null: the combine/split flow creates derived fields with selector=null and mode='text' (the mode is irrelevant;
 * groupNodeSuffix shows a distinguishing label). `hiddenFromOutput` is set only by that flow's "remove original field(s)" option.
 */
export function buildFieldNode(
  name: string, selector: string | null, mode: SFDraft.FieldMode, attribute: string | null, framePath: string[] | null = null,
  transforms: SFWire.FieldTransform[] = [], download = false, maxDownloadSizeBytes: number | null = null,
  allowedContentTypes: string[] = [], hiddenFromOutput = false,
): SFDraft.FieldNode {
  const isDownload = mode === 'attribute' && !!download;
  return {
    kind: 'field', name, selector, mode, attribute: mode === 'attribute' ? attribute : null,
    framePath: framePath || null,
    // Not meaningful for Exists mode: dropped here rather than trusting every caller.
    transforms: mode !== 'exists' && transforms.length > 0 ? transforms : null,
    // Only meaningful for Attribute mode (the raw value is a URL only then); gated here like attribute / transforms. The size and
    // content-type safety net follows the same "only when download is on" gate.
    download: isDownload,
    maxDownloadSizeBytes: isDownload ? (maxDownloadSizeBytes || null) : null,
    allowedContentTypes: isDownload && allowedContentTypes.length > 0 ? allowedContentTypes : [],
    hiddenFromOutput,
  };
}

/** Shared by the container and flat field modals: a comma-separated content-type allowlist, split, trimmed, blanks dropped. */
export function parseAllowedContentTypes(text: string): string[] {
  return (text || '').split(',').map(part => part.trim()).filter(part => part.length > 0);
}

/** The max-size input is MB (friendlier), the wire format is bytes. Null for blank, non-numeric or non-positive: "no limit". */
export function megabytesToBytes(value: string): number | null {
  const mb = parseFloat(value);
  return Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : null;
}

// Guesses which of the clicked element's attributes most likely holds a downloadable resource URL, so the picker can preselect it.
// Only a convenience: every attribute stays listed and pickable.
const RESOURCE_LIKE_EXTENSION_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|pdf|mp4|webm|mp3)(\?|#|$)/i;

// A "data:" URI is inline content, not a fetchable resource (typically a tracking-pixel placeholder in `src` while the real URL sits
// in a lazy-load data-* attribute).
function looksLikeResourceUrl(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('data:')) return false;
  return value.includes('/') || RESOURCE_LIKE_EXTENSION_RE.test(value);
}

function scoreAttributeForDownload(name: string, value: string): number {
  if (!looksLikeResourceUrl(value)) return -1;
  const lower = name.toLowerCase();
  if (lower === 'src') return 100;
  // Common lazy-loading conventions: the real URL sits in a data-* attribute until the element scrolls into view.
  if (lower === 'data-src' || lower === 'data-original' || lower.includes('lazy')) return 90;
  if (lower === 'href') return 70;
  if (lower.startsWith('data-') && RESOURCE_LIKE_EXTENSION_RE.test(value)) return 60;
  if (RESOURCE_LIKE_EXTENSION_RE.test(value)) return 50;
  return 10; // contains a slash but nothing else recognizable
}

/** The best-guess attribute name, or null when nothing looks like a resource URL. */
export function guessUrlAttribute(attributes: Record<string, string> | null | undefined): string | null {
  if (!attributes) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const [name, value] of Object.entries(attributes)) {
    const score = scoreAttributeForDownload(name, value);
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

export function resolveGroupNode(groups: Nodes, path: number[] | null | undefined): SFDraft.ContainerNode | null {
  if (!path || path.length === 0) return null;
  let node: SFDraft.ContainerNode = groups[path[0]];
  for (let i = 1; i < path.length; i++) node = (node as SFDraft.GroupNode).children[path[i]];
  return node;
}

/**
 * True if the node at `path` or an ancestor is a repeating group: content-script then skips its id-selector shortcut (an id is
 * page-unique and would starve the other repetitions).
 */
export function hasRepeatingAncestor(groups: Nodes, path: number[] | null | undefined): boolean {
  if (!path) return false;
  let nodes = groups;
  for (const index of path) {
    const node = nodes[index];
    if (node.kind === 'group' && node.repeating) return true;
    nodes = node.kind === 'group' ? node.children : [];
  }
  return false;
}

// insertContainerNode, removeGroupTreeNode, updateGroupTreeNode and moveGroupTreeNode only read and rewrite `children`, so they are generic
// over any node with a `kind` and also serve the Output Blueprint tree editor's smaller nodes (output-blueprints-ui.ts).
type TreeNode = { kind: string };
const childrenOf = <N>(node: N): N[] => (node as unknown as { children: N[] }).children;

/** Appends `node` as the last child at `parentPath` (or at root level when it is null). Immutable. */
export function insertContainerNode<N extends TreeNode>(groups: N[], parentPath: number[] | null | undefined, node: N): N[] {
  const path = parentPath || [];
  if (path.length === 0) return [...groups, node];
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head
    ? { ...n, children: insertContainerNode(childrenOf(n), rest, node) }
    : n));
}

/**
 * Field-name options a new combine/split field may reference: the field children directly under `parentPath`, in declared order.
 * Same-immediate-parent, not global-by-name like collectFieldNames; the new field is appended last, so every current sibling is
 * "declared earlier" (ScrapingPlanValidator's ordering rule).
 */
export function collectSiblingFieldNames(groups: Nodes, parentPath: number[] | null | undefined): string[] {
  const parent = !parentPath || parentPath.length === 0 ? null : resolveGroupNode(groups, parentPath);
  const siblings = !parentPath || parentPath.length === 0
    ? groups
    : (parent && parent.kind === 'group' ? parent.children : []);
  return siblings.filter(n => n.kind === 'field').map(n => n.name);
}

/** Removes the node (and its subtree) at `path`, which is never empty (unlike insertContainerNode's parentPath). */
export function removeGroupTreeNode<N extends TreeNode>(groups: N[], path: number[]): N[] {
  if (path.length === 1) return groups.filter((_, i) => i !== path[0]);
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head
    ? { ...n, children: removeGroupTreeNode(childrenOf(n), rest) }
    : n));
}

/** Replaces the node at `path` with `updater(node)` (like api-config's updateApiTreeNode). */
export function updateGroupTreeNode<N extends TreeNode>(groups: N[], path: number[], updater: (node: N) => N): N[] {
  const [head, ...rest] = path;
  return groups.map((n, i) => {
    if (i !== head) return n;
    return rest.length === 0
      ? updater(n)
      : { ...n, children: updateGroupTreeNode(childrenOf(n), rest, updater) };
  });
}

/** Swaps the node at `path` with its adjacent sibling (-1 up, 1 down, like moveTransform); a no-op past either end, so a button can call it unconditionally. */
export function moveGroupTreeNode<N extends TreeNode>(groups: N[], path: number[], direction: number): N[] {
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  let siblings = groups;
  for (const step of parentPath) siblings = childrenOf(siblings[step]);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return groups;

  const swapped = [...siblings];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];

  return parentPath.length === 0
    ? swapped
    : updateGroupTreeNode(groups, parentPath, (n) => ({ ...n, children: swapped }));
}

/** The part of formatGroupNodeLabel that is not the name, so the tree row can show an editable name and this suffix. */
export function groupNodeSuffix(node: SFDraft.ContainerNode): string {
  if (node.kind === 'group') {
    return `(${t(node.repeating ? 'group.repeating' : 'group.single')})`;
  }
  // Branches on the transform kind first: a derived field carries mode='text', which would mislead.
  const firstTransform = node.transforms?.[0];
  if (firstTransform?.kind === 'combineFields') {
    return `— ${t('group.combinedFieldMode', { sources: firstTransform.sourceFieldNames.join(', ') })}`;
  }
  if (firstTransform?.kind === 'splitField') {
    return `— ${t('group.splitFieldMode', { source: firstTransform.sourceFieldName })}`;
  }
  const modeLabel = {
    text: t('group.textMode'),
    attribute: t('group.attributeMode', { attribute: node.attribute }),
    exists: t('group.existsMode'),
    ownText: t('group.ownTextMode'),
  }[node.mode];
  return `— ${modeLabel}`;
}

export function formatGroupNodeLabel(node: SFDraft.ContainerNode): string {
  return `${node.name} ${groupNodeSuffix(node)}`;
}

const FIELD_MODE_WIRE_NAMES: Record<SFDraft.FieldMode, SFWire.ExtractMode> = { text: 'Text', attribute: 'Attribute', exists: 'Exists', ownText: 'OwnText' };

/** Strips the internal `kind` tag and shapes each node like the wire format (children only for groups, attribute only for Attribute mode). */
export function serializeGroupTree(groups: Nodes): SFWire.ContainerNode[] {
  return groups.map((node): SFWire.ContainerNode => node.kind === 'group'
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
        // Optional keys are omitted (not false/null) when off, like transforms / framePath; the download safety net only travels
        // with an enabled download.
        ...(node.mode === 'attribute' && node.download ? { download: true } : {}),
        ...(node.mode === 'attribute' && node.download && node.maxDownloadSizeBytes
          ? { maxDownloadSizeBytes: node.maxDownloadSizeBytes } : {}),
        ...(node.mode === 'attribute' && node.download && node.allowedContentTypes?.length > 0
          ? { allowedContentTypes: node.allowedContentTypes } : {}),
        ...(node.hiddenFromOutput ? { hiddenFromOutput: true } : {}),
      });
}
