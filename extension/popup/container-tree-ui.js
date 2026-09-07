// Container mode's own DOM rendering and event-handling logic: the group-
// tree editor's row rendering, and every handler that adds/confirms a new
// container/field within it. Split out of popup.js (which had grown past
// 3800 lines) purely for readability — no behavior change. Same
// IIFE-wrapped-single-global pattern as shared/logger.js/
// shared/companion-config.js/i18n/i18n.js (see their own doc comments):
// popup.html loads this as a classic <script> before popup.js, which pulls
// the functions it needs off `self.SFContainerTreeUI`.
//
// Like api-config-ui.js, the handler functions below (anything that reads or
// mutates popup state) take a `bridge` object — `{ getState, setState,
// patchState, stopPreviewIfActive, requestDomTree }` — as their first
// parameter, built once by popup.js's wireEvents() and passed through on
// every call, instead of closing over popup.js's own `_state`/`setState`/etc.
// See api-config-ui.js's own doc comment for why (load order + Jest module
// isolation both rule out a plain closure here). renderGroupTree/
// buildGroupTreeNodeEl need none of this — already pure, explicit-argument
// functions before the split and still are.
const SFContainerTreeUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:ContainerTreeUI');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { STATES } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const {
    formatGroupNodeLabel, resolveGroupNode, hasRepeatingAncestor, buildFieldNode, insertContainerNode,
  } = typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

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
  function openContainerModal(bridge, parentPath) {
    log('CONTAINER_MODAL open', { parentPath });
    bridge.patchState({ containerModalOpen: true, pendingParentPath: parentPath });
  }

  // Container-add order is deliberately "name/type first, then click an
  // element" (unlike field-add below) — see planning-container-scraping.md.
  function confirmContainerModal(bridge) {
    const name = document.getElementById('input-container-name')?.value.trim();
    if (!name) return;
    const repeating = document.getElementById('radio-container-repeating')?.checked ?? false;
    const state = bridge.getState();
    const parentPath = state.pendingParentPath;
    const scopeSelector = parentPath ? resolveGroupNode(state.groups, parentPath)?.selector : null;
    // This container's own selector must itself be able to match N times when
    // repeating, on top of the usual "nested inside a repeating ancestor" case.
    const avoidId = repeating || hasRepeatingAncestor(state.groups, parentPath);

    log('CONTAINER_ADD start', { name, repeating, parentPath, scopeSelector, avoidId });
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION', scopeSelector, avoidId });
    bridge.setState(STATES.SELECTING, {
      containerModalOpen:  false,
      selectionKind:       'container',
      pendingNewContainer: { name, repeating },
      pendingSelector:     null,
      pendingMatchCount:   null,
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (state.domViewEnabled) bridge.requestDomTree();
  }

  function cancelContainerModal(bridge) {
    log('CONTAINER_MODAL cancel');
    bridge.setState(bridge.getState().current, { containerModalOpen: false, pendingParentPath: null });
  }

  // Field-add within a container keeps the flat mode's order — click first,
  // name/type after — since the field type doesn't affect what gets clicked.
  function startFieldSelection(bridge, parentPath) {
    const state = bridge.getState();
    const scopeSelector = resolveGroupNode(state.groups, parentPath)?.selector ?? null;
    const avoidId = hasRepeatingAncestor(state.groups, parentPath);
    log('FIELD_ADD(container) start', { parentPath, scopeSelector, avoidId });
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION', scopeSelector, avoidId });
    bridge.setState(STATES.SELECTING, {
      selectionKind:       'field',
      pendingParentPath:   parentPath,
      pendingNewContainer: null,
      pendingSelector:     null,
      pendingMatchCount:   null,
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (state.domViewEnabled) bridge.requestDomTree();
  }

  function confirmExtendedField(bridge) {
    const name = document.getElementById('input-field-extended-name')?.value.trim();
    if (!name) return;
    const mode = document.getElementById('select-field-mode')?.value ?? 'text';
    const attribute = document.getElementById('input-field-attribute')?.value.trim();
    if (mode === 'attribute' && !attribute) return;

    const state = bridge.getState();
    const node = buildFieldNode(name, state.pendingSelector, mode, attribute, state.pendingFramePath);
    log('FIELD_ADD(container) confirm', node);
    bridge.setState(STATES.IDLE, {
      groups:            insertContainerNode(state.groups, state.pendingParentPath, node),
      pendingSelector:   null,
      pendingFramePath:  null,
      pendingMatchCount: null,
      pendingParentPath: null,
      selectionKind:     null,
    });
  }

  function cancelExtendedField(bridge) {
    log('FIELD_ADD(container) cancel');
    bridge.setState(STATES.IDLE, {
      pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingParentPath: null, selectionKind: null,
    });
  }

  return {
    buildGroupTreeNodeEl, renderGroupTree,
    openContainerModal, confirmContainerModal, cancelContainerModal,
    startFieldSelection, confirmExtendedField, cancelExtendedField,
  };
})();

if (typeof module !== 'undefined') module.exports = SFContainerTreeUI;
if (typeof self !== 'undefined') self.SFContainerTreeUI = SFContainerTreeUI;
