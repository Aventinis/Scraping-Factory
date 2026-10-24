// JSON-path picker: tree model and path derivation — pure, no DOM (json-path-picker-ui.ts renders it). API mode asks for JSON
// paths in several places (a group's path, the cursor and "has more" paths, the cursor's body slot, the token path); this
// turns a recorded response or request body into a clickable tree and a click into a path in the syntax of the script's
// `_resolve_json_path`: dots for object keys, `[n]` for an array element.
//
// Three modes:
//   'leaf'  a scalar (or null) is picked: cursor, "has more" flag, token. Arrays are shown through their first element.
//   'group' an object or array is picked: a group's path, relative to the parent scope (the tree is rooted at that scope's
//           first instance). Arrays are terminal: what is inside an item belongs in a nested group.
//   'body'  like 'leaf', but arrays are not entered: the cursor's body slot is a plain dot path (isValidBodyPath).

export const PATH_TOKEN_PATTERN = /[^.[\]]+|\[\*\]|\[\d+\]/g;
export const DEFAULT_MAX_NODES = 400;
const PREVIEW_MAX_CHARS = 40;

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export type PickerMode = 'leaf' | 'group' | 'body';

export interface PathTreeNode {
  /** The object key, or "[0]" for an array element. */
  key: string;
  /** The path this node would fill in (relative to the tree root). */
  path: string;
  type: JsonType;
  /** Short, human-readable look at the value. */
  preview: string;
  selectable: boolean;
  /** Why it is not selectable (i18n key suffix), when that is worth saying. */
  reason?: string;
  children?: PathTreeNode[];
  /** Number of items of an array. */
  itemCount?: number;
}

export interface PathTreeResult {
  nodes: PathTreeNode[];
  /** The tree was cut at the node limit. */
  truncated: boolean;
  /** False when a 'group' scope does not exist in this JSON. */
  scopeFound: boolean;
}

/** A recorded request/response pair as GET_API_CAPTURE_ENTRIES returns it. */
export interface CaptureEntryLike {
  id?: string | number;
  url?: string;
  method?: string;
  status?: number;
  body?: string;
  bodyTruncated?: boolean;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  requestBodySkipped?: boolean;
}

export type ParsedEntryJson =
  | { json: unknown; reason: '' }
  | { json: null; reason: 'noEntry' | 'truncated' | 'skipped' | 'notJson' | 'noBody' };

type JsonObject = Record<string, unknown>;

export function jsonTypeOf(value: unknown): JsonType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'object') return 'object';
  if (type === 'number' || type === 'boolean') return type;
  return 'string';
}

function previewOf(value: unknown): string {
  const type = jsonTypeOf(value);
  if (type === 'object') return `{ ${Object.keys(value as JsonObject).length} }`;
  if (type === 'array') return `[ ${(value as unknown[]).length} ]`;
  const text = type === 'string' ? JSON.stringify(value) : String(value);
  return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS - 1)}…` : text;
}

/** A key the generated script can address: the runtime splits a path on `.`, `[` and `]`, so a key containing one cannot be reached. */
export function isAddressableKey(key: string): boolean {
  return key.length > 0 && !/[.[\]]/.test(key);
}

function joinKey(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** The value at a dot/[n] path (`[*]` is not used by the picker and not resolved), or undefined. An empty path is the root itself. */
export function resolveJsonPath(json: unknown, path: string): unknown {
  let value: unknown = json;
  for (const token of path.match(PATH_TOKEN_PATTERN) || []) {
    if (token.startsWith('[')) {
      if (token === '[*]' || !Array.isArray(value)) return undefined;
      value = value[Number(token.slice(1, -1))];
    } else {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || !(token in value)) return undefined;
      value = (value as JsonObject)[token];
    }
    if (value === undefined) return undefined;
  }
  return value;
}

/**
 * The clickable tree for one JSON value. `scopePath` (group mode) is the absolute path of the parent group's first instance
 * ("categories[0]"); the tree is rooted there and paths come out relative to it.
 */
export function buildJsonPathTree(
  json: unknown, { mode, scopePath = '', maxNodes = DEFAULT_MAX_NODES }: { mode: PickerMode; scopePath?: string; maxNodes?: number },
): PathTreeResult {
  const root = mode === 'group' && scopePath ? resolveJsonPath(json, scopePath) : json;
  if (root === undefined) return { nodes: [], truncated: false, scopeFound: false };

  let count = 0;
  let truncated = false;

  function build(key: string, path: string, value: unknown): PathTreeNode | null {
    if (count >= maxNodes) { truncated = true; return null; }
    count += 1;
    const type = jsonTypeOf(value);
    const isContainer = type === 'object' || type === 'array';
    const node: PathTreeNode = { key, path, type, preview: previewOf(value), selectable: false };
    if (type === 'array') node.itemCount = (value as unknown[]).length;

    if (mode === 'group') {
      node.selectable = isContainer;
    } else {
      node.selectable = !isContainer;
      if (mode === 'body' && type === 'array') node.reason = 'bodyNoArrays';
    }

    // Children: objects always; arrays only in 'leaf' mode, through their first element.
    if (type === 'object') {
      node.children = childrenOfObject(path, value as JsonObject);
    } else if (type === 'array' && mode === 'leaf' && (value as unknown[]).length > 0) {
      const first = build('[0]', `${path}[0]`, (value as unknown[])[0]);
      node.children = first ? [first] : [];
    }
    return node;
  }

  function childrenOfObject(path: string, object: JsonObject): PathTreeNode[] {
    const out: PathTreeNode[] = [];
    for (const [key, child] of Object.entries(object)) {
      const node = build(key, joinKey(path, key), child);
      if (!node) break;
      if (!isAddressableKey(key)) { node.selectable = false; node.reason = 'badKey'; }
      out.push(node);
    }
    return out;
  }

  let nodes: PathTreeNode[];
  if (jsonTypeOf(root) === 'object') {
    nodes = childrenOfObject('', root as JsonObject);
  } else if (jsonTypeOf(root) === 'array' && mode === 'leaf' && (root as unknown[]).length > 0) {
    const first = build('[0]', '[0]', (root as unknown[])[0]);
    nodes = first ? [first] : [];
  } else {
    nodes = [];
  }
  return { nodes, truncated, scopeFound: true };
}

/** Every selectable path of a tree, depth first: used by tests and to decide whether a tree offers anything to pick at all. */
export function selectablePaths(nodes: PathTreeNode[]): string[] {
  return nodes.flatMap((node) => [...(node.selectable ? [node.path] : []), ...selectablePaths(node.children || [])]);
}

// ── Finding the recorded JSON a path input should offer ─────────────────────

/** Parses a recorded response or request body into JSON, saying plainly why it cannot be offered otherwise. */
export function parseEntryJson(entry: CaptureEntryLike | null | undefined, which: 'response' | 'request'): ParsedEntryJson {
  if (!entry) return { json: null, reason: 'noEntry' };
  const text = which === 'response' ? entry.body : entry.requestBody;
  if (which === 'request' && entry.requestBodySkipped) return { json: null, reason: 'skipped' };
  if (which === 'response' ? entry.bodyTruncated : entry.requestBodyTruncated) return { json: null, reason: 'truncated' };
  if (!text) return { json: null, reason: which === 'request' ? 'noBody' : 'notJson' };
  try {
    const json: unknown = JSON.parse(text);
    return json !== null && typeof json === 'object' ? { json, reason: '' } : { json: null, reason: 'notJson' };
  } catch {
    return { json: null, reason: 'notJson' };
  }
}

/** The recorded request a confirmed API config came from: by entry id, else the latest one with the same URL and method. */
export function findSourceEntry(
  entries: CaptureEntryLike[], draft: { sourceEntryId?: string | number; sourceUrl?: string; method?: string },
): CaptureEntryLike | null {
  const byId = draft.sourceEntryId !== undefined ? entries.find((e) => e.id === draft.sourceEntryId) : undefined;
  if (byId) return byId;
  const method = draft.method || 'GET';
  return [...entries].reverse().find((e) => e.url === draft.sourceUrl && (e.method || 'GET') === method) || null;
}

/**
 * Recorded requests with a successful, parseable JSON response: what the picker offers when a path input has no obvious source (the
 * token request of an auth bootstrap typed by hand, ...). Entries matching `preferUrl` come first.
 */
export function jsonResponseEntries(entries: CaptureEntryLike[], options: { preferUrl?: string; preferMethod?: string } = {}): CaptureEntryLike[] {
  const usable = entries.filter((e) => (e.status === undefined || (e.status >= 200 && e.status < 300)) && parseEntryJson(e, 'response').json !== null);
  const preferred = (e: CaptureEntryLike) => Boolean(options.preferUrl && e.url === options.preferUrl
    && (!options.preferMethod || (e.method || 'GET') === options.preferMethod));
  return [...usable].sort((a, b) => Number(preferred(b)) - Number(preferred(a)));
}
