// Issue #182: pure, DOM-free helpers for Blocks mode's ordered list of
// independent extraction blocks — mirrors combined-config.ts's own
// add/remove/move shape exactly (see moveComponent's doc comment for the
// swap-with-adjacent-sibling convention this reuses verbatim). Unlike
// Combined mode, a block has no external "saved configuration" to point
// at — its own Fields/Groups content is edited directly, via the exact same
// flat-mode-ui.js/container-tree-ui.js click-based selection flow flat/
// container mode already use, reusing _state.fields/_state.groups as the
// "block currently being built" draft (see blocks-config-ui.ts) rather than
// duplicating that whole selection machinery a second time.
import type * as SFDraft from '../types/drafts';

export interface BlockDraft {
  shape: SFDraft.Block['shape'];
  name: string;
  outputFileName: string;
}

export function createDraftBlock(): BlockDraft {
  return { shape: 'flat', name: '', outputFileName: '' };
}

// Snapshots the current draft (name/outputFileName/shape, from
// _state.blocksDraft*) plus whichever of fields/groups actually matches
// that shape into one confirmed block — appended, or (editingIndex not
// null/undefined) overwriting the block previously at that index, the
// "load for editing, then re-add" round trip blocks-config-ui.ts's own
// Edit button starts.
export function addOrUpdateBlock(
  blocks: SFDraft.Block[], draft: BlockDraft, fields: SFDraft.Field[], groups: SFDraft.ContainerNode[], editingIndex?: number | null,
): SFDraft.Block[] {
  const block: SFDraft.Block = {
    name: draft.name.trim(),
    outputFileName: draft.outputFileName.trim(),
    shape: draft.shape,
    fields: draft.shape === 'flat' ? fields : [],
    groups: draft.shape === 'group' ? groups : [],
  };
  if (editingIndex === null || editingIndex === undefined) return [...blocks, block];
  return blocks.map((b, i) => (i === editingIndex ? block : b));
}

export function removeBlock(blocks: SFDraft.Block[], index: number): SFDraft.Block[] {
  return blocks.filter((_, i) => i !== index);
}

// direction: -1 (up) or +1 (down). Out-of-range moves are a no-op rather
// than clamped/wrapped — the UI already disables the button at either end
// (see blocks-config-ui.ts), this is just the data-layer safety net.
export function moveBlock(blocks: SFDraft.Block[], index: number, direction: number): SFDraft.Block[] {
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
export function draftIsAddable(draft: Pick<BlockDraft, 'name' | 'shape'>, fields: SFDraft.Field[], groups: SFDraft.ContainerNode[]): boolean {
  if (!draft.name.trim()) return false;
  return draft.shape === 'flat' ? fields.length > 0 : groups.length > 0;
}

