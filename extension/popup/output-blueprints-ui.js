// Issue #191: Output Blueprints — CRUD against the companion's /blueprints
// endpoints, the management modal's own row-list rendering (mirrors
// saved-configs-ui.js's own combined fetch+render style), the create/edit
// modal, and the per-scrape source-field mapping picker rendered inside the
// Settings section on the idle screen. Functions take a `bridge` object
// (same convention as saved-configs-ui.js/api-config-ui.js) instead of
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
const SFOutputBlueprintsUI = (function () {
  const { createLogger } =
    typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');

  const { t } =
    typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

  const { escapeHtml } =
    typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

  const { showToast } =
    typeof require !== 'undefined' ? require('./toast') : self.SFToast;

  const { collectFieldNames } =
    typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

  const { getResolvedCompanionUrl } =
    typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;

  const {
    addBlueprintFieldName, removeBlueprintFieldName, updateBlueprintFieldName, moveBlueprintFieldName,
    blueprintDraftIsValid, createMappingDraft, updateMappingSource,
    buildBlueprintSchemaGroup, buildBlueprintSchemaField, parseBlueprintSchemaTree, serializeBlueprintSchemaTree,
    blueprintTreeSchemaIsValid, createTreeMappingDraft, updateTreeMappingSource,
  } = typeof require !== 'undefined' ? require('./output-blueprints') : self.SFOutputBlueprints;

  // Issue #244: the tree schema editor's own structural editing (add/remove/
  // rename/move a group or field node) reuses container-tree.js's generic
  // path-based helpers directly — see output-blueprints.js's own doc comment
  // on why they apply unchanged to a blueprint schema node's much smaller
  // {kind, name, children} shape.
  const {
    insertContainerNode, removeGroupTreeNode, updateGroupTreeNode, moveGroupTreeNode,
  } = typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

  const EMPTY_OUTPUT_BLUEPRINT_STATE = {
    selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
    selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
  };

  // ── Fetch wrappers, mirroring saved-configs-ui.js's own style ──────────

  async function fetchOutputBlueprints(bridge) {
    bridge.patchState({ outputBlueprintsLoading: true });
    try {
      const res = await fetch(`${getResolvedCompanionUrl()}/blueprints`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const outputBlueprints = await res.json();
      log('OUTPUT_BLUEPRINTS_LIST', outputBlueprints.length);
      bridge.patchState({ outputBlueprints, outputBlueprintsLoading: false });
    } catch (err) {
      // Non-fatal: an older companion without /blueprints, or a transient
      // network hiccup — same "optional companion capability" treatment
      // fetchSavedConfigs already gives its own failure case.
      log('OUTPUT_BLUEPRINTS_LIST FAIL', err.message);
      bridge.patchState({ outputBlueprints: [], outputBlueprintsLoading: false });
    }
  }

  async function fetchOutputBlueprint(id) {
    const res = await fetch(`${getResolvedCompanionUrl()}/blueprints/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Per-scrape mapping picker (Settings section) ────────────────────────

  // True once the current mode/shape has real nesting a Tree-schema mapping
  // could actually flatten/rebuild against — the same source-shape scope
  // OutputBlueprintFlattening/ScrapingPlanValidator enforce server-side
  // (container mode, or Api mode's own tree response shape). A Tree-schema
  // blueprint is filtered out of the picker entirely for any other mode —
  // there would be nothing for its target groups to resolve against.
  function currentShapeSupportsTreeBlueprint(state) {
    return state.mode === 'container'
      || (state.mode === 'api' && !!state.apiConfig && Array.isArray(state.apiConfig.groups) && state.apiConfig.groups.length > 0);
  }

  // idValue is the <select>'s own string value — '' means "None" picked,
  // clearing the mapping entirely.
  async function selectOutputBlueprint(bridge, idValue) {
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
      log('SELECT_OUTPUT_BLUEPRINT FAIL', err.message);
      showToast(t('toast.blueprintLoadFailed', { message: err.message }), 'Output Blueprint');
    }
  }

  function updateOutputBlueprintMappingSource(bridge, targetField, sourceField) {
    const state = bridge.getState();
    bridge.patchState({
      outputBlueprintMapping: updateMappingSource(state.outputBlueprintMapping, targetField, sourceField),
    });
  }

  function updateOutputBlueprintTreeMappingSource(bridge, leafPath, sourceField) {
    const state = bridge.getState();
    bridge.patchState({
      outputBlueprintTreeMapping: updateTreeMappingSource(state.outputBlueprintTreeMapping, leafPath, sourceField),
    });
  }

  // Renders the picker <select> (options from _state.outputBlueprints,
  // Tree-schema entries filtered out when the current mode/shape can't use
  // one — see currentShapeSupportsTreeBlueprint) and, once a blueprint is
  // picked, its own mapping view: the original flat per-target-field row
  // list, or (Issue #244) the tree mapping view below, depending on
  // selectedOutputBlueprintSchemaKind. Only ever called while the picker
  // itself is reachable (flat mode, or Api mode's flat shape, or — since
  // #192 — container mode/Api's tree shape) — idle-screen-ui.js gates
  // #output-blueprint-toggle-row's own visibility.
  function renderOutputBlueprintMappingSection(bridge) {
    const state = bridge.getState();
    const selectEl = document.getElementById('select-output-blueprint');
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
      document.getElementById('output-blueprint-mapping')?.classList.add('hidden');
      renderOutputBlueprintTreeMapping(bridge);
      return;
    }

    document.getElementById('output-blueprint-tree-mapping')?.classList.add('hidden');
    const mappingSection = document.getElementById('output-blueprint-mapping');
    const targetFields = state.selectedOutputBlueprintFieldNames || [];
    if (!mappingSection) return;
    if (!state.selectedOutputBlueprintId || targetFields.length === 0) {
      mappingSection.classList.add('hidden');
      return;
    }
    mappingSection.classList.remove('hidden');

    const availableSourceFields = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
    const listEl = document.getElementById('output-blueprint-mapping-list');
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
  // scheme output-blueprints.js's own createTreeMappingDraft uses as its
  // draft keys, so a row's `data-path` can be used directly as the lookup.
  function buildOutputBlueprintTreeMappingRowHtml(node, path, depth, availableSourceFields, draft) {
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

  function renderOutputBlueprintTreeMapping(bridge) {
    const state = bridge.getState();
    const section = document.getElementById('output-blueprint-tree-mapping');
    const tree = state.selectedOutputBlueprintTree || [];
    if (!section) return;
    if (!state.selectedOutputBlueprintId || tree.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');

    const availableSourceFields = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
    const listEl = document.getElementById('output-blueprint-tree-mapping-list');
    if (listEl) {
      listEl.innerHTML = tree.map((node, i) =>
        buildOutputBlueprintTreeMappingRowHtml(node, `${i}`, 0, availableSourceFields, state.outputBlueprintTreeMapping)).join('');
    }
  }

  // ── Blueprint management modal (list + create/edit/delete) ─────────────

  function renderManageBlueprintsModal(bridge) {
    const state = bridge.getState();
    const listEl = document.getElementById('manage-blueprints-list');
    const emptyEl = document.getElementById('manage-blueprints-empty');
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

  function openManageBlueprintsModal(bridge) {
    log('OPEN manage-blueprints modal');
    bridge.patchState({ manageBlueprintsModalOpen: true, blueprintDeletePendingId: null });
  }

  function closeManageBlueprintsModal(bridge) {
    bridge.patchState({ manageBlueprintsModalOpen: false, blueprintDeletePendingId: null });
  }

  function requestDeleteBlueprint(bridge, id) {
    bridge.patchState({ blueprintDeletePendingId: id });
  }

  function cancelDeleteBlueprint(bridge) {
    bridge.patchState({ blueprintDeletePendingId: null });
  }

  async function deleteBlueprint(bridge, id) {
    log('DELETE_BLUEPRINT', id);
    try {
      const res = await fetch(`${getResolvedCompanionUrl()}/blueprints/${id}`, { method: 'DELETE' });
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
      log('DELETE_BLUEPRINT FAIL', err.message);
      showToast(t('toast.blueprintDeleteFailed', { message: err.message }), 'Output Blueprint');
    }
  }

  // ── Create/edit modal ────────────────────────────────────────────────────

  function openBlueprintCreateModal(bridge) {
    log('OPEN blueprint-edit modal (new)');
    bridge.patchState({
      blueprintEditModalOpen: true, blueprintEditingId: null,
      blueprintEditDraft: { name: '', schemaKind: 'Flat', fieldNames: [''], tree: [] },
    });
  }

  async function openBlueprintEditModal(bridge, id) {
    log('OPEN blueprint-edit modal (edit)', id);
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
      log('OPEN blueprint-edit modal FAIL', err.message);
      showToast(t('toast.blueprintLoadFailed', { message: err.message }), 'Output Blueprint');
    }
  }

  function closeBlueprintEditModal(bridge) {
    bridge.patchState({ blueprintEditModalOpen: false });
  }

  function setBlueprintSchemaKind(bridge, schemaKind) {
    const state = bridge.getState();
    bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, schemaKind } });
  }

  async function saveBlueprintEdit(bridge) {
    const state = bridge.getState();
    const { name, schemaKind, fieldNames, tree } = state.blueprintEditDraft;
    const isTree = schemaKind === 'Tree';
    if (isTree ? !blueprintTreeSchemaIsValid(name, tree) : !blueprintDraftIsValid(name, fieldNames)) return;

    const trimmedName = name.trim();
    const editingId = state.blueprintEditingId;
    log('SAVE_BLUEPRINT', editingId ?? '(new)', trimmedName, schemaKind);
    try {
      const url = editingId
        ? `${getResolvedCompanionUrl()}/blueprints/${editingId}`
        : `${getResolvedCompanionUrl()}/blueprints`;
      const body = isTree
        ? { name: trimmedName, schemaKind: 'Tree', tree: serializeBlueprintSchemaTree(tree) }
        : { name: trimmedName, schemaKind: 'Flat', fieldNames: fieldNames.map(n => n.trim()) };
      const res = await fetch(url, {
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
      log('SAVE_BLUEPRINT FAIL', err.message);
      showToast(t('toast.blueprintSaveFailed', { message: err.message }), 'Output Blueprint');
    }
  }

  function renderBlueprintEditModal(bridge) {
    const state = bridge.getState();
    const { name, schemaKind, fieldNames, tree } = state.blueprintEditDraft;
    const isTree = schemaKind === 'Tree';
    const nameInput = document.getElementById('input-blueprint-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = name;

    document.getElementById('btn-blueprint-schema-kind-flat')?.classList.toggle('active', !isTree);
    document.getElementById('btn-blueprint-schema-kind-tree')?.classList.toggle('active', isTree);
    document.getElementById('blueprint-flat-schema-section')?.classList.toggle('hidden', isTree);
    document.getElementById('blueprint-tree-schema-section')?.classList.toggle('hidden', !isTree);

    const listEl = document.getElementById('blueprint-field-list');
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

    const saveBtn = document.getElementById('btn-blueprint-edit-save');
    if (saveBtn) saveBtn.disabled = isTree ? !blueprintTreeSchemaIsValid(name, tree) : !blueprintDraftIsValid(name, fieldNames);
  }

  // ── Tree schema editor (create/edit modal, Tree) ────────────────────────
  // Mirrors container-tree-ui.js's own buildGroupTreeNodeEl visually
  // (indentation, name input, move/remove buttons) but simpler: no
  // selector/mode/repeating/frame-path — a blueprint's target schema is
  // site-independent (see OutputBlueprintTreeSchema.cs), so there's nothing
  // here to pick from the page.

  function buildBlueprintSchemaNodeEl(node, path, depth, siblingCount) {
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

  function renderBlueprintSchemaTree(tree) {
    const root = document.getElementById('blueprint-schema-tree-root');
    if (!root) return;
    root.innerHTML = '';
    tree.forEach((node, i) => root.appendChild(buildBlueprintSchemaNodeEl(node, [i], 0, tree.length)));
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  function wireOutputBlueprintsEvents(bridge) {
    document.getElementById('select-output-blueprint')?.addEventListener('change', (e) => {
      selectOutputBlueprint(bridge, e.target.value);
    });

    document.getElementById('output-blueprint-mapping-list')?.addEventListener('change', (e) => {
      const select = e.target.closest('.output-blueprint-source-select');
      if (!select) return;
      updateOutputBlueprintMappingSource(bridge, select.dataset.target, select.value);
    });

    document.getElementById('output-blueprint-tree-mapping-list')?.addEventListener('change', (e) => {
      const select = e.target.closest('.output-blueprint-source-select');
      if (!select) return;
      updateOutputBlueprintTreeMappingSource(bridge, select.dataset.path, select.value);
    });

    document.getElementById('btn-manage-blueprints')?.addEventListener('click', () => openManageBlueprintsModal(bridge));
    document.getElementById('btn-manage-blueprints-close')?.addEventListener('click', () => closeManageBlueprintsModal(bridge));

    document.getElementById('manage-blueprints-list')?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-blueprint-edit');
      if (editBtn) { openBlueprintEditModal(bridge, parseInt(editBtn.dataset.id, 10)); return; }
      const deleteBtn = e.target.closest('.btn-blueprint-delete');
      if (deleteBtn) { requestDeleteBlueprint(bridge, parseInt(deleteBtn.dataset.id, 10)); return; }
      const confirmBtn = e.target.closest('.btn-blueprint-delete-confirm');
      if (confirmBtn) { deleteBlueprint(bridge, parseInt(confirmBtn.dataset.id, 10)); return; }
      const cancelBtn = e.target.closest('.btn-blueprint-delete-cancel');
      if (cancelBtn) cancelDeleteBlueprint(bridge);
    });

    document.getElementById('btn-blueprint-new')?.addEventListener('click', () => openBlueprintCreateModal(bridge));
    document.getElementById('btn-blueprint-edit-cancel')?.addEventListener('click', () => closeBlueprintEditModal(bridge));
    document.getElementById('btn-blueprint-edit-save')?.addEventListener('click', () => saveBlueprintEdit(bridge));

    document.getElementById('btn-blueprint-schema-kind-flat')?.addEventListener('click', () => setBlueprintSchemaKind(bridge, 'Flat'));
    document.getElementById('btn-blueprint-schema-kind-tree')?.addEventListener('click', () => setBlueprintSchemaKind(bridge, 'Tree'));

    document.getElementById('input-blueprint-name')?.addEventListener('change', (e) => {
      const state = bridge.getState();
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, name: e.target.value } });
    });

    document.getElementById('btn-blueprint-field-add')?.addEventListener('click', () => {
      const state = bridge.getState();
      bridge.patchState({
        blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: addBlueprintFieldName(state.blueprintEditDraft.fieldNames) },
      });
    });

    document.getElementById('blueprint-field-list')?.addEventListener('change', (e) => {
      const row = e.target.closest('.blueprint-field-row');
      if (!row || !e.target.classList.contains('blueprint-field-name-input')) return;
      const index = parseInt(row.dataset.index, 10);
      const state = bridge.getState();
      bridge.patchState({
        blueprintEditDraft: {
          ...state.blueprintEditDraft,
          fieldNames: updateBlueprintFieldName(state.blueprintEditDraft.fieldNames, index, e.target.value),
        },
      });
    });

    document.getElementById('blueprint-field-list')?.addEventListener('click', (e) => {
      const row = e.target.closest('.blueprint-field-row');
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      const state = bridge.getState();
      const { fieldNames } = state.blueprintEditDraft;

      if (e.target.closest('.btn-blueprint-field-move-up')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: moveBlueprintFieldName(fieldNames, index, -1) } });
      } else if (e.target.closest('.btn-blueprint-field-move-down')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: moveBlueprintFieldName(fieldNames, index, 1) } });
      } else if (e.target.closest('.btn-blueprint-field-remove')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, fieldNames: removeBlueprintFieldName(fieldNames, index) } });
      }
    });

    // ── Tree schema editor wiring ──────────────────────────────────────────

    document.getElementById('btn-blueprint-schema-add-root-group')?.addEventListener('click', () => {
      const state = bridge.getState();
      const tree = insertContainerNode(state.blueprintEditDraft.tree, null, buildBlueprintSchemaGroup(''));
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
    });

    document.getElementById('btn-blueprint-schema-add-root-field')?.addEventListener('click', () => {
      const state = bridge.getState();
      const tree = insertContainerNode(state.blueprintEditDraft.tree, null, buildBlueprintSchemaField(''));
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
    });

    document.getElementById('blueprint-schema-tree-root')?.addEventListener('change', (e) => {
      if (!e.target.classList.contains('blueprint-schema-name')) return;
      const path = JSON.parse(e.target.dataset.path);
      const state = bridge.getState();
      const tree = updateGroupTreeNode(state.blueprintEditDraft.tree, path, (n) => ({ ...n, name: e.target.value }));
      bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree } });
    });

    document.getElementById('blueprint-schema-tree-root')?.addEventListener('click', (e) => {
      const nodeEl = e.target.closest('.blueprint-schema-node');
      if (!nodeEl) return;
      const path = JSON.parse(nodeEl.dataset.path);
      const state = bridge.getState();
      const { tree } = state.blueprintEditDraft;

      if (e.target.closest('.btn-blueprint-schema-move-up')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: moveGroupTreeNode(tree, path, -1) } });
      } else if (e.target.closest('.btn-blueprint-schema-move-down')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: moveGroupTreeNode(tree, path, 1) } });
      } else if (e.target.closest('.btn-blueprint-schema-remove')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: removeGroupTreeNode(tree, path) } });
      } else if (e.target.closest('.btn-blueprint-schema-add-group')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: insertContainerNode(tree, path, buildBlueprintSchemaGroup('')) } });
      } else if (e.target.closest('.btn-blueprint-schema-add-field')) {
        bridge.patchState({ blueprintEditDraft: { ...state.blueprintEditDraft, tree: insertContainerNode(tree, path, buildBlueprintSchemaField('')) } });
      }
    });
  }

  return {
    fetchOutputBlueprints, fetchOutputBlueprint, selectOutputBlueprint,
    updateOutputBlueprintMappingSource, updateOutputBlueprintTreeMappingSource,
    renderOutputBlueprintMappingSection, renderOutputBlueprintTreeMapping,
    renderManageBlueprintsModal, openManageBlueprintsModal, closeManageBlueprintsModal,
    requestDeleteBlueprint, cancelDeleteBlueprint, deleteBlueprint,
    openBlueprintCreateModal, openBlueprintEditModal, closeBlueprintEditModal, saveBlueprintEdit,
    setBlueprintSchemaKind, renderBlueprintEditModal, renderBlueprintSchemaTree,
    wireOutputBlueprintsEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFOutputBlueprintsUI;
if (typeof self !== 'undefined') self.SFOutputBlueprintsUI = SFOutputBlueprintsUI;
