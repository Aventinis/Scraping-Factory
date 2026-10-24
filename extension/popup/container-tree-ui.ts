// Container mode's own DOM rendering and event-handling logic: the group-
// tree editor's row rendering, and every handler that adds/confirms a new
// container/field within it. Split out of popup.ts (which had grown past
// 3800 lines) purely for readability — no behavior change.
//
// Like api-config-ui.ts, the handler functions below (anything that reads or
// mutates popup state) take a `bridge` object — `{ getState, setState,
// patchState, stopPreviewIfActive, requestDomTree }` — as their first
// parameter, built once by popup.ts's wireEvents() and passed through on
// every call, instead of closing over popup.ts's own `_state`/`setState`/etc.
// See api-config-ui.ts's own doc comment for why (load order + Jest module
// isolation both rule out a plain closure here). renderGroupTree/
// buildGroupTreeNodeEl need none of this — already pure, explicit-argument
// functions before the split and still are.
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { buildGroupNodeHighlight, wireHoverHighlight } from './hover-highlight';
import { t } from '../i18n/i18n';
import { STATES } from './api-config';
import {
  groupNodeSuffix, resolveGroupNode, hasRepeatingAncestor, buildFieldNode, insertContainerNode,
  removeGroupTreeNode, updateGroupTreeNode, moveGroupTreeNode,
  parseAllowedContentTypes, megabytesToBytes,
} from './container-tree';
import { transformsAreValid, addTransform } from './field-transforms';
import { appendTextFilter } from './selector-text-filter';
import { resetTextFilter, effectiveMatchCount, wireTextFilter } from './selector-text-filter-ui';
import { renderTransformList, renderTransformPreview, wireTransformList } from './field-transforms-ui';
import { openCombineFieldModal, openSplitFieldModal } from './combine-split-fields-ui';
import { renderMatchCountHint, populateAttributeSelect } from './field-modal';
import { byIdOrNull, parseDataPath } from './dom';

const log = createLogger('SF:ContainerTreeUI');

// Issue #139: one static inline chevron per row instead of swapping between
// two different Unicode glyphs (▸/▾) on click — collapsed/expanded is now a
// CSS rotation driven by the .collapsed class (see popup.html's shared
// .group-tree-toggle svg / .collapsed rule). Same duplicated-per-file
// pattern api-config-ui.ts/popup.ts use for their own tree toggles.
const TREE_TOGGLE_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"></polyline></svg>';

// ── Container tree editor ────────────────────────────────────────────────────
// Same visual pattern as the DOM-tree-view below (indentation, toggle arrow,
// click-to-collapse — see buildTreeNodeEl) but editable: rows carry
// add-container/add-field/remove buttons, and nodes start expanded since
// this tree is user-authored and typically small, unlike a full page DOM.

export function buildGroupTreeNodeEl(node: SFDraft.ContainerNode, path: number[], depth: number, siblingCount: number): HTMLElement {
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

  // Issue #177: an editable name input (same shape as api-config-ui.ts's
  // own tree-row nameInput) instead of a plain label — formatGroupNodeLabel's
  // own name+suffix text is now split across this and the read-only suffix
  // span below it.
  const index = path[path.length - 1];
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'group-tree-name';
  nameInput.dataset.path = JSON.stringify(path);
  nameInput.value = node.name;
  // Issue #206 follow-up: node.selector is null for a combine/split-
  // derived field (see buildFieldNode's own doc comment) — '' avoids
  // setting the title attribute to the literal string "null".
  nameInput.title = node.selector || '';
  row.appendChild(nameInput);

  // Issue #398: a group's "(single)"/"(repeating)" suffix is a button that
  // switches the type — it can't be changed anywhere else once the container
  // exists, and the match-count toast right after the pick points at it.
  const suffix: HTMLElement = document.createElement(node.kind === 'group' ? 'button' : 'span');
  suffix.className = 'group-tree-label';
  suffix.textContent = groupNodeSuffix(node);
  if (node.kind === 'group') {
    (suffix as HTMLButtonElement).type = 'button';
    suffix.classList.add('group-tree-type');
    suffix.title = t(node.repeating ? 'group.toggleToSingleTitle' : 'group.toggleToRepeatingTitle');
  } else {
    suffix.title = node.selector || '';
  }
  row.appendChild(suffix);

  if (node.kind === 'field' && node.hiddenFromOutput) {
    const hiddenBadge = document.createElement('span');
    hiddenBadge.className = 'field-hidden-badge';
    hiddenBadge.textContent = t('group.hiddenFromOutputBadge');
    row.appendChild(hiddenBadge);
  }

  if (node.framePath) {
    const badge = document.createElement('span');
    badge.className = 'frame-badge';
    badge.title = t('frame.badgeTitle', { path: node.framePath.join(' > ') });
    badge.textContent = t('frame.badge');
    row.appendChild(badge);
  }

  // Issue #177: reorder among direct siblings — mirrors field-transforms-ui.ts's
  // own move-up/move-down buttons (bare arrow glyphs, disabled at the
  // boundary) rather than introducing a new UI convention for "move within
  // a list".
  const moveUpBtn = document.createElement('button');
  moveUpBtn.type = 'button';
  moveUpBtn.className = 'btn-secondary btn-tiny btn-group-move-up';
  moveUpBtn.textContent = '↑';
  moveUpBtn.disabled = index === 0;
  row.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement('button');
  moveDownBtn.type = 'button';
  moveDownBtn.className = 'btn-secondary btn-tiny btn-group-move-down';
  moveDownBtn.textContent = '↓';
  moveDownBtn.disabled = index === siblingCount - 1;
  row.appendChild(moveDownBtn);

  if (node.kind === 'group') {
    const addContainerBtn = document.createElement('button');
    addContainerBtn.className = 'btn-secondary btn-tiny btn-add-subcontainer';
    addContainerBtn.textContent = t('group.addSubcontainerBtn');
    row.appendChild(addContainerBtn);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-secondary btn-tiny btn-add-subfield';
    addFieldBtn.textContent = t('group.addSubfieldBtn');
    row.appendChild(addFieldBtn);

    // Issue #206 follow-up: disabled (not hidden) below the minimum field
    // count each kind needs — clicking "+ Datenfeld" first to build up
    // real fields to combine/split is the expected path, same reasoning
    // idle-screen-ui.ts's own flat-mode button-disable logic uses.
    const fieldSiblingCount = node.children.filter(c => c.kind === 'field').length;

    const addCombineFieldBtn = document.createElement('button');
    addCombineFieldBtn.className = 'btn-secondary btn-tiny btn-add-combine-field';
    addCombineFieldBtn.textContent = t('group.combineFieldsBtn');
    addCombineFieldBtn.disabled = fieldSiblingCount < 2;
    row.appendChild(addCombineFieldBtn);

    const addSplitFieldBtn = document.createElement('button');
    addSplitFieldBtn.className = 'btn-secondary btn-tiny btn-add-split-field';
    addSplitFieldBtn.textContent = t('group.splitFieldBtn');
    addSplitFieldBtn.disabled = fieldSiblingCount < 1;
    row.appendChild(addSplitFieldBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-danger btn-remove-group-node';
  removeBtn.textContent = t('common.remove');
  row.appendChild(removeBtn);

  li.appendChild(row);

  if (node.kind === 'group') {
    const childUl = document.createElement('ul');
    childUl.className = 'group-tree-children';
    node.children.forEach((child, i) => childUl.appendChild(buildGroupTreeNodeEl(child, [...path, i], depth + 1, node.children.length)));
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

export function renderGroupTree(groups: SFDraft.ContainerNode[]): void {
  const root = byIdOrNull('group-tree-root');
  if (!root) return;
  root.innerHTML = '';
  groups.forEach((node, i) => root.appendChild(buildGroupTreeNodeEl(node, [i], 0, groups.length)));
}
export function openContainerModal(bridge: PopupBridge, parentPath: number[] | null): void {
  log('CONTAINER_MODAL open', { parentPath });
  bridge.patchState({ containerModalOpen: true, pendingParentPath: parentPath });
}

// Container-add order is deliberately "name/type first, then click an
// element" (unlike field-add below) — see planning-container-scraping.md.
export function confirmContainerModal(bridge: PopupBridge): void {
  const name = byIdOrNull<HTMLInputElement>('input-container-name')?.value.trim();
  if (!name) return;
  const repeating = byIdOrNull<HTMLInputElement>('radio-container-repeating')?.checked ?? false;
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

export function cancelContainerModal(bridge: PopupBridge): void {
  log('CONTAINER_MODAL cancel');
  bridge.setState(bridge.getState().current, { containerModalOpen: false, pendingParentPath: null });
}

// Field-add within a container keeps the flat mode's order — click first,
// name/type after — since the field type doesn't affect what gets clicked.
export function startFieldSelection(bridge: PopupBridge, parentPath: number[]): void {
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

export function confirmExtendedField(bridge: PopupBridge): void {
  const name = byIdOrNull<HTMLInputElement>('input-field-extended-name')?.value.trim();
  if (!name) return;
  // The mode select only offers the four FieldMode values.
  const mode = (byIdOrNull<HTMLSelectElement>('select-field-mode')?.value ?? 'text') as SFDraft.FieldMode;
  const attribute = byIdOrNull<HTMLSelectElement>('select-field-attribute')?.value.trim();
  if (mode === 'attribute' && !attribute) return;
  const download = byIdOrNull<HTMLInputElement>('toggle-field-download')?.checked ?? false;
  const maxDownloadSizeBytes = megabytesToBytes(byIdOrNull<HTMLInputElement>('input-field-download-max-size')?.value as string);
  const allowedContentTypes = parseAllowedContentTypes(byIdOrNull<HTMLInputElement>('input-field-download-allowed-types')?.value as string);

  const state = bridge.getState();
  if (!transformsAreValid(state.pendingTransforms)) return;
  // Issue #227: an optional text the element must contain — appended as a
  // :contains("…") suffix; blank leaves the pick's selector untouched.
  const selector = appendTextFilter(state.pendingSelector as string, byIdOrNull<HTMLInputElement>('input-field-text-filter')?.value);
  const node = buildFieldNode(
    name, selector, mode, attribute ?? null, state.pendingFramePath, state.pendingTransforms, download,
    maxDownloadSizeBytes, allowedContentTypes,
  );
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

export function cancelExtendedField(bridge: PopupBridge): void {
  log('FIELD_ADD(container) cancel');
  bridge.setState(STATES.IDLE, {
    pendingSelector: null, pendingFramePath: null, pendingMatchCount: null,
    pendingRawText: null, pendingElementAttributes: null,
    pendingTransforms: [], pendingParentPath: null, selectionKind: null,
  });
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
function resolveExtendedRawValue(state: State): string | null {
  const mode = byIdOrNull<HTMLSelectElement>('select-field-mode')?.value ?? 'text';
  let rawValue: string | null = null;
  if (mode === 'text') {
    rawValue = state.pendingRawText;
  } else if (mode === 'attribute') {
    const attrName = byIdOrNull<HTMLSelectElement>('select-field-attribute')?.value.trim();
    if (attrName) rawValue = (state.pendingElementAttributes?.[attrName] ?? '').trim();
  } else if (mode === 'ownText') {
    rawValue = state.pendingOwnText;
  }
  return rawValue;
}

export function refreshExtendedTransformPreview(bridge: PopupBridge): void {
  const state = bridge.getState();
  renderTransformPreview('field-extended-transform-preview', resolveExtendedRawValue(state), state.pendingTransforms);
}

export function renderContainerFieldModal(bridge: PopupBridge, isNewPick: boolean): void {
  const state = bridge.getState();
  byIdOrNull('modal-field-extended')?.classList.remove('hidden');
  if (isNewPick) {
    const nameInput = byIdOrNull<HTMLInputElement>('input-field-extended-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const modeSelect = byIdOrNull<HTMLSelectElement>('select-field-mode');
    if (modeSelect) modeSelect.value = 'text';
    byIdOrNull('field-attribute-row')?.classList.add('hidden');
    byIdOrNull('field-extended-transforms-section')?.classList.remove('hidden');
    populateAttributeSelect('select-field-attribute', state.pendingElementAttributes);
    const downloadToggle = byIdOrNull<HTMLInputElement>('toggle-field-download');
    if (downloadToggle) downloadToggle.checked = false;
    byIdOrNull('field-download-options')?.classList.add('hidden');
    const maxSizeInput = byIdOrNull<HTMLInputElement>('input-field-download-max-size');
    if (maxSizeInput) maxSizeInput.value = '';
    const allowedTypesInput = byIdOrNull<HTMLInputElement>('input-field-download-allowed-types');
    if (allowedTypesInput) allowedTypesInput.value = '';
    resetTextFilter('input-field-text-filter', 'btn-field-use-text', state.pendingRawText);
  }
  renderMatchCountHint('field-extended-match-count', effectiveMatchCount('input-field-text-filter', state.pendingMatchCount));
  renderTransformList('field-extended-transform-list', state.pendingTransforms, () => resolveExtendedRawValue(bridge.getState()));
  refreshExtendedTransformPreview(bridge);
}

export function wireContainerModeEvents(bridge: PopupBridge): void {
  // Issue #233: hovering a tree row (group or field) highlights that node's
  // element(s) on the page — in every instance of its repeating ancestors.
  wireHoverHighlight(byIdOrNull('group-tree-root'), '.group-tree-row',
    row => buildGroupNodeHighlight(bridge.getState().groups, parseDataPath(row.closest('.group-tree-node') as HTMLElement)));

  byIdOrNull('btn-add-root-container')?.addEventListener('click', () => openContainerModal(bridge, null));

  // Event delegation for the container tree's per-row add/remove/move buttons
  byIdOrNull('group-tree-root')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const li = target.closest<HTMLElement>('.group-tree-node');
    if (!li) return;
    const path = parseDataPath(li);

    if (target.closest('.btn-add-subcontainer')) { openContainerModal(bridge, path); return; }
    if (target.closest('.btn-add-subfield')) { startFieldSelection(bridge, path); return; }
    // Issue #206 follow-up: no click-based selection — opens the shared
    // combine/split creation modal directly, scoped to this group's own
    // children (same `path` .btn-add-subfield already targets).
    if (target.closest('.btn-add-combine-field')) { openCombineFieldModal(bridge, { mode: 'container', parentPath: path }); return; }
    if (target.closest('.btn-add-split-field')) { openSplitFieldModal(bridge, { mode: 'container', parentPath: path }); return; }
    if (target.closest('.group-tree-type')) {
      const group = resolveGroupNode(bridge.getState().groups, path);
      if (!group || group.kind !== 'group') return;
      log('GROUP_NODE_TOGGLE_REPEATING', { path, repeating: !group.repeating });
      bridge.stopPreviewIfActive();
      bridge.setState(bridge.getState().current, {
        groups: updateGroupTreeNode(bridge.getState().groups, path, (node) => ({ ...(node as SFDraft.GroupNode), repeating: !group.repeating })),
      });
      return;
    }
    if (target.closest('.btn-remove-group-node')) {
      log('GROUP_NODE_REMOVE', { path });
      bridge.stopPreviewIfActive();
      bridge.setState(bridge.getState().current, { groups: removeGroupTreeNode(bridge.getState().groups, path) });
      return;
    }
    // Issue #177: reorder among direct siblings — no-ops past either
    // boundary (moveGroupTreeNode's own guard), so the disabled attribute on
    // the boundary buttons is purely a visual affordance, not load-bearing.
    if (target.closest('.btn-group-move-up')) {
      log('GROUP_NODE_MOVE', { path, direction: -1 });
      bridge.setState(bridge.getState().current, { groups: moveGroupTreeNode(bridge.getState().groups, path, -1) });
      return;
    }
    if (target.closest('.btn-group-move-down')) {
      log('GROUP_NODE_MOVE', { path, direction: 1 });
      bridge.setState(bridge.getState().current, { groups: moveGroupTreeNode(bridge.getState().groups, path, 1) });
    }
  });

  // Issue #177: rename a tree node in place, committed on change (like the
  // API tree's own nameInput) — a blank value reverts the input to the
  // node's current name instead of saving an empty one, since Container
  // mode's own field-name inputs elsewhere never allow blank either.
  byIdOrNull('group-tree-root')?.addEventListener('change', (e) => {
    const nameInput = (e.target as Element).closest<HTMLInputElement>('.group-tree-name');
    if (!nameInput) return;
    const path: number[] = JSON.parse(nameInput.dataset.path as string); // written by buildGroupTreeNodeEl
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.value = resolveGroupNode(bridge.getState().groups, path)?.name ?? '';
      return;
    }
    log('GROUP_NODE_RENAME', { path, name });
    bridge.setState(bridge.getState().current, {
      groups: updateGroupTreeNode(bridge.getState().groups, path, (node) => ({ ...node, name })),
    });
  });

  byIdOrNull('btn-container-confirm')?.addEventListener('click', () => confirmContainerModal(bridge));
  byIdOrNull('input-container-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmContainerModal(bridge);
  });
  byIdOrNull('btn-container-cancel')?.addEventListener('click', () => cancelContainerModal(bridge));
  // Issue #227: re-rendering the modal lets the match-count hint follow the
  // typed text (renderContainerFieldModal reads effectiveMatchCount each time).
  wireTextFilter({
    inputId: 'input-field-text-filter',
    useButtonId: 'btn-field-use-text',
    rerender: () => bridge.patchState({}),
    getRawText: () => bridge.getState().pendingRawText,
  });
  byIdOrNull('btn-field-extended-confirm')?.addEventListener('click', () => confirmExtendedField(bridge));
  byIdOrNull('input-field-extended-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmExtendedField(bridge);
  });
  byIdOrNull('btn-field-extended-cancel')?.addEventListener('click', () => cancelExtendedField(bridge));
  // Issue #214: the safety-net inputs only make sense once Download itself
  // is actually checked — same "hide until relevant" treatment the
  // attribute row already gets from the mode select just below.
  byIdOrNull('toggle-field-download')?.addEventListener('change', (e) => {
    byIdOrNull('field-download-options')?.classList.toggle('hidden', !(e.target as HTMLInputElement).checked);
  });

  byIdOrNull('select-field-mode')?.addEventListener('change', (e) => {
    byIdOrNull('field-attribute-row')?.classList.toggle('hidden', (e.target as HTMLSelectElement).value !== 'attribute');
    // Issue #84: transforms are a string post-processing pipeline — not
    // meaningful for "Vorhanden?" (a boolean-ish presence check).
    byIdOrNull('field-extended-transforms-section')?.classList.toggle('hidden', (e.target as HTMLSelectElement).value === 'exists');
    // Issue #143: the raw value the preview runs against depends on the mode.
    refreshExtendedTransformPreview(bridge);
  });
  // Issue #143: typing an attribute name updates the preview live, without
  // requiring a transform edit first.
  // Issue #213 follow-up: now a <select> (was a free-text <input>) — 'change'
  // matches select-field-mode's own listener convention, fired once a pick
  // is actually made rather than per-keystroke.
  byIdOrNull('select-field-attribute')?.addEventListener('change', () => refreshExtendedTransformPreview(bridge));
  byIdOrNull('btn-field-extended-transform-add')?.addEventListener('click', () => {
    bridge.patchState({ pendingTransforms: addTransform(bridge.getState().pendingTransforms) });
  });
  wireTransformList(
    'field-extended-transform-list',
    () => bridge.getState().pendingTransforms,
    (transforms) => bridge.patchState({ pendingTransforms: transforms }),
    () => resolveExtendedRawValue(bridge.getState()),
  );
}
