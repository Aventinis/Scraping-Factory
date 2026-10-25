// Editing an existing Flat or Container field (Issue #505): the creation dialogs, reopened prefilled with only the name and the
// transformation chain left editable (the pick-specific controls — type, attribute, download, text filter — belong to the element
// and are hidden). See field-edit.ts for the state side and the `bridge` convention in api-config-ui.ts.
import type { FieldEditTarget, PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { transformsAreValid } from './field-transforms';
import {
  resolveEditedField, isRenameLocked, hasEditableTransforms, openFieldEditPatch, closeFieldEditPatch, applyFieldEdit,
} from './field-edit';
import { isDerivedField } from './combine-split-fields';
import { openDerivedFieldEdit } from './combine-split-fields-ui';
import { byIdOrNull } from './dom';

const log = createLogger('SF:FieldEditUI');

interface ModalIds {
  nameInput: string; hint: string; confirmBtn: string; transformsSection: string;
  pickSections: string[]; matchCount: string;
}

const FLAT_IDS: ModalIds = {
  nameInput: 'input-field-name', hint: 'field-name-edit-hint', confirmBtn: 'btn-field-confirm',
  transformsSection: 'field-name-transforms-section', pickSections: ['field-name-text-filter-row'], // the mode section is also hidden in Blocks mode, see renderFlatFieldModal
  matchCount: 'field-name-match-count',
};
const CONTAINER_IDS: ModalIds = {
  nameInput: 'input-field-extended-name', hint: 'field-extended-edit-hint', confirmBtn: 'btn-field-extended-confirm',
  transformsSection: 'field-extended-transforms-section', pickSections: ['field-extended-mode-section', 'field-extended-text-filter-row'],
  matchCount: 'field-extended-match-count',
};

export function openFieldEdit(bridge: PopupBridge, target: FieldEditTarget): void {
  const state = bridge.getState();
  const field = resolveEditedField(state, target);
  if (!field) return;
  if (isDerivedField(field.transforms)) { openDerivedFieldEdit(bridge, target); return; }
  log('FIELD_EDIT open', target);
  bridge.setState(state.current, openFieldEditPatch(state, target));
}

export function cancelFieldEdit(bridge: PopupBridge): void {
  log('FIELD_EDIT cancel');
  bridge.setState(bridge.getState().current, closeFieldEditPatch());
}

export function confirmFieldEdit(bridge: PopupBridge): void {
  const state = bridge.getState();
  const target = state.editingField;
  if (!target) return;
  const ids = target.mode === 'flat' ? FLAT_IDS : CONTAINER_IDS;
  const name = byIdOrNull<HTMLInputElement>(ids.nameInput)?.value.trim();
  if (!name || !transformsAreValid(state.pendingTransforms)) return;
  log('FIELD_EDIT confirm', { target, name, transforms: state.pendingTransforms });
  bridge.setState(state.current, { ...applyFieldEdit(state, target, name, state.pendingTransforms), ...closeFieldEditPatch() });
}

// Called from the field dialogs' own render functions on every pass. Outside an edit it restores what an edit hid, so the creation
// flow is untouched. `isNewEdit` is the closed→open transition: the name is prefilled only then, not on each transform-row re-render.
export function renderFieldEditChrome(bridge: PopupBridge, ids: 'flat' | 'container', isNewEdit: boolean): void {
  const state = bridge.getState();
  const modal = ids === 'flat' ? FLAT_IDS : CONTAINER_IDS;
  const target = state.editingField;
  const field = target ? resolveEditedField(state, target) : null;
  const editing = !!target && !!field;

  modal.pickSections.forEach(id => byIdOrNull(id)?.classList.toggle('hidden', editing));
  const confirmBtn = byIdOrNull(modal.confirmBtn);
  if (confirmBtn) confirmBtn.textContent = t(editing ? 'modals.fieldEdit.confirm' : 'common.add');
  if (!editing) {
    byIdOrNull(modal.hint)?.classList.add('hidden');
    byIdOrNull<HTMLInputElement>(modal.nameInput)?.removeAttribute('disabled');
    return;
  }

  byIdOrNull(modal.matchCount)?.classList.add('hidden');
  byIdOrNull(modal.transformsSection)?.classList.toggle('hidden', !hasEditableTransforms(field));
  const locked = isRenameLocked(state, target);
  byIdOrNull(modal.hint)?.classList.toggle('hidden', !locked);
  const nameInput = byIdOrNull<HTMLInputElement>(modal.nameInput);
  if (!nameInput) return;
  nameInput.disabled = locked;
  if (isNewEdit) { nameInput.value = field.name; nameInput.focus(); }
}
