// API mode: the request side of the API_CONFIG screen — the captured-header table
// (Issue #53/#220) and the POST body tree with its "new parameter" modal
// (Issue #55). Split out of api-config-ui.ts (Issue #390); behavior unchanged.
// See api-config-ui.ts for the `bridge` convention.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const { helpHostHtml } = require('./help-popover');
const { createAdvancedDisclosure } = require('./advanced-disclosure-ui');
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
// ── Request-body tree editor ──
// Mirrors the response tree but simpler: a node's JSON key / index is a read-only label (the body's shape is never edited), and only a
// 'literal' / 'variable' leaf gets controls; object / array nodes recurse.

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

    // Issue #404: the value type matters only when the server expects a number
    // or true/false — so it sits under "Advanced" (opened by itself when a
    // non-default type is already chosen), with a "?" popover.
    const coerceSelect = document.createElement('select');
    coerceSelect.className = 'body-tree-coerce-to';
    coerceSelect.title = t('apiConfig.bodyCoerceToTitle');
    coerceSelect.innerHTML = ['String', 'Number', 'Boolean']
      .map(kind => `<option value="${kind}" ${(node.coerceTo || 'String') === kind ? 'selected' : ''}>${kind}</option>`)
      .join('');
    const valueTypeAdvanced = createAdvancedDisclosure('api-body-value-type', 'apiConfig.bodyValueTypeAdvanced');
    const valueTypeBody = valueTypeAdvanced.querySelector('.advanced-disclosure-body');
    valueTypeBody.setAttribute('data-help-anchor', '');
    valueTypeBody.insertAdjacentHTML('beforeend', `<span>${escapeHtml(t('apiConfig.bodyValueTypeLabel'))}</span>${helpHostHtml('help.apiConfig.valueType')}`);
    valueTypeBody.appendChild(coerceSelect);
    if (node.coerceTo && node.coerceTo !== 'String') valueTypeAdvanced.open = true;
    row.appendChild(valueTypeAdvanced);

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
// ── Network recording ──
// A standalone recording of the page's fetch / XHR traffic, not dependent on Fields / Groups; it feeds request discovery (the interception
// is in api-capture.js, MAIN world, and the content script's API_CAPTURE bridge).

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

// ── Request-body wiring ──
// Toggling a leaf is the only structural edit; a newly variable leaf is routed into the same parameter-source UI a URL variable part uses
// (allParameterParts / renderApiConfigParameters), not a second picker.

function toggleBodyLeafToVariable(bridge, path) {
  const bodyTree = updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({
    kind: 'variable', literalKind: node.literalKind, value: node.value, parameterId: null, coerceTo: null,
  }));
  patchApiConfigDraft(bridge, { bodyTree });
}

// A body-only parameter exists only because a variable leaf points at it: when the last one goes back to fixed, drop it and its
// parameterSources entry (an orphan card would still need a source, and the companion rejects an unused parameter). A leaf bound to a
// URL-derived id is left alone: that part stays a real URL segment either way.
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

// New body-only parameter ids are a monotonic sequence (nextBodyParameterSeq), not the array length: removals could make a reused length
// collide with an id still referenced elsewhere.
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
