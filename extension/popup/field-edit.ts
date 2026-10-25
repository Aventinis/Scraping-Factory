// Editing a Flat or Container field's name and transformation chain after it was created (Issue #505): the pure state logic.
// The dialogs are the ones used for creating a field; field-edit-ui.ts adapts them.
import type * as SFDraft from '../types/drafts';
import type * as SFWire from '../types/wire';
import type { DerivedFieldScope, FieldEditTarget, State, StatePatch } from '../types/popup';
import { resolveGroupNode, updateGroupTreeNode } from './container-tree';
import { updateField } from './scraping-config-builder';
import { isDerivedField } from './combine-split-fields';

type EditableField = SFDraft.Field | SFDraft.FieldNode;
type EditState = Pick<State, 'fields' | 'groups'>;

export function resolveEditedField(state: EditState, target: FieldEditTarget): EditableField | null {
  if (target.mode === 'flat') return state.fields[target.index] ?? null;
  const node = resolveGroupNode(state.groups, target.path);
  return node?.kind === 'field' ? node : null;
}

// The fields a derived field can read from: every flat field, or the siblings inside the edited node's own group.
function siblingFields(state: EditState, target: FieldEditTarget): EditableField[] {
  if (target.mode === 'flat') return state.fields;
  const parentPath = target.path.slice(0, -1);
  const siblings = parentPath.length === 0 ? state.groups : (resolveGroupNode(state.groups, parentPath) as SFDraft.GroupNode).children;
  return siblings.filter((node): node is SFDraft.FieldNode => node.kind === 'field');
}

function derivedSourceNames(field: EditableField): string[] {
  const first = field.transforms?.[0];
  if (first?.kind === 'combineFields') return first.sourceFieldNames;
  if (first?.kind === 'splitField') return [first.sourceFieldName];
  return [];
}

// A combine / split field names its sources, so renaming one would silently break it.
export function isRenameLocked(state: EditState, target: FieldEditTarget): boolean {
  const edited = resolveEditedField(state, target);
  if (!edited) return false;
  return siblingFields(state, target).some(field => field !== edited && derivedSourceNames(field).includes(edited.name));
}

// Chains of derived fields are edited through their own dialogs, and an "exists" field has no chain at all.
export function hasEditableTransforms(field: EditableField): boolean {
  return !isDerivedField(field.transforms) && !('mode' in field && field.mode === 'exists');
}

export function openFieldEditPatch(state: EditState, target: FieldEditTarget): StatePatch {
  const field = resolveEditedField(state, target) as EditableField;
  return {
    editingField: target,
    pendingTransforms: [...(field.transforms ?? [])],
    pendingRawText: field.sampleValue ?? null,
    pendingElementAttributes: null, pendingOwnText: null, pendingMatchCount: null,
  };
}

export function closeFieldEditPatch(): StatePatch {
  return {
    editingField: null, pendingTransforms: [], pendingRawText: null,
    pendingElementAttributes: null, pendingOwnText: null, pendingMatchCount: null,
  };
}

export function applyFieldEdit(state: EditState, target: FieldEditTarget, name: string, transforms: SFWire.FieldTransform[]): StatePatch {
  const field = resolveEditedField(state, target) as EditableField;
  const chain = hasEditableTransforms(field) ? (transforms.length > 0 ? transforms : null) : field.transforms;
  if (target.mode === 'flat') return { fields: updateField(state.fields, target.index, { name, transforms: chain }) };
  return { groups: updateGroupTreeNode(state.groups, target.path, node => ({ ...node, name, transforms: chain } as SFDraft.ContainerNode)) };
}

// A combine / split field may only read fields that come before it (the companion validates the order), and it stays in place when
// edited, so only its predecessors are offered as sources.
export function derivedEditAvailableNames(state: EditState, target: FieldEditTarget): string[] {
  const edited = resolveEditedField(state, target);
  const siblings = siblingFields(state, target);
  return siblings.slice(0, siblings.indexOf(edited as EditableField)).map(field => field.name);
}

export function derivedEditScope(target: FieldEditTarget): DerivedFieldScope {
  return target.mode === 'flat'
    ? { mode: 'flat' }
    : { mode: 'container', parentPath: target.path.length > 1 ? target.path.slice(0, -1) : null };
}

export function applyDerivedFieldEdit(state: EditState, target: FieldEditTarget, name: string, transform: SFWire.FieldTransform): StatePatch {
  if (target.mode === 'flat') return { fields: updateField(state.fields, target.index, { name, transforms: [transform] }) };
  return { groups: updateGroupTreeNode(state.groups, target.path, node => ({ ...node, name, transforms: [transform] } as SFDraft.ContainerNode)) };
}
