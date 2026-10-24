// ── Blocks mode: block list render + wiring (Issue #182) ────────────────────
// Follows the project's <feature>.js/<feature>-ui.js split (docs/design-notes/extension.md, "Popup module boundaries") — pure add/remove/move
// helpers live in blocks-config.ts, this file owns the DOM side: the draft
// shape toggle (Flat/Container — which of _state.fields/_state.groups is
// currently being edited as "the block in progress"), the draft's own name/
// output-filename inputs, and the ordered list of already-confirmed blocks
// (edit/reorder/remove). The draft's actual field/group content is rendered
// by flat-mode-ui.ts's renderFields/container-tree-ui.js's renderGroupTree —
// unchanged, called from idle-screen-ui.js exactly like flat/container mode
// already do, since those functions already operate on _state.fields/
// _state.groups directly with no mode of their own baked in.
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, StatePatch } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { createDraftBlock, addOrUpdateBlock, removeBlock, moveBlock, draftIsAddable } from './blocks-config';
import { byIdOrNull } from './dom';

const log = createLogger('SF:Popup');

// Switching the draft's own shape starts that shape fresh — the other
// shape's content (whichever of fields/groups doesn't match) is cleared,
// the same "switching clears what doesn't belong to the new shape"
// convention idle-screen-ui.js's own switchMode/MODE_SWITCH_CLEARS already
// uses for the top-level mode switch.
function switchBlocksDraftShape(bridge: PopupBridge, shape: SFDraft.Block['shape']): void {
  const state = bridge.getState();
  if (shape === state.blocksDraftShape) return;
  log('BLOCKS_DRAFT_SHAPE_SWITCH', shape);
  bridge.patchState({ blocksDraftShape: shape, fields: [], groups: [] });
}

function blockSummaryText(block: SFDraft.Block): string {
  const count = block.shape === 'flat' ? (block.fields || []).length : (block.groups || []).length;
  return t(block.shape === 'flat' ? 'idle.blocksSummaryFlat' : 'idle.blocksSummaryGroup', { count });
}

function buildBlockRowEl(block: SFDraft.Block, index: number, total: number): HTMLElement {
  const li = document.createElement('li');
  li.className = 'group-tree-row blocks-block-row';
  li.dataset.index = String(index);

  const nameEl = document.createElement('span');
  nameEl.className = 'blocks-block-name';
  nameEl.textContent = block.name || t('idle.blocksUnnamed');
  li.appendChild(nameEl);

  const summaryEl = document.createElement('span');
  summaryEl.className = 'blocks-block-summary';
  summaryEl.textContent = blockSummaryText(block);
  li.appendChild(summaryEl);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-secondary btn-tiny btn-blocks-edit';
  editBtn.textContent = t('common.edit');
  li.appendChild(editBtn);

  const moveUpBtn = document.createElement('button');
  moveUpBtn.type = 'button';
  moveUpBtn.className = 'btn-secondary btn-tiny btn-blocks-move-up';
  moveUpBtn.textContent = '↑';
  moveUpBtn.disabled = index === 0;
  li.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement('button');
  moveDownBtn.type = 'button';
  moveDownBtn.className = 'btn-secondary btn-tiny btn-blocks-move-down';
  moveDownBtn.textContent = '↓';
  moveDownBtn.disabled = index === total - 1;
  li.appendChild(moveDownBtn);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-danger btn-tiny btn-blocks-remove';
  removeBtn.textContent = t('common.remove');
  li.appendChild(removeBtn);

  return li;
}

export function renderBlocksSection(bridge: PopupBridge): void {
  const state = bridge.getState();
  const blocks = state.blocks || [];
  const editingIndex = state.blocksEditingIndex;

  byIdOrNull('btn-blocks-draft-flat')?.classList.toggle('active', state.blocksDraftShape === 'flat');
  byIdOrNull('btn-blocks-draft-group')?.classList.toggle('active', state.blocksDraftShape === 'group');
  // The flat/container editors themselves are rendered/shown by
  // idle-screen-ui.js exactly as they are for flat/container mode — only
  // reachable once a shape has been picked, so the draft editor row stays
  // hidden until then (there's nothing to click "+ Datenfeld"/"+ Gruppe"
  // against before this decision is made).
  byIdOrNull('blocks-draft-editor')?.classList.remove('hidden');

  const nameInput = byIdOrNull<HTMLInputElement>('input-blocks-draft-name');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = state.blocksDraftName;
  const outputNameInput = byIdOrNull<HTMLInputElement>('input-blocks-draft-output-filename');
  if (outputNameInput && document.activeElement !== outputNameInput) outputNameInput.value = state.blocksDraftOutputFileName;

  const addBtn = byIdOrNull<HTMLButtonElement>('btn-blocks-add-update');
  if (addBtn) {
    addBtn.textContent = t(editingIndex === null || editingIndex === undefined ? 'idle.blocksAddBtn' : 'idle.blocksUpdateBtn');
    addBtn.disabled = !draftIsAddable(
      { name: state.blocksDraftName, shape: state.blocksDraftShape }, state.fields, state.groups,
    );
  }
  const cancelEditBtn = byIdOrNull('btn-blocks-cancel-edit');
  if (cancelEditBtn) cancelEditBtn.classList.toggle('hidden', editingIndex === null || editingIndex === undefined);

  const listEl = byIdOrNull('blocks-list');
  if (listEl) {
    listEl.innerHTML = '';
    blocks.forEach((block, i) => listEl.appendChild(buildBlockRowEl(block, i, blocks.length)));
  }
  const hintEl = byIdOrNull('blocks-min-count-hint');
  if (hintEl) hintEl.classList.toggle('hidden', blocks.length >= 2);
}

// Loads an already-confirmed block back into the draft (shape + name/
// outputFileName + its own fields/groups) for further editing — the
// reverse of addOrUpdateBlock, entering "update" mode (blocksEditingIndex
// set) instead of "add".
export function editBlock(bridge: PopupBridge, index: number): void {
  const state = bridge.getState();
  const block = (state.blocks || [])[index];
  if (!block) return;
  log('BLOCKS_EDIT', { index, name: block.name });
  bridge.patchState({
    blocksDraftShape: block.shape,
    blocksDraftName: block.name ?? '',
    blocksDraftOutputFileName: block.outputFileName ?? '',
    blocksEditingIndex: index,
    fields: block.shape === 'flat' ? block.fields ?? [] : [],
    groups: block.shape === 'group' ? block.groups ?? [] : [],
  });
}

export function confirmDraftBlock(bridge: PopupBridge): void {
  const state = bridge.getState();
  const draft = { name: state.blocksDraftName, shape: state.blocksDraftShape };
  if (!draftIsAddable(draft, state.fields, state.groups)) return;
  const nextBlocks = addOrUpdateBlock(
    state.blocks || [], { ...draft, outputFileName: state.blocksDraftOutputFileName }, state.fields, state.groups,
    state.blocksEditingIndex,
  );
  log('BLOCKS_ADD_UPDATE', { editingIndex: state.blocksEditingIndex, name: draft.name });
  bridge.patchState({
    blocks: nextBlocks,
    blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null,
    fields: [], groups: [],
  });
}

export function cancelDraftEdit(bridge: PopupBridge): void {
  log('BLOCKS_EDIT_CANCEL');
  bridge.patchState({
    blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null,
    fields: [], groups: [],
  });
}

export function wireBlocksConfigEvents(bridge: PopupBridge): void {
  byIdOrNull('btn-blocks-draft-flat')?.addEventListener('click', () => switchBlocksDraftShape(bridge, 'flat'));
  byIdOrNull('btn-blocks-draft-group')?.addEventListener('click', () => switchBlocksDraftShape(bridge, 'group'));

  byIdOrNull('input-blocks-draft-name')?.addEventListener('input', (e) => {
    bridge.patchState({ blocksDraftName: (e.target as HTMLInputElement).value });
  });
  byIdOrNull('input-blocks-draft-output-filename')?.addEventListener('input', (e) => {
    bridge.patchState({ blocksDraftOutputFileName: (e.target as HTMLInputElement).value });
  });

  byIdOrNull('btn-blocks-add-update')?.addEventListener('click', () => confirmDraftBlock(bridge));
  byIdOrNull('btn-blocks-cancel-edit')?.addEventListener('click', () => cancelDraftEdit(bridge));

  const listEl = byIdOrNull('blocks-list');
  if (!listEl) return;
  listEl.addEventListener('click', (e) => {
    const target = e.target as Element;
    const row = target.closest<HTMLElement>('.blocks-block-row');
    if (!row) return;
    const index = parseInt(row.dataset.index as string, 10);
    const state = bridge.getState();
    const blocks = state.blocks || [];

    if (target.closest('.btn-blocks-edit')) {
      editBlock(bridge, index);
    } else if (target.closest('.btn-blocks-move-up')) {
      bridge.patchState({ blocks: moveBlock(blocks, index, -1) });
    } else if (target.closest('.btn-blocks-move-down')) {
      bridge.patchState({ blocks: moveBlock(blocks, index, 1) });
    } else if (target.closest('.btn-blocks-remove')) {
      log('BLOCKS_REMOVE', { index, name: blocks[index]?.name });
      const patch: StatePatch = { blocks: removeBlock(blocks, index) };
      // Removing the block currently being edited also clears the draft —
      // otherwise "+ Update block" would resurrect it at a now-stale index.
      if (state.blocksEditingIndex === index) {
        Object.assign(patch, { blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null, fields: [], groups: [] });
      }
      bridge.patchState(patch);
    }
  });
}

export { createDraftBlock };
