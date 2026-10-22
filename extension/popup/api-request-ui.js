// API mode: the request side of the API_CONFIG screen — the captured-header table
// (Issue #53/#220) and the POST body tree with its "new parameter" modal
// (Issue #55). Split out of api-config-ui.js (Issue #390); behavior unchanged.
// See api-config-ui.js for the `bridge` convention.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const {
  STATES, escapeHtml, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId, allParameterParts,
} = require('./api-config');
const { patchApiConfigDraft } = require('./api-config-shared-ui');

// Issue #220: `bootstrap` (apiConfigDraft.bootstrap, or null) adds a third
// "From token" mode whose template (e.g. "Bearer {token}") is filled with
// the freshly fetched bootstrap value at runtime.
function renderApiConfigHeaders(capturedHeaders, headerDecisions, bootstrap = null) {
  const listEl = document.getElementById('api-config-headers');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (capturedHeaders.length === 0) {
    listEl.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('apiConfig.noHeadersRecorded'))}</li>`;
    return;
  }

  capturedHeaders.forEach((header) => {
    const decision = headerDecisions[header.name] || { include: false, mode: 'literal', envName: '' };
    const li = document.createElement('li');
    li.className = 'api-config-header-row';
    li.innerHTML =
      `<label><input type="checkbox" class="api-config-header-include" data-header-name="${escapeHtml(header.name)}" ${decision.include ? 'checked' : ''} /></label>` +
      `<span class="api-config-header-name" title="${escapeHtml(header.name)}: ${escapeHtml(header.value)}">${escapeHtml(header.name)}</span>` +
      (decision.include
        ? `<span class="api-config-header-mode">
               <label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="literal" ${decision.mode === 'literal' ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.headerModeValue'))}</label>
               <label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="env" ${decision.mode === 'env' ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.headerModeEnv'))}</label>` +
            (bootstrap || decision.mode === 'bootstrap'
              ? `<label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="bootstrap" ${decision.mode === 'bootstrap' ? 'checked' : ''} /> ${escapeHtml(t('apiBootstrap.headerMode'))}</label>`
              : '') +
          `</span>` +
          (decision.mode === 'env'
            ? `<input type="text" class="api-config-env-name" data-env-var data-header-name="${escapeHtml(header.name)}" placeholder="${escapeHtml(t('envVar.placeholder.apiHeader'))}" value="${escapeHtml(decision.envName || '')}" />`
            : decision.mode === 'bootstrap'
              ? `<input type="text" class="api-config-header-template" data-header-name="${escapeHtml(header.name)}" placeholder="Bearer {${escapeHtml(bootstrap?.name || 'token')}}" value="${escapeHtml(decision.template || '')}" />`
              : '')
        : '');
    listEl.appendChild(li);
  });
}
// ── API-Mode request-body tree editor (Issue #55, Phase B4) ─────────────────
// Visually mirrors the response tree above (buildApiTreeNodeEl/renderApiTree)
// but simpler: a node's own JSON key/array index is a read-only label (the
// body's shape itself is never edited, see this section's own doc comment
// on jsonValueToBodyDraft), and only a 'literal'/'variable' leaf gets any
// controls at all — object/array nodes just recurse.

function bodyNodeLabel(key, node) {
  if (node.kind === 'literal') return `${key}: ${node.literalKind === 'Null' ? 'null' : JSON.stringify(node.value)}`;
  return key;
}

function buildBodyTreeNodeEl(key, node, path, depth, availableParameters) {
  const li = document.createElement('li');
  li.className = 'body-tree-node';
  li.dataset.path = JSON.stringify(path);

  const row = document.createElement('div');
  row.className = 'body-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const label = document.createElement('span');
  label.className = 'body-tree-label';
  label.textContent = bodyNodeLabel(key, node);
  row.appendChild(label);

  if (node.kind === 'literal') {
    const toVariableBtn = document.createElement('button');
    toVariableBtn.type = 'button';
    toVariableBtn.className = 'btn-secondary btn-tiny btn-body-to-variable';
    toVariableBtn.textContent = t('apiConfig.bodyToVariableBtn');
    row.appendChild(toVariableBtn);
  } else if (node.kind === 'variable') {
    const picker = document.createElement('select');
    picker.className = 'body-tree-parameter-picker';
    picker.innerHTML =
      `<option value="">${escapeHtml(t('apiConfig.bodyPickParameterPlaceholder'))}</option>` +
      availableParameters.map(p =>
        `<option value="${escapeHtml(p.id)}" ${node.parameterId === p.id ? 'selected' : ''}>${escapeHtml(p.name?.trim() ? p.name : t('apiConfig.unnamedPart'))}</option>`
      ).join('') +
      `<option value="__new__">${escapeHtml(t('apiConfig.bodyNewParameterOption'))}</option>`;
    row.appendChild(picker);

    const coerceSelect = document.createElement('select');
    coerceSelect.className = 'body-tree-coerce-to';
    coerceSelect.title = t('apiConfig.bodyCoerceToTitle');
    coerceSelect.innerHTML = ['String', 'Number', 'Boolean']
      .map(kind => `<option value="${kind}" ${(node.coerceTo || 'String') === kind ? 'selected' : ''}>${kind}</option>`)
      .join('');
    row.appendChild(coerceSelect);

    const toFixedBtn = document.createElement('button');
    toFixedBtn.type = 'button';
    toFixedBtn.className = 'btn-secondary btn-tiny btn-body-to-fixed';
    toFixedBtn.textContent = t('apiConfig.bodyToFixedBtn');
    row.appendChild(toFixedBtn);
  }

  li.appendChild(row);

  if (node.kind === 'object' || node.kind === 'array') {
    const childUl = document.createElement('ul');
    childUl.className = 'body-tree-children';
    if (node.kind === 'object') {
      Object.entries(node.properties).forEach(([childKey, child]) =>
        childUl.appendChild(buildBodyTreeNodeEl(childKey, child, [...path, childKey], depth + 1, availableParameters)));
    } else {
      node.items.forEach((child, i) =>
        childUl.appendChild(buildBodyTreeNodeEl(`[${i}]`, child, [...path, i], depth + 1, availableParameters)));
    }
    li.appendChild(childUl);
  }

  return li;
}

// draft (not just draft.bodyTree) since a parameter picker needs the full
// allParameterParts(draft) list to populate its options.
function renderBodyTree(draft) {
  const root = document.getElementById('body-tree-root');
  if (!root) return;
  root.innerHTML = '';
  if (!draft.bodyTree) return;
  root.appendChild(buildBodyTreeNodeEl(t('apiConfig.bodyRootLabel'), draft.bodyTree, [], 0, allParameterParts(draft)));
}
// ── API-Mode network recording (Issue #53 Phase 3) ───────────────────────────
// Unlike preview, this doesn't depend on Fields/Groups — it's a standalone
// recording of the page's own fetch/XHR traffic, meant to feed the future
// API-Mode's request-discovery flow (Phase 4+). See content-script.js's
// API_CAPTURE bridge and api-capture.js (MAIN world) for where the actual
// interception happens.

function setApiConfigHeaderDecision(bridge, headerName, patch) {
  const draft = bridge.getState().apiConfigDraft;
  const current = draft.headerDecisions[headerName] || { include: false, mode: 'literal', envName: '' };
  const next = { ...current, ...patch };
  // Issue #220: switching a header to "From token" pre-fills a sensible
  // template — "Bearer {token}" for a recorded bearer header, else just
  // "{token}" — instead of starting from an empty input.
  if (patch.mode === 'bootstrap' && !next.template) {
    const recorded = draft.capturedHeaders.find(h => h.name === headerName)?.value || '';
    const name = draft.bootstrap?.name || 'token';
    next.template = /^bearer\s/i.test(recorded) ? `Bearer {${name}}` : `{${name}}`;
  }
  patchApiConfigDraft(bridge, { headerDecisions: { ...draft.headerDecisions, [headerName]: next } });
}

// ── API-Mode request-body wiring (Issue #55, Phase B4) ──────────────────────
// Toggling a leaf is the only structural edit the body tree ever gets (see
// the section's own doc comment above jsonValueToBodyDraft) — everything
// else here is either that toggle or routing a newly-variable leaf into the
// exact same parameter-source configuration UI a URL variable part already
// uses (allParameterParts/renderApiConfigParameters), rather than a second,
// body-specific source picker.

function toggleBodyLeafToVariable(bridge, path) {
  const bodyTree = updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({
    kind: 'variable', literalKind: node.literalKind, value: node.value, parameterId: null, coerceTo: null,
  }));
  patchApiConfigDraft(bridge, { bodyTree });
}

// A body-only parameter (unlike a URL part, which persists regardless of
// whether the body still references it) only exists because some variable
// leaf pointed at it — if this was the last one, drop it along with its
// parameterSources entry rather than leaving an orphaned parameter card
// that would still need a configured source just to satisfy
// apiConfigDraftHasAllSourcesChosen (and the companion's own "declared but
// unused parameter" rejection) for nothing. A leaf bound to a URL-derived
// id is left alone either way — that part is still a real URL segment/query
// param regardless of whether the body also referenced it.
function toggleBodyLeafToFixed(bridge, path) {
  const draft = bridge.getState().apiConfigDraft;
  const node = resolveBodyTreeNode(draft.bodyTree, path);
  const boundId = node.parameterId;
  const bodyTree = updateBodyTreeNode(draft.bodyTree, path, n => ({ kind: 'literal', literalKind: n.literalKind, value: n.value }));

  const isOrphanedBodyParameter = boundId?.startsWith('body:') && !bodyTreeReferencesParameterId(bodyTree, boundId);
  const bodyParameters = isOrphanedBodyParameter
    ? (draft.bodyParameters || []).filter(p => p.id !== boundId)
    : draft.bodyParameters;
  const parameterSources = isOrphanedBodyParameter
    ? Object.fromEntries(Object.entries(draft.parameterSources).filter(([id]) => id !== boundId))
    : draft.parameterSources;

  patchApiConfigDraft(bridge, { bodyTree, bodyParameters, parameterSources });
}

function setBodyLeafParameter(bridge, path, parameterId) {
  patchApiConfigDraft(bridge, { bodyTree: updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({ ...node, parameterId: parameterId || null })) });
}

// null (not "String") is the wire-omitted default — mirrors CoerceTo's own
// optional nullable shape on the companion side (ApiBodyVariable.CoerceTo).
function setBodyLeafCoerceTo(bridge, path, coerceTo) {
  patchApiConfigDraft(bridge, { bodyTree: updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({ ...node, coerceTo: coerceTo === 'String' ? null : coerceTo })) });
}

function openBodyParameterModal(bridge, path) {
  log('API_BODY_PARAMETER_MODAL open', { path });
  bridge.patchState({ bodyParameterModalOpen: true, pendingBodyVariablePath: path });
}

// New body-only parameter ids are a monotonic sequence (draft.
// nextBodyParameterSeq), not derived from the current array length —
// toggleBodyLeafToFixed can remove entries again, and reusing a shrunk
// array's length as the next id could otherwise collide with one still
// referenced elsewhere in the tree.
function confirmBodyParameterModal(bridge) {
  const name = document.getElementById('input-api-body-parameter-name')?.value.trim();
  if (!name) return;

  const state = bridge.getState();
  const draft = state.apiConfigDraft;
  const seq = draft.nextBodyParameterSeq || 0;
  const id = `body:${seq}`;
  const bodyParameters = [...(draft.bodyParameters || []), { id, name }];
  const bodyTree = updateBodyTreeNode(draft.bodyTree, state.pendingBodyVariablePath, node => ({ ...node, parameterId: id }));

  log('API_BODY_PARAMETER_ADD', { id, name });
  bridge.setState(STATES.API_CONFIG, {
    apiConfigDraft: { ...draft, bodyParameters, bodyTree, nextBodyParameterSeq: seq + 1 },
    bodyParameterModalOpen: false, pendingBodyVariablePath: null,
  });
}

function cancelBodyParameterModal(bridge) {
  log('API_BODY_PARAMETER_MODAL cancel');
  bridge.patchState({ bodyParameterModalOpen: false, pendingBodyVariablePath: null });
}

function wireApiRequestEvents(bridge) {
  document.getElementById('api-config-headers')?.addEventListener('change', (e) => {
    const include = e.target.closest('.api-config-header-include');
    if (include) { setApiConfigHeaderDecision(bridge, include.dataset.headerName, { include: include.checked }); return; }
    const modeRadio = e.target.closest('.api-config-header-mode-radio');
    if (modeRadio) { setApiConfigHeaderDecision(bridge, modeRadio.dataset.headerName, { mode: modeRadio.value }); return; }
    const envName = e.target.closest('.api-config-env-name');
    if (envName) { setApiConfigHeaderDecision(bridge, envName.dataset.headerName, { envName: envName.value.trim() }); return; }
    const template = e.target.closest('.api-config-header-template');
    if (template) setApiConfigHeaderDecision(bridge, template.dataset.headerName, { template: template.value });
  });

  // ── API-Mode request-body tree (Issue #55, Phase B4) ─────────────────────
  document.getElementById('body-tree-root')?.addEventListener('click', (e) => {
    const toVariableBtn = e.target.closest('.btn-body-to-variable');
    if (toVariableBtn) {
      toggleBodyLeafToVariable(bridge, JSON.parse(toVariableBtn.closest('.body-tree-node').dataset.path));
      return;
    }
    const toFixedBtn = e.target.closest('.btn-body-to-fixed');
    if (toFixedBtn) toggleBodyLeafToFixed(bridge, JSON.parse(toFixedBtn.closest('.body-tree-node').dataset.path));
  });

  document.getElementById('body-tree-root')?.addEventListener('change', (e) => {
    const picker = e.target.closest('.body-tree-parameter-picker');
    if (picker) {
      const path = JSON.parse(picker.closest('.body-tree-node').dataset.path);
      if (picker.value === '__new__') { openBodyParameterModal(bridge, path); return; }
      setBodyLeafParameter(bridge, path, picker.value);
      return;
    }
    const coerceTo = e.target.closest('.body-tree-coerce-to');
    if (coerceTo) setBodyLeafCoerceTo(bridge, JSON.parse(coerceTo.closest('.body-tree-node').dataset.path), coerceTo.value);
  });

  document.getElementById('btn-api-body-parameter-confirm')?.addEventListener('click', () => confirmBodyParameterModal(bridge));
  document.getElementById('input-api-body-parameter-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBodyParameterModal(bridge);
  });
  document.getElementById('btn-api-body-parameter-cancel')?.addEventListener('click', () => cancelBodyParameterModal(bridge));
}

module.exports = {
  renderApiConfigHeaders,
  bodyNodeLabel,
  buildBodyTreeNodeEl,
  renderBodyTree,
  setApiConfigHeaderDecision,
  toggleBodyLeafToVariable,
  toggleBodyLeafToFixed,
  setBodyLeafParameter,
  setBodyLeafCoerceTo,
  openBodyParameterModal,
  confirmBodyParameterModal,
  cancelBodyParameterModal,
  wireApiRequestEvents,
};
