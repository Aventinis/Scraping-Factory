// @ts-check
// JSON-path picker: tree model and path derivation (Issue #404) — pure
// data/logic only, no DOM (see json-path-picker-ui.js for the rendering). API
// mode asks for JSON paths in several places (a group's path, the cursor and
// "has more" paths, the body slot a cursor goes into, the token's path); a
// non-developer shouldn't have to type them. This turns a recorded response
// (or request body) into a small clickable tree, and a click into a path in
// the exact syntax the generated script's `_resolve_json_path` understands:
// dot notation for object keys, `[n]` for an array element.
//
// Three modes, one per kind of path:
//   'leaf'  a scalar (or null) is picked — cursor, "has more" flag, token.
//           Arrays are shown through their first element (`items[0].id`).
//   'group' an object or array is picked — a group's path, *relative to the
//           parent scope* (the tree is rooted at that scope's first instance,
//           the same "first instance is the template" assumption the rest of
//           API mode uses). Arrays are terminal: what's inside an item belongs
//           in a nested group of its own, not in one long path.
//   'body'  like 'leaf', but arrays aren't entered at all: the cursor's body
//           slot is a plain dot path (no `[`), see isValidBodyPath.

const PATH_TOKEN_PATTERN = /[^.[\]]+|\[\*\]|\[\d+\]/g;
const DEFAULT_MAX_NODES = 400;
const PREVIEW_MAX_CHARS = 40;

/**
 * @typedef {'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'} JsonType
 * @typedef {Object} PathTreeNode
 * @property {string} key       the object key, or "[0]" for an array element
 * @property {string} path      the path this node would fill in (relative to the tree root)
 * @property {JsonType} type
 * @property {string} preview   short, human-readable look at the value
 * @property {boolean} selectable
 * @property {string} [reason]  why it isn't selectable (i18n key suffix), when that is worth saying
 * @property {PathTreeNode[]} [children]
 * @property {number} [itemCount]  number of items of an array
 */

/**
 * @param {*} value
 * @returns {JsonType}
 */
function jsonTypeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'object') return 'object';
  if (type === 'number' || type === 'boolean') return type;
  return 'string';
}

/**
 * @param {*} value
 * @returns {string}
 */
function previewOf(value) {
  const type = jsonTypeOf(value);
  if (type === 'object') return `{ ${Object.keys(value).length} }`;
  if (type === 'array') return `[ ${value.length} ]`;
  const text = type === 'string' ? JSON.stringify(value) : String(value);
  return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS - 1)}…` : text;
}

/**
 * A key the generated script can address: the runtime splits a path on `.`,
 * `[` and `]`, so a key containing one of them can't be reached.
 * @param {string} key
 */
function isAddressableKey(key) {
  return key.length > 0 && !/[.[\]]/.test(key);
}

/**
 * @param {string} path
 * @param {string} key
 */
function joinKey(path, key) {
  return path ? `${path}.${key}` : key;
}

/**
 * The value at a dot/[n] path (`[*]` isn't used by the picker and isn't
 * resolved), or `undefined`. An empty path is the root itself.
 * @param {*} json
 * @param {string} path
 * @returns {*}
 */
function resolveJsonPath(json, path) {
  let value = json;
  for (const token of path.match(PATH_TOKEN_PATTERN) || []) {
    if (token.startsWith('[')) {
      if (token === '[*]' || !Array.isArray(value)) return undefined;
      value = value[Number(token.slice(1, -1))];
    } else {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || !(token in value)) return undefined;
      value = value[token];
    }
    if (value === undefined) return undefined;
  }
  return value;
}

/**
 * @typedef {Object} PathTreeResult
 * @property {PathTreeNode[]} nodes
 * @property {boolean} truncated   the tree was cut at the node limit
 * @property {boolean} scopeFound  false when a 'group' scope doesn't exist in this JSON
 */

/**
 * The clickable tree for one JSON value.
 * @param {*} json
 * @param {{ mode: 'leaf' | 'group' | 'body', scopePath?: string, maxNodes?: number }} options
 *   `scopePath` (group mode): absolute path of the parent group's first instance
 *   ("categories[0]"); the tree is rooted there and paths come out relative to it.
 * @returns {PathTreeResult}
 */
function buildJsonPathTree(json, { mode, scopePath = '', maxNodes = DEFAULT_MAX_NODES }) {
  const root = mode === 'group' && scopePath ? resolveJsonPath(json, scopePath) : json;
  if (root === undefined) return { nodes: [], truncated: false, scopeFound: false };

  let count = 0;
  let truncated = false;

  /**
   * @param {string} key
   * @param {string} path
   * @param {*} value
   * @returns {PathTreeNode | null}
   */
  function build(key, path, value) {
    if (count >= maxNodes) { truncated = true; return null; }
    count += 1;
    const type = jsonTypeOf(value);
    const isContainer = type === 'object' || type === 'array';
    /** @type {PathTreeNode} */
    const node = { key, path, type, preview: previewOf(value), selectable: false };
    if (type === 'array') node.itemCount = value.length;

    if (mode === 'group') {
      node.selectable = isContainer;
    } else {
      node.selectable = !isContainer;
      if (mode === 'body' && type === 'array') node.reason = 'bodyNoArrays';
    }

    // Children: objects always; arrays only in 'leaf' mode, through their first element.
    if (type === 'object') {
      node.children = childrenOfObject(path, value);
    } else if (type === 'array' && mode === 'leaf' && value.length > 0) {
      const first = build('[0]', `${path}[0]`, value[0]);
      node.children = first ? [first] : [];
    }
    return node;
  }

  /**
   * @param {string} path
   * @param {Record<string, *>} object
   * @returns {PathTreeNode[]}
   */
  function childrenOfObject(path, object) {
    /** @type {PathTreeNode[]} */
    const out = [];
    for (const [key, child] of Object.entries(object)) {
      const node = build(key, joinKey(path, key), child);
      if (!node) break;
      if (!isAddressableKey(key)) { node.selectable = false; node.reason = 'badKey'; }
      out.push(node);
    }
    return out;
  }

  /** @type {PathTreeNode[]} */
  let nodes;
  if (jsonTypeOf(root) === 'object') {
    nodes = childrenOfObject('', root);
  } else if (jsonTypeOf(root) === 'array' && mode === 'leaf' && root.length > 0) {
    const first = build('[0]', '[0]', root[0]);
    nodes = first ? [first] : [];
  } else {
    nodes = [];
  }
  return { nodes, truncated, scopeFound: true };
}

/**
 * Every selectable path of a tree, depth first — used by tests and to decide
 * whether a tree offers anything to pick at all.
 * @param {PathTreeNode[]} nodes
 * @returns {string[]}
 */
function selectablePaths(nodes) {
  return nodes.flatMap((node) => [...(node.selectable ? [node.path] : []), ...selectablePaths(node.children || [])]);
}

// ── Finding the recorded JSON a path input should offer ─────────────────────

/**
 * @typedef {Object} CaptureEntryLike
 * @property {string | number} [id]
 * @property {string} [url]
 * @property {string} [method]
 * @property {number} [status]
 * @property {string} [body]
 * @property {boolean} [bodyTruncated]
 * @property {string} [requestBody]
 * @property {boolean} [requestBodyTruncated]
 * @property {boolean} [requestBodySkipped]
 */

/**
 * Parses a recorded response ('response') or request body ('request') into
 * JSON, saying plainly why it can't be offered otherwise.
 * @param {CaptureEntryLike | null | undefined} entry
 * @param {'response' | 'request'} which
 * @returns {{ json: * , reason: '' } | { json: null, reason: 'noEntry' | 'truncated' | 'skipped' | 'notJson' | 'noBody' }}
 */
function parseEntryJson(entry, which) {
  if (!entry) return { json: null, reason: 'noEntry' };
  const text = which === 'response' ? entry.body : entry.requestBody;
  if (which === 'request' && entry.requestBodySkipped) return { json: null, reason: 'skipped' };
  if (which === 'response' ? entry.bodyTruncated : entry.requestBodyTruncated) return { json: null, reason: 'truncated' };
  if (!text) return { json: null, reason: which === 'request' ? 'noBody' : 'notJson' };
  try {
    const json = JSON.parse(text);
    return json !== null && typeof json === 'object' ? { json, reason: '' } : { json: null, reason: 'notJson' };
  } catch {
    return { json: null, reason: 'notJson' };
  }
}

/**
 * The recorded request a confirmed API config came from: by entry id, else
 * the latest one with the same URL and method (same lookup "Detect from
 * recording" already uses).
 * @param {CaptureEntryLike[]} entries
 * @param {{ sourceEntryId?: string | number, sourceUrl?: string, method?: string }} draft
 * @returns {CaptureEntryLike | null}
 */
function findSourceEntry(entries, draft) {
  const byId = draft.sourceEntryId !== undefined ? entries.find((e) => e.id === draft.sourceEntryId) : undefined;
  if (byId) return byId;
  const method = draft.method || 'GET';
  return [...entries].reverse().find((e) => e.url === draft.sourceUrl && (e.method || 'GET') === method) || null;
}

/**
 * Recorded requests with a successful, parseable JSON response — what the
 * picker offers to choose from when a path input has no obvious source (the
 * token request of an auth bootstrap typed by hand, …). `preferUrl` ones come first.
 * @param {CaptureEntryLike[]} entries
 * @param {{ preferUrl?: string, preferMethod?: string }} [options]
 * @returns {CaptureEntryLike[]}
 */
function jsonResponseEntries(entries, options = {}) {
  const usable = entries.filter((e) => (e.status === undefined || (e.status >= 200 && e.status < 300)) && parseEntryJson(e, 'response').json !== null);
  const preferred = (/** @type {CaptureEntryLike} */ e) => Boolean(options.preferUrl && e.url === options.preferUrl
    && (!options.preferMethod || (e.method || 'GET') === options.preferMethod));
  return [...usable].sort((a, b) => Number(preferred(b)) - Number(preferred(a)));
}

module.exports = {
  PATH_TOKEN_PATTERN, DEFAULT_MAX_NODES,
  jsonTypeOf, isAddressableKey, resolveJsonPath, buildJsonPathTree, selectablePaths,
  parseEntryJson, findSourceEntry, jsonResponseEntries,
};
