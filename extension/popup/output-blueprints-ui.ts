// Issue #191: Output Blueprints — CRUD against the companion's /blueprints
// endpoints, the management modal's own row-list rendering (mirrors
// saved-configs-ui.ts's own combined fetch+render style), the create/edit
// modal, and the per-scrape source-field mapping picker rendered inside the
// Settings section on the idle screen. Functions take a `bridge` object
// (same convention as saved-configs-ui.ts/api-config-ui.js) instead of
// closing over popup.js's own module-level state.
//
// Issue #244: a second, tree-shaped target schema alongside the original
// flat field-name list — the create/edit modal gains a Flat/Tree toggle
// (schemaKind on blueprintEditDraft) switching between the original flat
// field-name-list editor and a new tree editor (mirrors container mode's own
// group-tree editor visually, but structurally simpler — see
// buildBlueprintSchemaNodeEl), and the per-scrape mapping picker gains a
// parallel tree-mapping view (renderOutputBlueprintTreeMapping) shown
// instead of the flat mapping list once a Tree-schema blueprint is picked.
import type * as SFDraft from '../types/drafts';
import type {
  BlueprintEditDraft, OutputBlueprintRecord, OutputBlueprintSummary, PopupBridge, State, StatePatch,
} from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { escapeHtml, STATES } from './api-config';
import { showToast } from './toast';
import { collectFieldNames } from './scraping-config-builder';
import { getResolvedCompanionUrl, companionFetch } from './companion-client';
import {
  addBlueprintFieldName, removeBlueprintFieldName, updateBlueprintFieldName, moveBlueprintFieldName,
  blueprintDraftIsValid, createMappingDraft, updateMappingSource, parseFieldNamesFromSample,
  buildBlueprintSchemaGroup, buildBlueprintSchemaField, parseBlueprintSchemaTree, serializeBlueprintSchemaTree,
  blueprintTreeSchemaIsValid, createTreeMappingDraft, updateTreeMappingSource,
  buildBlueprintTreeFromSample, countBlueprintTreeLeaves,
} from './output-blueprints';
import { byIdOrNull } from './dom';

const log = createLogger('SF:Popup');

// Issue #244: the tree schema editor's own structural editing (add/remove/
// rename/move a group or field node) reuses container-tree.ts's generic
// path-based helpers directly — see output-blueprints.ts's own doc comment
// on why they apply unchanged to a blueprint schema node's much smaller
// {kind, name, children} shape.
import {
  insertContainerNode, removeGroupTreeNode, updateGroupTreeNode, moveGroupTreeNode,
} from './container-tree';

const EMPTY_OUTPUT_BLUEPRINT_STATE: StatePatch = {
  selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
  selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
};

// ── Fetch wrappers, mirroring saved-configs-ui.ts's own style ──────────

export async function fetchOutputBlueprints(bridge: PopupBridge): Promise<void> {
  bridge.patchState({ outputBlueprintsLoading: true });
  try {
    const res = await companionFetch(`${getResolvedCompanionUrl()}/blueprints`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const outputBlueprints: OutputBlueprintSummary[] = await res.json(); // GET /blueprints
    log('OUTPUT_BLUEPRINTS_LIST', outputBlueprints.length);
    bridge.patchState({ outputBlueprints, outputBlueprintsLoading: false });
  } catch (err) {
    // Non-fatal: an older companion without /blueprints, or a transient
    // network hiccup — same "optional companion capability" treatment
    // fetchSavedConfigs already gives its own failure case.
    log('OUTPUT_BLUEPRINTS_LIST FAIL', (err as Error).message);
    bridge.patchState({ outputBlueprints: [], outputBlueprintsLoading: false });
  }
}

export async function fetchOutputBlueprint(id: number | string): Promise<OutputBlueprintRecord> {
  const res = await companionFetch(`${getResolvedCompanionUrl()}/blueprints/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // GET /blueprints/{id}
}

// ── Per-scrape mapping picker (Settings section) ────────────────────────

// True once the current mode/shape has real nesting a Tree-schema mapping
// could actually flatten/rebuild against — the same source-shape scope
// OutputBlueprintFlattening/ScrapingPlanValidator enforce server-side
// (container mode, or Api mode's own tree response shape). A Tree-schema
// blueprint is filtered out of the picker entirely for any other mode —
// there would be nothing for its target groups to resolve against.
function currentShapeSupportsTreeBlueprint(state: State): boolean {
  return state.mode === 'container'
    || (state.mode === 'api' && !!state.apiConfig && Array.isArray(state.apiConfig.groups) && state.apiConfig.groups.length > 0);
}

// idValue is the <select>'s own string value — '' means "None" picked,
// clearing the mapping entirely.
export async function selectOutputBlueprint(bridge: PopupBridge, idValue: string): Promise<void> {
  if (!idValue) {
    log('SELECT_OUTPUT_BLUEPRINT none');
    bridge.patchState({ ...EMPTY_OUTPUT_BLUEPRINT_STATE });
    return;
  }
  log('SELECT_OUTPUT_BLUEPRINT', idValue);
  try {
    const record = await fetchOutputBlueprint(idValue);
    if (record.schemaKind === 'Tree') {
      bridge.patchState({
        selectedOutputBlueprintId: idValue,
        selectedOutputBlueprintFieldNames: [],
        outputBlueprintMapping: {},
        selectedOutputBlueprintSchemaKind: 'Tree',
        selectedOutputBlueprintTree: record.tree || [],
        outputBlueprintTreeMapping: createTreeMappingDraft(record.tree || []),
      });
      return;
    }
    bridge.patchState({
      selectedOutputBlueprintId: idValue,
      selectedOutputBlueprintFieldNames: record.fieldNames,
      outputBlueprintMapping: createMappingDraft(record.fieldNames),
      selectedOutputBlueprintSchemaKind: 'Flat',
      selectedOutputBlueprintTree: [],
      outputBlueprintTreeMapping: {},
    });
  } catch (err) {
    log('SELECT_OUTPUT_BLUEPRINT FAIL', (err as Error).message);
    showToast(t('toast.blueprintLoadFailed', { message: (err as Error).message }), 'Output Blueprint');
  }
}

export function updateOutputBlueprintMappingSource(bridge: PopupBridge, targetField: string, sourceField: string): void {
  const state = bridge.getState();
  bridge.patchState({
    outputBlueprintMapping: updateMappingSource(state.outputBlueprintMapping, targetField, sourceField),
  });
}

export function updateOutputBlueprintTreeMappingSource(bridge: PopupBridge, leafPath: string, sourceField: string): void {
  const state = bridge.getState();
  bridge.patchState({
    outputBlueprintTreeMapping: updateTreeMappingSource(state.outputBlueprintTreeMapping ?? {}, leafPath, sourceField),
  });
}

// Renders the picker <select> (options from _state.outputBlueprints,
// Tree-schema entries filtered out when the current mode/shape can't use
// one — see currentShapeSupportsTreeBlueprint) and, once a blueprint is
// picked, its own mapping view: the original flat per-target-field row
// list, or (Issue #244) the tree mapping view below, depending on
// selectedOutputBlueprintSchemaKind. Only ever called while the picker
// itself is reachable (flat mode, or Api mode's flat shape, or — since
// #192 — container mode/Api's tree shape) — idle-screen-ui.ts gates
// #output-blueprint-toggle-row's own visibility.
export function renderOutputBlueprintMappingSection(bridge: PopupBridge): void {
  const state = bridge.getState();
  const selectEl = byIdOrNull<HTMLSelectElement>('select-output-blueprint');
  if (selectEl && document.activeElement !== selectEl) {
    const treeEligible = currentShapeSupportsTreeBlueprint(state);
    const options = (state.outputBlueprints || [])
      .filter(bp => bp.schemaKind !== 'Tree' || treeEligible)
      .map(bp => `<option value="${bp.id}">${escapeHtml(bp.name)} (${bp.fieldCount})</option>`)
      .join('');
    selectEl.innerHTML = `<option value="" data-i18n="idle.outputBlueprintNoneOption">${escapeHtml(t('idle.outputBlueprintNoneOption'))}</option>${options}`;
    selectEl.value = state.selectedOutputBlueprintId || '';
  }

  if (state.selectedOutputBlueprintSchemaKind === 'Tree') {
    byIdOrNull('output-blueprint-mapping')?.classList.add('hidden');
    renderOutputBlueprintTreeMapping(bridge);
    return;
  }

  byIdOrNull('output-blueprint-tree-mapping')?.classList.add('hidden');
  const mappingSection = byIdOrNull('output-blueprint-mapping');
  const targetFields = state.selectedOutputBlueprintFieldNames || [];
  if (!mappingSection) return;
  if (!state.selectedOutputBlueprintId || targetFields.length === 0) {
    mappingSection.classList.add('hidden');
    return;
  }
  mappingSection.classList.remove('hidden');

  const availableSourceFields = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
  const listEl = byIdOrNull('output-blueprint-mapping-list');
  if (listEl) {
    listEl.innerHTML = targetFields.map(target => {
      const picked = state.outputBlueprintMapping[target] || '';
      const options = ['<option value=""></option>', ...availableSourceFields.map(name =>
        `<option value="${escapeHtml(name)}"${name === picked ? ' selected' : ''}>${escapeHtml(name)}</option>`)].join('');
      return `<li class="output-blueprint-mapping-row" data-target="${escapeHtml(target)}">` +
        `<span class="output-blueprint-target-name" title="${escapeHtml(target)}">${escapeHtml(target)}</span>` +
        `<select class="output-blueprint-source-select" data-target="${escapeHtml(target)}">${options}</select>` +
        `</li>`;
    }).join('');
  }
}

// Issue #244: read-only structural rendering of the fetched target tree
// (a target GROUP row is just a label — there's nothing to pick for it,
// its own row-scope is inferred entirely from its mapped leaf fields, see
// OutputBlueprintFlattening.ResolveContainerTreeRowScopes), each target
// LEAF row getting a source-field <select> exactly like the flat mapping's
// own per-row <select>. `path` addresses a node the same dot-joined-index
// scheme output-blueprints.ts's own createTreeMappingDraft uses as its
// draft keys, so a row's `data-path` can be used directly as the lookup.
function buildOutputBlueprintTreeMappingRowHtml(
  node: SFDraft.OutputBlueprintTreeNode, path: string, depth: number, availableSourceFields: string[], draft: Record<string, string | null>,
): string {
  const indent = `style="padding-left:${depth * 12}px"`;
  if (Array.isArray(node.children)) {
    const children = node.children.map((child, i) =>
      buildOutputBlueprintTreeMappingRowHtml(child, `${path}.${i}`, depth + 1, availableSourceFields, draft)).join('');
    return `<li class="group-tree-node"><div class="group-tree-row" ${indent}>` +
      `<span class="group-tree-label">${escapeHtml(node.name)}</span></div>` +
      `<ul class="group-tree-children">${children}</ul></li>`;
  }
  const picked = draft[path] || '';
  const options = ['<option value=""></option>', ...availableSourceFields.map(name =>
    `<option value="${escapeHtml(name)}"${name === picked ? ' selected' : ''}>${escapeHtml(name)}</option>`)].join('');
  return `<li class="group-tree-node"><div class="group-tree-row output-blueprint-mapping-row" ${indent} data-path="${escapeHtml(path)}">` +
    `<span class="group-tree-label">${escapeHtml(node.name)}</span>` +
    `<select class="output-blueprint-source-select" data-path="${escapeHtml(path)}">${options}</select>` +
    `</div></li>`;
}

export function renderOutputBlueprintTreeMapping(bridge: PopupBridge): void {
  const state = bridge.getState();
  const section = byIdOrNull('output-blueprint-tree-mapping');
  const tree = state.selectedOutputBlueprintTree || [];
  if (!section) return;
  if (!state.selectedOutputBlueprintId || tree.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const availableSourceFields = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
  const listEl = byIdOrNull('output-blueprint-tree-mapping-list');
  if (listEl) {
    listEl.innerHTML = tree.map((node, i) =>
      buildOutputBlueprintTreeMappingRowHtml(node, `${i}`, 0, availableSourceFields, state.outputBlueprintTreeMapping ?? {})).join('');
  }
}

// ── Blueprint management (list + create/edit/delete) ────────────────────
// Issue-driven follow-up: renderManageBlueprintsModal now renders into a
// permanent section of the global Settings tab (screens/settings.html)
// instead of a modal — the function itself needed no changes, since it
// never assumed anything about its container beyond the #manage-
// blueprints-list/#manage-blueprints-empty ids (the generic hide()/show()
// sweep in popup.js's render() is what used to toggle the modal, not this
// file). modal-blueprint-edit (create/edit) is unaffected — it still opens
// as an actual overlay on top of whatever screen is behind it.

export function renderManageBlueprintsModal(bridge: PopupBridge): void {
  const state = bridge.getState();
  const listEl = byIdOrNull('manage-blueprints-list');
  const emptyEl = byIdOrNull('manage-blueprints-empty');
  if (!listEl) return;

  const blueprints = state.outputBlueprints || [];
  if (emptyEl) emptyEl.classList.toggle('hidden', blueprints.length > 0);

  listEl.innerHTML = blueprints.map(bp => {
    if (state.blueprintDeletePendingId === bp.id) {
      return `<div class="blueprint-row" data-id="${bp.id}">` +
        `<span class="blueprint-row-name">${escapeHtml(bp.name)}</span>` +
        `<span class="saved-config-confirm-text">${escapeHtml(t('idle.savedConfigsDeleteConfirm'))}</span>` +
        `<button type="button" class="btn-danger btn-tiny btn-blueprint-delete-confirm" data-id="${bp.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmYes'))}</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-blueprint-delete-cancel" data-id="${bp.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmNo'))}</button>` +
        `</div>`;
    }
    return `<div class="blueprint-row" data-id="${bp.id}">` +
      `<span class="blueprint-row-name">${escapeHtml(bp.name)}</span>` +
      `<span class="blueprint-row-count">${bp.fieldCount}</span>` +
      `<button type="button" class="btn-secondary btn-tiny btn-blueprint-edit" data-id="${bp.id}">${escapeHtml(t('modals.blueprintEdit.editBtn'))}</button>` +
      `<button type="button" class="btn-danger btn-tiny btn-blueprint-delete" data-id="${bp.id}">${escapeHtml(t('idle.savedConfigsDeleteBtn'))}</button>` +
      `</div>`;
  }).join('');
}

export function requestDeleteBlueprint(bridge: PopupBridge, id: number): void {
  bridge.patchState({ blueprintDeletePendingId: id });
}

export function cancelDeleteBlueprint(bridge: PopupBridge): void {
  bridge.patchState({ blueprintDeletePendingId: null });
}

export async function deleteBlueprint(bridge: PopupBridge, id: number): Promise<void> {
  log('DELETE_BLUEPRINT', id);
  try {
    const res = await companionFetch(`${getResolvedCompanionUrl()}/blueprints/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    log('DELETE_BLUEPRINT OK');
    bridge.patchState({ blueprintDeletePendingId: null });
    showToast(t('toast.blueprintDeleted'), null, 'info');
    // A deleted blueprint that's currently picked for this scrape's own
    // mapping is cleared too — its target field list/tree is gone, so the
    // mapping draft can no longer mean anything.
    if (bridge.getState().selectedOutputBlueprintId === String(id)) {
      bridge.patchState({ ...EMPTY_OUTPUT_BLUEPRINT_STATE });
    }
    await fetchOutputBlueprints(bridge);
  } catch (err) {
    log('DELETE_BLUEPRINT FAIL', (err as Error).message);
    showToast(t('toast.blueprintDeleteFailed', { message: (err as Error).message }), 'Output Blueprint');
  }
}

// ── Create/edit modal ────────────────────────────────────────────────────

// Issue #252: the picked-file indicator (#blueprint-import-file-name) is
// plain static markup, not re-rendered from state — once a file is picked
// its text is overwritten with that file's own name (see the 'change'
// listener below), so it has to be put back to the "no file selected"
// placeholder explicitly whenever the modal is (re)opened, or a stale
// filename from a previous attempt would otherwise linger across reopens.
function resetBlueprintImportFileIndicator(): void {
  const nameEl = byIdOrNull('blueprint-import-file-name');
  if (nameEl) nameEl.textContent = t('modals.blueprintEdit.importFileNone');
}

export function openBlueprintCreateModal(bridge: PopupBridge): void {
  log('OPEN blueprint-edit modal (new)');
  resetBlueprintImportFileIndicator();
  bridge.patchState({
    blueprintEditModalOpen: true, blueprintEditingId: null,
    blueprintEditDraft: { name: '', schemaKind: 'Flat', fieldNames: [''], tree: [] },
  });
}

export async function openBlueprintEditModal(bridge: PopupBridge, id: number): Promise<void> {
  log('OPEN blueprint-edit modal (edit)', id);
  resetBlueprintImportFileIndicator();
  try {
    const record = await fetchOutputBlueprint(id);
    bridge.patchState({
      blueprintEditModalOpen: true, blueprintEditingId: id,
      blueprintEditDraft: {
        name: record.name,
        schemaKind: record.schemaKind || 'Flat',
        // Both drafts are always populated (one from the fetched record,
        // the other freshly defaulted) so toggling schemaKind back and
        // forth in the modal never loses/needs to refetch either shape.
        fieldNames: record.schemaKind === 'Tree' ? [''] : [...record.fieldNames],
        tree: record.schemaKind === 'Tree' ? parseBlueprintSchemaTree(record.tree) : [],
      },
    });
  } catch (err) {
    log('OPEN blueprint-edit modal FAIL', (err as Error).message);
    showToast(t('toast.blueprintLoadFailed', { message: (err as Error).message }), 'Output Blueprint');
  }
}

export function closeBlueprintEditModal(bridge: PopupBridge): void {
  bridge.patchState({ blueprintEditModalOpen: false });
}

export function setBlueprintSchemaKind(bridge: PopupBridge, schemaKind: BlueprintEditDraft['schemaKind']): void {
  const state = bridge.getState();
  bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, schemaKind } });
}

// Issue #193 (Flat schema), extended to Tree by Issue #253: replaces the
// draft's own fieldNames (Flat) or tree (Tree) with whatever
// parseFieldNamesFromSample/buildBlueprintTreeFromSample could pull out of
// the pasted/uploaded sample — a full replace, not a merge (see this
// file's own doc comment and CLAUDE.md for why "merge into an existing
// blueprint" is deliberately out of scope for this first version). Only
// reachable while creating a new blueprint (see renderBlueprintEditModal's
// own visibility gate), so there's no already-saved field list/tree this
// could ever clobber. Dispatches purely on the draft's own current
// schemaKind — the same textarea/button serves either schema kind.
export function importBlueprintFieldNamesFromSample(bridge: PopupBridge, sampleText: string): void {
  const state = bridge.getState();
  const isTree = state.blueprintEditDraft.schemaKind === 'Tree';

  if (isTree) {
    const tree = buildBlueprintTreeFromSample(sampleText);
    if (tree.length === 0) {
      showToast(t('toast.blueprintImportEmpty'), null, 'warn');
      return;
    }
    bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
    showToast(t('toast.blueprintImportParsed', { count: countBlueprintTreeLeaves(tree) }), null, 'info');
    return;
  }

  const parsed = parseFieldNamesFromSample(sampleText);
  if (parsed.length === 0) {
    showToast(t('toast.blueprintImportEmpty'), null, 'warn');
    return;
  }
  bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: parsed } });
  showToast(t('toast.blueprintImportParsed', { count: parsed.length }), null, 'info');
}

// Issue #252: lets the sample be picked from disk instead of opened and
// pasted in by hand — this only reads the file's text and writes it into
// the existing textarea, it never parses/applies anything itself, so
// "Parse & fill fields" stays the one action that commits a sample
// regardless of which input method produced its text (consistent with the
// existing paste flow, and reusing the exact same
// importBlueprintFieldNamesFromSample code path for both). Uses
// FileReader rather than File.text() — same convention
// download-helpers.test.js/popup.test.js's own readBlobText helper already
// established, since jsdom (this project's test environment) doesn't
// implement Blob/File.text().
function loadBlueprintImportSampleFile(file: File): Promise<void> {
  const textarea = byIdOrNull<HTMLTextAreaElement>('input-blueprint-import-sample');
  return new Promise<void>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (textarea) textarea.value = reader.result as string; // readAsText
      resolve();
    };
    reader.onerror = () => {
      const message = reader.error ? reader.error.message : '';
      log('BLUEPRINT_IMPORT_FILE_READ_FAIL', message);
      showToast(t('toast.blueprintImportFileReadFailed', { message }), 'Output Blueprint');
      resolve();
    };
    reader.readAsText(file);
  });
}

export async function saveBlueprintEdit(bridge: PopupBridge): Promise<void> {
  const state = bridge.getState();
  const { name, schemaKind, fieldNames, tree } = state.blueprintEditDraft;
  const isTree = schemaKind === 'Tree';
  if (isTree ? !blueprintTreeSchemaIsValid(name, tree) : !blueprintDraftIsValid(name, fieldNames)) return;

  const trimmedName = name.trim();
  const editingId = state.blueprintEditingId;
  log('SAVE_BLUEPRINT', editingId ?? '(new)');
  try {
    const url = editingId
      ? `${getResolvedCompanionUrl()}/blueprints/${editingId}`
      : `${getResolvedCompanionUrl()}/blueprints`;
    const body = isTree
      ? { name: trimmedName, schemaKind: 'Tree', tree: serializeBlueprintSchemaTree(tree) }
      : { name: trimmedName, schemaKind: 'Flat', fieldNames: fieldNames.map(n => n.trim()) };
    const res = await companionFetch(url, {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('SAVE_BLUEPRINT OK');
    bridge.patchState({ blueprintEditModalOpen: false });
    showToast(t('toast.blueprintSaved'), null, 'info');
    await fetchOutputBlueprints(bridge);
    // Refresh the mapping picker's own view too, in case the blueprint
    // being edited is also the one currently picked for this scrape.
    if (editingId && state.selectedOutputBlueprintId === String(editingId)) {
      await selectOutputBlueprint(bridge, String(editingId));
    }
  } catch (err) {
    log('SAVE_BLUEPRINT FAIL', (err as Error).message);
    showToast(t('toast.blueprintSaveFailed', { message: (err as Error).message }), 'Output Blueprint');
  }
}

export function renderBlueprintEditModal(bridge: PopupBridge): void {
  const state = bridge.getState();
  const { name, schemaKind, fieldNames, tree } = state.blueprintEditDraft;
  const isTree = schemaKind === 'Tree';
  const nameInput = byIdOrNull<HTMLInputElement>('input-blueprint-name');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = name;

  byIdOrNull('btn-blueprint-schema-kind-flat')?.classList.toggle('active', !isTree);
  byIdOrNull('btn-blueprint-schema-kind-tree')?.classList.toggle('active', isTree);
  byIdOrNull('blueprint-flat-schema-section')?.classList.toggle('hidden', isTree);
  byIdOrNull('blueprint-tree-schema-section')?.classList.toggle('hidden', !isTree);
  // Issue #193 (Flat), extended to Tree by Issue #253: import only ever
  // targets a brand-new blueprint (see importBlueprintFieldNamesFromSample's
  // own doc comment) — hidden once editing an already-existing one,
  // regardless of schema kind. No longer schema-kind-gated: Tree-schema
  // import is fully supported now, dispatched purely by schemaKind inside
  // importBlueprintFieldNamesFromSample itself.
  byIdOrNull('blueprint-import-section')?.classList.toggle('hidden', !!state.blueprintEditingId);

  const listEl = byIdOrNull('blueprint-field-list');
  if (listEl) {
    listEl.innerHTML = fieldNames.map((fieldName, index) => {
      const escaped = escapeHtml(fieldName);
      return `<li class="blueprint-field-row" data-index="${index}">` +
        `<input type="text" class="blueprint-field-name-input" value="${escaped}" placeholder="${escapeHtml(t('modals.blueprintEdit.fieldNamePlaceholder'))}" />` +
        `<button type="button" class="btn-secondary btn-tiny btn-blueprint-field-move-up" ${index === 0 ? 'disabled' : ''}>↑</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-blueprint-field-move-down" ${index === fieldNames.length - 1 ? 'disabled' : ''}>↓</button>` +
        `<button type="button" class="btn-danger btn-blueprint-field-remove">${escapeHtml(t('common.remove'))}</button>` +
        `</li>`;
    }).join('');
  }

  renderBlueprintSchemaTree(tree);

  const saveBtn = byIdOrNull<HTMLButtonElement>('btn-blueprint-edit-save');
  if (saveBtn) saveBtn.disabled = isTree ? !blueprintTreeSchemaIsValid(name, tree) : !blueprintDraftIsValid(name, fieldNames);
}

// ── Tree schema editor (create/edit modal, Tree) ────────────────────────
// Mirrors container-tree-ui.ts's own buildGroupTreeNodeEl visually
// (indentation, name input, move/remove buttons) but simpler: no
// selector/mode/repeating/frame-path — a blueprint's target schema is
// site-independent (see OutputBlueprintTreeSchema.cs), so there's nothing
// here to pick from the page.

function buildBlueprintSchemaNodeEl(node: SFDraft.BlueprintSchemaNode, path: number[], depth: number, siblingCount: number): HTMLElement {
  const li = document.createElement('li');
  li.className = 'group-tree-node blueprint-schema-node';
  li.dataset.path = JSON.stringify(path);

  const row = document.createElement('div');
  row.className = 'group-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const index = path[path.length - 1];
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'group-tree-name blueprint-schema-name';
  nameInput.dataset.path = JSON.stringify(path);
  nameInput.value = node.name;
  nameInput.placeholder = t('modals.blueprintEdit.fieldNamePlaceholder');
  row.appendChild(nameInput);

  const moveUpBtn = document.createElement('button');
  moveUpBtn.type = 'button';
  moveUpBtn.className = 'btn-secondary btn-tiny btn-blueprint-schema-move-up';
  moveUpBtn.textContent = '↑';
  moveUpBtn.disabled = index === 0;
  row.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement('button');
  moveDownBtn.type = 'button';
  moveDownBtn.className = 'btn-secondary btn-tiny btn-blueprint-schema-move-down';
  moveDownBtn.textContent = '↓';
  moveDownBtn.disabled = index === siblingCount - 1;
  row.appendChild(moveDownBtn);

  if (node.kind === 'group') {
    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'btn-secondary btn-tiny btn-blueprint-schema-add-group';
    addGroupBtn.textContent = t('modals.blueprintEdit.addGroupBtn');
    row.appendChild(addGroupBtn);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-secondary btn-tiny btn-blueprint-schema-add-field';
    addFieldBtn.textContent = t('modals.blueprintEdit.addFieldBtn');
    row.appendChild(addFieldBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-danger btn-blueprint-schema-remove';
  removeBtn.textContent = t('common.remove');
  row.appendChild(removeBtn);

  li.appendChild(row);

  if (node.kind === 'group') {
    const childUl = document.createElement('ul');
    childUl.className = 'group-tree-children';
    node.children.forEach((child, i) => childUl.appendChild(buildBlueprintSchemaNodeEl(child, [...path, i], depth + 1, node.children.length)));
    li.appendChild(childUl);
  }

  return li;
}

export function renderBlueprintSchemaTree(tree: SFDraft.BlueprintSchemaNode[]): void {
  const root = byIdOrNull('blueprint-schema-tree-root');
  if (!root) return;
  root.innerHTML = '';
  tree.forEach((node, i) => root.appendChild(buildBlueprintSchemaNodeEl(node, [i], 0, tree.length)));
}

// ── Wiring ────────────────────────────────────────────────────────────

export function wireOutputBlueprintsEvents(bridge: PopupBridge): void {
  byIdOrNull('select-output-blueprint')?.addEventListener('change', (e) => {
    selectOutputBlueprint(bridge, (e.target as HTMLSelectElement).value);
  });

  byIdOrNull('output-blueprint-mapping-list')?.addEventListener('change', (e) => {
    const select = (e.target as Element).closest<HTMLSelectElement>('.output-blueprint-source-select');
    if (!select) return;
    updateOutputBlueprintMappingSource(bridge, select.dataset.target as string, select.value);
  });

  byIdOrNull('output-blueprint-tree-mapping-list')?.addEventListener('change', (e) => {
    const select = (e.target as Element).closest<HTMLSelectElement>('.output-blueprint-source-select');
    if (!select) return;
    updateOutputBlueprintTreeMappingSource(bridge, select.dataset.path as string, select.value);
  });

  // Issue-driven follow-up: blueprint management moved from a modal
  // (openManageBlueprintsModal) into the permanent global Settings tab —
  // this button now just navigates there.
  byIdOrNull('btn-manage-blueprints')?.addEventListener('click', () => {
    bridge.setState(STATES.SETTINGS, { blueprintDeletePendingId: null });
  });

  byIdOrNull('manage-blueprints-list')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const editBtn = target.closest<HTMLElement>('.btn-blueprint-edit');
    if (editBtn) { openBlueprintEditModal(bridge, parseInt(editBtn.dataset.id as string, 10)); return; }
    const deleteBtn = target.closest<HTMLElement>('.btn-blueprint-delete');
    if (deleteBtn) { requestDeleteBlueprint(bridge, parseInt(deleteBtn.dataset.id as string, 10)); return; }
    const confirmBtn = target.closest<HTMLElement>('.btn-blueprint-delete-confirm');
    if (confirmBtn) { deleteBlueprint(bridge, parseInt(confirmBtn.dataset.id as string, 10)); return; }
    const cancelBtn = target.closest<HTMLElement>('.btn-blueprint-delete-cancel');
    if (cancelBtn) cancelDeleteBlueprint(bridge);
  });

  byIdOrNull('btn-blueprint-new')?.addEventListener('click', () => openBlueprintCreateModal(bridge));
  byIdOrNull('btn-blueprint-edit-cancel')?.addEventListener('click', () => closeBlueprintEditModal(bridge));
  byIdOrNull('btn-blueprint-edit-save')?.addEventListener('click', () => saveBlueprintEdit(bridge));

  byIdOrNull('btn-blueprint-schema-kind-flat')?.addEventListener('click', () => setBlueprintSchemaKind(bridge, 'Flat'));
  byIdOrNull('btn-blueprint-schema-kind-tree')?.addEventListener('click', () => setBlueprintSchemaKind(bridge, 'Tree'));

  byIdOrNull('btn-blueprint-import-parse')?.addEventListener('click', () => {
    const textarea = byIdOrNull<HTMLTextAreaElement>('input-blueprint-import-sample');
    importBlueprintFieldNamesFromSample(bridge, textarea ? textarea.value : '');
  });

  byIdOrNull<HTMLInputElement>('input-blueprint-import-file')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = ''; // allow re-picking the same file to re-trigger 'change'
    if (!file) return;
    const nameEl = byIdOrNull('blueprint-import-file-name');
    if (nameEl) nameEl.textContent = file.name;
    await loadBlueprintImportSampleFile(file);
  });

  byIdOrNull('input-blueprint-name')?.addEventListener('change', (e) => {
    const state = bridge.getState();
    bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, name: (e.target as HTMLInputElement).value } });
  });

  byIdOrNull('btn-blueprint-field-add')?.addEventListener('click', () => {
    const state = bridge.getState();
    bridge.patchState({
      blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: addBlueprintFieldName(state.blueprintEditDraft.fieldNames) },
    });
  });

  byIdOrNull('blueprint-field-list')?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    const row = target.closest<HTMLElement>('.blueprint-field-row');
    if (!row || !target.classList.contains('blueprint-field-name-input')) return;
    const index = parseInt(row.dataset.index as string, 10);
    const state = bridge.getState();
    bridge.patchState({
      blueprintEditDraft: {
        ...state.blueprintEditDraft,
        fieldNames: updateBlueprintFieldName(state.blueprintEditDraft.fieldNames, index, target.value),
      },
    });
  });

  byIdOrNull('blueprint-field-list')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const row = target.closest<HTMLElement>('.blueprint-field-row');
    if (!row) return;
    const index = parseInt(row.dataset.index as string, 10);
    const state = bridge.getState();
    const { fieldNames } = state.blueprintEditDraft;

    if (target.closest('.btn-blueprint-field-move-up')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: moveBlueprintFieldName(fieldNames, index, -1) } });
    } else if (target.closest('.btn-blueprint-field-move-down')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: moveBlueprintFieldName(fieldNames, index, 1) } });
    } else if (target.closest('.btn-blueprint-field-remove')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: removeBlueprintFieldName(fieldNames, index) } });
    }
  });

  // ── Tree schema editor wiring ──────────────────────────────────────────

  byIdOrNull('btn-blueprint-schema-add-root-group')?.addEventListener('click', () => {
    const state = bridge.getState();
    const tree = insertContainerNode(state.blueprintEditDraft.tree, null, buildBlueprintSchemaGroup(''));
    bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
  });

  byIdOrNull('btn-blueprint-schema-add-root-field')?.addEventListener('click', () => {
    const state = bridge.getState();
    const tree = insertContainerNode(state.blueprintEditDraft.tree, null, buildBlueprintSchemaField(''));
    bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
  });

  byIdOrNull('blueprint-schema-tree-root')?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (!target.classList.contains('blueprint-schema-name')) return;
    const path: number[] = JSON.parse(target.dataset.path as string); // written by buildBlueprintSchemaNodeEl
    const state = bridge.getState();
    const tree = updateGroupTreeNode(state.blueprintEditDraft.tree, path, (n) => ({ ...n, name: target.value }));
    bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
  });

  byIdOrNull('blueprint-schema-tree-root')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const nodeEl = target.closest<HTMLElement>('.blueprint-schema-node');
    if (!nodeEl) return;
    const path: number[] = JSON.parse(nodeEl.dataset.path as string); // written by buildBlueprintSchemaNodeEl
    const state = bridge.getState();
    const { tree } = state.blueprintEditDraft;

    if (target.closest('.btn-blueprint-schema-move-up')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: moveGroupTreeNode(tree, path, -1) } });
    } else if (target.closest('.btn-blueprint-schema-move-down')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: moveGroupTreeNode(tree, path, 1) } });
    } else if (target.closest('.btn-blueprint-schema-remove')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: removeGroupTreeNode(tree, path) } });
    } else if (target.closest('.btn-blueprint-schema-add-group')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: insertContainerNode(tree, path, buildBlueprintSchemaGroup('')) } });
    } else if (target.closest('.btn-blueprint-schema-add-field')) {
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: insertContainerNode(tree, path, buildBlueprintSchemaField('')) } });
    }
  });
}
