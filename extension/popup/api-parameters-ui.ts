// API mode: the URL parts and parameter-source cards of the API_CONFIG screen: fixed / variable parts, value lists, discovery endpoints,
// ranges, and the browser-discovery source (api-browser-discovery-ui.ts). See api-config-ui.ts for the `bridge` convention.
import type * as SFWire from '../types/wire';
import type { PopupBridge, State } from '../types/popup';
import type { ApiCandidate } from '../types/messages';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import {
  STATES, findUrlTemplateMatches, mergeValueListValues, buildDiscoverySource, RANGE_FORMAT_PRESETS, detectRangeFormat, findUrlPartValue, rangeFormatExample, allParameterParts, earlierParameterNames,
} from './api-config';
import type { ApiConfigDraft, ApiParameterSourceDraft, ParameterPart, SourceOf, UrlParts } from './api-config';
// Issue #220: a variable URL part can take the bootstrap value as its
// source, and a captured header can be built from it ("Bearer {token}").
import { BOOTSTRAP_SOURCE_KIND } from './api-bootstrap';
import { helpHostHtml } from './help-popover';
import { renderParameterPlaceholderPicker, patchApiConfigDraft, patchApiConfigSource, insertParameterPlaceholder } from './api-config-shared-ui';
import { fetchApiCaptureEntries } from './api-capture-ui';
import { renderBrowserDiscoverySourceFields, handleBrowserDiscoveryChange, handleBrowserDiscoveryClick } from './api-browser-discovery-ui';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:ApiConfigUI');

type SourceKind = ApiParameterSourceDraft['kind'];

// These handlers only run on the API_CONFIG screen, where the draft exists.
const currentDraft = (bridge: PopupBridge): ApiConfigDraft => bridge.getState().apiConfigDraft as ApiConfigDraft;

// `id` ("path:<index>" or "query:<key>") embeds the query key, which came from the recorded page and is untrusted: escapeHtml, never raw
// interpolation.
function urlPartRowHtml(id: string, valueLabel: string, variable: boolean, name: string | undefined): string {
  const safeId = escapeHtml(id);
  return (
    `<span class="api-config-part-value" title="${escapeHtml(valueLabel)}">${escapeHtml(valueLabel)}</span>` +
    `<label><input type="checkbox" class="api-config-part-toggle" data-part-id="${safeId}" ${variable ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.variableLabel'))}</label>` +
    (variable ? `<input type="text" class="api-config-part-name" data-part-id="${safeId}" placeholder="${escapeHtml(t('common.namePlaceholder'))}" value="${escapeHtml(name || '')}" />` : '')
  );
}

export function renderApiConfigUrlParts(urlParts: UrlParts): void {
  const segEl = byIdOrNull('api-config-segments');
  if (segEl) {
    segEl.innerHTML = '';
    urlParts.pathSegments.forEach((seg, i) => {
      const li = document.createElement('li');
      li.className = 'api-config-part-row';
      li.innerHTML = urlPartRowHtml(`path:${i}`, `/${seg.value}`, seg.variable, seg.name);
      segEl.appendChild(li);
    });
  }

  const queryEl = byIdOrNull('api-config-query-params');
  if (queryEl) {
    queryEl.innerHTML = '';
    urlParts.queryParams.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'api-config-part-row';
      li.innerHTML = urlPartRowHtml(`query:${p.key}`, `${p.key}=${p.value}`, p.variable, p.name);
      queryEl.appendChild(li);
    });
  }
}

// help.apiConfig.sourceStaticList / sourceDiscovery / sourceRange / sourceBrowserDiscovery / sourceBootstrap
function sourceHelpSuffix(kind: SourceKind): string {
  const name = kind === BOOTSTRAP_SOURCE_KIND ? 'bootstrap' : kind;
  return name[0].toUpperCase() + name.slice(1);
}

export function renderApiConfigParameters(
  draft: ApiConfigDraft, discoveryCandidates: State['apiDiscoveryCandidates'], discoveryTemplateEditingPartId: string | null | undefined,
): void {
  const container = byIdOrNull('api-config-parameters');
  if (!container) return;
  container.innerHTML = '';

  allParameterParts(draft).forEach((part) => {
    const source: ApiParameterSourceDraft | undefined = draft.parameterSources[part.id];
    const safePartId = escapeHtml(part.id); // see urlPartRowHtml's doc comment — part.id can embed an untrusted query key
    const card = document.createElement('div');
    card.className = 'api-config-param-card';
    card.dataset.partId = part.id; // DOM property assignment, not HTML parsing — safe regardless

    const title = document.createElement('div');
    title.className = 'row-label';
    title.textContent = source?.kind === BOOTSTRAP_SOURCE_KIND && draft.bootstrap
      ? `{${draft.bootstrap.name}}`
      : part.name ? part.name : t('apiConfig.unnamedPart');
    card.appendChild(title);

    const kindRow = document.createElement('div');
    kindRow.className = 'api-config-source-kind';
    const sourceKindLabels: Record<SourceKind, string> = {
      staticList: t('apiConfig.sourceKindStaticList'),
      discovery: t('apiConfig.sourceKindDiscovery'),
      range: t('apiConfig.sourceKindRange'),
      browserDiscovery: t('apiConfig.sourceKindBrowserDiscovery'),
      [BOOTSTRAP_SOURCE_KIND]: t('apiBootstrap.sourceKind'),
    };
    // Issue #220: "Bootstrap value" is only offered for a URL part (never a
    // body-only parameter — the body references the bootstrap by name
    // directly on the wire) and only while a bootstrap is configured.
    const isUrlPart = part.id.startsWith('path:') || part.id.startsWith('query:');
    // All sources are plain options; the token value only while a bootstrap exists (or is the chosen source).
    const kinds: SourceKind[] = ['staticList', 'discovery', 'range', 'browserDiscovery'];
    if (isUrlPart && (draft.bootstrap || source?.kind === BOOTSTRAP_SOURCE_KIND)) kinds.push(BOOTSTRAP_SOURCE_KIND);
    const radioHtml = (kind: SourceKind) => `
        <label>
          <input type="radio" name="source-kind-${safePartId}" class="api-config-source-kind-radio"
            data-part-id="${safePartId}" value="${kind}" ${source?.kind === kind ? 'checked' : ''} />
          ${escapeHtml(sourceKindLabels[kind])}
          ${helpHostHtml(`help.apiConfig.source${sourceHelpSuffix(kind)}`, kind === 'range' ? 'range' : undefined)}
        </label>
      `;
    kindRow.setAttribute('data-help-anchor', '');
    kindRow.innerHTML = kinds.map(radioHtml).join('');
    card.appendChild(kindRow);

    const fieldsEl = document.createElement('div');
    fieldsEl.className = 'api-config-source-fields';
    if (source?.kind === 'staticList') {
      fieldsEl.innerHTML =
        `<textarea class="api-config-static-list" data-part-id="${safePartId}" rows="2" placeholder="${escapeHtml(t('apiConfig.valueListPlaceholder'))}">${escapeHtml(source.valuesText || '')}</textarea>` +
        `<button type="button" class="btn-secondary btn-tiny api-config-autofill-pool" data-part-id="${safePartId}" title="${escapeHtml(t('apiConfig.autoFillFromPoolTitle'))}">${escapeHtml(t('apiConfig.autoFillFromPoolBtn'))}</button>`;
    } else if (source?.kind === 'discovery') {
      fieldsEl.appendChild(renderDiscoverySourceFields(draft, part, source, discoveryCandidates, discoveryTemplateEditingPartId));
    } else if (source?.kind === 'range') {
      fieldsEl.innerHTML = `
          <div class="api-config-range-row">
            <select class="api-config-range-type" data-part-id="${safePartId}">
              ${['IsoWeek', 'Number', 'Date'].map(rangeType => `<option value="${rangeType}" ${source.type === rangeType ? 'selected' : ''}>${rangeType}</option>`).join('')}
            </select>
            <input type="text" class="api-config-range-from" data-part-id="${safePartId}" placeholder="${escapeHtml(t('apiConfig.rangeFromPlaceholder'))}" value="${escapeHtml(source.from || '')}" />
            <input type="text" class="api-config-range-to" data-part-id="${safePartId}" placeholder="${escapeHtml(t('apiConfig.rangeToPlaceholder'))}" value="${escapeHtml(source.to || '')}" />
          </div>
          ${renderRangeFormatFields(source, safePartId)}
        `;
    } else if (source?.kind === 'browserDiscovery') {
      fieldsEl.appendChild(renderBrowserDiscoverySourceFields(draft, part, source));
    } else if (source?.kind === BOOTSTRAP_SOURCE_KIND) {
      const note = document.createElement('p');
      note.className = 'api-config-source-note';
      note.textContent = draft.bootstrap
        ? t('apiBootstrap.sourceKindNote', { placeholder: `{${draft.bootstrap.name}}` })
        : t('apiBootstrap.sourceKindMissing');
      fieldsEl.appendChild(note);
    }
    card.appendChild(fieldsEl);

    container.appendChild(card);
  });
}

// Preset dropdown, custom-format input and a live example under From / To (IsoWeek / Date only). `source.format` is always set by now
// (auto-detected or chosen), so "custom" means "not one of the presets".
export function renderRangeFormatFields(source: SourceOf<'range'>, safePartId: string): string {
  if (source.type === 'Number') return '';

  const presets = RANGE_FORMAT_PRESETS[source.type] as NonNullable<(typeof RANGE_FORMAT_PRESETS)[SFWire.RangeType]>; // only Number has none, returned above
  const isCustom = !presets.some(preset => preset.format === source.format);
  const options = presets
    .map(preset => `<option value="${escapeHtml(preset.format)}" ${preset.format === source.format ? 'selected' : ''}>${escapeHtml(t(preset.labelKey))}</option>`)
    .join('') + `<option value="custom" ${isCustom ? 'selected' : ''}>${escapeHtml(t('apiConfig.customFormatOption'))}</option>`;
  const example = rangeFormatExample(source.format, source.from) ?? t('apiConfig.formatEnterPrompt');

  return `
      <div class="api-config-range-format-row">
        <select class="api-config-range-format-preset" data-part-id="${safePartId}">${options}</select>
        ${isCustom ? `<input type="text" class="api-config-range-format-custom" data-part-id="${safePartId}" placeholder="{yyyy}-{ww}" value="${escapeHtml(source.format || '')}" />` : ''}
        <p class="api-config-range-format-example">${escapeHtml(t('apiConfig.formatExample', { example }))}</p>
      </div>
    `;
}

// DiscoverySource.UrlTemplate is read-only (derived by "Search again"); editingPartId (state.discoveryTemplateEditingPartId, a screen-scoped flag
// outside apiConfigDraft, which is sent to the companion as is) swaps the summary for a text input so the user can replace a concrete segment
// with "{earlierParameterName}" and chain it. Only the template is edited; itemsPath / valuePath stay.
export function renderDiscoverySourceFields(
  draft: ApiConfigDraft, part: ParameterPart, source: SourceOf<'discovery'>, discoveryCandidates: State['apiDiscoveryCandidates'],
  editingPartId: string | null | undefined,
): HTMLElement {
  const wrap = document.createElement('div');
  const safePartId = escapeHtml(part.id);
  const earlierNames = earlierParameterNames(draft, part.id);

  if (editingPartId === part.id) {
    const editRow = document.createElement('div');
    editRow.innerHTML =
      `<input type="text" class="api-discovery-url-template" data-part-id="${safePartId}" value="${escapeHtml(source.urlTemplate || '')}" />` +
      renderParameterPlaceholderPicker(earlierNames, safePartId, '.api-discovery-url-template', 'urlTemplate');
    wrap.appendChild(editRow);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'btn-secondary btn-tiny btn-discovery-template-done';
    doneBtn.dataset.partId = part.id;
    doneBtn.textContent = t('apiConfig.doneEditingTemplateBtn');
    wrap.appendChild(doneBtn);
    return wrap;
  }

  if (source.urlTemplate) {
    const summary = document.createElement('p');
    summary.className = 'api-candidates-target';
    summary.textContent = t('apiConfig.discoverySource', { urlTemplate: source.urlTemplate, itemsPath: source.itemsPath, valuePath: source.valuePath });
    wrap.appendChild(summary);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-secondary btn-tiny btn-discovery-template-edit';
    editBtn.dataset.partId = part.id;
    editBtn.textContent = t('apiConfig.editTemplateBtn');
    wrap.appendChild(editBtn);
  }

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'btn-secondary btn-tiny api-config-discovery-search';
  searchBtn.dataset.partId = part.id;
  searchBtn.textContent = t(source.urlTemplate ? 'apiConfig.discoverySearchAgainBtn' : 'apiConfig.discoverySearchBtn');
  wrap.appendChild(searchBtn);

  if (discoveryCandidates && discoveryCandidates.parameter === part.id) {
    const list = document.createElement('ul');
    list.className = 'api-candidates-list';
    if (discoveryCandidates.candidates.length === 0) {
      list.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('common.noMatches'))}</li>`;
    } else {
      discoveryCandidates.candidates.forEach((candidate, i) => {
        const li = document.createElement('li');
        li.className = 'api-candidate';
        const usable = candidate.itemsPath && candidate.valuePath;
        li.innerHTML =
          `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.method)} ${escapeHtml(candidate.url)}</div>` +
          `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
          (usable
            ? `<button type="button" class="btn-secondary btn-tiny api-config-discovery-confirm" data-part-id="${escapeHtml(part.id)}" data-candidate-index="${i}">${escapeHtml(t('common.use'))}</button>`
            : `<div class="api-candidate-unusable">${escapeHtml(t('common.noRecordArray'))}</div>`);
        list.appendChild(li);
      });
    }
    wrap.appendChild(list);
  }

  return wrap;
}

// Starts a second search round with the same click selection; its result becomes a DiscoverySource for one variable part. `partId` (not the
// editable display name) identifies it.
export function startDiscoverySearch(bridge: PopupBridge, partId: string): void {
  log('API_DISCOVERY_SEARCH start', partId);
  chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true });
  bridge.setState(STATES.SELECTING, {
    apiSearchTarget: { parameter: partId }, pendingSelector: null, apiDiscoveryCandidates: null,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
  if (bridge.getState().domViewEnabled) bridge.requestDomTree();
}

export function confirmDiscoveryCandidate(bridge: PopupBridge, partId: string, candidate: ApiCandidate): void {
  // The "Use" button is only rendered for a candidate that has all three.
  const source = buildDiscoverySource(candidate.url as string, candidate.itemsPath as string, candidate.valuePath as string);
  const state = bridge.getState();
  log('API_DISCOVERY_CONFIRM', { partId, source });
  bridge.setState(STATES.API_CONFIG, {
    apiDiscoveryCandidates: null,
    apiConfigDraft: {
      ...currentDraft(bridge),
      parameterSources: { ...currentDraft(bridge).parameterSources, [partId]: source },
    },
  });
}

export function toggleApiConfigPartVariable(bridge: PopupBridge, partId: string): void {
  const draft = currentDraft(bridge);
  const [scope, key] = partId.split(':');
  const urlParts = scope === 'path'
    ? { ...draft.urlParts, pathSegments: draft.urlParts.pathSegments.map((seg, i) => (String(i) === key ? { ...seg, variable: !seg.variable } : seg)) }
    : { ...draft.urlParts, queryParams: draft.urlParts.queryParams.map(p => (p.key === key ? { ...p, variable: !p.variable } : p)) };

  // Toggling either way drops any source config for this part — avoids an
  // orphaned/stale parameterSources entry for a part that just became
  // "fest" again, or a half-configured one lingering under a name that no
  // longer means anything after a second toggle.
  const parameterSources = { ...draft.parameterSources };
  delete parameterSources[partId];

  patchApiConfigDraft(bridge, { urlParts, parameterSources });
}

export function setApiConfigPartName(bridge: PopupBridge, partId: string, name: string): void {
  const draft = currentDraft(bridge);
  const [scope, key] = partId.split(':');
  const urlParts = scope === 'path'
    ? { ...draft.urlParts, pathSegments: draft.urlParts.pathSegments.map((seg, i) => (String(i) === key ? { ...seg, name } : seg)) }
    : { ...draft.urlParts, queryParams: draft.urlParts.queryParams.map(p => (p.key === key ? { ...p, name } : p)) };
  patchApiConfigDraft(bridge, { urlParts });
}

const API_CONFIG_SOURCE_DEFAULTS: {
  staticList: SourceOf<'staticList'>; range: SourceOf<'range'>; discovery: SourceOf<'discovery'>; browserDiscovery: SourceOf<'browserDiscovery'>;
} = {
  staticList: { kind: 'staticList', valuesText: '' },
  range: { kind: 'range', type: 'IsoWeek', from: '', to: '' },
  discovery: { kind: 'discovery' }, // incomplete until confirmDiscoveryCandidate fills in urlTemplate/itemsPath/valuePath
  // Issue #216: discoveryUrl/actions stay in draft shape (actions: a
  // plain SFDraft.BrowserAction[], same shape _state.browserActions
  // already uses) until confirmApiConfig serializes them — see
  // buildBrowserDiscoverySource's own doc comment.
  browserDiscovery: { kind: 'browserDiscovery', discoveryUrl: '', actions: [] },
};

// A Range source gets its format from the part's captured example (detectRangeFormat); browser discovery prefills DiscoveryUrl from the
// inspected page (the likeliest discovery page; still editable).
export function setApiConfigSourceKind(bridge: PopupBridge, partId: string, kind: SourceKind): void {
  const state = bridge.getState();
  const draft = currentDraft(bridge);
  const source: ApiParameterSourceDraft = kind === BOOTSTRAP_SOURCE_KIND
    ? { kind: BOOTSTRAP_SOURCE_KIND }
    : kind === 'range'
    ? { ...API_CONFIG_SOURCE_DEFAULTS.range, format: detectRangeFormat(API_CONFIG_SOURCE_DEFAULTS.range.type, findUrlPartValue(draft.urlParts, partId)) }
    : kind === 'browserDiscovery'
      ? { ...API_CONFIG_SOURCE_DEFAULTS.browserDiscovery, discoveryUrl: state.url || '' }
      : API_CONFIG_SOURCE_DEFAULTS[kind];
  patchApiConfigDraft(bridge, { parameterSources: { ...draft.parameterSources, [partId]: source } });
}

// Derives sibling values for a variable URL part from the recorded pool and merges them into its value list (findUrlTemplateMatches /
// mergeValueListValues). Runs once when "Value list" is picked and on demand via "Fill from recording".
export async function fillStaticListFromPool(bridge: PopupBridge, partId: string): Promise<void> {
  log('API_AUTOFILL start', partId);
  const entries = await fetchApiCaptureEntries();

  // The round trip is async — re-read state instead of trusting a
  // closed-over draft, and bail if the screen/parameter moved on while it
  // was in flight (config screen left, part removed, or its source kind
  // switched away from staticList in the meantime).
  const draft = bridge.getState().apiConfigDraft;
  const source = draft?.parameterSources?.[partId];
  if (!draft || source?.kind !== 'staticList') return;

  const matches = findUrlTemplateMatches(draft.urlParts, partId, entries);
  const { text, addedCount } = mergeValueListValues(source.valuesText || '', matches);
  log('API_AUTOFILL result', { partId, found: matches.length, added: addedCount });

  // A successful fill is already visible in the textarea itself — no need
  // to also announce it via the (otherwise error-only, red) toast. Only the
  // no-op case gets one, since nothing else on screen would otherwise
  // confirm that the button/auto-run actually did something.
  if (addedCount > 0) {
    patchApiConfigSource<SourceOf<'staticList'>>(bridge, partId, { valuesText: text });
  } else {
    bridge.showToast(t('apiConfig.autoFillNoMatches'));
  }
}

export function wireApiParameterEvents(bridge: PopupBridge): void {
  // ── API-Mode config screen (Issue #53 Phase 5) ─────────────────────────────
  // Delegated `change` listeners (not `input`) so typing in a text field
  // doesn't trigger a re-render — and thus lose focus — on every keystroke;
  // see renderApiConfigScreen's doc comment for the trade-off this implies.

  const handleUrlPartControlChange = (e: Event) => {
    const target = e.target as Element;
    const toggle = target.closest<HTMLElement>('.api-config-part-toggle');
    if (toggle) { toggleApiConfigPartVariable(bridge, toggle.dataset.partId as string); return; }
    const nameInput = target.closest<HTMLInputElement>('.api-config-part-name');
    if (nameInput) setApiConfigPartName(bridge, nameInput.dataset.partId as string, nameInput.value.trim());
  };
  byIdOrNull('api-config-segments')?.addEventListener('change', handleUrlPartControlChange);
  byIdOrNull('api-config-query-params')?.addEventListener('change', handleUrlPartControlChange);

  byIdOrNull('api-config-parameters')?.addEventListener('change', (e) => {
    const target = e.target as Element;
    const kindRadio = target.closest<HTMLInputElement>('.api-config-source-kind-radio');
    if (kindRadio) {
      setApiConfigSourceKind(bridge, kindRadio.dataset.partId as string, kindRadio.value as SourceKind);
      // Best-effort first pass: picking "Value list" is when a user would hunt for sibling requests, so try the pool first.
      if (kindRadio.value === 'staticList') fillStaticListFromPool(bridge, kindRadio.dataset.partId as string);
      return;
    }
    const staticList = target.closest<HTMLTextAreaElement>('.api-config-static-list');
    if (staticList) { patchApiConfigSource<SourceOf<'staticList'>>(bridge, staticList.dataset.partId as string, { valuesText: staticList.value }); return; }
    const rangeType = target.closest<HTMLSelectElement>('.api-config-range-type');
    if (rangeType) {
      const partId = rangeType.dataset.partId as string;
      // Re-detect on every Type change, not just the initial "Range" pick
      // — switching e.g. IsoWeek → Date should re-match the same captured
      // raw value against Date's own presets instead of keeping a format
      // string that no longer means anything for the new Type.
      const rawValue = findUrlPartValue(currentDraft(bridge).urlParts, partId);
      const type = rangeType.value as SFWire.RangeType;
      patchApiConfigSource<SourceOf<'range'>>(bridge, partId, { type, format: detectRangeFormat(type, rawValue) });
      return;
    }
    const rangeFrom = target.closest<HTMLInputElement>('.api-config-range-from');
    if (rangeFrom) { patchApiConfigSource<SourceOf<'range'>>(bridge, rangeFrom.dataset.partId as string, { from: rangeFrom.value.trim() }); return; }
    const rangeTo = target.closest<HTMLInputElement>('.api-config-range-to');
    if (rangeTo) { patchApiConfigSource<SourceOf<'range'>>(bridge, rangeTo.dataset.partId as string, { to: rangeTo.value.trim() }); return; }
    const formatPreset = target.closest<HTMLSelectElement>('.api-config-range-format-preset');
    if (formatPreset) { patchApiConfigSource<SourceOf<'range'>>(bridge, formatPreset.dataset.partId as string, { format: formatPreset.value === 'custom' ? '' : formatPreset.value }); return; }
    const formatCustom = target.closest<HTMLInputElement>('.api-config-range-format-custom');
    if (formatCustom) { patchApiConfigSource<SourceOf<'range'>>(bridge, formatCustom.dataset.partId as string, { format: formatCustom.value.trim() }); return; }

    // ── Chained parameter discovery (Issue #217) ──────────────────────────
    const discoveryUrlTemplate = target.closest<HTMLInputElement>('.api-discovery-url-template');
    if (discoveryUrlTemplate) { patchApiConfigSource<SourceOf<'discovery'>>(bridge, discoveryUrlTemplate.dataset.partId as string, { urlTemplate: discoveryUrlTemplate.value.trim() }); return; }
    const paramPlaceholderSelect = target.closest<HTMLSelectElement>('.api-param-placeholder-select');
    if (paramPlaceholderSelect) { insertParameterPlaceholder(bridge, paramPlaceholderSelect); return; }

    handleBrowserDiscoveryChange(bridge, e);
  });

  byIdOrNull('api-config-parameters')?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const searchBtn = target.closest<HTMLElement>('.api-config-discovery-search');
    if (searchBtn) { startDiscoverySearch(bridge, searchBtn.dataset.partId as string); return; }
    const confirmBtn = target.closest<HTMLElement>('.api-config-discovery-confirm');
    if (confirmBtn) {
      const index = parseInt(confirmBtn.dataset.candidateIndex as string, 10);
      const candidate = bridge.getState().apiDiscoveryCandidates?.candidates?.[index];
      if (candidate) confirmDiscoveryCandidate(bridge, confirmBtn.dataset.partId as string, candidate);
      return;
    }
    const autofillBtn = target.closest<HTMLElement>('.api-config-autofill-pool');
    if (autofillBtn) { fillStaticListFromPool(bridge, autofillBtn.dataset.partId as string); return; }

    // ── Chained parameter discovery (Issue #217) ──────────────────────────
    const editTemplateBtn = target.closest<HTMLElement>('.btn-discovery-template-edit');
    if (editTemplateBtn) { bridge.patchState({ discoveryTemplateEditingPartId: editTemplateBtn.dataset.partId }); return; }
    const doneTemplateBtn = target.closest<HTMLElement>('.btn-discovery-template-done');
    if (doneTemplateBtn) { bridge.patchState({ discoveryTemplateEditingPartId: null }); return; }

    handleBrowserDiscoveryClick(bridge, e);
  });
}
