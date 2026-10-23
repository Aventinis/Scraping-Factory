// API mode: the response-tree editor: the rows, the "add group" and "edit a leaf's transforms" modals, and the JSON-scoped search that adds a
// field or group to a confirmed tree. See api-config-ui.js for the `bridge` convention.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const {
  STATES, buildApiGroupDraft, insertApiTreeNode, updateApiTreeNode, removeApiTreeNode, resolveApiTreeNode, buildApiSubtreeFromCandidate, resolveApiGroupScopePath,
} = require('./api-config');
const { transformsAreValid, addTransform } = require('./field-transforms');
const { wireTransformList } = require('./field-transforms-ui');
const { isDerivedField } = require('./combine-split-fields');
const { openCombineFieldModal, openSplitFieldModal } = require('./combine-split-fields-ui');
const { patchApiConfigDraft } = require('./api-config-shared-ui');
const { wirePathPickerEvents } = require('./json-path-picker-ui');

// Issue #139: one static inline chevron per row instead of swapping between
// two different Unicode glyphs (▸/▾) on click — see container-tree-ui.js's
// own copy of this constant for the full rationale.
const TREE_TOGGLE_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"></polyline></svg>';

// Same pattern as the container tree editor (buildGroupTreeNodeEl). Rows differ: an editable name input and a read-only path; no
// repeating / attribute / mode label and no frame badge (JSON has no iframes).
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
  if (hasChildren) toggle.innerHTML = TREE_TOGGLE_CHEVRON_SVG; // starts expanded, see below
  row.appendChild(toggle);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'api-tree-name';
  nameInput.dataset.path = JSON.stringify(path);
  nameInput.value = node.name;
  row.appendChild(nameInput);

  const pathLabel = document.createElement('span');
  pathLabel.className = 'api-tree-path';
  // Issue #206 follow-up: node.path is null for a combine/split-derived
  // field (see buildApiFieldDraft's own doc comment) — shows a
  // distinguishing description instead of "—", mirroring container-tree.js's
  // own groupNodeSuffix branch for the identical case.
  pathLabel.textContent = isDerivedField(node.transforms)
    ? (node.transforms[0].kind === 'combineFields'
      ? t('group.combinedFieldMode', { sources: node.transforms[0].sourceFieldNames.join(', ') })
      : t('group.splitFieldMode', { source: node.transforms[0].sourceFieldName }))
    : (node.path || '—');
  pathLabel.title = node.path || '';
  row.appendChild(pathLabel);

  if (node.kind === 'field' && node.hiddenFromOutput) {
    const hiddenBadge = document.createElement('span');
    hiddenBadge.className = 'field-hidden-badge';
    hiddenBadge.textContent = t('group.hiddenFromOutputBadge');
    row.appendChild(hiddenBadge);
  }

  if (node.kind === 'group') {
    const addSubgroupBtn = document.createElement('button');
    addSubgroupBtn.className = 'btn-secondary btn-tiny btn-add-api-subgroup';
    addSubgroupBtn.textContent = t('apiTree.addSubgroupBtn');
    row.appendChild(addSubgroupBtn);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-secondary btn-tiny btn-add-api-subfield';
    addFieldBtn.textContent = t('apiTree.addSubfieldBtn');
    row.appendChild(addFieldBtn);

    // Issue #206 follow-up: disabled below the minimum field count each
    // kind needs — same reasoning container-tree-ui.js's own
    // buildGroupTreeNodeEl uses.
    const fieldSiblingCount = node.children.filter(c => c.kind === 'field').length;

    const addCombineFieldBtn = document.createElement('button');
    addCombineFieldBtn.className = 'btn-secondary btn-tiny btn-add-api-combine-field';
    addCombineFieldBtn.textContent = t('apiTree.combineFieldsBtn');
    addCombineFieldBtn.disabled = fieldSiblingCount < 2;
    row.appendChild(addCombineFieldBtn);

    const addSplitFieldBtn = document.createElement('button');
    addSplitFieldBtn.className = 'btn-secondary btn-tiny btn-add-api-split-field';
    addSplitFieldBtn.textContent = t('apiTree.splitFieldBtn');
    addSplitFieldBtn.disabled = fieldSiblingCount < 1;
    row.appendChild(addSplitFieldBtn);
  }

  // Issue #84 follow-up: only a leaf actually extracts a value (ApiGroup
  // has no Transforms property on the companion side, see IR/ApiConfig.cs)
  // — same reasoning Container-Mode's own transforms section already
  // follows for "Vorhanden?" mode.
  if (node.kind === 'field') {
    const transformsBtn = document.createElement('button');
    transformsBtn.className = 'btn-secondary btn-tiny btn-api-field-transforms';
    transformsBtn.textContent = node.transforms && node.transforms.length > 0
      ? t('apiTree.transformsBtnCount', { count: node.transforms.length })
      : t('apiTree.transformsBtn');
    row.appendChild(transformsBtn);
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
        toggle.classList.toggle('collapsed', collapsed);
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
// ── Candidate search results ──
// Renders findApiCandidates' output: per candidate the request, JSON path and matched value, with the sibling scalar keys as click-to-toggle
// suggestions for more fields.

// A tree sourced from an embedded <script> tag (draft.embeddedJsonSource) is extended by scanning that same tag, not the recorded pool (there
// is only one source once ScriptSelector is fixed). confirmApiTreeFieldCandidate needs no change: both search kinds fill treeSkeleton / siblings.
function startApiTreeFieldSearch(bridge, parentPath) {
  const state = bridge.getState();
  const scopePath = parentPath ? resolveApiGroupScopePath(state.apiConfigDraft.groups, parentPath) : null;
  const embeddedJsonSource = state.apiConfigDraft.embeddedJsonSource;
  log('API_TREE_FIELD_SEARCH start', { parentPath, scopePath, embeddedJsonSource });
  if (embeddedJsonSource) {
    chrome.runtime.sendMessage({
      type: 'START_SELECTION', embeddedJsonSearch: true,
      embeddedJsonScopePath: scopePath, embeddedJsonScriptSelector: embeddedJsonSource.scriptSelector,
    });
  } else {
    chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true, apiScopePath: scopePath });
  }
  bridge.setState(STATES.SELECTING, {
    apiSearchTarget: { treeParentPath: parentPath }, pendingSelector: null, apiTreeSearchResult: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (state.domViewEnabled) bridge.requestDomTree();
}

// skipSegments = the target group's own tree depth: that many of the
// candidate's derived skeleton segments are already represented by existing
// ancestor groups (see resolveApiGroupScopePath) — 0 for a new root.
function confirmApiTreeFieldCandidate(bridge, candidate, fieldName, siblingNames) {
  const state = bridge.getState();
  const { treeParentPath } = state.apiTreeSearchResult;
  const skipSegments = treeParentPath ? treeParentPath.length : 0;
  const newNodes = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames, skipSegments);
  log('API_TREE_FIELD_CONFIRM', { treeParentPath, fieldName, siblingNames });
  const groups = newNodes.reduce((acc, node) => insertApiTreeNode(acc, treeParentPath, node), state.apiConfigDraft.groups);
  bridge.setState(STATES.API_CONFIG, { apiTreeSearchResult: null, apiConfigDraft: { ...state.apiConfigDraft, groups } });
}

function openApiGroupModal(bridge, parentPath) {
  log('API_GROUP_MODAL open', { parentPath });
  bridge.patchState({ apiGroupModalOpen: true, pendingApiTreeParentPath: parentPath });
}

function confirmApiGroupModal(bridge) {
  const name = document.getElementById('input-api-group-name')?.value.trim();
  const path = document.getElementById('input-api-group-path')?.value.trim();
  // A JSON path can legitimately be "" (array of arrays), but only through automatic derivation; requiring a non-empty path keeps this no-click
  // modal unambiguous.
  if (!name || !path) return;

  const node = buildApiGroupDraft(name, path);
  const state = bridge.getState();
  log('API_TREE_GROUP_ADD', { name, path, parentPath: state.pendingApiTreeParentPath });
  bridge.setState(STATES.API_CONFIG, {
    apiConfigDraft: { ...state.apiConfigDraft, groups: insertApiTreeNode(state.apiConfigDraft.groups, state.pendingApiTreeParentPath, node) },
    apiGroupModalOpen: false, pendingApiTreeParentPath: null, apiPathPicker: null,
  });
}

function cancelApiGroupModal(bridge) {
  log('API_GROUP_MODAL cancel');
  bridge.patchState({ apiGroupModalOpen: false, pendingApiTreeParentPath: null, apiPathPicker: null });
}

// Renames a tree node in place — Phase A5 generalization of
// setApiConfigFieldName (the old flat-only version), see updateApiTreeNode.
function setApiTreeNodeName(bridge, path, name) {
  patchApiConfigDraft(bridge, { groups: updateApiTreeNode(bridge.getState().apiConfigDraft.groups, path, node => ({ ...node, name })) });
}

// ── Field transforms ──
// Reuses the flat / container transform editor and _state.pendingTransforms (these screens never overlap). The live preview reuses
// _state.pendingRawText: the node's sampleValue stringified like the runtime (`"" if value is None else str(value)`); undefined (a
// hand-typed path with no click behind it) maps to null, so the hint hides instead of showing a misleading empty result.
function sampleValueToRawText(sampleValue) {
  if (sampleValue === undefined) return null;
  return sampleValue === null ? '' : String(sampleValue);
}

function openApiFieldTransformsModal(bridge, path) {
  const node = resolveApiTreeNode(bridge.getState().apiConfigDraft.groups, path);
  log('API_FIELD_TRANSFORMS_MODAL open', { path });
  bridge.patchState({
    apiFieldTransformModalOpen: true, pendingApiFieldTransformPath: path,
    pendingTransforms: node.transforms || [],
    pendingRawText: sampleValueToRawText(node.sampleValue),
  });
}

function confirmApiFieldTransformsModal(bridge) {
  const state = bridge.getState();
  if (!transformsAreValid(state.pendingTransforms)) return;
  const transforms = state.pendingTransforms.length > 0 ? state.pendingTransforms : null;
  const groups = updateApiTreeNode(state.apiConfigDraft.groups, state.pendingApiFieldTransformPath, node => ({ ...node, transforms }));

  log('API_FIELD_TRANSFORMS_CONFIRM', { path: state.pendingApiFieldTransformPath, transforms });
  bridge.setState(STATES.API_CONFIG, {
    apiConfigDraft: { ...state.apiConfigDraft, groups },
    apiFieldTransformModalOpen: false, pendingApiFieldTransformPath: null, pendingTransforms: [], pendingRawText: null,
  });
}

function cancelApiFieldTransformsModal(bridge) {
  log('API_FIELD_TRANSFORMS_MODAL cancel');
  bridge.patchState({ apiFieldTransformModalOpen: false, pendingApiFieldTransformPath: null, pendingTransforms: [], pendingRawText: null });
}

function wireApiResponseTreeEvents(bridge) {
  wirePathPickerEvents(bridge, document.getElementById('modal-api-group-new')); // Issue #404
  document.getElementById('btn-api-tree-add-root')?.addEventListener('click', () => startApiTreeFieldSearch(bridge, null));

  // Event delegation for the API-tree's per-row add/remove buttons and name
  // input — mirrors the Container-tree's own delegation below.
  document.getElementById('api-tree-root')?.addEventListener('click', (e) => {
    const li = e.target.closest('.api-tree-node');
    if (!li) return;
    const path = JSON.parse(li.dataset.path);

    if (e.target.closest('.btn-add-api-subgroup')) { openApiGroupModal(bridge, path); return; }
    if (e.target.closest('.btn-add-api-subfield')) { startApiTreeFieldSearch(bridge, path); return; }
    // Issue #206 follow-up: no click-based/JSON-path search at all — opens
    // the shared combine/split creation modal directly, scoped to this
    // group's own children (same `path` .btn-add-api-subfield already
    // targets).
    if (e.target.closest('.btn-add-api-combine-field')) { openCombineFieldModal(bridge, { mode: 'api', groupPath: path }); return; }
    if (e.target.closest('.btn-add-api-split-field')) { openSplitFieldModal(bridge, { mode: 'api', groupPath: path }); return; }
    if (e.target.closest('.btn-api-field-transforms')) { openApiFieldTransformsModal(bridge, path); return; }
    if (e.target.closest('.btn-remove-api-node')) {
      log('API_TREE_NODE_REMOVE', { path });
      bridge.setState(bridge.getState().current, { apiConfigDraft: { ...bridge.getState().apiConfigDraft, groups: removeApiTreeNode(bridge.getState().apiConfigDraft.groups, path) } });
    }
  });

  document.getElementById('api-tree-root')?.addEventListener('change', (e) => {
    const nameInput = e.target.closest('.api-tree-name');
    if (nameInput) setApiTreeNodeName(bridge, JSON.parse(nameInput.dataset.path), nameInput.value.trim());
  });

  document.getElementById('btn-api-group-confirm')?.addEventListener('click', () => confirmApiGroupModal(bridge));
  document.getElementById('input-api-group-path')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmApiGroupModal(bridge);
  });
  document.getElementById('btn-api-group-cancel')?.addEventListener('click', () => cancelApiGroupModal(bridge));

  // Issue #84 follow-up: API-mode field transforms modal — reuses the same
  // transform-chain editor (field-transforms.js/field-transforms-ui.js) the
  // flat/container field modals already wire up above.
  document.getElementById('btn-api-field-transforms-add')?.addEventListener('click', () => {
    bridge.patchState({ pendingTransforms: addTransform(bridge.getState().pendingTransforms) });
  });
  wireTransformList(
    'api-field-transform-list',
    () => bridge.getState().pendingTransforms,
    (transforms) => bridge.patchState({ pendingTransforms: transforms }),
    () => bridge.getState().pendingRawText,
  );
  document.getElementById('btn-api-field-transforms-confirm')?.addEventListener('click', () => confirmApiFieldTransformsModal(bridge));
  document.getElementById('btn-api-field-transforms-cancel')?.addEventListener('click', () => cancelApiFieldTransformsModal(bridge));
}

module.exports = {
  buildApiTreeNodeEl,
  renderApiTree,
  startApiTreeFieldSearch,
  confirmApiTreeFieldCandidate,
  openApiGroupModal,
  confirmApiGroupModal,
  cancelApiGroupModal,
  setApiTreeNodeName,
  openApiFieldTransformsModal,
  confirmApiFieldTransformsModal,
  cancelApiFieldTransformsModal,
  wireApiResponseTreeEvents,
};
