// API mode: the response-tree editor: the rows, the "add group" and "edit a leaf's transforms" modals, and the JSON-scoped search that adds a
// field or group to a confirmed tree. See api-config-ui.ts for the `bridge` convention.
import type * as SFWire from '../types/wire';
import type { PopupBridge } from '../types/popup';
import type { ApiCandidate } from '../types/messages';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import {
  STATES, buildApiGroupDraft, insertApiTreeNode, updateApiTreeNode, removeApiTreeNode, resolveApiTreeNode, buildApiSubtreeFromCandidate, resolveApiGroupScopePath,
} from './api-config';
import type { ApiConfigDraft, ApiFieldDraft, ApiNodeDraft } from './api-config';
import { transformsAreValid, addTransform } from './field-transforms';
import { wireTransformList } from './field-transforms-ui';
import { isDerivedField } from './combine-split-fields';
import { openCombineFieldModal, openSplitFieldModal } from './combine-split-fields-ui';
import { patchApiConfigDraft } from './api-config-shared-ui';
import { wirePathPickerEvents } from './json-path-picker-ui';
import { byIdOrNull } from './dom';

const log = createLogger('SF:ApiConfigUI');

// These handlers only run on the API_CONFIG screen, where the draft exists.
const currentDraft = (bridge: PopupBridge): ApiConfigDraft => bridge.getState().apiConfigDraft as ApiConfigDraft;
// A tree draft (the flat `fields` shape only exists on the wire): `groups` is always set while the screen is open.
const currentGroups = (bridge: PopupBridge): ApiNodeDraft[] => currentDraft(bridge).groups as ApiNodeDraft[];

// Issue #139: one static inline chevron per row instead of swapping between
// two different Unicode glyphs (▸/▾) on click — see container-tree-ui.js's
// own copy of this constant for the full rationale.
const TREE_TOGGLE_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"></polyline></svg>';

// Same pattern as the container tree editor (buildGroupTreeNodeEl). Rows differ: an editable name input and a read-only path; no
// repeating / attribute / mode label and no frame badge (JSON has no iframes).
export function buildApiTreeNodeEl(node: ApiNodeDraft, path: number[], depth: number): HTMLElement {
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
  // distinguishing description instead of "—", mirroring container-tree.ts's
  // own groupNodeSuffix branch for the identical case.
  const derived = node.kind === 'field' && isDerivedField(node.transforms) ? (node.transforms as SFWire.FieldTransform[])[0] : null;
  pathLabel.textContent = derived
    ? (derived.kind === 'combineFields'
      ? t('group.combinedFieldMode', { sources: derived.sourceFieldNames.join(', ') })
      : t('group.splitFieldMode', { source: (derived as SFWire.SplitFieldTransform).sourceFieldName }))
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

export function renderApiTree(groups: ApiNodeDraft[]): void {
  const root = byIdOrNull('api-tree-root');
  if (!root) return;
  root.innerHTML = '';
  groups.forEach((node, i) => root.appendChild(buildApiTreeNodeEl(node, [i], 0)));
}
// ── Candidate search results ──
// Renders findApiCandidates' output: per candidate the request, JSON path and matched value, with the sibling scalar keys as click-to-toggle
// suggestions for more fields.

// A tree sourced from an embedded <script> tag (draft.embeddedJsonSource) is extended by scanning that same tag, not the recorded pool (there
// is only one source once ScriptSelector is fixed). confirmApiTreeFieldCandidate needs no change: both search kinds fill treeSkeleton / siblings.
export function startApiTreeFieldSearch(bridge: PopupBridge, parentPath: number[] | null): void {
  const state = bridge.getState();
  const scopePath = parentPath ? resolveApiGroupScopePath(currentGroups(bridge), parentPath) : null;
  const embeddedJsonSource = currentDraft(bridge).embeddedJsonSource;
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
export function confirmApiTreeFieldCandidate(bridge: PopupBridge, candidate: ApiCandidate, fieldName: string, siblingNames: string[]): void {
  const state = bridge.getState();
  const { treeParentPath } = state.apiTreeSearchResult as NonNullable<typeof state.apiTreeSearchResult>; // the panel it is confirmed from only shows with a result
  const skipSegments = treeParentPath ? treeParentPath.length : 0;
  const newNodes = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames, skipSegments);
  log('API_TREE_FIELD_CONFIRM', { treeParentPath, fieldName, siblingNames });
  const groups = newNodes.reduce((acc, node) => insertApiTreeNode(acc, treeParentPath, node), currentGroups(bridge));
  bridge.setState(STATES.API_CONFIG, { apiTreeSearchResult: null, apiConfigDraft: { ...currentDraft(bridge), groups } });
}

export function openApiGroupModal(bridge: PopupBridge, parentPath: number[] | null): void {
  log('API_GROUP_MODAL open', { parentPath });
  bridge.patchState({ apiGroupModalOpen: true, pendingApiTreeParentPath: parentPath });
}

export function confirmApiGroupModal(bridge: PopupBridge): void {
  const name = byIdOrNull<HTMLInputElement>('input-api-group-name')?.value.trim();
  const path = byIdOrNull<HTMLInputElement>('input-api-group-path')?.value.trim();
  // A JSON path can legitimately be "" (array of arrays), but only through automatic derivation; requiring a non-empty path keeps this no-click
  // modal unambiguous.
  if (!name || !path) return;

  const node = buildApiGroupDraft(name, path);
  const state = bridge.getState();
  log('API_TREE_GROUP_ADD', { name, path, parentPath: state.pendingApiTreeParentPath });
  bridge.setState(STATES.API_CONFIG, {
    apiConfigDraft: { ...currentDraft(bridge), groups: insertApiTreeNode(currentGroups(bridge), state.pendingApiTreeParentPath, node) },
    apiGroupModalOpen: false, pendingApiTreeParentPath: null, apiPathPicker: null,
  });
}

export function cancelApiGroupModal(bridge: PopupBridge): void {
  log('API_GROUP_MODAL cancel');
  bridge.patchState({ apiGroupModalOpen: false, pendingApiTreeParentPath: null, apiPathPicker: null });
}

// Renames a tree node in place — Phase A5 generalization of
// setApiConfigFieldName (the old flat-only version), see updateApiTreeNode.
export function setApiTreeNodeName(bridge: PopupBridge, path: number[], name: string): void {
  patchApiConfigDraft(bridge, { groups: updateApiTreeNode(currentGroups(bridge), path, node => ({ ...node, name })) });
}

// ── Field transforms ──
// Reuses the flat / container transform editor and _state.pendingTransforms (these screens never overlap). The live preview reuses
// _state.pendingRawText: the node's sampleValue stringified like the runtime (`"" if value is None else str(value)`); undefined (a
// hand-typed path with no click behind it) maps to null, so the hint hides instead of showing a misleading empty result.
function sampleValueToRawText(sampleValue: unknown): string | null {
  if (sampleValue === undefined) return null;
  return sampleValue === null ? '' : String(sampleValue);
}

export function openApiFieldTransformsModal(bridge: PopupBridge, path: number[]): void {
  const node = resolveApiTreeNode(currentGroups(bridge), path) as ApiFieldDraft; // the button exists on a leaf only
  log('API_FIELD_TRANSFORMS_MODAL open', { path });
  bridge.patchState({
    apiFieldTransformModalOpen: true, pendingApiFieldTransformPath: path,
    pendingTransforms: node.transforms || [],
    pendingRawText: sampleValueToRawText(node.sampleValue),
  });
}

export function confirmApiFieldTransformsModal(bridge: PopupBridge): void {
  const state = bridge.getState();
  if (!transformsAreValid(state.pendingTransforms)) return;
  const transforms = state.pendingTransforms.length > 0 ? state.pendingTransforms : null;
  const groups = updateApiTreeNode(currentGroups(bridge), state.pendingApiFieldTransformPath as number[], node => ({ ...(node as ApiFieldDraft), transforms }));

  log('API_FIELD_TRANSFORMS_CONFIRM', { path: state.pendingApiFieldTransformPath, transforms });
  bridge.setState(STATES.API_CONFIG, {
    apiConfigDraft: { ...currentDraft(bridge), groups },
    apiFieldTransformModalOpen: false, pendingApiFieldTransformPath: null, pendingTransforms: [], pendingRawText: null,
  });
}

export function cancelApiFieldTransformsModal(bridge: PopupBridge): void {
  log('API_FIELD_TRANSFORMS_MODAL cancel');
  bridge.patchState({ apiFieldTransformModalOpen: false, pendingApiFieldTransformPath: null, pendingTransforms: [], pendingRawText: null });
}

export function wireApiResponseTreeEvents(bridge: PopupBridge): void {
  wirePathPickerEvents(bridge, byIdOrNull('modal-api-group-new')); // Issue #404
  byIdOrNull('btn-api-tree-add-root')?.addEventListener('click', () => startApiTreeFieldSearch(bridge, null));

  // Event delegation for the API-tree's per-row add/remove buttons and name
  // input — mirrors the Container-tree's own delegation below.
  byIdOrNull('api-tree-root')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const li = target.closest<HTMLElement>('.api-tree-node');
    if (!li) return;
    const path: number[] = JSON.parse(li.dataset.path as string); // written by buildApiTreeNodeEl

    if (target.closest('.btn-add-api-subgroup')) { openApiGroupModal(bridge, path); return; }
    if (target.closest('.btn-add-api-subfield')) { startApiTreeFieldSearch(bridge, path); return; }
    // Issue #206 follow-up: no click-based/JSON-path search at all — opens
    // the shared combine/split creation modal directly, scoped to this
    // group's own children (same `path` .btn-add-api-subfield already
    // targets).
    if (target.closest('.btn-add-api-combine-field')) { openCombineFieldModal(bridge, { mode: 'api', groupPath: path }); return; }
    if (target.closest('.btn-add-api-split-field')) { openSplitFieldModal(bridge, { mode: 'api', groupPath: path }); return; }
    if (target.closest('.btn-api-field-transforms')) { openApiFieldTransformsModal(bridge, path); return; }
    if (target.closest('.btn-remove-api-node')) {
      log('API_TREE_NODE_REMOVE', { path });
      bridge.setState(bridge.getState().current, { apiConfigDraft: { ...currentDraft(bridge), groups: removeApiTreeNode(currentGroups(bridge), path) } });
    }
  });

  byIdOrNull('api-tree-root')?.addEventListener('change', (e) => {
    const nameInput = (e.target as Element).closest<HTMLInputElement>('.api-tree-name');
    if (nameInput) setApiTreeNodeName(bridge, JSON.parse(nameInput.dataset.path as string), nameInput.value.trim());
  });

  byIdOrNull('btn-api-group-confirm')?.addEventListener('click', () => confirmApiGroupModal(bridge));
  byIdOrNull('input-api-group-path')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmApiGroupModal(bridge);
  });
  byIdOrNull('btn-api-group-cancel')?.addEventListener('click', () => cancelApiGroupModal(bridge));

  // Issue #84 follow-up: API-mode field transforms modal — reuses the same
  // transform-chain editor (field-transforms.ts/field-transforms-ui.js) the
  // flat/container field modals already wire up above.
  byIdOrNull('btn-api-field-transforms-add')?.addEventListener('click', () => {
    bridge.patchState({ pendingTransforms: addTransform(bridge.getState().pendingTransforms) });
  });
  wireTransformList(
    'api-field-transform-list',
    () => bridge.getState().pendingTransforms,
    (transforms: SFWire.FieldTransform[]) => bridge.patchState({ pendingTransforms: transforms }),
    () => bridge.getState().pendingRawText,
  );
  byIdOrNull('btn-api-field-transforms-confirm')?.addEventListener('click', () => confirmApiFieldTransformsModal(bridge));
  byIdOrNull('btn-api-field-transforms-cancel')?.addEventListener('click', () => cancelApiFieldTransformsModal(bridge));
}
