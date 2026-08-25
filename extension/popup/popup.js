const COMPANION_URL = 'http://localhost:5000';

const STATES = {
  CHECKING_COMPANION: 'CHECKING_COMPANION',
  COMPANION_ERROR:    'COMPANION_ERROR',
  IDLE:               'IDLE',
  SELECTING:          'SELECTING',
  GENERATING:         'GENERATING',
  DONE:               'DONE',
};

let _state = {
  current:             STATES.CHECKING_COMPANION,
  url:                 '',
  mode:                'flat', // 'flat' (Fields → Csv) | 'container' (Groups → Xml) — mutually exclusive
  fields:              [],   // [{name, selector, attribute}]
  groups:              [],   // container-mode tree: {kind:'group', name, selector, repeating, children} | {kind:'field', name, selector, mode, attribute}
  scriptText:          '',
  pendingSelector:     null,  // set while field-name modal (flat) or extended field modal (container) is open
  selectionKind:       null,  // 'field' | 'container' | null — which kind the current SELECTING round is for (container-mode only)
  pendingParentPath:   null,  // number[] | null — where the next inserted group-tree node goes; null = root level
  pendingNewContainer: null,  // {name, repeating} captured by modal-container-new before element-selection starts
  containerModalOpen:  false, // modal-container-new visibility
  domViewEnabled:    false, // user preference, kept across selection rounds
  domTree:           null,  // serialized tree from the content script, or null while loading/errored
  domTreeTruncated:  false,
  domTreeError:      null,  // set if no DOM_TREE response arrives within DOM_TREE_TIMEOUT_MS
};

const DOM_TREE_TIMEOUT_MS = 5000;
let domTreeTimeoutId = null;

// Sends ENABLE_DOM_VIEW and arms a timeout so a lost/slow response shows an
// error instead of spinning forever (see feature/dom-tree-view regression:
// an unthrottled content script could stall the message channel entirely).
function requestDomTree() {
  clearTimeout(domTreeTimeoutId);
  patchState({ domTree: null, domTreeTruncated: false, domTreeError: null });
  chrome.runtime.sendMessage({ type: 'ENABLE_DOM_VIEW' });
  domTreeTimeoutId = setTimeout(() => {
    log('DOM_TREE timeout — no response');
    setLastError('DOM-Baum-Anfrage lief in ein Timeout', 'DOM-Baum-Ansicht');
    patchState({ domTreeError: 'Baum konnte nicht geladen werden.' });
  }, DOM_TREE_TIMEOUT_MS);
}

// ── Logging ───────────────────────────────────────────────────────────────────

const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));
}

// ── Pure functions (exported for testing) ────────────────────────────────────

function buildScrapingConfig(url, mode, fields, groups) {
  if (mode === 'container') {
    return { version: '1', url, groups: serializeGroupTree(groups) };
  }
  return {
    version: '1',
    url,
    fields: fields.map(f => ({ name: f.name, selector: f.selector, attribute: f.attribute ?? null })),
    outputFormat: 'Csv',
  };
}

// Wraps the exact wire-format config (buildScrapingConfig) with export
// metadata, so a user hitting a selector problem can hand over one file
// that both shows the current Fields/Groups and, unwrapped, is the literal
// request body /generate would receive — no need to describe the setup by
// hand. `manifest` is injected so this stays a pure, testable function
// instead of reaching into chrome.runtime itself.
function buildConfigExport(url, mode, fields, groups, manifest = {}) {
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: manifest.version || '?',
    config: buildScrapingConfig(url, mode, fields, groups),
  };
}

function addField(fields, name, selector) {
  return [...fields, { name, selector, attribute: null }];
}

function removeField(fields, index) {
  return fields.filter((_, i) => i !== index);
}

// ── Container-Mode tree (GroupNode/DataFieldNode) ───────────────────────────
// Mirrors the backend IR (ContainerNode.cs): a group node scopes its
// children to matches of its own selector, a field node is the extraction
// leaf. `path` addresses a node the same way the DOM-tree-view already does
// (an array of child indices) — see buildTreeNodeEl's `node.path`.

function buildGroupNode(name, selector, repeating) {
  return { kind: 'group', name, selector, repeating, children: [] };
}

function buildFieldNode(name, selector, mode, attribute) {
  return { kind: 'field', name, selector, mode, attribute: mode === 'attribute' ? attribute : null };
}

function resolveGroupNode(groups, path) {
  if (!path || path.length === 0) return null;
  let node = groups[path[0]];
  for (let i = 1; i < path.length; i++) node = node.children[path[i]];
  return node;
}

// True if the node at `path` (or any of its ancestors) is a repeating
// group — i.e. a selector added under this path will be re-evaluated once
// per matched instance, not just once. Used to tell content-script to skip
// its usual id-selector shortcut (see buildSelector's avoidId): an id is
// page-unique, so a selector built from one can only ever match a single
// instance, silently starving every other repetition of that field/nested
// container.
function hasRepeatingAncestor(groups, path) {
  if (!path) return false;
  let nodes = groups;
  for (const index of path) {
    const node = nodes[index];
    if (node.kind === 'group' && node.repeating) return true;
    nodes = node.children;
  }
  return false;
}

// Appends `node` as the last child at `parentPath` (or at root level when
// `parentPath` is null) — immutable, like addField above.
function insertContainerNode(groups, parentPath, node) {
  const path = parentPath || [];
  if (path.length === 0) return [...groups, node];
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head ? { ...n, children: insertContainerNode(n.children, rest, node) } : n));
}

// Removes the node (and its subtree) at `path` — always non-empty, unlike
// insertContainerNode's parentPath.
function removeGroupTreeNode(groups, path) {
  if (path.length === 1) return groups.filter((_, i) => i !== path[0]);
  const [head, ...rest] = path;
  return groups.map((n, i) => (i === head ? { ...n, children: removeGroupTreeNode(n.children, rest) } : n));
}

function formatGroupNodeLabel(node) {
  if (node.kind === 'group') {
    return `${node.name} (${node.repeating ? 'wiederholend' : 'einzeln'})`;
  }
  const modeLabel = { text: 'Text', attribute: `Attribut: ${node.attribute}`, exists: 'Vorhanden?' }[node.mode];
  return `${node.name} — ${modeLabel}`;
}

const FIELD_MODE_WIRE_NAMES = { text: 'Text', attribute: 'Attribute', exists: 'Exists' };

// Strips the popup's internal `kind` tag and shapes each node exactly like
// the wire format the Companion expects (ContainerNode.cs / ContainerNodeJsonConverter):
// `children` present only for groups, `attribute` present only when mode is Attribute.
function serializeGroupTree(groups) {
  return groups.map(node => node.kind === 'group'
    ? { name: node.name, selector: node.selector, repeating: node.repeating, children: serializeGroupTree(node.children) }
    : {
        name: node.name,
        selector: node.selector,
        mode: FIELD_MODE_WIRE_NAMES[node.mode],
        ...(node.mode === 'attribute' ? { attribute: node.attribute } : {}),
      });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── State ────────────────────────────────────────────────────────────────────

function setState(newState, patch = {}) {
  const prev = _state.current;
  _state = { ..._state, current: newState, ...patch };
  log('STATE', `${prev} → ${newState}`, Object.keys(patch).length ? patch : undefined);
  persistState();
  if (typeof document !== 'undefined') render();
}

// Updates state without a screen transition (e.g. DOM-tree-view bookkeeping)
// — skips persistState() since none of this needs to survive popup reopen.
function patchState(patch) {
  _state = { ..._state, ...patch };
  if (typeof document !== 'undefined') render();
}

// Persists the parts of state that must survive popup close/reopen.
function persistState() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
  chrome.storage.session
    .set({
      fields: _state.fields,
      url: _state.url,
      mode: _state.mode,
      groups: _state.groups,
      selectionKind: _state.selectionKind,
      pendingParentPath: _state.pendingParentPath,
      pendingNewContainer: _state.pendingNewContainer,
    })
    .catch(err => log('STORAGE_ERR', err.message));
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function render() {
  ['checking', 'error', 'idle', 'selecting', 'generating', 'done'].forEach(s =>
    hide(`screen-${s}`)
  );
  hide('modal-field-name');
  hide('modal-field-extended');
  hide('modal-container-new');

  const screenKey = {
    [STATES.CHECKING_COMPANION]: 'checking',
    [STATES.COMPANION_ERROR]:    'error',
    [STATES.IDLE]:               'idle',
    [STATES.SELECTING]:          'selecting',
    [STATES.GENERATING]:         'generating',
    [STATES.DONE]:               'done',
  }[_state.current];

  if (screenKey) show(`screen-${screenKey}`);

  if (_state.current === STATES.IDLE) {
    const urlEl = document.getElementById('url-display');
    if (urlEl) urlEl.textContent = _state.url || '—';

    document.getElementById('btn-mode-flat')?.classList.toggle('active', _state.mode === 'flat');
    document.getElementById('btn-mode-container')?.classList.toggle('active', _state.mode === 'container');
    document.getElementById('flat-mode-section')?.classList.toggle('hidden', _state.mode !== 'flat');
    document.getElementById('container-mode-section')?.classList.toggle('hidden', _state.mode !== 'container');

    if (_state.mode === 'container') {
      renderGroupTree(_state.groups);
    } else {
      renderFields();
    }

    const hasConfig = _state.mode === 'container' ? _state.groups.length > 0 : _state.fields.length > 0;
    const genBtn = document.getElementById('btn-generate');
    if (genBtn) genBtn.disabled = !hasConfig;
    const exportBtn = document.getElementById('btn-export-config');
    if (exportBtn) exportBtn.disabled = !hasConfig;

    if (_state.containerModalOpen) {
      show('modal-container-new');
      const nameInput = document.getElementById('input-container-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const singleRadio = document.getElementById('radio-container-single');
      if (singleRadio) singleRadio.checked = true;
    }
  }

  // Show modal when an element has been captured during selection
  if (_state.current === STATES.SELECTING && _state.pendingSelector !== null) {
    if (_state.mode === 'container') {
      show('modal-field-extended');
      const nameInput = document.getElementById('input-field-extended-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const modeSelect = document.getElementById('select-field-mode');
      if (modeSelect) modeSelect.value = 'text';
      document.getElementById('field-attribute-row')?.classList.add('hidden');
      const attrInput = document.getElementById('input-field-attribute');
      if (attrInput) attrInput.value = '';
    } else {
      show('modal-field-name');
      const input = document.getElementById('input-field-name');
      if (input) { input.value = ''; input.focus(); }
    }
  }

  if (_state.current === STATES.SELECTING) {
    const toggle = document.getElementById('toggle-dom-view');
    if (toggle) toggle.checked = _state.domViewEnabled;

    const wrapper = document.getElementById('dom-tree-wrapper');
    if (wrapper) wrapper.classList.toggle('hidden', !_state.domViewEnabled);

    const loading = document.getElementById('dom-tree-loading');
    if (loading) loading.classList.toggle('hidden', _state.domTree !== null || !!_state.domTreeError);

    const error = document.getElementById('dom-tree-error');
    if (error) error.classList.toggle('hidden', !_state.domTreeError);

    const truncated = document.getElementById('dom-tree-truncated');
    if (truncated) truncated.classList.toggle('hidden', !_state.domTreeTruncated);
  }
}

function renderFields(fields = _state.fields) {
  const listEl = document.getElementById('fields-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  fields.forEach((field, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML =
      `<span class="field-name" title="${escapeHtml(field.name)}">${escapeHtml(field.name)}</span>` +
      `<span class="field-selector" title="${escapeHtml(field.selector)}">${escapeHtml(field.selector)}</span>` +
      `<button class="btn-danger btn-remove-field" data-index="${i}">Entfernen</button>`;
    listEl.appendChild(row);
  });
}

// ── Container tree editor ────────────────────────────────────────────────────
// Same visual pattern as the DOM-tree-view below (indentation, toggle arrow,
// click-to-collapse — see buildTreeNodeEl) but editable: rows carry
// add-container/add-field/remove buttons, and nodes start expanded since
// this tree is user-authored and typically small, unlike a full page DOM.

function buildGroupTreeNodeEl(node, path, depth) {
  const li = document.createElement('li');
  li.className = 'group-tree-node';
  li.dataset.path = JSON.stringify(path);

  const row = document.createElement('div');
  row.className = 'group-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.kind === 'group' && node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'group-tree-toggle';
  toggle.textContent = hasChildren ? '▾' : '';
  row.appendChild(toggle);

  const label = document.createElement('span');
  label.className = 'group-tree-label';
  label.textContent = formatGroupNodeLabel(node);
  label.title = node.selector;
  row.appendChild(label);

  if (node.kind === 'group') {
    const addContainerBtn = document.createElement('button');
    addContainerBtn.className = 'btn-secondary btn-tiny btn-add-subcontainer';
    addContainerBtn.textContent = '+ Container';
    row.appendChild(addContainerBtn);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-secondary btn-tiny btn-add-subfield';
    addFieldBtn.textContent = '+ Datenfeld';
    row.appendChild(addFieldBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-danger btn-remove-group-node';
  removeBtn.textContent = 'Entfernen';
  row.appendChild(removeBtn);

  li.appendChild(row);

  if (node.kind === 'group') {
    const childUl = document.createElement('ul');
    childUl.className = 'group-tree-children';
    node.children.forEach((child, i) => childUl.appendChild(buildGroupTreeNodeEl(child, [...path, i], depth + 1)));
    li.appendChild(childUl);

    if (hasChildren) {
      toggle.addEventListener('click', () => {
        const collapsed = childUl.classList.toggle('hidden');
        toggle.textContent = collapsed ? '▸' : '▾';
      });
    }
  }

  return li;
}

function renderGroupTree(groups) {
  const root = document.getElementById('group-tree-root');
  if (!root) return;
  root.innerHTML = '';
  groups.forEach((node, i) => root.appendChild(buildGroupTreeNodeEl(node, [i], 0)));
}

// ── DOM tree view ────────────────────────────────────────────────────────────
// Rendered imperatively (not through render()) so a user's expand/collapse
// clicks survive unrelated state updates (e.g. adding/removing a field).

function formatTreeLabel(node) {
  let label = node.tag;
  if (node.id) label += `#${node.id}`;
  if (node.classes.length) label += `.${node.classes.join('.')}`;
  return label;
}

function buildTreeNodeEl(node, depth) {
  const li = document.createElement('li');
  li.className = 'dom-tree-node';
  li.dataset.path = JSON.stringify(node.path);

  const row = document.createElement('div');
  row.className = 'dom-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'dom-tree-toggle';
  toggle.textContent = hasChildren ? '▸' : '';
  row.appendChild(toggle);

  const label = document.createElement('span');
  label.textContent = formatTreeLabel(node);
  row.appendChild(label);

  li.appendChild(row);

  if (hasChildren) {
    const childUl = document.createElement('ul');
    childUl.className = 'dom-tree-children hidden';
    node.children.forEach(child => childUl.appendChild(buildTreeNodeEl(child, depth + 1)));
    li.appendChild(childUl);

    toggle.addEventListener('click', () => {
      const collapsed = childUl.classList.toggle('hidden');
      toggle.textContent = collapsed ? '▸' : '▾';
    });
  }

  return li;
}

function renderDomTree(tree) {
  const root = document.getElementById('dom-tree-root');
  if (!root || !tree) return;
  root.innerHTML = '';
  root.appendChild(buildTreeNodeEl(tree, 0));
}

function findTreeNode(path) {
  return document.querySelector(`#dom-tree-root li[data-path='${JSON.stringify(path)}']`);
}

// Un-collapses every ancestor <ul> of `li` so it becomes visible/scrollable-to.
function expandAncestors(li) {
  let ul = li.parentElement;
  while (ul && ul.classList.contains('dom-tree-children')) {
    ul.classList.remove('hidden');
    const ownerLi = ul.parentElement;
    const toggle = ownerLi.firstElementChild.querySelector('.dom-tree-toggle');
    if (toggle) toggle.textContent = '▾';
    ul = ownerLi.parentElement;
  }
}

let _lastHoverRow = null;

function highlightHover(path) {
  if (_lastHoverRow) _lastHoverRow.classList.remove('hover');
  const li = findTreeNode(path);
  const row = li?.firstElementChild ?? null;
  if (li && row) {
    row.classList.add('hover');
    expandAncestors(li);
    li.scrollIntoView?.({ block: 'nearest' });
  }
  _lastHoverRow = row;
}

function highlightSelected(path) {
  document.querySelectorAll('#dom-tree-root .dom-tree-row.selected')
    .forEach(el => el.classList.remove('selected'));
  const li = findTreeNode(path);
  const row = li?.firstElementChild ?? null;
  if (li && row) {
    row.classList.add('selected');
    expandAncestors(li);
    li.scrollIntoView?.({ block: 'nearest' });
  }
}

// ── Async actions ─────────────────────────────────────────────────────────────

async function checkCompanion() {
  log('HEALTH_CHECK start', COMPANION_URL);
  try {
    const res = await fetch(`${COMPANION_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('HEALTH_CHECK OK');

    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    const url = tabs[0]?.url ?? '';
    log('TAB_URL', url);
    setState(STATES.IDLE, { url });
  } catch (err) {
    log('HEALTH_CHECK FAIL', err.message);
    setLastError(err.message, 'Companion-Verbindung');
    setState(STATES.COMPANION_ERROR);
  }
}

// The companion actually generates and runs the script against the live
// page before handing it out (same rendering stage, and now the exact
// artifact the user would download) and responds 422 with a message when
// that run fails or errors — is the page unreachable, does the script raise
// an exception, or does it run cleanly but write no data (all selectors
// found nothing). `data` is logged separately so it ends up in the bug
// report if the user reports it.
function buildVerificationErrorMessage(data) {
  return data?.error || 'Verifikation der Konfiguration fehlgeschlagen.';
}

async function generate() {
  setState(STATES.GENERATING);
  const config = buildScrapingConfig(_state.url, _state.mode, _state.fields, _state.groups);
  log('GENERATE request', config);
  try {
    const res = await fetch(`${COMPANION_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (res.status === 422) {
      const data = await res.json().catch(() => null);
      log('GENERATE VERIFICATION FAIL', data);
      throw new Error(buildVerificationErrorMessage(data));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const scriptText = await res.text();
    log('GENERATE OK', `${scriptText.length} chars`);
    setState(STATES.DONE, { scriptText });
  } catch (err) {
    log('GENERATE FAIL', err.message);
    setState(STATES.IDLE);
    showToast(`Fehler: ${err.message}`, 'Skript-Generierung');
  }
}

function triggerDownload() {
  log('DOWNLOAD scraper.py');
  const blob = new Blob([_state.scriptText], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'scraper.py';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Lets a user hand over the current Fields/Groups configuration when
// reporting a selector problem, without having to describe their setup by
// hand — e.g. attached to a "Fehler melden" GitHub issue or shared directly.
function downloadConfigExport() {
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};
  const exportObj = buildConfigExport(_state.url, _state.mode, _state.fields, _state.groups, manifest);
  log('DOWNLOAD scraping-config.json', exportObj);

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `scraping-config-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// `context` is a short human label (e.g. "Skript-Generierung"); passing it
// marks the error as reportable — the toast then also offers "Fehler
// melden" and the message/context are attached to the next bug report.
function showToast(message, context) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;

  const msgEl = document.getElementById('error-toast-message');
  if (msgEl) msgEl.textContent = message; else toast.textContent = message;

  const reportBtn = document.getElementById('btn-report-bug-toast');
  if (reportBtn) reportBtn.classList.toggle('hidden', !context);
  if (context) setLastError(message, context);

  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), context ? 8000 : 4000);
}

// ── Bug reporting ─────────────────────────────────────────────────────────────
// Combines this side panel's own log buffer with the service worker's and
// (best-effort, via the service worker) the active tab's content script's,
// so a user hitting an error can attach real diagnostic context to a GitHub
// issue in one click instead of having to copy devtools console output by hand.

const GITHUB_REPO_URL = 'https://github.com/Aventinis/Scraping-Factory';
const BUG_REPORT_LOG_EXCERPT_LIMIT = 5000; // chars embedded directly in the GitHub issue body

let lastReportedError = null; // { message, context, ts } — feeds the next bug report

function setLastError(message, context) {
  lastReportedError = { message, context, ts: new Date().toISOString() };
}

async function collectLogs() {
  const popup = getLogBuffer();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    return { popup, background: response?.background ?? [], content: response?.content ?? null, contentError: response?.contentError ?? null };
  } catch (err) {
    log('GET_LOGS failed', err.message);
    return { popup, background: [], content: null, contentError: err.message };
  }
}

function formatLogSection(title, entries) {
  if (!entries || entries.length === 0) return `## ${title}\n(keine Einträge)\n`;
  const lines = entries.map(e => `${e.ts} ${e.event}${e.data !== null ? ' ' + JSON.stringify(e.data) : ''}`);
  return `## ${title}\n${lines.join('\n')}\n`;
}

async function buildBugReport() {
  const { popup, background, content, contentError } = await collectLogs();
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};

  const header = [
    '# Scraping Factory — Bug Report',
    `Zeitpunkt: ${new Date().toISOString()}`,
    `Extension-Version: ${manifest.version || '?'}`,
    `Seite: ${_state.url || '—'}`,
    lastReportedError ? `Letzter Fehler: ${lastReportedError.message} (${lastReportedError.context})` : null,
  ].filter(Boolean).join('\n');

  const sections = [
    formatLogSection('Side Panel', popup),
    formatLogSection('Service Worker', background),
    contentError ? `## Content Script\n(nicht verfügbar: ${contentError})\n` : formatLogSection('Content Script', content),
  ].join('\n');

  return `${header}\n\n${sections}`;
}

function downloadBugReport(text) {
  log('DOWNLOAD bug-report.log');
  const blob = new Blob([text], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `bug-report-${Date.now()}.log`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Prefills a new GitHub issue. Short reports are embedded in full so the
// issue is ready to submit as-is; longer ones are trailed off with a note
// pointing at the downloaded bug-report.log (URLs have practical length
// limits, so we don't risk silently truncating mid-word into a broken link).
function buildGithubIssueUrl(reportText) {
  const title = lastReportedError ? `Fehler: ${lastReportedError.message}` : 'Fehlerbericht';
  const truncated = reportText.length > BUG_REPORT_LOG_EXCERPT_LIMIT;
  const excerpt = truncated ? reportText.slice(-BUG_REPORT_LOG_EXCERPT_LIMIT) : reportText;

  const body = [
    'Bitte kurz beschreiben, was du getan hast, als der Fehler auftrat.',
    '',
    '<details><summary>Log</summary>',
    '',
    '```',
    excerpt,
    '```',
    '</details>',
    truncated ? '\n_(Log gekürzt — bitte die heruntergeladene bug-report.log-Datei zusätzlich an dieses Issue anhängen.)_' : '',
  ].filter(Boolean).join('\n');

  return `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

async function reportBug() {
  log('BTN report-bug');
  const reportText = await buildBugReport();
  downloadBugReport(reportText);
  chrome.tabs.create({ url: buildGithubIssueUrl(reportText) });
}

// ── Field-name modal ──────────────────────────────────────────────────────────

function confirmField() {
  const name = document.getElementById('input-field-name')?.value.trim();
  if (!name) return;
  log('FIELD_ADD', { name, selector: _state.pendingSelector });
  setState(STATES.IDLE, {
    fields:          addField(_state.fields, name, _state.pendingSelector),
    pendingSelector: null,
  });
}

// ── Container-Mode: mode switch, container/field add flows ─────────────────

function switchMode(mode) {
  if (mode === _state.mode) return;
  log('MODE_SWITCH', mode);
  // Strictly separate — switching modes clears the other mode's config
  // rather than keeping both around.
  setState(_state.current, mode === 'flat' ? { mode, groups: [] } : { mode, fields: [] });
}

function openContainerModal(parentPath) {
  log('CONTAINER_MODAL open', { parentPath });
  patchState({ containerModalOpen: true, pendingParentPath: parentPath });
}

// Container-add order is deliberately "name/type first, then click an
// element" (unlike field-add below) — see planning-container-scraping.md.
function confirmContainerModal() {
  const name = document.getElementById('input-container-name')?.value.trim();
  if (!name) return;
  const repeating = document.getElementById('radio-container-repeating')?.checked ?? false;
  const parentPath = _state.pendingParentPath;
  const scopeSelector = parentPath ? resolveGroupNode(_state.groups, parentPath)?.selector : null;
  // This container's own selector must itself be able to match N times when
  // repeating, on top of the usual "nested inside a repeating ancestor" case.
  const avoidId = repeating || hasRepeatingAncestor(_state.groups, parentPath);

  log('CONTAINER_ADD start', { name, repeating, parentPath, scopeSelector, avoidId });
  chrome.runtime.sendMessage({ type: 'START_SELECTION', scopeSelector, avoidId });
  setState(STATES.SELECTING, {
    containerModalOpen:  false,
    selectionKind:       'container',
    pendingNewContainer: { name, repeating },
    pendingSelector:     null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

function cancelContainerModal() {
  log('CONTAINER_MODAL cancel');
  setState(_state.current, { containerModalOpen: false, pendingParentPath: null });
}

// Field-add within a container keeps the flat mode's order — click first,
// name/type after — since the field type doesn't affect what gets clicked.
function startFieldSelection(parentPath) {
  const scopeSelector = resolveGroupNode(_state.groups, parentPath)?.selector ?? null;
  const avoidId = hasRepeatingAncestor(_state.groups, parentPath);
  log('FIELD_ADD(container) start', { parentPath, scopeSelector, avoidId });
  chrome.runtime.sendMessage({ type: 'START_SELECTION', scopeSelector, avoidId });
  setState(STATES.SELECTING, {
    selectionKind:       'field',
    pendingParentPath:   parentPath,
    pendingNewContainer: null,
    pendingSelector:     null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (_state.domViewEnabled) requestDomTree();
}

function confirmExtendedField() {
  const name = document.getElementById('input-field-extended-name')?.value.trim();
  if (!name) return;
  const mode = document.getElementById('select-field-mode')?.value ?? 'text';
  const attribute = document.getElementById('input-field-attribute')?.value.trim();
  if (mode === 'attribute' && !attribute) return;

  const node = buildFieldNode(name, _state.pendingSelector, mode, attribute);
  log('FIELD_ADD(container) confirm', node);
  setState(STATES.IDLE, {
    groups:            insertContainerNode(_state.groups, _state.pendingParentPath, node),
    pendingSelector:   null,
    pendingParentPath: null,
    selectionKind:     null,
  });
}

function cancelExtendedField() {
  log('FIELD_ADD(container) cancel');
  setState(STATES.IDLE, { pendingSelector: null, pendingParentPath: null, selectionKind: null });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('btn-report-bug-error')?.addEventListener('click', reportBug);
  document.getElementById('btn-report-bug-toast')?.addEventListener('click', reportBug);
  document.getElementById('btn-report-bug-domtree')?.addEventListener('click', reportBug);

  document.getElementById('btn-retry')?.addEventListener('click', () => {
    log('BTN retry');
    setState(STATES.CHECKING_COMPANION);
    checkCompanion();
  });

  document.getElementById('btn-add-field')?.addEventListener('click', () => {
    log('BTN add-field → START_SELECTION');
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    setState(STATES.SELECTING, { pendingSelector: null, domTree: null, domTreeTruncated: false, domTreeError: null });
    if (_state.domViewEnabled) {
      log('DOM view was enabled → re-requesting tree');
      requestDomTree();
    }
  });

  document.getElementById('btn-mode-flat')?.addEventListener('click', () => switchMode('flat'));
  document.getElementById('btn-mode-container')?.addEventListener('click', () => switchMode('container'));

  document.getElementById('btn-add-root-container')?.addEventListener('click', () => openContainerModal(null));

  // Event delegation for the container tree's per-row add/remove buttons
  document.getElementById('group-tree-root')?.addEventListener('click', (e) => {
    const li = e.target.closest('.group-tree-node');
    if (!li) return;
    const path = JSON.parse(li.dataset.path);

    if (e.target.closest('.btn-add-subcontainer')) { openContainerModal(path); return; }
    if (e.target.closest('.btn-add-subfield')) { startFieldSelection(path); return; }
    if (e.target.closest('.btn-remove-group-node')) {
      log('GROUP_NODE_REMOVE', { path });
      setState(_state.current, { groups: removeGroupTreeNode(_state.groups, path) });
    }
  });

  document.getElementById('btn-container-confirm')?.addEventListener('click', confirmContainerModal);
  document.getElementById('input-container-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmContainerModal();
  });
  document.getElementById('btn-container-cancel')?.addEventListener('click', cancelContainerModal);

  document.getElementById('btn-field-extended-confirm')?.addEventListener('click', confirmExtendedField);
  document.getElementById('input-field-extended-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmExtendedField();
  });
  document.getElementById('btn-field-extended-cancel')?.addEventListener('click', cancelExtendedField);
  document.getElementById('select-field-mode')?.addEventListener('change', (e) => {
    document.getElementById('field-attribute-row')?.classList.toggle('hidden', e.target.value !== 'attribute');
  });

  document.getElementById('btn-cancel-selection')?.addEventListener('click', () => {
    log('BTN cancel-selection → STOP_SELECTION');
    chrome.runtime.sendMessage({ type: 'STOP_SELECTION' });
    clearTimeout(domTreeTimeoutId);
    setState(STATES.IDLE, { selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null });
  });

  document.getElementById('toggle-dom-view')?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    log('BTN toggle-dom-view', enabled);
    if (enabled) {
      patchState({ domViewEnabled: true });
      requestDomTree();
    } else {
      chrome.runtime.sendMessage({ type: 'DISABLE_DOM_VIEW' });
      clearTimeout(domTreeTimeoutId);
      patchState({ domViewEnabled: false });
    }
  });

  document.getElementById('btn-field-confirm')?.addEventListener('click', confirmField);

  document.getElementById('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField();
  });

  document.getElementById('btn-field-cancel')?.addEventListener('click', () => {
    log('BTN field-cancel');
    setState(STATES.IDLE, { pendingSelector: null });
  });

  // Event delegation for "Entfernen" buttons in the field list
  document.getElementById('fields-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    log('FIELD_REMOVE', { index, name: _state.fields[index]?.name });
    setState(_state.current, { fields: removeField(_state.fields, index) });
  });

  document.getElementById('btn-generate')?.addEventListener('click', () => {
    log('BTN generate');
    generate();
  });
  document.getElementById('btn-download')?.addEventListener('click', triggerDownload);
  document.getElementById('btn-export-config')?.addEventListener('click', downloadConfigExport);

  document.getElementById('btn-new-scraper')?.addEventListener('click', () => {
    log('BTN new-scraper → reset state');
    chrome.storage.session.set({ fields: [], url: '', groups: [] });
    setState(STATES.CHECKING_COMPANION, { fields: [], groups: [], scriptText: '', url: '' });
    checkCompanion();
  });

  chrome.runtime.onMessage.addListener((message) => {
    log('MSG_IN', message);
    if (message.type === 'SELECTION_UNAVAILABLE' && _state.current === STATES.SELECTING) {
      log('SELECTION_UNAVAILABLE', message.reason);
      setLastError(message.reason, 'Element-Auswahl');
      setState(STATES.IDLE, { selectionKind: null, pendingParentPath: null, pendingNewContainer: null });
      showToast('Element-Auswahl auf dieser Seite nicht möglich.');
    }
    if (message.type === 'ELEMENT_SELECTED' && _state.current === STATES.SELECTING) {
      log('ELEMENT_SELECTED received (real-time)', message.selector);
      // Clear the storage entry the service worker wrote — we have it now.
      chrome.storage.session.remove('pendingSelector');
      if (_state.mode === 'container' && _state.selectionKind === 'container') {
        // Name/type were already collected by modal-container-new — insert
        // the new group node straight away, no further modal needed.
        const node = buildGroupNode(_state.pendingNewContainer.name, message.selector, _state.pendingNewContainer.repeating);
        setState(STATES.IDLE, {
          groups: insertContainerNode(_state.groups, _state.pendingParentPath, node),
          selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null,
        });
      } else {
        setState(STATES.SELECTING, { pendingSelector: message.selector });
      }
      if (message.path) highlightSelected(message.path);
    }
    if (message.type === 'DOM_TREE') {
      log('DOM_TREE received', { nodes: message.tree, truncated: message.truncated });
      clearTimeout(domTreeTimeoutId);
      if (message.tree) {
        patchState({ domTree: message.tree, domTreeTruncated: !!message.truncated, domTreeError: null });
        renderDomTree(message.tree);
      } else {
        const reason = message.error || 'Baum konnte nicht geladen werden.';
        setLastError(reason, 'DOM-Baum-Ansicht');
        patchState({ domTreeError: reason });
      }
    }
    if (message.type === 'HOVER_ELEMENT') {
      highlightHover(message.path);
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  wireEvents();

  log('INIT reading session storage');
  const stored = await chrome.storage.session.get([
    'fields', 'url', 'pendingSelector', 'mode', 'groups',
    'selectionKind', 'pendingParentPath', 'pendingNewContainer',
  ]);
  log('INIT restored', stored);

  // Always restore persisted fields/groups and URL.
  if (Array.isArray(stored.fields)) _state = { ..._state, fields: stored.fields };
  if (Array.isArray(stored.groups)) _state = { ..._state, groups: stored.groups };
  if (stored.url)                   _state = { ..._state, url: stored.url };
  if (stored.mode)                  _state = { ..._state, mode: stored.mode };
  if (stored.selectionKind)         _state = { ..._state, selectionKind: stored.selectionKind };
  if (stored.pendingParentPath !== undefined) _state = { ..._state, pendingParentPath: stored.pendingParentPath };
  if (stored.pendingNewContainer)   _state = { ..._state, pendingNewContainer: stored.pendingNewContainer };

  if (stored.pendingSelector) {
    // The user clicked an element while the side panel was closed (e.g. it
    // hadn't finished loading yet, or was closed manually).
    await chrome.storage.session.remove('pendingSelector');

    if (stored.mode === 'container' && stored.selectionKind === 'container' && stored.pendingNewContainer) {
      // Same as the live ELEMENT_SELECTED path: name/type were already
      // collected before selection started, so insert straight away.
      log('INIT pending container selector found → inserting node', stored.pendingSelector);
      const node = buildGroupNode(stored.pendingNewContainer.name, stored.pendingSelector, stored.pendingNewContainer.repeating);
      const groups = insertContainerNode(_state.groups, stored.pendingParentPath, node);
      await chrome.storage.session.set({ groups });
      setState(STATES.IDLE, {
        groups, selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null,
      });
      return;
    }

    // Flat field or container field — show the (extended, in container
    // mode) field-name modal without re-checking the companion.
    log('INIT pending selector found → show modal', stored.pendingSelector);
    setState(STATES.SELECTING, { pendingSelector: stored.pendingSelector });
    return;
  }

  setState(STATES.CHECKING_COMPANION);
  await checkCompanion();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildScrapingConfig, addField, removeField, escapeHtml, renderFields, STATES,
    formatTreeLabel, renderDomTree, highlightHover, highlightSelected,
    formatLogSection, buildGithubIssueUrl, setLastError, buildVerificationErrorMessage,
    buildGroupNode, buildFieldNode, resolveGroupNode, insertContainerNode, removeGroupTreeNode,
    formatGroupNodeLabel, serializeGroupTree, renderGroupTree, buildConfigExport, hasRepeatingAncestor,
  };
}
