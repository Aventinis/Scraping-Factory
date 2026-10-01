// Issue #206 follow-up: DOM rendering + event wiring for the dedicated
// "Felder kombinieren"/"Feld aufteilen" field creation modals — see
// combine-split-fields.js's own doc comment for why this exists as its own
// flow instead of two more kinds in the generic transform-chain editor.
//
// Deliberately mode-agnostic, unlike container-tree-ui.js/api-config-ui.js:
// it never imports anything from container-tree.js/api-config.js/
// scraping-config-builder.js (which would only be safe if this file loaded
// *after* all three in popup.html — it doesn't, and can't, since
// flat-mode-ui.js/container-tree-ui.js/api-config-ui.js each need to call
// this file's own openCombineFieldModal/openSplitFieldModal from their own
// top-level scope). `availableFieldNames` is passed in by the caller
// (popup.js, which loads last and already has every mode's own field-name
// helper on hand) rather than computed here; confirming reads the modal's
// own form fields and hands the parsed result to an injected
// onConfirmCombine/onConfirmSplit callback (also supplied by popup.js, the
// one place that already imports every mode's own insert/update helpers) —
// this file only ever decides *whether* the input is complete enough to
// call that callback at all, never *where* the result goes.
const SFCombineSplitFieldsUI = (function () {
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { combineFieldsIsValid, splitFieldIsValid } =
    typeof require !== 'undefined' ? require('./combine-split-fields') : self.SFCombineSplitFields;

  function openCombineFieldModal(bridge, scope) {
    bridge.patchState({ combineFieldModalOpen: true, pendingDerivedFieldScope: scope });
  }

  function openSplitFieldModal(bridge, scope) {
    bridge.patchState({ splitFieldModalOpen: true, pendingDerivedFieldScope: scope });
  }

  function cancelCombineFieldModal(bridge) {
    bridge.patchState({ combineFieldModalOpen: false, pendingDerivedFieldScope: null });
  }

  function cancelSplitFieldModal(bridge) {
    bridge.patchState({ splitFieldModalOpen: false, pendingDerivedFieldScope: null });
  }

  // Reset to defaults and rebuilt fresh on every call while the modal is
  // open — safe because nothing inside either modal writes back to _state
  // on interaction (the checkbox list's own checked state lives in the DOM
  // only, read back at confirm time), the same "no re-render can happen
  // mid-edit" reasoning modal-api-group-new's own render block already
  // relies on (see api-config-ui.js's renderApiConfigModals).
  function renderCombineFieldModal(bridge, availableFieldNames) {
    const state = bridge.getState();
    const modal = document.getElementById('modal-combine-field');
    if (modal) modal.classList.toggle('hidden', !state.combineFieldModalOpen);
    if (!state.combineFieldModalOpen) return;

    const nameInput = document.getElementById('input-combine-field-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const separatorInput = document.getElementById('input-combine-field-separator');
    if (separatorInput) separatorInput.value = ' ';
    const removeToggle = document.getElementById('toggle-combine-field-remove-originals');
    if (removeToggle) removeToggle.checked = false;

    const list = document.getElementById('combine-field-source-list');
    if (list) {
      list.innerHTML = '';
      (availableFieldNames || []).forEach((name) => {
        const li = document.createElement('li');
        li.className = 'combine-field-source-row';
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'combine-field-source-checkbox';
        checkbox.dataset.fieldName = name;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${name}`));
        li.appendChild(label);
        list.appendChild(li);
      });
    }
  }

  function renderSplitFieldModal(bridge, availableFieldNames) {
    const state = bridge.getState();
    const modal = document.getElementById('modal-split-field');
    if (modal) modal.classList.toggle('hidden', !state.splitFieldModalOpen);
    if (!state.splitFieldModalOpen) return;

    const nameInput = document.getElementById('input-split-field-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const separatorInput = document.getElementById('input-split-field-separator');
    if (separatorInput) separatorInput.value = ' ';
    const indexInput = document.getElementById('input-split-field-index');
    if (indexInput) indexInput.value = '0';
    const removeToggle = document.getElementById('toggle-split-field-remove-original');
    if (removeToggle) removeToggle.checked = false;

    const select = document.getElementById('select-split-field-source');
    if (select) {
      select.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('transforms.splitSourcePlaceholderOption');
      select.appendChild(placeholder);
      (availableFieldNames || []).forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });
    }
  }

  // handlers: { onConfirmCombine(scope, name, sourceFieldNames, separator,
  // removeOriginals), onConfirmSplit(scope, name, sourceFieldName,
  // separator, index, removeOriginals) } — each returns true on success
  // (closes the modal) or a falsy value to leave it open, the same silent-
  // no-op-on-incomplete-input convention every other field-creation modal
  // in this codebase already follows (confirmField/confirmExtendedField).
  function wireCombineSplitFieldsEvents(bridge, handlers) {
    document.getElementById('btn-combine-field-cancel')?.addEventListener('click', () => cancelCombineFieldModal(bridge));
    document.getElementById('btn-split-field-cancel')?.addEventListener('click', () => cancelSplitFieldModal(bridge));

    document.getElementById('btn-combine-field-confirm')?.addEventListener('click', () => {
      const state = bridge.getState();
      const scope = state.pendingDerivedFieldScope;
      if (!scope) return;
      const name = document.getElementById('input-combine-field-name')?.value.trim();
      if (!name) return;
      const sourceFieldNames = Array.from(document.querySelectorAll('.combine-field-source-checkbox:checked')).map(cb => cb.dataset.fieldName);
      if (!combineFieldsIsValid(sourceFieldNames)) return;
      const separator = document.getElementById('input-combine-field-separator')?.value ?? ' ';
      const removeOriginals = document.getElementById('toggle-combine-field-remove-originals')?.checked ?? false;
      if (handlers.onConfirmCombine(scope, name, sourceFieldNames, separator, removeOriginals)) {
        bridge.patchState({ combineFieldModalOpen: false, pendingDerivedFieldScope: null });
      }
    });

    document.getElementById('btn-split-field-confirm')?.addEventListener('click', () => {
      const state = bridge.getState();
      const scope = state.pendingDerivedFieldScope;
      if (!scope) return;
      const name = document.getElementById('input-split-field-name')?.value.trim();
      if (!name) return;
      const sourceFieldName = document.getElementById('select-split-field-source')?.value ?? '';
      if (!splitFieldIsValid(sourceFieldName)) return;
      const separator = document.getElementById('input-split-field-separator')?.value ?? ' ';
      const parsedIndex = parseInt(document.getElementById('input-split-field-index')?.value, 10);
      const index = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
      const removeOriginal = document.getElementById('toggle-split-field-remove-original')?.checked ?? false;
      if (handlers.onConfirmSplit(scope, name, sourceFieldName, separator, index, removeOriginal)) {
        bridge.patchState({ splitFieldModalOpen: false, pendingDerivedFieldScope: null });
      }
    });
  }

  return {
    openCombineFieldModal, openSplitFieldModal, cancelCombineFieldModal, cancelSplitFieldModal,
    renderCombineFieldModal, renderSplitFieldModal, wireCombineSplitFieldsEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFCombineSplitFieldsUI;
if (typeof self !== 'undefined') self.SFCombineSplitFieldsUI = SFCombineSplitFieldsUI;
