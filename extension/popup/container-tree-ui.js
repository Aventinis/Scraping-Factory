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
  const { STATES, escapeHtml } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const {
    formatGroupNodeLabel, resolveGroupNode, hasRepeatingAncestor, buildFieldNode, insertContainerNode,
    removeGroupTreeNode,
  } = typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;
  const { transformsAreValid, addTransform } = typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;
  const { renderTransformList, renderTransformPreview, wireTransformList } =
    typeof require !== 'undefined' ? require('./field-transforms-ui') : self.SFFieldTransformsUI;

  // Issue #139: one static inline chevron per row instead of swapping between
  // two different Unicode glyphs (▸/▾) on click — collapsed/expanded is now a
  // CSS rotation driven by the .collapsed class (see popup.html's shared
  // .group-tree-toggle svg / .collapsed rule). Same duplicated-per-file
  // pattern api-config-ui.js/popup.js use for their own tree toggles.
  const TREE_TOGGLE_CHEVRON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="6 9 12 15 18 9"></polyline></svg>';

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
    if (hasChildren) toggle.innerHTML = TREE_TOGGLE_CHEVRON_SVG; // starts expanded, see below
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
          toggle.classList.toggle('collapsed', collapsed);
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
      pendingRawText:      null,
      pendingElementAttributes: null,
      pendingTransforms:   [],
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
      pendingRawText:      null,
      pendingElementAttributes: null,
      pendingTransforms:   [],
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
    if (!transformsAreValid(state.pendingTransforms)) return;
    const node = buildFieldNode(name, state.pendingSelector, mode, attribute, state.pendingFramePath, state.pendingTransforms);
    log('FIELD_ADD(container) confirm', node);
    bridge.setState(STATES.IDLE, {
      groups:            insertContainerNode(state.groups, state.pendingParentPath, node),
      pendingSelector:   null,
      pendingFramePath:  null,
      pendingMatchCount: null,
      pendingRawText: null,
      pendingElementAttributes: null,
      pendingTransforms: [],
      pendingParentPath: null,
      selectionKind:     null,
    });
  }

  function cancelExtendedField(bridge) {
    log('FIELD_ADD(container) cancel');
    bridge.setState(STATES.IDLE, {
      pendingSelector: null, pendingFramePath: null, pendingMatchCount: null,
      pendingRawText: null, pendingElementAttributes: null,
      pendingTransforms: [], pendingParentPath: null, selectionKind: null,
    });
  }

  // Issue #85: existence/quantity feedback next to the name input — same
  // function as flat-mode-ui.js's own copy (see that file's doc comment on
  // why it's duplicated rather than shared).
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

  // Issue #143: container mode's raw value depends on the mode/attribute the
  // user is currently typing into the modal — read directly from those DOM
  // inputs (like the attribute-row visibility toggle already does), not from
  // bridge.getState(), since neither is state-managed. "exists" mode always
  // passes null (its own transforms section is hidden, see
  // wireContainerModeEvents' select-field-mode change handler) and attribute
  // mode passes null until an attribute name has actually been typed, so the
  // hint doesn't show a misleading result before then. Issue #169: "ownText"
  // mode reads pendingOwnText, computed at click time by content-script.js's
  // collectOwnText — no DOM input to wait on, unlike attribute mode's
  // attribute-name field.
  function refreshExtendedTransformPreview(bridge) {
    const state = bridge.getState();
    const mode = document.getElementById('select-field-mode')?.value ?? 'text';
    let rawValue = null;
    if (mode === 'text') {
      rawValue = state.pendingRawText;
    } else if (mode === 'attribute') {
      const attrName = document.getElementById('input-field-attribute')?.value.trim();
      if (attrName) rawValue = (state.pendingElementAttributes?.[attrName] ?? '').trim();
    } else if (mode === 'ownText') {
      rawValue = state.pendingOwnText;
    }
    renderTransformPreview('field-extended-transform-preview', rawValue, state.pendingTransforms);
  }

  // Called from popup.js's render() once it's determined the confirmed-
  // selection modal is container mode's own (STATES.SELECTING + a pending
  // selector + mode === 'container'). `isNewPick` distinguishes an actual
  // closed→open transition (reset name/mode/focus) from a re-render
  // triggered by editing the transform chain (which must not wipe what's
  // already typed/chosen).
  function renderContainerFieldModal(bridge, isNewPick) {
    const state = bridge.getState();
    document.getElementById('modal-field-extended')?.classList.remove('hidden');
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
    renderMatchCountHint('field-extended-match-count', state.pendingMatchCount);
    renderTransformList('field-extended-transform-list', state.pendingTransforms);
    refreshExtendedTransformPreview(bridge);
  }

  function wireContainerModeEvents(bridge) {
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
      bridge.stopPreviewIfActive();
      bridge.setState(bridge.getState().current, { groups: removeGroupTreeNode(bridge.getState().groups, path) });
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
    refreshExtendedTransformPreview(bridge);
  });
  // Issue #143: typing an attribute name updates the preview live, without
  // requiring a transform edit first.
  document.getElementById('input-field-attribute')?.addEventListener('input', () => refreshExtendedTransformPreview(bridge));
  document.getElementById('btn-field-extended-transform-add')?.addEventListener('click', () => {
    bridge.patchState({ pendingTransforms: addTransform(bridge.getState().pendingTransforms) });
  });
  wireTransformList(
    'field-extended-transform-list',
    () => bridge.getState().pendingTransforms,
    (transforms) => bridge.patchState({ pendingTransforms: transforms }),
  );
  }

  return {
    buildGroupTreeNodeEl, renderGroupTree,
    openContainerModal, confirmContainerModal, cancelContainerModal,
    startFieldSelection, confirmExtendedField, cancelExtendedField,
    renderMatchCountHint, refreshExtendedTransformPreview, renderContainerFieldModal,
    wireContainerModeEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFContainerTreeUI;
if (typeof self !== 'undefined') self.SFContainerTreeUI = SFContainerTreeUI;
