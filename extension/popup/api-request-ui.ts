// API mode: the request side of the API_CONFIG screen — the captured-header table
// (Issue #53/#220) and the POST body tree with its "new parameter" modal
// (Issue #55). Split out of api-config-ui.ts (Issue #390); behavior unchanged.
// See api-config-ui.ts for the `bridge` convention.
import type * as SFDraft from '../types/drafts';
import type { PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { helpHostHtml } from './help-popover';
import { createAdvancedDisclosure } from './advanced-disclosure-ui';
import {
  STATES, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId, allParameterParts,
} from './api-config';
import type {
  ApiBodyLiteralDraft, ApiBodyNodeDraft, ApiBodyVariableDraft, ApiConfigDraft, HeaderDecision, ParameterPart,
} from './api-config';
import { patchApiConfigDraft } from './api-config-shared-ui';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:ApiConfigUI');

type BodyPath = Array<string | number>;

// These handlers only run on the API_CONFIG screen, where the draft exists.
const currentDraft = (bridge: PopupBridge): ApiConfigDraft => bridge.getState().apiConfigDraft as ApiConfigDraft;
// ... and only for a draft that has a request body.
const currentBodyTree = (bridge: PopupBridge): ApiBodyNodeDraft => currentDraft(bridge).bodyTree as ApiBodyNodeDraft;
// The toggles are only rendered on a literal or variable leaf.
type BodyLeaf = ApiBodyLiteralDraft | ApiBodyVariableDraft;

// Issue #220: `bootstrap` (apiConfigDraft.bootstrap, or null) adds a third
// "From token" mode whose template (e.g. "Bearer {token}") is filled with
// the freshly fetched bootstrap value at runtime.
export function renderApiConfigHeaders(
  capturedHeaders: Array<{ name: string; value: string }>, headerDecisions: Record<string, HeaderDecision>,
  bootstrap: SFDraft.ApiBootstrap | null = null,
): void {
  const listEl = byIdOrNull('api-config-headers');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (capturedHeaders.length === 0) {
    listEl.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('apiConfig.noHeadersRecorded'))}</li>`;
    return;
  }

  capturedHeaders.forEach((header) => {
    const decision: HeaderDecision = headerDecisions[header.name] || { include: false, mode: 'literal', envName: '' };
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

export function bodyNodeLabel(key: string, node: ApiBodyNodeDraft): string {
  if (node.kind === 'literal') return `${key}: ${node.literalKind === 'Null' ? 'null' : JSON.stringify(node.value)}`;
  return key;
}

export function buildBodyTreeNodeEl(key: string, node: ApiBodyNodeDraft, path: BodyPath, depth: number, availableParameters: ParameterPart[]): HTMLElement {
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
    const valueTypeBody = valueTypeAdvanced.querySelector('.advanced-disclosure-body') as HTMLElement;
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
export function renderBodyTree(draft: ApiConfigDraft): void {
  const root = byIdOrNull('body-tree-root');
  if (!root) return;
  root.innerHTML = '';
  if (!draft.bodyTree) return;
  root.appendChild(buildBodyTreeNodeEl(t('apiConfig.bodyRootLabel'), draft.bodyTree, [], 0, allParameterParts(draft)));
}
// ── Network recording ──
// A standalone recording of the page's fetch / XHR traffic, not dependent on Fields / Groups; it feeds request discovery (the interception
// is in api-capture.ts, MAIN world, and the content script's API_CAPTURE bridge).

export function setApiConfigHeaderDecision(bridge: PopupBridge, headerName: string, patch: Partial<HeaderDecision>): void {
  const draft = currentDraft(bridge);
  const current: HeaderDecision = draft.headerDecisions[headerName] || { include: false, mode: 'literal', envName: '' };
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

export function toggleBodyLeafToVariable(bridge: PopupBridge, path: BodyPath): void {
  const bodyTree = updateBodyTreeNode(currentBodyTree(bridge), path, (node) => {
    const leaf = node as BodyLeaf;
    return { kind: 'variable', literalKind: leaf.literalKind, value: leaf.value, parameterId: null, coerceTo: null };
  });
  patchApiConfigDraft(bridge, { bodyTree });
}

// A body-only parameter exists only because a variable leaf points at it: when the last one goes back to fixed, drop it and its
// parameterSources entry (an orphan card would still need a source, and the companion rejects an unused parameter). A leaf bound to a
// URL-derived id is left alone: that part stays a real URL segment either way.
export function toggleBodyLeafToFixed(bridge: PopupBridge, path: BodyPath): void {
  const draft = currentDraft(bridge);
  const node = resolveBodyTreeNode(currentBodyTree(bridge), path);
  const boundId = node.kind === 'variable' ? node.parameterId : undefined;
  const bodyTree = updateBodyTreeNode(currentBodyTree(bridge), path, (n) => {
    const leaf = n as BodyLeaf;
    return { kind: 'literal', literalKind: leaf.literalKind, value: leaf.value };
  });

  const isOrphanedBodyParameter = boundId?.startsWith('body:') && !bodyTreeReferencesParameterId(bodyTree, boundId);
  const bodyParameters = isOrphanedBodyParameter
    ? (draft.bodyParameters || []).filter(p => p.id !== boundId)
    : draft.bodyParameters;
  const parameterSources = isOrphanedBodyParameter
    ? Object.fromEntries(Object.entries(draft.parameterSources).filter(([id]) => id !== boundId))
    : draft.parameterSources;

  patchApiConfigDraft(bridge, { bodyTree, bodyParameters, parameterSources });
}

export function setBodyLeafParameter(bridge: PopupBridge, path: BodyPath, parameterId: string): void {
  patchApiConfigDraft(bridge, { bodyTree: updateBodyTreeNode(currentBodyTree(bridge), path, node => ({ ...(node as ApiBodyVariableDraft), parameterId: parameterId || null })) });
}

// null (not "String") is the wire-omitted default — mirrors CoerceTo's own
// optional nullable shape on the companion side (ApiBodyVariable.CoerceTo).
export function setBodyLeafCoerceTo(bridge: PopupBridge, path: BodyPath, coerceTo: 'String' | 'Number' | 'Boolean'): void {
  patchApiConfigDraft(bridge, { bodyTree: updateBodyTreeNode(currentBodyTree(bridge), path, node => ({ ...(node as ApiBodyVariableDraft), coerceTo: coerceTo === 'String' ? null : coerceTo })) });
}

export function openBodyParameterModal(bridge: PopupBridge, path: BodyPath): void {
  log('API_BODY_PARAMETER_MODAL open', { path });
  bridge.patchState({ bodyParameterModalOpen: true, pendingBodyVariablePath: path });
}

// New body-only parameter ids are a monotonic sequence (nextBodyParameterSeq), not the array length: removals could make a reused length
// collide with an id still referenced elsewhere.
export function confirmBodyParameterModal(bridge: PopupBridge): void {
  const name = byIdOrNull<HTMLInputElement>('input-api-body-parameter-name')?.value.trim();
  if (!name) return;

  const state = bridge.getState();
  const draft = currentDraft(bridge);
  const seq = draft.nextBodyParameterSeq || 0;
  const id = `body:${seq}`;
  const bodyParameters = [...(draft.bodyParameters || []), { id, name }];
  const bodyTree = updateBodyTreeNode(draft.bodyTree as ApiBodyNodeDraft, state.pendingBodyVariablePath as BodyPath, node => ({ ...(node as ApiBodyVariableDraft), parameterId: id }));

  log('API_BODY_PARAMETER_ADD', { id, name });
  bridge.setState(STATES.API_CONFIG, {
    apiConfigDraft: { ...draft, bodyParameters, bodyTree, nextBodyParameterSeq: seq + 1 },
    bodyParameterModalOpen: false, pendingBodyVariablePath: null,
  });
}

export function cancelBodyParameterModal(bridge: PopupBridge): void {
  log('API_BODY_PARAMETER_MODAL cancel');
  bridge.patchState({ bodyParameterModalOpen: false, pendingBodyVariablePath: null });
}

export function wireApiRequestEvents(bridge: PopupBridge): void {
  byIdOrNull('api-config-headers')?.addEventListener('change', (e) => {
    const target = e.target as Element;
    const include = target.closest<HTMLInputElement>('.api-config-header-include');
    if (include) { setApiConfigHeaderDecision(bridge, include.dataset.headerName as string, { include: include.checked }); return; }
    const modeRadio = target.closest<HTMLInputElement>('.api-config-header-mode-radio');
    if (modeRadio) { setApiConfigHeaderDecision(bridge, modeRadio.dataset.headerName as string, { mode: modeRadio.value as HeaderDecision['mode'] }); return; }
    const envName = target.closest<HTMLInputElement>('.api-config-env-name');
    if (envName) { setApiConfigHeaderDecision(bridge, envName.dataset.headerName as string, { envName: envName.value.trim() }); return; }
    const template = target.closest<HTMLInputElement>('.api-config-header-template');
    if (template) setApiConfigHeaderDecision(bridge, template.dataset.headerName as string, { template: template.value });
  });

  // ── API-Mode request-body tree (Issue #55, Phase B4) ─────────────────────
  // A node's data-path is the JSON this module wrote in buildBodyTreeNodeEl.
  const pathOf = (el: Element): BodyPath => JSON.parse((el.closest('.body-tree-node') as HTMLElement).dataset.path as string);
  byIdOrNull('body-tree-root')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const toVariableBtn = target.closest('.btn-body-to-variable');
    if (toVariableBtn) {
      toggleBodyLeafToVariable(bridge, pathOf(toVariableBtn));
      return;
    }
    const toFixedBtn = target.closest('.btn-body-to-fixed');
    if (toFixedBtn) toggleBodyLeafToFixed(bridge, pathOf(toFixedBtn));
  });

  byIdOrNull('body-tree-root')?.addEventListener('change', (e) => {
    const target = e.target as Element;
    const picker = target.closest<HTMLSelectElement>('.body-tree-parameter-picker');
    if (picker) {
      const path = pathOf(picker);
      if (picker.value === '__new__') { openBodyParameterModal(bridge, path); return; }
      setBodyLeafParameter(bridge, path, picker.value);
      return;
    }
    const coerceTo = target.closest<HTMLSelectElement>('.body-tree-coerce-to');
    if (coerceTo) setBodyLeafCoerceTo(bridge, pathOf(coerceTo), coerceTo.value as 'String' | 'Number' | 'Boolean');
  });

  byIdOrNull('btn-api-body-parameter-confirm')?.addEventListener('click', () => confirmBodyParameterModal(bridge));
  byIdOrNull('input-api-body-parameter-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBodyParameterModal(bridge);
  });
  byIdOrNull('btn-api-body-parameter-cancel')?.addEventListener('click', () => cancelBodyParameterModal(bridge));
}
