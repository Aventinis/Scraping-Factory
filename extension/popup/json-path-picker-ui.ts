// JSON-path picker: rendering, loading and event wiring (json-path-picker.ts has the tree model). A path input in API mode gets a "Pick from the
// recording" button that opens a panel under it with the recorded response, request body or embedded JSON as a clickable tree; a click fills the path.
//
// _state.apiPathPicker (never persisted) is null or { field, status, token, ... } for the one open picker; it lives in state because the cursor
// and bootstrap sections rebuild their HTML on every state change. `field` names the input: 'group' (relative to the parent scope),
// 'cursor.nextCursorPath', 'cursor.hasNextPagePath', 'cursor.bodyPath' (the request-body field the cursor goes into), 'bootstrap.valuePath'.
import type * as SFDraft from '../types/drafts';
import type { ApiPathPickerState, PathPickerField, PathPickerOutcome, PopupBridge, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { resolveApiGroupScopePath } from './api-config';
import type { ApiConfigDraft, ApiNodeDraft } from './api-config';
import {
  buildJsonPathTree, selectablePaths, parseEntryJson, findSourceEntry, jsonResponseEntries,
} from './json-path-picker';
import type { CaptureEntryLike, PathTreeNode, PickerMode } from './json-path-picker';
import { fetchApiCaptureEntries } from './api-capture-ui';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:JsonPathPickerUI');

// A picker outcome plus the labels a loader attaches to it.
type Resolved = PathPickerOutcome & { sourceLabel?: string; choices?: CaptureEntryLike[] };

// These handlers only run on the API_CONFIG screen, where the draft exists.
const currentDraft = (state: State): ApiConfigDraft => state.apiConfigDraft as ApiConfigDraft;

export const PICKER_FIELDS: Record<PathPickerField, { which: 'response' | 'request'; mode: PickerMode; preferBootstrap?: boolean }> = {
  group: { which: 'response', mode: 'group' },
  'cursor.nextCursorPath': { which: 'response', mode: 'leaf' },
  'cursor.hasNextPagePath': { which: 'response', mode: 'leaf' },
  'cursor.bodyPath': { which: 'request', mode: 'body' },
  'bootstrap.valuePath': { which: 'response', mode: 'leaf', preferBootstrap: true },
};

const OPEN_EXPAND_DEPTH = 2;
let tokenSeq = 0;

// ── Loading ─────────────────────────────────────────────────────────────────

interface EmbeddedJsonResult {
  body: string;
  truncated: boolean;
  found: boolean;
}

async function fetchEmbeddedJson(scriptSelector: string): Promise<EmbeddedJsonResult> {
  try {
    const result: EmbeddedJsonResult | undefined = await chrome.runtime.sendMessage({ type: 'GET_EMBEDDED_JSON', scriptSelector }); // the content script's answer
    return result || { body: '', truncated: false, found: false };
  } catch (err) {
    log('GET_EMBEDDED_JSON failed', (err as Error).message);
    return { body: '', truncated: false, found: false };
  }
}

/** The group modal's scope: absolute path of the parent group's first instance ('' = the root). */
function groupScopePath(state: State): string {
  const parent = state.pendingApiTreeParentPath;
  return parent === null || parent === undefined ? '' : resolveApiGroupScopePath(currentDraft(state).groups as ApiNodeDraft[], parent);
}

/**
 * What a picker shows for one recorded entry / embedded blob — the `ready`
 * result carries the tree, anything else a `message` key (jsonPathPicker.*).
 */
function treeStateFor(state: State, field: PathPickerField, json: unknown): PathPickerOutcome {
  const spec = PICKER_FIELDS[field];
  const scopePath = spec.mode === 'group' ? groupScopePath(state) : '';
  const tree = buildJsonPathTree(json, { mode: spec.mode, scopePath });
  if (!tree.scopeFound) return { status: 'message', message: 'scopeMissing' };
  if (selectablePaths(tree.nodes).length === 0) return { status: 'message', message: 'nothingToPick' };
  return { status: 'tree', tree };
}

async function resolvePicker(state: State, field: PathPickerField): Promise<Resolved> {
  const spec = PICKER_FIELDS[field];
  const draft = currentDraft(state);

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

  const entries = await fetchApiCaptureEntries();
  let entry: CaptureEntryLike | null = null;
  if (spec.preferBootstrap) {
    const bootstrap: Partial<SFDraft.ApiBootstrap> = draft.bootstrap || {};
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

export async function openPathPicker(bridge: PopupBridge, field: PathPickerField): Promise<void> {
  if (!PICKER_FIELDS[field]) return;
  const current = bridge.getState().apiPathPicker;
  if (current && current.field === field) { closePathPicker(bridge); return; } // the button toggles
  const token = ++tokenSeq;
  bridge.patchState({ apiPathPicker: { field, token, status: 'loading' } });
  const result = await resolvePicker(bridge.getState(), field);
  // The user may have closed it or opened another one meanwhile.
  if (bridge.getState().apiPathPicker?.token !== token) return;
  log('JSON_PATH_PICKER open', { field, status: result.status, message: result.status === 'message' ? result.message : undefined });
  bridge.patchState({ apiPathPicker: { field, token, ...result } });
}

export function closePathPicker(bridge: PopupBridge): void {
  bridge.patchState({ apiPathPicker: null });
}

/** A recorded response picked from the chooser list. */
function chooseEntry(bridge: PopupBridge, entryId: string | undefined): void {
  const picker = bridge.getState().apiPathPicker;
  if (!picker) return;
  const entry = (picker.choices || []).find((e) => String(e.id) === String(entryId));
  if (!entry) return;
  const parsed = parseEntryJson(entry, 'response');
  const sourceLabel = t('jsonPathPicker.recordedSource', { request: `${entry.method || 'GET'} ${entry.url}` });
  const next: PathPickerOutcome = parsed.json === null
    ? { status: 'message', message: parsed.reason }
    : treeStateFor(bridge.getState(), picker.field, parsed.json);
  bridge.patchState({ apiPathPicker: { ...picker, ...next, sourceLabel } as ApiPathPickerState }); // the new outcome replaces the old one
}

// ── Applying a pick ─────────────────────────────────────────────────────────

export function applyPick(bridge: PopupBridge, field: PathPickerField, path: string): void {
  log('JSON_PATH_PICKER pick', { field, path });
  const state = bridge.getState();
  if (field === 'group') {
    // The modal's inputs are plain DOM; the picker only fills the path.
    const input = byIdOrNull<HTMLInputElement>('input-api-group-path');
    if (input) { input.value = path; input.focus(); }
    bridge.patchState({ apiPathPicker: null });
    return;
  }
  const [section, name] = field.split('.');
  const draft = currentDraft(state);
  const key = section === 'cursor' ? 'cursorPagination' : 'bootstrap';
  bridge.setState(state.current, {
    apiConfigDraft: { ...draft, [key]: { ...draft[key], [name]: path } } as ApiConfigDraft, // `name` is the one path property of the section
    apiPathPicker: null,
  });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function nodeHtml(node: PathTreeNode, depth: number): string {
  const typeLabel = t(`jsonPathPicker.type.${node.type}`);
  const countNote = node.type === 'array' ? ` · ${t('jsonPathPicker.items', { count: node.itemCount })}` : '';
  const title = node.reason ? t(`jsonPathPicker.reason.${node.reason}`) : '';
  const label = `<span class="json-path-key">${escapeHtml(node.key)}</span>`
    + `<span class="json-path-type">${escapeHtml(typeLabel)}${escapeHtml(countNote)}</span>`
    + `<span class="json-path-preview">${escapeHtml(node.preview)}</span>`;
  const row = node.selectable
    ? `<button type="button" class="json-path-pick" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">${label}</button>`
    : `<span class="json-path-static"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</span>`;
  const children = !!node.children && node.children.length > 0;
  const collapsed = children && depth >= OPEN_EXPAND_DEPTH;
  const toggle = children
    ? `<button type="button" class="json-path-toggle" aria-label="${escapeHtml(t('jsonPathPicker.toggle'))}" aria-expanded="${collapsed ? 'false' : 'true'}"></button>`
    : '<span class="json-path-toggle-space"></span>';
  return `<li class="json-path-node${collapsed ? ' collapsed' : ''}"><div class="json-path-row">${toggle}${row}</div>`
    + (children ? `<ul class="json-path-children">${(node.children as PathTreeNode[]).map((c) => nodeHtml(c, depth + 1)).join('')}</ul>` : '')
    + '</li>';
}

function chooserHtml(choices: CaptureEntryLike[]): string {
  return `<p class="json-path-hint">${escapeHtml(t('jsonPathPicker.chooseResponse'))}</p>`
    + `<ul class="api-candidates-list json-path-chooser">${choices.map((entry) => `
      <li class="api-candidate json-path-chooser-entry" data-entry-id="${escapeHtml(entry.id)}">
        <div class="api-candidate-source">${escapeHtml(entry.method || 'GET')} ${escapeHtml(entry.status ?? '')}</div>
        <div class="api-candidate-path" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</div>
      </li>`).join('')}</ul>`;
}

/** The open-button markup for a path input. */
export function pathPickerButtonHtml(field: PathPickerField): string {
  return `<button type="button" class="btn-secondary btn-tiny json-path-open" data-field="${escapeHtml(field)}">${escapeHtml(t('jsonPathPicker.openBtn'))}</button>`;
}

/** The panel for `field` when its picker is open, else ''. */
export function pathPickerPanelHtml(state: State, field: PathPickerField): string {
  const picker = state.apiPathPicker;
  if (!picker || picker.field !== field) return '';
  const spec = PICKER_FIELDS[field];
  const head = `<div class="json-path-head"><span class="json-path-source">${escapeHtml(picker.sourceLabel || '')}</span>`
    + `<button type="button" class="btn-secondary btn-tiny json-path-close">${escapeHtml(t('jsonPathPicker.closeBtn'))}</button></div>`;
  let body: string;
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
 */
export function wirePathPickerEvents(bridge: PopupBridge, container: HTMLElement | null): void {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const open = target.closest<HTMLElement>('.json-path-open');
    if (open) { openPathPicker(bridge, open.dataset.field as PathPickerField); return; }
    if (target.closest('.json-path-close')) { closePathPicker(bridge); return; }
    const pick = target.closest<HTMLElement>('.json-path-pick');
    if (pick) {
      const field = pick.closest('.json-path-panel')?.getAttribute('data-field');
      if (field) applyPick(bridge, field as PathPickerField, pick.dataset.path as string);
      return;
    }
    const toggle = target.closest('.json-path-toggle');
    if (toggle) {
      const li = toggle.closest('.json-path-node') as HTMLElement; // a toggle is rendered inside its node
      const collapsed = li.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      return;
    }
    const chooser = target.closest<HTMLElement>('.json-path-chooser-entry');
    if (chooser) { chooseEntry(bridge, chooser.dataset.entryId); return; }
    if (target.closest('.json-path-other')) {
      const picker = bridge.getState().apiPathPicker;
      if (picker) bridge.patchState({ apiPathPicker: { ...picker, status: 'chooser' } as ApiPathPickerState }); // the button only exists while there are choices
    }
  });
}

/** Renders the group modal's own panel (called from renderApiConfigModals). */
export function renderGroupPathPicker(bridge: PopupBridge): void {
  const host = byIdOrNull('api-group-path-picker');
  if (!host) return;
  const state = bridge.getState();
  host.innerHTML = state.apiGroupModalOpen ? pathPickerPanelHtml(state, 'group') : '';
}
