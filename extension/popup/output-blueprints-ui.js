// Issue #191: Output Blueprints — CRUD against the companion's /blueprints
// endpoints, the management modal's own row-list rendering (mirrors
// saved-configs-ui.js's own combined fetch+render style), the create/edit
// modal, and the per-scrape source-field mapping picker rendered inside the
// Settings section on the idle screen. Functions take a `bridge` object
// (same convention as saved-configs-ui.js/api-config-ui.js) instead of
// closing over popup.js's own module-level state.
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
  } = typeof require !== 'undefined' ? require('./output-blueprints') : self.SFOutputBlueprints;

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

  // idValue is the <select>'s own string value — '' means "None" picked,
  // clearing the mapping entirely.
  async function selectOutputBlueprint(bridge, idValue) {
    if (!idValue) {
      log('SELECT_OUTPUT_BLUEPRINT none');
      bridge.patchState({
        selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
      });
      return;
    }
    log('SELECT_OUTPUT_BLUEPRINT', idValue);
    try {
      const record = await fetchOutputBlueprint(idValue);
      bridge.patchState({
        selectedOutputBlueprintId: idValue,
        selectedOutputBlueprintFieldNames: record.fieldNames,
        outputBlueprintMapping: createMappingDraft(record.fieldNames),
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

  // Renders the picker <select> (options from _state.outputBlueprints) and,
  // once a blueprint is picked, one mapping row per target field — a
  // <select> of the current mode's own available source field names
  // (collectFieldNames), the same field-name source the hardening null-rate/
  // required-fields pickers already draw from. Only ever called while the
  // mapping is actually reachable (flat mode, or Api mode's flat shape) —
  // idle-screen-ui.js gates #output-blueprint-toggle-row's own visibility.
  function renderOutputBlueprintMappingSection(bridge) {
    const state = bridge.getState();
    const selectEl = document.getElementById('select-output-blueprint');
    if (selectEl && document.activeElement !== selectEl) {
      const options = (state.outputBlueprints || [])
        .map(bp => `<option value="${bp.id}">${escapeHtml(bp.name)} (${bp.fieldCount})</option>`)
        .join('');
      selectEl.innerHTML = `<option value="" data-i18n="idle.outputBlueprintNoneOption">${escapeHtml(t('idle.outputBlueprintNoneOption'))}</option>${options}`;
      selectEl.value = state.selectedOutputBlueprintId || '';
    }

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
      // mapping is cleared too — its target field list is gone, so the
      // mapping draft can no longer mean anything.
      if (bridge.getState().selectedOutputBlueprintId === String(id)) {
        bridge.patchState({ selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {} });
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
      blueprintEditDraft: { name: '', fieldNames: [''] },
    });
  }

  async function openBlueprintEditModal(bridge, id) {
    log('OPEN blueprint-edit modal (edit)', id);
    try {
      const record = await fetchOutputBlueprint(id);
      bridge.patchState({
        blueprintEditModalOpen: true, blueprintEditingId: id,
        blueprintEditDraft: { name: record.name, fieldNames: [...record.fieldNames] },
      });
    } catch (err) {
      log('OPEN blueprint-edit modal FAIL', err.message);
      showToast(t('toast.blueprintLoadFailed', { message: err.message }), 'Output Blueprint');
    }
  }

  function closeBlueprintEditModal(bridge) {
    bridge.patchState({ blueprintEditModalOpen: false });
  }

  async function saveBlueprintEdit(bridge) {
    const state = bridge.getState();
    const { name, fieldNames } = state.blueprintEditDraft;
    if (!blueprintDraftIsValid(name, fieldNames)) return;

    const trimmedName = name.trim();
    const trimmedFieldNames = fieldNames.map(n => n.trim());
    const editingId = state.blueprintEditingId;
    log('SAVE_BLUEPRINT', editingId ?? '(new)', trimmedName);
    try {
      const url = editingId
        ? `${getResolvedCompanionUrl()}/blueprints/${editingId}`
        : `${getResolvedCompanionUrl()}/blueprints`;
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, fieldNames: trimmedFieldNames }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log('SAVE_BLUEPRINT OK');
      bridge.patchState({ blueprintEditModalOpen: false });
      showToast(t('toast.blueprintSaved'), null, 'info');
      await fetchOutputBlueprints(bridge);
      // Refresh the mapping target-field list too, in case the blueprint
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
    const { name, fieldNames } = state.blueprintEditDraft;
    const nameInput = document.getElementById('input-blueprint-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = name;

    const listEl = document.getElementById('blueprint-field-list');
    if (!listEl) return;
    listEl.innerHTML = fieldNames.map((fieldName, index) => {
      const escaped = escapeHtml(fieldName);
      return `<li class="blueprint-field-row" data-index="${index}">` +
        `<input type="text" class="blueprint-field-name-input" value="${escaped}" placeholder="${escapeHtml(t('modals.blueprintEdit.fieldNamePlaceholder'))}" />` +
        `<button type="button" class="btn-secondary btn-tiny btn-blueprint-field-move-up" ${index === 0 ? 'disabled' : ''}>↑</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-blueprint-field-move-down" ${index === fieldNames.length - 1 ? 'disabled' : ''}>↓</button>` +
        `<button type="button" class="btn-danger btn-blueprint-field-remove">${escapeHtml(t('common.remove'))}</button>` +
        `</li>`;
    }).join('');

    const saveBtn = document.getElementById('btn-blueprint-edit-save');
    if (saveBtn) saveBtn.disabled = !blueprintDraftIsValid(name, fieldNames);
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
  }

  return {
    fetchOutputBlueprints, fetchOutputBlueprint, selectOutputBlueprint, updateOutputBlueprintMappingSource,
    renderOutputBlueprintMappingSection,
    renderManageBlueprintsModal, openManageBlueprintsModal, closeManageBlueprintsModal,
    requestDeleteBlueprint, cancelDeleteBlueprint, deleteBlueprint,
    openBlueprintCreateModal, openBlueprintEditModal, closeBlueprintEditModal, saveBlueprintEdit,
    renderBlueprintEditModal,
    wireOutputBlueprintsEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFOutputBlueprintsUI;
if (typeof self !== 'undefined') self.SFOutputBlueprintsUI = SFOutputBlueprintsUI;
