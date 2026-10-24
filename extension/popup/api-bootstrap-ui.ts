// API mode: token/auth bootstrap value (Issue #220) — DOM rendering and
// event wiring for the "Auth bootstrap (token)" section on the API_CONFIG
// screen (see api-bootstrap.ts for the pure draft/wire logic, the same
// <feature>.js/<feature>-ui.js split the rest of the popup uses). Every
// function that touches state takes popup.ts's `bridge` as its first
// parameter, per Architecture Decision #12.
//
// State this module owns:
//   apiConfigDraft.bootstrap       — the bootstrap draft (null = disabled)
//   apiBootstrapRecordingEntries   — the "Take from recording" picker's list
//                                    (null = closed), UI-only like
//                                    apiDiscoveryCandidates
//   apiBootstrapTestValues         — one-time credential test values for the
//                                    /generate trial run, keyed by env-var
//                                    name; written via patchState only, so
//                                    they never reach chrome.storage (same
//                                    treatment as fillTestValues, Issue #43)
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { envVarNoteHtml } from './env-var-ui';
import { helpHostHtml } from './help-popover';
import { autoOpenAdvanced } from './advanced-disclosure-ui';
import { pathPickerButtonHtml, pathPickerPanelHtml, wirePathPickerEvents } from './json-path-picker-ui';
import {
  createDefaultBootstrapDraft, createBootstrapPair, detectTokenInResponse, bootstrapDraftFromCaptureEntry,
  wireTokenIntoMainRequest, stripBootstrapReferences, suggestEnvVarName,
} from './api-bootstrap';
import type { ApiConfigDraft } from './api-config';
import { patchApiConfigDraft } from './api-config-shared-ui';
import { fetchApiCaptureEntries } from './api-capture-ui';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:ApiBootstrapUI');

type PairListKey = 'headers' | 'bodyFields';
type RecordingRows = NonNullable<State['apiBootstrapRecordingEntries']>;

// These handlers only run on the API_CONFIG screen, where the draft exists.
const currentDraft = (bridge: PopupBridge): ApiConfigDraft => bridge.getState().apiConfigDraft as ApiConfigDraft;

function patchBootstrap(bridge: PopupBridge, patch: Partial<SFDraft.ApiBootstrap>): void {
  const draft = currentDraft(bridge);
  patchApiConfigDraft(bridge, { bootstrap: { ...draft.bootstrap, ...patch } as SFDraft.ApiBootstrap });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function pairRowHtml(listKey: PairListKey, pair: SFDraft.ApiBootstrapPair, index: number, testValues: Record<string, string>): string {
  const attrs = `data-list="${listKey}" data-index="${index}"`;
  const valueInput = pair.mode === 'env'
    ? `<input type="text" class="api-bootstrap-pair-env" data-env-var ${attrs} placeholder="${escapeHtml(t('envVar.placeholder.apiHeader'))}" value="${escapeHtml(pair.envName)}" />` +
      `<input type="password" class="api-bootstrap-test-value" data-env-name="${escapeHtml(pair.envName)}" placeholder="${escapeHtml(t('envVar.testValuePlaceholder'))}" value="${escapeHtml(testValues[pair.envName] || '')}" ${pair.envName ? '' : 'disabled'} autocomplete="off" />`
    : `<input type="text" class="api-bootstrap-pair-value" ${attrs} placeholder="${escapeHtml(t('apiBootstrap.valuePlaceholder'))}" value="${escapeHtml(pair.value)}" />`;
  return `
      <li class="api-bootstrap-pair-row">
        <input type="text" class="api-bootstrap-pair-name" ${attrs} placeholder="${escapeHtml(t('common.namePlaceholder'))}" value="${escapeHtml(pair.name)}" />
        <select class="api-bootstrap-pair-mode" ${attrs}>
          <option value="literal" ${pair.mode === 'literal' ? 'selected' : ''}>${escapeHtml(t('apiConfig.headerModeValue'))}</option>
          <option value="env" ${pair.mode === 'env' ? 'selected' : ''}>${escapeHtml(t('apiConfig.headerModeEnv'))}</option>
        </select>
        ${valueInput}
        <button type="button" class="btn-secondary btn-tiny btn-api-bootstrap-remove-pair" ${attrs} title="${escapeHtml(t('common.remove'))}">−</button>
      </li>`;
}

function pairListHtml(listKey: PairListKey, labelKey: string, pairs: SFDraft.ApiBootstrapPair[], testValues: Record<string, string>): string {
  return `
      <div class="row-label">${escapeHtml(t(labelKey))}</div>
      <ul class="api-bootstrap-pairs">${pairs.map((pair, i) => pairRowHtml(listKey, pair, i, testValues)).join('')}</ul>
      <button type="button" class="btn-secondary btn-tiny btn-api-bootstrap-add-pair" data-list="${listKey}">${escapeHtml(t('apiBootstrap.addRow'))}</button>`;
}

function recordingListHtml(entries: RecordingRows): string {
  if (entries.length === 0) {
    return `<li class="api-candidates-empty">${escapeHtml(t('apiBootstrap.recordingEmpty'))}</li>`;
  }
  return entries.map(({ entry, likely }) => `
      <li class="api-candidate api-bootstrap-recording-entry${likely ? ' likely' : ''}" data-entry-id="${escapeHtml(entry.id)}">
        <div class="api-candidate-source">${escapeHtml(entry.method)} ${escapeHtml(entry.status)}${likely ? ` · ${escapeHtml(t('apiBootstrap.recordingLikely'))}` : ''}</div>
        <div class="api-candidate-path" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</div>
      </li>`).join('');
}

function bootstrapConfigHtml(bootstrap: SFDraft.ApiBootstrap, recordingEntries: RecordingRows | null, testValues: Record<string, string>, state: State): string {
  return `
      ${envVarNoteHtml()}
      <div class="actions">
        <button type="button" id="btn-api-bootstrap-from-recording" class="btn-secondary btn-tiny">${escapeHtml(t('apiBootstrap.fromRecordingBtn'))}</button>
      </div>
      ${recordingEntries
      ? `<p class="browser-actions-hint">${escapeHtml(t('apiBootstrap.recordingHint'))}</p>
           <ul id="api-bootstrap-recording-list" class="api-candidates-list">${recordingListHtml(recordingEntries)}</ul>`
      : ''}
      <div class="api-bootstrap-request-row">
        <select class="api-bootstrap-field" data-field="method">
          <option value="POST" ${bootstrap.method === 'POST' ? 'selected' : ''}>POST</option>
          <option value="GET" ${bootstrap.method === 'GET' ? 'selected' : ''}>GET</option>
        </select>
        <input type="text" class="api-bootstrap-field" data-field="url" placeholder="https://example.com/auth/token" value="${escapeHtml(bootstrap.url)}" />
      </div>
      ${pairListHtml('headers', 'apiBootstrap.headersLabel', bootstrap.headers, testValues)}
      ${bootstrap.method === 'POST'
      ? `${pairListHtml('bodyFields', 'apiBootstrap.bodyFieldsLabel', bootstrap.bodyFields, testValues)}
           <label class="api-bootstrap-encoding">${escapeHtml(t('apiBootstrap.bodyEncodingLabel'))}
             <select class="api-bootstrap-field" data-field="bodyEncoding">
               <option value="Json" ${bootstrap.bodyEncoding === 'Json' ? 'selected' : ''}>JSON</option>
               <option value="Form" ${bootstrap.bodyEncoding === 'Form' ? 'selected' : ''}>${escapeHtml(t('apiBootstrap.bodyEncodingForm'))}</option>
             </select>
           </label>`
      : ''}
      <div class="row-label">${escapeHtml(t('apiBootstrap.valuePathLabel'))}</div>
      <input type="text" class="api-bootstrap-field" data-field="valuePath" placeholder="access_token" value="${escapeHtml(bootstrap.valuePath)}" />
      <div class="actions">${pathPickerButtonHtml('bootstrap.valuePath')}</div>${pathPickerPanelHtml(state, 'bootstrap.valuePath')}
      <div class="row-label" data-help-anchor>${escapeHtml(t('apiBootstrap.nameLabel'))}${helpHostHtml('help.apiBootstrap.placeholder', 'modesApi')}</div>
      <input type="text" class="api-bootstrap-field" data-field="name" placeholder="token" value="${escapeHtml(bootstrap.name)}" />`;
}

// Called from popup.ts's render() while the API_CONFIG screen is showing.
export function renderApiBootstrapSection(bridge: PopupBridge): void {
  const state = bridge.getState();
  const bootstrap = state.apiConfigDraft?.bootstrap || null;
  const toggle = byIdOrNull<HTMLInputElement>('toggle-api-bootstrap');
  if (toggle) toggle.checked = !!bootstrap;
  autoOpenAdvanced(byIdOrNull('api-bootstrap-section'), !!bootstrap);
  const configEl = byIdOrNull('api-bootstrap-config');
  if (!configEl) return;
  configEl.classList.toggle('hidden', !bootstrap);
  configEl.innerHTML = bootstrap
    ? bootstrapConfigHtml(bootstrap, state.apiBootstrapRecordingEntries, state.apiBootstrapTestValues || {}, state)
    : '';
}

// ── Actions ─────────────────────────────────────────────────────────────────

function setBootstrapEnabled(bridge: PopupBridge, enabled: boolean): void {
  const draft = currentDraft(bridge);
  log('API_BOOTSTRAP toggle', enabled);
  if (enabled) {
    patchApiConfigDraft(bridge, { bootstrap: createDefaultBootstrapDraft() });
  } else {
    bridge.patchState({ apiBootstrapRecordingEntries: null });
    patchApiConfigDraft(bridge, { bootstrap: null, ...stripBootstrapReferences(draft) });
  }
}

// Renaming the bootstrap value carries every header template referencing
// the old "{name}" along, so a rename never silently breaks the
// "Bearer {token}" header the user already set up.
function setBootstrapField(bridge: PopupBridge, field: string, value: string): void {
  const draft = currentDraft(bridge);
  if (field !== 'name') {
    patchBootstrap(bridge, { [field]: field === 'url' || field === 'valuePath' ? value.trim() : value } as Partial<SFDraft.ApiBootstrap>); // field is one of the data-field names
    return;
  }
  const oldName = (draft.bootstrap as SFDraft.ApiBootstrap).name;
  const newName = value.trim();
  const headerDecisions = { ...draft.headerDecisions };
  Object.entries(headerDecisions).forEach(([header, decision]) => {
    if (decision.mode === 'bootstrap' && decision.template) {
      headerDecisions[header] = { ...decision, template: decision.template.split(`{${oldName}}`).join(`{${newName}}`) };
    }
  });
  patchApiConfigDraft(bridge, { bootstrap: { ...(draft.bootstrap as SFDraft.ApiBootstrap), name: newName }, headerDecisions });
}

function updatePair(bridge: PopupBridge, listKey: PairListKey, index: number, patch: Partial<SFDraft.ApiBootstrapPair>): void {
  const bootstrap = currentDraft(bridge).bootstrap as SFDraft.ApiBootstrap;
  const list = bootstrap[listKey].map((pair, i) => {
    if (i !== index) return pair;
    const next = { ...pair, ...patch };
    // Switching a named row to env mode suggests a variable name right away.
    if (patch.mode === 'env' && !next.envName && next.name) next.envName = suggestEnvVarName(next.name);
    return next;
  });
  patchBootstrap(bridge, { [listKey]: list });
}

// "Take from recording": lists every recorded request with a successful
// JSON-looking response (the main request itself excluded), sorted so the
// ones whose response contains a value the main request actually sends
// (its token, in practice) come first, marked as "likely".
export async function openRecordingPicker(bridge: PopupBridge): Promise<void> {
  if (bridge.getState().apiBootstrapRecordingEntries) {
    bridge.patchState({ apiBootstrapRecordingEntries: null });
    return;
  }
  const draft = currentDraft(bridge);
  const mainStrings = [draft.sourceUrl || '', ...(draft.capturedHeaders || []).map(h => h.value)];
  const entries = (await fetchApiCaptureEntries())
    .filter(entry => entry.status >= 200 && entry.status < 300 && entry.body && entry.url !== draft.sourceUrl)
    .map((entry) => {
      let likely = false;
      try {
        const detected = detectTokenInResponse(JSON.parse(entry.body), mainStrings);
        likely = !!detected && mainStrings.some(s => s.includes(detected.value));
      } catch {
        return null; // not a JSON response — can't be a token endpoint we can read a value from
      }
      return { entry, likely };
    })
    .filter((row): row is RecordingRows[number] => row !== null)
    .sort((a, b) => Number(b.likely) - Number(a.likely));
  log('API_BOOTSTRAP recording picker', { count: entries.length });
  bridge.patchState({ apiBootstrapRecordingEntries: entries });
}

export function applyRecordingEntry(bridge: PopupBridge, entryId: string | undefined): void {
  const state = bridge.getState();
  const picked = (state.apiBootstrapRecordingEntries || []).find(({ entry }) => String(entry.id) === String(entryId));
  if (!picked) return;
  const draft = currentDraft(bridge);
  const name = draft.bootstrap?.name?.trim() || undefined;
  const { bootstrap, tokenValue } = bootstrapDraftFromCaptureEntry(picked.entry, { url: draft.sourceUrl, capturedHeaders: draft.capturedHeaders }, name);
  log('API_BOOTSTRAP from recording', { url: bootstrap.url, valuePath: bootstrap.valuePath, tokenDetected: !!tokenValue });
  bridge.patchState({ apiBootstrapRecordingEntries: null });
  patchApiConfigDraft(bridge, { bootstrap, ...wireTokenIntoMainRequest(draft, tokenValue, bootstrap.name) });
  bridge.showToast(
    bootstrap.valuePath ? t('apiBootstrap.recordingApplied', { path: bootstrap.valuePath }) : t('apiBootstrap.recordingNoValuePath'),
    null, bootstrap.valuePath ? 'info' : 'warn');
}

// ── Event wiring ────────────────────────────────────────────────────────────

export function wireApiBootstrapEvents(bridge: PopupBridge): void {
  const section = byIdOrNull('api-bootstrap-section');
  if (!section) return;
  wirePathPickerEvents(bridge, section); // Issue #404

  section.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'toggle-api-bootstrap') { setBootstrapEnabled(bridge, target.checked); return; }
    if (target.classList.contains('api-bootstrap-field')) { setBootstrapField(bridge, target.dataset.field as string, target.value); return; }
    if (target.classList.contains('api-bootstrap-test-value')) {
      // patchState (not setState): test values must never reach
      // persistState()/chrome.storage.session, same as fillTestValues.
      const envName = target.dataset.envName as string;
      bridge.patchState({ apiBootstrapTestValues: { ...bridge.getState().apiBootstrapTestValues, [envName]: target.value } });
      return;
    }
    const listKey = target.dataset.list as PairListKey | undefined;
    const index = parseInt(target.dataset.index as string, 10);
    if (!listKey || Number.isNaN(index)) return;
    if (target.classList.contains('api-bootstrap-pair-name')) updatePair(bridge, listKey, index, { name: target.value.trim() });
    else if (target.classList.contains('api-bootstrap-pair-mode')) updatePair(bridge, listKey, index, { mode: target.value as 'literal' | 'env' });
    else if (target.classList.contains('api-bootstrap-pair-value')) updatePair(bridge, listKey, index, { value: target.value });
    else if (target.classList.contains('api-bootstrap-pair-env')) updatePair(bridge, listKey, index, { envName: target.value.trim() });
  });

  section.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#btn-api-bootstrap-from-recording')) { openRecordingPicker(bridge); return; }
    const entryEl = target.closest<HTMLElement>('.api-bootstrap-recording-entry');
    if (entryEl) { applyRecordingEntry(bridge, entryEl.dataset.entryId); return; }
    const addBtn = target.closest<HTMLElement>('.btn-api-bootstrap-add-pair');
    if (addBtn) {
      const listKey = addBtn.dataset.list as PairListKey;
      const bootstrap = currentDraft(bridge).bootstrap as SFDraft.ApiBootstrap;
      patchBootstrap(bridge, { [listKey]: [...bootstrap[listKey], createBootstrapPair()] });
      return;
    }
    const removeBtn = target.closest<HTMLElement>('.btn-api-bootstrap-remove-pair');
    if (removeBtn) {
      const listKey = removeBtn.dataset.list as PairListKey;
      const index = parseInt(removeBtn.dataset.index as string, 10);
      const bootstrap = currentDraft(bridge).bootstrap as SFDraft.ApiBootstrap;
      patchBootstrap(bridge, { [listKey]: bootstrap[listKey].filter((_, i) => i !== index) });
    }
  });
}
