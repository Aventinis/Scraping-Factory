// JSON-path picker: rendering, loading and event wiring (json-path-picker.ts has the tree model). A path input in API mode gets a "Pick from the
// recording" button that opens a panel under it with the recorded response, request body or embedded JSON as a clickable tree; a click fills the path.
//
// _state.apiPathPicker (never persisted) is null or { field, status, token, ... } for the one open picker; it lives in state because the cursor
// and bootstrap sections rebuild their HTML on every state change. `field` names the input: 'group' (relative to the parent scope),
// 'cursor.nextCursorPath', 'cursor.hasNextPagePath', 'cursor.bodyPath' (the request-body field the cursor goes into), 'bootstrap.valuePath'.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:JsonPathPickerUI');
const { t } = require('../i18n/i18n');
const { escapeHtml, resolveApiGroupScopePath } = require('./api-config');
const {
  buildJsonPathTree, selectablePaths, parseEntryJson, findSourceEntry, jsonResponseEntries,
} = require('./json-path-picker');

/**
 * @type {Record<string, { which: 'response' | 'request', mode: 'leaf' | 'group' | 'body', preferBootstrap?: boolean }>}
 */
const PICKER_FIELDS = {
  group: { which: 'response', mode: 'group' },
  'cursor.nextCursorPath': { which: 'response', mode: 'leaf' },
  'cursor.hasNextPagePath': { which: 'response', mode: 'leaf' },
  'cursor.bodyPath': { which: 'request', mode: 'body' },
  'bootstrap.valuePath': { which: 'response', mode: 'leaf', preferBootstrap: true },
};

const OPEN_EXPAND_DEPTH = 2;
let tokenSeq = 0;

// ── Loading ─────────────────────────────────────────────────────────────────

// GET_API_CAPTURE_ENTRIES round trip — the same message api-capture-ui.ts's
// own fetchApiCaptureEntries sends, repeated (a few lines) rather than
// reaching into that module.
async function fetchCaptureEntries() {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_API_CAPTURE_ENTRIES' }) || [];
  } catch (err) {
    log('GET_API_CAPTURE_ENTRIES failed', err.message);
    return [];
  }
}

async function fetchEmbeddedJson(scriptSelector) {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_EMBEDDED_JSON', scriptSelector })
      || { body: '', truncated: false, found: false };
  } catch (err) {
    log('GET_EMBEDDED_JSON failed', err.message);
    return { body: '', truncated: false, found: false };
  }
}

/** The group modal's scope: absolute path of the parent group's first instance ('' = the root). */
function groupScopePath(state) {
  const parent = state.pendingApiTreeParentPath;
  return parent === null || parent === undefined ? '' : resolveApiGroupScopePath(state.apiConfigDraft.groups, parent);
}

/**
 * What a picker shows for one recorded entry / embedded blob — the `ready`
 * result carries the tree, anything else a `message` key (jsonPathPicker.*).
 */
function treeStateFor(state, field, json) {
  const spec = PICKER_FIELDS[field];
  const scopePath = spec.mode === 'group' ? groupScopePath(state) : '';
  const tree = buildJsonPathTree(json, { mode: spec.mode, scopePath });
  if (!tree.scopeFound) return { status: 'message', message: 'scopeMissing' };
  if (selectablePaths(tree.nodes).length === 0) return { status: 'message', message: 'nothingToPick' };
  return { status: 'tree', tree };
}

async function resolvePicker(state, field) {
  const spec = PICKER_FIELDS[field];
  const draft = state.apiConfigDraft;

  if (spec.which === 'response' && draft.embeddedJsonSource && !spec.preferBootstrap) {
    const result = await fetchEmbeddedJson(draft.embeddedJsonSource.scriptSelector);
    const label = t('jsonPathPicker.embeddedSource', { selector: draft.embeddedJsonSource.scriptSelector });
    if (!result.found) return { status: 'message', message: 'embeddedMissing', sourceLabel: label };
    if (result.truncated) return { status: 'message', message: 'truncated', sourceLabel: label };
    try {
      return { ...treeStateFor(state, field, JSON.parse(result.body)), sourceLabel: label };
    } catch {
      return { status: 'message', message: 'notJson', sourceLabel: label };
    }
  }

  const entries = await fetchCaptureEntries();
  let entry = null;
  if (spec.preferBootstrap) {
    const bootstrap = draft.bootstrap || {};
    entry = entries.find((e) => e.url === bootstrap.url && (e.method || 'GET') === (bootstrap.method || 'POST')
      && parseEntryJson(e, 'response').json !== null) || null;
  } else {
    entry = findSourceEntry(entries, draft);
  }
  const choices = jsonResponseEntries(entries, spec.preferBootstrap ? { preferUrl: draft.bootstrap?.url, preferMethod: draft.bootstrap?.method } : {});

  // Nothing to take it from: offer the other recorded responses (response
  // pickers only — a request body belongs to exactly one request).
  if (!entry) {
    if (spec.which === 'request' || choices.length === 0) return { status: 'message', message: 'noRecording' };
    return { status: 'chooser', choices };
  }
  const parsed = parseEntryJson(entry, spec.which);
  const base = { sourceLabel: t('jsonPathPicker.recordedSource', { request: `${entry.method || 'GET'} ${entry.url}` }), choices: spec.which === 'response' ? choices : [] };
  if (parsed.json === null) return { ...base, status: 'message', message: parsed.reason };
  return { ...base, ...treeStateFor(state, field, parsed.json) };
}

async function openPathPicker(bridge, field) {
  if (!PICKER_FIELDS[field]) return;
  const current = bridge.getState().apiPathPicker;
  if (current && current.field === field) { closePathPicker(bridge); return; } // the button toggles
  const token = ++tokenSeq;
  bridge.patchState({ apiPathPicker: { field, token, status: 'loading' } });
  const result = await resolvePicker(bridge.getState(), field);
  // The user may have closed it or opened another one meanwhile.
  if (bridge.getState().apiPathPicker?.token !== token) return;
  log('JSON_PATH_PICKER open', { field, status: result.status, message: result.message });
  bridge.patchState({ apiPathPicker: { field, token, ...result } });
}

function closePathPicker(bridge) {
  bridge.patchState({ apiPathPicker: null });
}

/** A recorded response picked from the chooser list. */
function chooseEntry(bridge, entryId) {
  const picker = bridge.getState().apiPathPicker;
  if (!picker) return;
  const entry = (picker.choices || []).find((e) => String(e.id) === String(entryId));
  if (!entry) return;
  const parsed = parseEntryJson(entry, 'response');
  const sourceLabel = t('jsonPathPicker.recordedSource', { request: `${entry.method || 'GET'} ${entry.url}` });
  const next = parsed.json === null
    ? { status: 'message', message: parsed.reason }
    : treeStateFor(bridge.getState(), picker.field, parsed.json);
  bridge.patchState({ apiPathPicker: { ...picker, ...next, sourceLabel } });
}

// ── Applying a pick ─────────────────────────────────────────────────────────

function applyPick(bridge, field, path) {
  log('JSON_PATH_PICKER pick', { field, path });
  const state = bridge.getState();
  if (field === 'group') {
    // The modal's inputs are plain DOM; the picker only fills the path.
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('input-api-group-path'));
    if (input) { input.value = path; input.focus(); }
    bridge.patchState({ apiPathPicker: null });
    return;
  }
  const [section, name] = field.split('.');
  const draft = state.apiConfigDraft;
  const key = section === 'cursor' ? 'cursorPagination' : 'bootstrap';
  bridge.setState(state.current, {
    apiConfigDraft: { ...draft, [key]: { ...draft[key], [name]: path } },
    apiPathPicker: null,
  });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function nodeHtml(node, depth) {
  const typeLabel = t(`jsonPathPicker.type.${node.type}`);
  const countNote = node.type === 'array' ? ` · ${t('jsonPathPicker.items', { count: node.itemCount })}` : '';
  const title = node.reason ? t(`jsonPathPicker.reason.${node.reason}`) : '';
  const label = `<span class="json-path-key">${escapeHtml(node.key)}</span>`
    + `<span class="json-path-type">${escapeHtml(typeLabel)}${escapeHtml(countNote)}</span>`
    + `<span class="json-path-preview">${escapeHtml(node.preview)}</span>`;
  const row = node.selectable
    ? `<button type="button" class="json-path-pick" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">${label}</button>`
    : `<span class="json-path-static"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</span>`;
  const children = node.children && node.children.length > 0;
  const collapsed = children && depth >= OPEN_EXPAND_DEPTH;
  const toggle = children
    ? `<button type="button" class="json-path-toggle" aria-label="${escapeHtml(t('jsonPathPicker.toggle'))}" aria-expanded="${collapsed ? 'false' : 'true'}"></button>`
    : '<span class="json-path-toggle-space"></span>';
  return `<li class="json-path-node${collapsed ? ' collapsed' : ''}"><div class="json-path-row">${toggle}${row}</div>`
    + (children ? `<ul class="json-path-children">${node.children.map((c) => nodeHtml(c, depth + 1)).join('')}</ul>` : '')
    + '</li>';
}

function chooserHtml(choices) {
  return `<p class="json-path-hint">${escapeHtml(t('jsonPathPicker.chooseResponse'))}</p>`
    + `<ul class="api-candidates-list json-path-chooser">${choices.map((entry) => `
      <li class="api-candidate json-path-chooser-entry" data-entry-id="${escapeHtml(entry.id)}">
        <div class="api-candidate-source">${escapeHtml(entry.method || 'GET')} ${escapeHtml(entry.status ?? '')}</div>
        <div class="api-candidate-path" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</div>
      </li>`).join('')}</ul>`;
}

/** The open-button markup for a path input. */
function pathPickerButtonHtml(field) {
  return `<button type="button" class="btn-secondary btn-tiny json-path-open" data-field="${escapeHtml(field)}">${escapeHtml(t('jsonPathPicker.openBtn'))}</button>`;
}

/** The panel for `field` when its picker is open, else ''. */
function pathPickerPanelHtml(state, field) {
  const picker = state.apiPathPicker;
  if (!picker || picker.field !== field) return '';
  const spec = PICKER_FIELDS[field];
  const head = `<div class="json-path-head"><span class="json-path-source">${escapeHtml(picker.sourceLabel || '')}</span>`
    + `<button type="button" class="btn-secondary btn-tiny json-path-close">${escapeHtml(t('jsonPathPicker.closeBtn'))}</button></div>`;
  let body;
  if (picker.status === 'loading') {
    body = `<p class="json-path-hint">${escapeHtml(t('jsonPathPicker.loading'))}</p>`;
  } else if (picker.status === 'chooser') {
    body = chooserHtml(picker.choices);
  } else if (picker.status === 'message') {
    body = `<p class="json-path-hint json-path-message">${escapeHtml(t(`jsonPathPicker.message.${picker.message}`))}</p>`
      + (picker.choices && picker.choices.length > 1 ? chooserHtml(picker.choices) : '');
  } else {
    body = `<p class="json-path-hint">${escapeHtml(t(`jsonPathPicker.hint.${spec.mode}`))}</p>`
      + `<ul class="json-path-tree">${picker.tree.nodes.map((n) => nodeHtml(n, 0)).join('')}</ul>`
      + (picker.tree.truncated ? `<p class="json-path-hint">${escapeHtml(t('jsonPathPicker.treeTruncated'))}</p>` : '')
      + (picker.choices && picker.choices.length > 1 ? `<button type="button" class="btn-secondary btn-tiny json-path-other">${escapeHtml(t('jsonPathPicker.otherResponse'))}</button>` : '');
  }
  return `<div class="json-path-panel" data-field="${escapeHtml(field)}">${head}${body}</div>`;
}

// ── Events ──────────────────────────────────────────────────────────────────

/**
 * Wires the picker's buttons inside `container` (one stable element per path
 * input — a section or the group modal; the HTML under it is rebuilt freely).
 * Returns true when the click was the picker's, so a caller with its own
 * delegated listener can skip the rest.
 */
function wirePathPickerEvents(bridge, container) {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const open = target.closest('.json-path-open');
    if (open) { openPathPicker(bridge, /** @type {HTMLElement} */ (open).dataset.field); return; }
    if (target.closest('.json-path-close')) { closePathPicker(bridge); return; }
    const pick = /** @type {HTMLElement | null} */ (target.closest('.json-path-pick'));
    if (pick) {
      const field = pick.closest('.json-path-panel')?.getAttribute('data-field');
      if (field) applyPick(bridge, field, pick.dataset.path);
      return;
    }
    const toggle = target.closest('.json-path-toggle');
    if (toggle) {
      const li = toggle.closest('.json-path-node');
      const collapsed = li.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      return;
    }
    const chooser = /** @type {HTMLElement | null} */ (target.closest('.json-path-chooser-entry'));
    if (chooser) { chooseEntry(bridge, chooser.dataset.entryId); return; }
    if (target.closest('.json-path-other')) {
      const picker = bridge.getState().apiPathPicker;
      if (picker) bridge.patchState({ apiPathPicker: { ...picker, status: 'chooser' } });
    }
  });
}

/**
 * Renders the group modal's own panel (called from renderApiConfigModals).
 */
function renderGroupPathPicker(bridge) {
  const host = document.getElementById('api-group-path-picker');
  if (!host) return;
  const state = bridge.getState();
  host.innerHTML = state.apiGroupModalOpen ? pathPickerPanelHtml(state, 'group') : '';
}

module.exports = {
  PICKER_FIELDS, pathPickerButtonHtml, pathPickerPanelHtml, wirePathPickerEvents, renderGroupPathPicker,
  openPathPicker, closePathPicker, applyPick,
};
