// ── Combined mode: component list render + wiring (Issue #239) ─────────────
// Follows the project's <feature>.js/<feature>-ui.js split (see CLAUDE.md's
// "Popup module boundaries" architecture decision) — pure add/remove/move
// helpers live in combined-config.js, this file owns the DOM side: the
// ordered component list, the "add from saved configurations" picker
// (sourced from every saved configuration regardless of host — see
// saved-configs-ui.js's fetchAllSavedConfigs — since a component doesn't
// have to match the page currently open), and the merge-key name inputs.
const SFCombinedConfigUI = (function () {
  const { createLogger } =
    typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { escapeHtml } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { addComponent, removeComponent, updateComponentName, moveComponent } =
    typeof require !== 'undefined' ? require('./combined-config') : self.SFCombinedConfig;

  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Builds one <li> row for a picked component — an editable merge-key name
  // input, a read-only hint of which saved configuration it's linked to
  // (looked up live in _state.allSavedConfigs, since the same saved config
  // could since have been renamed/deleted elsewhere), and ↑/↓/Remove
  // controls mirroring field-transforms-ui.js's buildTransformRowEl exactly.
  function buildComponentRowEl(component, index, total, allSavedConfigs) {
    const li = document.createElement('li');
    li.className = 'group-tree-row combined-component-row';
    li.dataset.index = String(index);

    const sourceConfig = (allSavedConfigs || []).find((c) => c.id === component.savedConfigId);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'group-tree-name combined-component-name-input';
    nameInput.value = component.name;
    nameInput.placeholder = t('idle.combinedNamePlaceholder');
    li.appendChild(nameInput);

    const sourceEl = document.createElement('span');
    sourceEl.className = 'combined-component-source';
    if (sourceConfig) {
      sourceEl.textContent = `${sourceConfig.name} (${hostnameOf(sourceConfig.url)})`;
    } else {
      sourceEl.textContent = t('idle.combinedComponentMissing');
      sourceEl.classList.add('warn');
    }
    li.appendChild(sourceEl);

    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'btn-secondary btn-tiny btn-combined-move-up';
    moveUpBtn.textContent = '↑';
    moveUpBtn.disabled = index === 0;
    li.appendChild(moveUpBtn);

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'btn-secondary btn-tiny btn-combined-move-down';
    moveDownBtn.textContent = '↓';
    moveDownBtn.disabled = index === total - 1;
    li.appendChild(moveDownBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger btn-tiny btn-combined-remove';
    removeBtn.textContent = t('common.remove');
    li.appendChild(removeBtn);

    return li;
  }

  function renderCombinedSection(bridge) {
    const state = bridge.getState();
    const components = state.combinedComponents || [];
    const allSavedConfigs = state.allSavedConfigs || [];

    const listEl = document.getElementById('combined-components-list');
    if (listEl) {
      listEl.innerHTML = '';
      components.forEach((component, i) =>
        listEl.appendChild(buildComponentRowEl(component, i, components.length, allSavedConfigs)));
    }

    // Already-picked components stay selectable again (a saved config can
    // sensibly be combined with itself under a different name), so the
    // picker always lists every saved configuration, not just the unpicked
    // ones.
    const hasSavedConfigs = allSavedConfigs.length > 0;
    document.getElementById('combined-no-saved-configs-hint')?.classList.toggle('hidden', hasSavedConfigs);
    const selectEl = document.getElementById('select-combined-add-component');
    const addBtn = document.getElementById('btn-combined-add-component');
    if (addBtn) addBtn.disabled = !hasSavedConfigs;
    if (selectEl) {
      selectEl.classList.toggle('hidden', !hasSavedConfigs);
      selectEl.innerHTML = allSavedConfigs.map((c) =>
        `<option value="${c.id}">${escapeHtml(t('idle.combinedPickerOption', { name: c.name, host: hostnameOf(c.url) }))}</option>`,
      ).join('');
    }
  }

  function wireCombinedConfigEvents(bridge) {
    document.getElementById('btn-combined-add-component')?.addEventListener('click', () => {
      const selectEl = document.getElementById('select-combined-add-component');
      const id = parseInt(selectEl?.value, 10);
      const state = bridge.getState();
      const savedConfig = (state.allSavedConfigs || []).find((c) => c.id === id);
      if (!savedConfig) return;
      log('BTN combined-add-component', id);
      bridge.patchState({ combinedComponents: addComponent(state.combinedComponents || [], savedConfig) });
    });

    const listEl = document.getElementById('combined-components-list');
    if (!listEl) return;

    listEl.addEventListener('change', (e) => {
      if (!e.target.classList.contains('combined-component-name-input')) return;
      const row = e.target.closest('.combined-component-row');
      const index = parseInt(row.dataset.index, 10);
      const name = e.target.value.trim();
      if (!name) return; // blank reverts on the next render rather than saving an empty merge key
      const state = bridge.getState();
      bridge.patchState({ combinedComponents: updateComponentName(state.combinedComponents || [], index, name) });
    });

    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.combined-component-row');
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      const state = bridge.getState();
      const components = state.combinedComponents || [];

      if (e.target.closest('.btn-combined-move-up')) {
        bridge.patchState({ combinedComponents: moveComponent(components, index, -1) });
      } else if (e.target.closest('.btn-combined-move-down')) {
        bridge.patchState({ combinedComponents: moveComponent(components, index, 1) });
      } else if (e.target.closest('.btn-combined-remove')) {
        bridge.patchState({ combinedComponents: removeComponent(components, index) });
      }
    });
  }

  return { renderCombinedSection, wireCombinedConfigEvents };
})();

if (typeof module !== 'undefined') module.exports = SFCombinedConfigUI;
if (typeof self !== 'undefined') self.SFCombinedConfigUI = SFCombinedConfigUI;
