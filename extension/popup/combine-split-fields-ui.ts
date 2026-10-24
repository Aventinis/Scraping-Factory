// Issue #206 follow-up: DOM rendering + event wiring for the dedicated
// "Felder kombinieren"/"Feld aufteilen" field creation modals — see
// combine-split-fields.ts's own doc comment for why this exists as its own
// flow instead of two more kinds in the generic transform-chain editor.
//
// Deliberately mode-agnostic, unlike container-tree-ui.ts/api-config-ui.js:
// it never imports anything from container-tree.ts/api-config.ts/
// scraping-config-builder.ts (which would only be safe if this file loaded
// *after* all three in popup.html — it doesn't, and can't, since
// flat-mode-ui.ts/container-tree-ui.js/api-config-ui.js each need to call
// this file's own openCombineFieldModal/openSplitFieldModal from their own
// top-level scope). `availableFieldNames` is passed in by the caller
// (popup.js, which loads last and already has every mode's own field-name
// helper on hand) rather than computed here; confirming reads the modal's
// own form fields and hands the parsed result to an injected
// onConfirmCombine/onConfirmSplit callback (also supplied by popup.js, the
// one place that already imports every mode's own insert/update helpers) —
// this file only ever decides *whether* the input is complete enough to
// call that callback at all, never *where* the result goes.
import type { DerivedFieldScope, PopupBridge } from '../types/popup';
import { t } from '../i18n/i18n';
import { combineFieldsIsValid, splitFieldIsValid, partNumberToIndex, indexToPartNumber } from './combine-split-fields';
import { byIdOrNull, qsa } from './dom';

// What popup.js injects: each callback inserts the new field into the right mode's tree and returns true on success (the modal then
// closes) or a falsy value to leave it open — the same silent-no-op-on-incomplete-input convention every field-creation modal follows.
export interface CombineSplitHandlers {
  onConfirmCombine(scope: DerivedFieldScope, name: string, sourceFieldNames: string[], separator: string, removeOriginals: boolean): boolean;
  onConfirmSplit(scope: DerivedFieldScope, name: string, sourceFieldName: string, separator: string, index: number, removeOriginal: boolean): boolean;
}

export function openCombineFieldModal(bridge: PopupBridge, scope: DerivedFieldScope): void {
  bridge.patchState({ combineFieldModalOpen: true, pendingDerivedFieldScope: scope });
}

export function openSplitFieldModal(bridge: PopupBridge, scope: DerivedFieldScope): void {
  bridge.patchState({ splitFieldModalOpen: true, pendingDerivedFieldScope: scope });
}

export function cancelCombineFieldModal(bridge: PopupBridge): void {
  bridge.patchState({ combineFieldModalOpen: false, pendingDerivedFieldScope: null });
}

export function cancelSplitFieldModal(bridge: PopupBridge): void {
  bridge.patchState({ splitFieldModalOpen: false, pendingDerivedFieldScope: null });
}

// Reset to defaults and rebuilt fresh on every call while the modal is
// open — safe because nothing inside either modal writes back to _state
// on interaction (the checkbox list's own checked state lives in the DOM
// only, read back at confirm time), the same "no re-render can happen
// mid-edit" reasoning modal-api-group-new's own render block already
// relies on (see api-config-ui.ts's renderApiConfigModals).
export function renderCombineFieldModal(bridge: PopupBridge, availableFieldNames: string[] | null | undefined): void {
  const state = bridge.getState();
  const modal = byIdOrNull('modal-combine-field');
  if (modal) modal.classList.toggle('hidden', !state.combineFieldModalOpen);
  if (!state.combineFieldModalOpen) return;

  const nameInput = byIdOrNull<HTMLInputElement>('input-combine-field-name');
  if (nameInput) { nameInput.value = ''; nameInput.focus(); }
  const separatorInput = byIdOrNull<HTMLInputElement>('input-combine-field-separator');
  if (separatorInput) separatorInput.value = ' ';
  const removeToggle = byIdOrNull<HTMLInputElement>('toggle-combine-field-remove-originals');
  if (removeToggle) removeToggle.checked = false;

  const list = byIdOrNull('combine-field-source-list');
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

export function renderSplitFieldModal(bridge: PopupBridge, availableFieldNames: string[] | null | undefined): void {
  const state = bridge.getState();
  const modal = byIdOrNull('modal-split-field');
  if (modal) modal.classList.toggle('hidden', !state.splitFieldModalOpen);
  if (!state.splitFieldModalOpen) return;

  const nameInput = byIdOrNull<HTMLInputElement>('input-split-field-name');
  if (nameInput) { nameInput.value = ''; nameInput.focus(); }
  const separatorInput = byIdOrNull<HTMLInputElement>('input-split-field-separator');
  if (separatorInput) separatorInput.value = ' ';
  const indexInput = byIdOrNull<HTMLInputElement>('input-split-field-index');
  if (indexInput) indexInput.value = String(indexToPartNumber(0));
  const removeToggle = byIdOrNull<HTMLInputElement>('toggle-split-field-remove-original');
  if (removeToggle) removeToggle.checked = false;

  const select = byIdOrNull<HTMLSelectElement>('select-split-field-source');
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

export function wireCombineSplitFieldsEvents(bridge: PopupBridge, handlers: CombineSplitHandlers): void {
  byIdOrNull('btn-combine-field-cancel')?.addEventListener('click', () => cancelCombineFieldModal(bridge));
  byIdOrNull('btn-split-field-cancel')?.addEventListener('click', () => cancelSplitFieldModal(bridge));

  byIdOrNull('btn-combine-field-confirm')?.addEventListener('click', () => {
    const state = bridge.getState();
    const scope = state.pendingDerivedFieldScope;
    if (!scope) return;
    const name = byIdOrNull<HTMLInputElement>('input-combine-field-name')?.value.trim();
    if (!name) return;
    const sourceFieldNames = qsa('.combine-field-source-checkbox:checked').map(cb => cb.dataset.fieldName as string);
    if (!combineFieldsIsValid(sourceFieldNames)) return;
    const separator = byIdOrNull<HTMLInputElement>('input-combine-field-separator')?.value ?? ' ';
    const removeOriginals = byIdOrNull<HTMLInputElement>('toggle-combine-field-remove-originals')?.checked ?? false;
    if (handlers.onConfirmCombine(scope, name, sourceFieldNames, separator, removeOriginals)) {
      bridge.patchState({ combineFieldModalOpen: false, pendingDerivedFieldScope: null });
    }
  });

  byIdOrNull('btn-split-field-confirm')?.addEventListener('click', () => {
    const state = bridge.getState();
    const scope = state.pendingDerivedFieldScope;
    if (!scope) return;
    const name = byIdOrNull<HTMLInputElement>('input-split-field-name')?.value.trim();
    if (!name) return;
    const sourceFieldName = byIdOrNull<HTMLSelectElement>('select-split-field-source')?.value ?? '';
    if (!splitFieldIsValid(sourceFieldName)) return;
    const separator = byIdOrNull<HTMLInputElement>('input-split-field-separator')?.value ?? ' ';
    const index = partNumberToIndex(parseInt(byIdOrNull<HTMLInputElement>('input-split-field-index')?.value as string, 10));
    const removeOriginal = byIdOrNull<HTMLInputElement>('toggle-split-field-remove-original')?.checked ?? false;
    if (handlers.onConfirmSplit(scope, name, sourceFieldName, separator, index, removeOriginal)) {
      bridge.patchState({ splitFieldModalOpen: false, pendingDerivedFieldScope: null });
    }
  });
}
