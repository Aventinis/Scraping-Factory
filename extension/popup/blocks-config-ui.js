// ── Blocks mode: block list render + wiring (Issue #182) ────────────────────
// Follows the project's <feature>.js/<feature>-ui.js split (see CLAUDE.md's
// "Popup module boundaries" architecture decision) — pure add/remove/move
// helpers live in blocks-config.js, this file owns the DOM side: the draft
// shape toggle (Flat/Container — which of _state.fields/_state.groups is
// currently being edited as "the block in progress"), the draft's own name/
// output-filename inputs, and the ordered list of already-confirmed blocks
// (edit/reorder/remove). The draft's actual field/group content is rendered
// by flat-mode-ui.js's renderFields/container-tree-ui.js's renderGroupTree —
// unchanged, called from idle-screen-ui.js exactly like flat/container mode
// already do, since those functions already operate on _state.fields/
// _state.groups directly with no mode of their own baked in.
const SFBlocksConfigUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { escapeHtml } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { createDraftBlock, addOrUpdateBlock, removeBlock, moveBlock, draftIsAddable } =
    typeof require !== 'undefined' ? require('./blocks-config') : self.SFBlocksConfig;

  // Switching the draft's own shape starts that shape fresh — the other
  // shape's content (whichever of fields/groups doesn't match) is cleared,
  // the same "switching clears what doesn't belong to the new shape"
  // convention idle-screen-ui.js's own switchMode/MODE_SWITCH_CLEARS already
  // uses for the top-level mode switch.
  function switchBlocksDraftShape(bridge, shape) {
    const state = bridge.getState();
    if (shape === state.blocksDraftShape) return;
    log('BLOCKS_DRAFT_SHAPE_SWITCH', shape);
    bridge.patchState({ blocksDraftShape: shape, fields: [], groups: [] });
  }

  function blockSummaryText(block) {
    const count = block.shape === 'flat' ? (block.fields || []).length : (block.groups || []).length;
    return t(block.shape === 'flat' ? 'idle.blocksSummaryFlat' : 'idle.blocksSummaryGroup', { count });
  }

  function buildBlockRowEl(block, index, total) {
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

  function renderBlocksSection(bridge) {
    const state = bridge.getState();
    const blocks = state.blocks || [];
    const editingIndex = state.blocksEditingIndex;

    document.getElementById('btn-blocks-draft-flat')?.classList.toggle('active', state.blocksDraftShape === 'flat');
    document.getElementById('btn-blocks-draft-group')?.classList.toggle('active', state.blocksDraftShape === 'group');
    // The flat/container editors themselves are rendered/shown by
    // idle-screen-ui.js exactly as they are for flat/container mode — only
    // reachable once a shape has been picked, so the draft editor row stays
    // hidden until then (there's nothing to click "+ Datenfeld"/"+ Gruppe"
    // against before this decision is made).
    document.getElementById('blocks-draft-editor')?.classList.remove('hidden');

    const nameInput = document.getElementById('input-blocks-draft-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = state.blocksDraftName;
    const outputNameInput = document.getElementById('input-blocks-draft-output-filename');
    if (outputNameInput && document.activeElement !== outputNameInput) outputNameInput.value = state.blocksDraftOutputFileName;

    const addBtn = document.getElementById('btn-blocks-add-update');
    if (addBtn) {
      addBtn.textContent = t(editingIndex === null || editingIndex === undefined ? 'idle.blocksAddBtn' : 'idle.blocksUpdateBtn');
      addBtn.disabled = !draftIsAddable(
        { name: state.blocksDraftName, shape: state.blocksDraftShape }, state.fields, state.groups,
      );
    }
    const cancelEditBtn = document.getElementById('btn-blocks-cancel-edit');
    if (cancelEditBtn) cancelEditBtn.classList.toggle('hidden', editingIndex === null || editingIndex === undefined);

    const listEl = document.getElementById('blocks-list');
    if (listEl) {
      listEl.innerHTML = '';
      blocks.forEach((block, i) => listEl.appendChild(buildBlockRowEl(block, i, blocks.length)));
    }
    const hintEl = document.getElementById('blocks-min-count-hint');
    if (hintEl) hintEl.classList.toggle('hidden', blocks.length >= 2);
  }

  // Loads an already-confirmed block back into the draft (shape + name/
  // outputFileName + its own fields/groups) for further editing — the
  // reverse of addOrUpdateBlock, entering "update" mode (blocksEditingIndex
  // set) instead of "add".
  function editBlock(bridge, index) {
    const state = bridge.getState();
    const block = (state.blocks || [])[index];
    if (!block) return;
    log('BLOCKS_EDIT', { index, name: block.name });
    bridge.patchState({
      blocksDraftShape: block.shape,
      blocksDraftName: block.name,
      blocksDraftOutputFileName: block.outputFileName,
      blocksEditingIndex: index,
      fields: block.shape === 'flat' ? block.fields : [],
      groups: block.shape === 'group' ? block.groups : [],
    });
  }

  function confirmDraftBlock(bridge) {
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

  function cancelDraftEdit(bridge) {
    log('BLOCKS_EDIT_CANCEL');
    bridge.patchState({
      blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null,
      fields: [], groups: [],
    });
  }

  function wireBlocksConfigEvents(bridge) {
    document.getElementById('btn-blocks-draft-flat')?.addEventListener('click', () => switchBlocksDraftShape(bridge, 'flat'));
    document.getElementById('btn-blocks-draft-group')?.addEventListener('click', () => switchBlocksDraftShape(bridge, 'group'));

    document.getElementById('input-blocks-draft-name')?.addEventListener('input', (e) => {
      bridge.patchState({ blocksDraftName: e.target.value });
    });
    document.getElementById('input-blocks-draft-output-filename')?.addEventListener('input', (e) => {
      bridge.patchState({ blocksDraftOutputFileName: e.target.value });
    });

    document.getElementById('btn-blocks-add-update')?.addEventListener('click', () => confirmDraftBlock(bridge));
    document.getElementById('btn-blocks-cancel-edit')?.addEventListener('click', () => cancelDraftEdit(bridge));

    const listEl = document.getElementById('blocks-list');
    if (!listEl) return;
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.blocks-block-row');
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      const state = bridge.getState();
      const blocks = state.blocks || [];

      if (e.target.closest('.btn-blocks-edit')) {
        editBlock(bridge, index);
      } else if (e.target.closest('.btn-blocks-move-up')) {
        bridge.patchState({ blocks: moveBlock(blocks, index, -1) });
      } else if (e.target.closest('.btn-blocks-move-down')) {
        bridge.patchState({ blocks: moveBlock(blocks, index, 1) });
      } else if (e.target.closest('.btn-blocks-remove')) {
        log('BLOCKS_REMOVE', { index, name: blocks[index]?.name });
        const patch = { blocks: removeBlock(blocks, index) };
        // Removing the block currently being edited also clears the draft —
        // otherwise "+ Update block" would resurrect it at a now-stale index.
        if (state.blocksEditingIndex === index) {
          Object.assign(patch, { blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null, fields: [], groups: [] });
        }
        bridge.patchState(patch);
      }
    });
  }

  return { createDraftBlock, renderBlocksSection, wireBlocksConfigEvents, editBlock, confirmDraftBlock, cancelDraftEdit };
})();

if (typeof module !== 'undefined') module.exports = SFBlocksConfigUI;
if (typeof self !== 'undefined') self.SFBlocksConfigUI = SFBlocksConfigUI;
