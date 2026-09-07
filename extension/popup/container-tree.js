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
const SFContainerTree = (function () {
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

  // ── Container-Mode tree (GroupNode/DataFieldNode) ───────────────────────────
  // Mirrors the backend IR (ContainerNode.cs): a group node scopes its
  // children to matches of its own selector, a field node is the extraction
  // leaf. `path` addresses a node the same way the DOM-tree-view already does
  // (an array of child indices) — see buildTreeNodeEl's `node.path`.

  function buildGroupNode(name, selector, repeating, framePath = null) {
    return { kind: 'group', name, selector, repeating, children: [], framePath: framePath || null };
  }

  function buildFieldNode(name, selector, mode, attribute, framePath = null, transforms = []) {
    return {
      kind: 'field', name, selector, mode, attribute: mode === 'attribute' ? attribute : null,
      framePath: framePath || null,
      // Issue #84: not meaningful for Exists mode (see FieldTransform's own
      // doc comment) — dropped here rather than trusting every call site to
      // pass [] for that mode itself.
      transforms: mode !== 'exists' && transforms.length > 0 ? transforms : null,
    };
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
          ...(node.transforms && node.transforms.length > 0 ? { transforms: node.transforms } : {}),
        });
  }

  return {
    buildGroupNode, buildFieldNode, resolveGroupNode, hasRepeatingAncestor,
    insertContainerNode, removeGroupTreeNode, formatGroupNodeLabel, serializeGroupTree,
  };
})();

if (typeof module !== 'undefined') module.exports = SFContainerTree;
if (typeof self !== 'undefined') self.SFContainerTree = SFContainerTree;
