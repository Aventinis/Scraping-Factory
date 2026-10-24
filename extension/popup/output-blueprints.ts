// Pure, DOM-free helpers for Output Blueprints: editing a blueprint's target-field list or tree (create / edit modal) and
// building the per-scrape source-field mapping draft. The tree structure reuses container-tree.ts's generic path helpers
// (insertContainerNode, removeGroupTreeNode, ...), which only read `.children`, against the much smaller
// {kind, name, children} schema node (Architecture Decision #13).
import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';

// target field (or leaf path) -> chosen source field, null while unset
type MappingDraft = Record<string, string | null>;

// A fetched schema tree: a group has `children`, a leaf does not (no `kind`).
export interface SchemaTreeWireNode {
  name: string;
  children?: SchemaTreeWireNode[] | null;
}

// ── Editing a blueprint's own field-name list (create / edit modal, Flat) ──

export function addBlueprintFieldName(fieldNames: string[]): string[] {
  return [...fieldNames, ''];
}

export function removeBlueprintFieldName(fieldNames: string[], index: number): string[] {
  return fieldNames.filter((_, i) => i !== index);
}

export function updateBlueprintFieldName(fieldNames: string[], index: number, name: string): string[] {
  return fieldNames.map((n, i) => (i === index ? name : n));
}

// direction: -1 (up) or +1 (down) — same swap-with-adjacent-sibling
// convention as field-transforms.ts's moveTransform/combined-config.js's
// moveComponent.
export function moveBlueprintFieldName(fieldNames: string[], index: number, direction: number): string[] {
  const target = index + direction;
  if (target < 0 || target >= fieldNames.length) return fieldNames;
  const copy = [...fieldNames];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

// Blocks saving: a blank or duplicate target name can never be a valid 1:1 mapping target.
export function blueprintDraftIsValid(name: string, fieldNames: string[]): boolean {
  const trimmedName = name.trim();
  if (!trimmedName || fieldNames.length === 0) return false;
  const trimmed = fieldNames.map(n => n.trim());
  if (trimmed.some(n => !n)) return false;
  return new Set(trimmed).size === trimmed.length;
}

// Looks for the "record" a sample's field names should come from. A real sample is often wrapped in outer keys
// (`{"offerTiles": [{"title": ""}]}`) that are not field names, so this walks depth-first into the first
// array-of-objects / nested object; a plain object whose values are all scalars is the record itself. Mixed shapes prefer
// the nested match (a heuristic).
function findSampleRecord(value: unknown, depth: number): Record<string, unknown> | null {
  if (depth > 10 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    if (!first || typeof first !== 'object') return null;
    return Array.isArray(first) ? findSampleRecord(first, depth + 1) : first as Record<string, unknown>;
  }
  const record = value as Record<string, unknown>;
  const values = Object.values(record);
  const isFlatRecord = Object.keys(record).length > 0 && values.every(v => v === null || typeof v !== 'object');
  if (isFlatRecord) return record;
  for (const v of values) {
    const found = findSampleRecord(v, depth + 1);
    if (found) return found;
  }
  return null;
}

// A line of only JSON punctuation (`{`, `}`, `[`, `]`, `,`) is never a field name, also in a hand-edited fragment.
function isStructuralOnlyLine(line: string): boolean {
  return /^[{}[\],]*$/.test(line);
}

// Extracts the key from a `"key": value` / `key: value` line (optional trailing comma), to recover names from a pasted object
// literal that fails JSON.parse. null when the line is not a property.
function extractLeadingKey(line: string): string | null {
  const quoted = line.match(/^"([^"]*)"\s*:/);
  if (quoted) return quoted[1];
  const bare = line.match(/^([A-Za-z_$][\w$-]*)\s*:/);
  return bare ? bare[1] : null;
}

// Parses a pasted / uploaded sample (JSON object or array, a CSV header, or a newline / comma-separated list) into an
// ordered, deduplicated field-name list, auto-detecting the format: JSON first (an array of strings is the list itself),
// then a per-line pass that recognizes a pasted object literal, then a comma in the first line decides CSV header vs. one
// name per line (the same split either way). [] when nothing name-like is found; the caller reports "could not parse".
export function parseFieldNamesFromSample(text: string | null | undefined): string[] {
  const dedupeTrimmed = (names: unknown[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of names) {
      const name = String(raw).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push(name);
    }
    return result;
  };

  const trimmedInput = (text || '').trim();
  if (!trimmedInput) return [];

  try {
    const parsed = JSON.parse(trimmedInput);
    if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
      return dedupeTrimmed(parsed);
    }
    const sample = findSampleRecord(parsed, 0);
    return sample ? dedupeTrimmed(Object.keys(sample)) : [];
  } catch {
    // Not valid JSON — fall through to the line-based parsing below.
  }

  const lines = trimmedInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const meaningfulLines = lines.filter(line => !isStructuralOnlyLine(line));
  if (meaningfulLines.length === 0) return [];

  if (meaningfulLines.some(line => extractLeadingKey(line))) {
    return dedupeTrimmed(meaningfulLines.map(line => extractLeadingKey(line) || line));
  }

  const stripQuotes = (s: string) => s.replace(/^"(.*)"$/, '$1');
  if (meaningfulLines[0].includes(',')) {
    return dedupeTrimmed(meaningfulLines[0].split(',').map(stripQuotes));
  }
  return dedupeTrimmed(meaningfulLines);
}

// ── Editing a blueprint's own target tree (Tree) ──
// Node: { kind: 'group', name, children } | { kind: 'field', name } (no selector / mode / repeating).

export function buildBlueprintSchemaGroup(name: string): SFDraft.BlueprintSchemaGroup {
  return { kind: 'group', name, children: [] };
}

export function buildBlueprintSchemaField(name: string): SFDraft.BlueprintSchemaField {
  return { kind: 'field', name };
}

// Builds tree nodes from a JSON object's keys. Unlike findSampleRecord this does NOT drill through a wrapper key: an import
// should reproduce real nesting, so "offerTiles" becomes a group. A scalar key is a field; an object or array-of-objects key
// is a group built recursively (an array from its first element, no repeating flag). Arrays of scalars and objects without
// importable children are skipped.
function buildTreeNodesFromRecord(record: Record<string, unknown>, depth: number): SFDraft.BlueprintSchemaNode[] {
  if (depth > 10) return [];
  const nodes: SFDraft.BlueprintSchemaNode[] = [];
  for (const [rawKey, value] of Object.entries(record)) {
    const name = String(rawKey).trim();
    if (!name) continue;
    if (value === null || typeof value !== 'object') {
      nodes.push(buildBlueprintSchemaField(name));
      continue;
    }
    let childRecord: Record<string, unknown> | null = null;
    if (Array.isArray(value)) {
      const first: unknown = value[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) childRecord = first as Record<string, unknown>;
    } else {
      childRecord = value as Record<string, unknown>;
    }
    if (!childRecord) continue;
    const children = buildTreeNodesFromRecord(childRecord, depth + 1);
    if (children.length === 0) continue;
    nodes.push({ kind: 'group', name, children });
  }
  return nodes;
}

// The Tree counterpart of parseFieldNamesFromSample: a nested tree from a pasted / uploaded JSON sample. Valid JSON is
// required (no line-based fallback; nesting cannot be recovered from indentation). A top-level array of strings becomes flat
// field nodes, an array of objects uses the first element's keys, any other array gives []; an object goes to
// buildTreeNodesFromRecord.
export function buildBlueprintTreeFromSample(text: string | null | undefined): SFDraft.BlueprintSchemaNode[] {
  const trimmedInput = (text || '').trim();
  if (!trimmedInput) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedInput);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) {
    if (parsed.every((v): v is string => typeof v === 'string')) {
      return parsed.map(v => v.trim()).filter(Boolean).map(name => buildBlueprintSchemaField(name));
    }
    const first: unknown = parsed[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return [];
    return buildTreeNodesFromRecord(first as Record<string, unknown>, 0);
  }

  if (parsed === null || typeof parsed !== 'object') return [];
  return buildTreeNodesFromRecord(parsed as Record<string, unknown>, 0);
}

// Counts leaf fields (a top-level node count would undercount with groups), for the "N fields imported" message.
export function countBlueprintTreeLeaves(nodes: SFDraft.BlueprintSchemaNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.kind === 'group' ? countBlueprintTreeLeaves(node.children) : 1), 0);
}

// Converts a fetched wire tree ({name, children} group, {name} leaf, no `kind`) into the editor's {kind, ...} shape.
export function parseBlueprintSchemaTree(wireNodes: SchemaTreeWireNode[] | null | undefined): SFDraft.BlueprintSchemaNode[] {
  return (wireNodes || []).map((node): SFDraft.BlueprintSchemaNode => (Array.isArray(node.children)
    ? { kind: 'group', name: node.name, children: parseBlueprintSchemaTree(node.children) }
    : { kind: 'field', name: node.name }));
}

// Reverse of parseBlueprintSchemaTree — strips the popup's internal `kind`
// tag, mirrors container-tree.ts's own serializeGroupTree in spirit.
export function serializeBlueprintSchemaTree(nodes: SFDraft.BlueprintSchemaNode[]): SchemaTreeWireNode[] {
  return nodes.map((node): SchemaTreeWireNode => (node.kind === 'group'
    ? { name: node.name, children: serializeBlueprintSchemaTree(node.children) }
    : { name: node.name }));
}

// Every node needs a non-blank name, and a group needs at least one child
// (an empty group carries no field to ever map anything onto) — mirrors
// OutputBlueprintTreeSchemaValidator's own companion-side structural check.
export function blueprintTreeSchemaIsValid(name: string, tree: SFDraft.BlueprintSchemaNode[] | null | undefined): boolean {
  if (!name.trim() || !tree || tree.length === 0) return false;
  const walk = (nodes: SFDraft.BlueprintSchemaNode[]): boolean => nodes.every(node => {
    if (!node.name || !node.name.trim()) return false;
    return node.kind === 'group' ? node.children.length > 0 && walk(node.children) : true;
  });
  return walk(tree);
}

// ── Per-scrape source-field mapping draft (Flat) ────────────────────────

// One entry per target field, source starting unset — targetFieldNames is
// the picked blueprint's own ordered field list (see fetchOutputBlueprint
// in output-blueprints-ui.js).
export function createMappingDraft(targetFieldNames: string[]): MappingDraft {
  const draft: MappingDraft = {};
  for (const name of targetFieldNames) draft[name] = null;
  return draft;
}

export function updateMappingSource(draft: MappingDraft, targetField: string, sourceField: string | null | undefined): MappingDraft {
  return { ...draft, [targetField]: sourceField || null };
}

// Same "incomplete draft blocks the action it feeds" convention as the
// per-field null-rate hardening check's own rows — every target field
// needs a chosen source before "Generate" is allowed.
export function mappingIsComplete(targetFieldNames: string[], draft: MappingDraft): boolean {
  return targetFieldNames.length > 0 && targetFieldNames.every(name => !!draft[name]);
}

// ── Per-scrape source-field mapping draft (Tree) ──
// Keyed by each leaf's dot-joined child-index path ("0.1"), not by name: two leaves may share a name in different branches.

function walkTreeLeafPaths(nodes: SFDraft.OutputBlueprintTreeNode[], prefix: string, visit: (path: string, node: SFDraft.OutputBlueprintTreeNode) => void): void {
  nodes.forEach((node, i) => {
    const path = prefix ? `${prefix}.${i}` : `${i}`;
    if (Array.isArray(node.children)) walkTreeLeafPaths(node.children, path, visit);
    else visit(path, node);
  });
}

export function createTreeMappingDraft(tree: SFDraft.OutputBlueprintTreeNode[] | null | undefined): MappingDraft {
  const draft: MappingDraft = {};
  walkTreeLeafPaths(tree || [], '', (path) => { draft[path] = null; });
  return draft;
}

export function updateTreeMappingSource(draft: MappingDraft, leafPath: string, sourceField: string | null | undefined): MappingDraft {
  return { ...draft, [leafPath]: sourceField || null };
}

export function treeMappingIsComplete(tree: SFDraft.OutputBlueprintTreeNode[] | null | undefined, draft: MappingDraft): boolean {
  if (!tree || tree.length === 0) return false;
  let complete = true;
  walkTreeLeafPaths(tree, '', (path) => { if (!draft[path]) complete = false; });
  return complete;
}

// Builds the wire-shaped OutputBlueprintTreeMappingNode[] — mirrors the
// fetched target tree node-for-node, attaching each leaf's picked source
// field from `draft`.
function buildOutputBlueprintTreeMappingNodes(nodes: SFDraft.OutputBlueprintTreeNode[], draft: MappingDraft, prefix: string): SFWire.OutputBlueprintTreeMappingNode[] {
  return nodes.map((node, i): SFWire.OutputBlueprintTreeMappingNode => {
    const path = prefix ? `${prefix}.${i}` : `${i}`;
    return Array.isArray(node.children)
      ? { name: node.name, children: buildOutputBlueprintTreeMappingNodes(node.children, draft, path) }
      : { name: node.name, sourceField: draft[path] as string };
  });
}

// Returns the wire OutputBlueprintMapping, or null when no blueprint is picked or the mapping is incomplete (the
// "incomplete draft = off" convention). blueprintId is the <select> string, parsed to a number. schemaKind picks which
// of (targetFieldNames, draft) / (tree, treeDraft) counts.
export function buildOutputBlueprintMapping(
  blueprintId: number | string | null | undefined, schemaKind: SFWire.OutputBlueprintSchemaKind, targetFieldNames: string[], draft: MappingDraft,
  tree?: SFDraft.OutputBlueprintTreeNode[], treeDraft?: MappingDraft,
): SFWire.OutputBlueprintMapping | null {
  if (!blueprintId) return null;
  if (schemaKind === 'Tree') {
    if (!tree || !treeDraft || !treeMappingIsComplete(tree, treeDraft)) return null;
    return { blueprintId: parseInt(String(blueprintId), 10), schemaKind: 'Tree', tree: buildOutputBlueprintTreeMappingNodes(tree, treeDraft, '') };
  }
  if (!mappingIsComplete(targetFieldNames, draft)) return null;
  return {
    blueprintId: parseInt(String(blueprintId), 10),
    schemaKind: 'Flat',
    fields: targetFieldNames.map(target => ({ targetField: target, sourceField: draft[target] as string })),
  };
}
