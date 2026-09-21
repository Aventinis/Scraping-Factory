// Issue #182: pure, DOM-free helpers for Blocks mode's ordered list of
// independent extraction blocks — mirrors combined-config.js's own
// add/remove/move shape exactly (see moveComponent's doc comment for the
// swap-with-adjacent-sibling convention this reuses verbatim). Unlike
// Combined mode, a block has no external "saved configuration" to point
// at — its own Fields/Groups content is edited directly, via the exact same
// flat-mode-ui.js/container-tree-ui.js click-based selection flow flat/
// container mode already use, reusing _state.fields/_state.groups as the
// "block currently being built" draft (see blocks-config-ui.js) rather than
// duplicating that whole selection machinery a second time.
const SFBlocksConfig = (function () {
  function createDraftBlock() {
    return { shape: 'flat', name: '', outputFileName: '' };
  }

  // Snapshots the current draft (name/outputFileName/shape, from
  // _state.blocksDraft*) plus whichever of fields/groups actually matches
  // that shape into one confirmed block — appended, or (editingIndex not
  // null/undefined) overwriting the block previously at that index, the
  // "load for editing, then re-add" round trip blocks-config-ui.js's own
  // Edit button starts.
  function addOrUpdateBlock(blocks, draft, fields, groups, editingIndex) {
    const block = {
      name: draft.name.trim(),
      outputFileName: draft.outputFileName.trim(),
      shape: draft.shape,
      fields: draft.shape === 'flat' ? fields : [],
      groups: draft.shape === 'group' ? groups : [],
    };
    if (editingIndex === null || editingIndex === undefined) return [...blocks, block];
    return blocks.map((b, i) => (i === editingIndex ? block : b));
  }

  function removeBlock(blocks, index) {
    return blocks.filter((_, i) => i !== index);
  }

  // direction: -1 (up) or +1 (down). Out-of-range moves are a no-op rather
  // than clamped/wrapped — the UI already disables the button at either end
  // (see blocks-config-ui.js), this is just the data-layer safety net.
  function moveBlock(blocks, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return blocks;
    const copy = [...blocks];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  }

  // A block is only worth keeping once it actually has content — an empty
  // draft (blank name, or no fields/groups picked yet for its own shape)
  // silently does nothing on "+ Add block" rather than adding a useless
  // entry the backend would reject anyway (ScrapingPlanValidator requires
  // every block to contain at least one field or group).
  function draftIsAddable(draft, fields, groups) {
    if (!draft.name.trim()) return false;
    return draft.shape === 'flat' ? fields.length > 0 : groups.length > 0;
  }

  return { createDraftBlock, addOrUpdateBlock, removeBlock, moveBlock, draftIsAddable };
})();

if (typeof module !== 'undefined') module.exports = SFBlocksConfig;
if (typeof self !== 'undefined') self.SFBlocksConfig = SFBlocksConfig;
