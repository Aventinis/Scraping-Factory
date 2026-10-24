// Deduplication by key field(s) (Issue #225) — DOM rendering and event
// wiring for the "Deduplication" subsection of the Settings section (see
// dedup-config.ts for the pure draft/wire logic, the same
// <feature>.js/<feature>-ui.js split every other popup feature uses). Every
// function that touches state takes popup.ts's `bridge` as its first
// parameter, per Architecture Decision #13.
//
// State this module owns:
//   _state.deduplication — { enabled, keyFields, incremental, appendOutput,
//                            retentionKind, retentionValueText }
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, State } from '../types/popup';
import { t } from '../i18n/i18n';
import { collectFieldNames } from './scraping-config-builder';
import { addKeyField, removeKeyField, setRetentionKind } from './dedup-config';
import { autoOpenAdvanced } from './advanced-disclosure-ui';
import { dedupRetentionDiffers } from './advanced-defaults';
import { byIdOrNull, escapeHtml } from './dom';

function patchDedup(bridge: PopupBridge, patch: Partial<SFDraft.DeduplicationState>): void {
  const state = bridge.getState();
  bridge.setState(state.current, { deduplication: { ...state.deduplication, ...patch } });
}

export function renderDedupSection(bridge: PopupBridge): void {
  const state = bridge.getState();
  const dedup = state.deduplication;

  // Not offered for Combined/Blocks: neither has a single field/tree
  // config of its own at the outer level to deduplicate (a component's own
  // config could, but is configured elsewhere) — the companion rejects
  // the combination outright.
  byIdOrNull('dedup-section')?.classList.toggle('hidden', state.mode === 'combined' || state.mode === 'blocks');

  const toggle = byIdOrNull<HTMLInputElement>('toggle-dedup');
  if (toggle) toggle.checked = dedup.enabled;
  byIdOrNull('dedup-config')?.classList.toggle('hidden', !dedup.enabled);

  renderKeyFieldList(state, dedup);

  const incremental = byIdOrNull<HTMLInputElement>('toggle-dedup-incremental');
  if (incremental) incremental.checked = dedup.incremental;
  byIdOrNull('dedup-incremental-config')?.classList.toggle('hidden', !dedup.incremental);

  byIdOrNull('btn-dedup-output-delta')?.classList.toggle('active', !dedup.appendOutput);
  byIdOrNull('btn-dedup-output-append')?.classList.toggle('active', dedup.appendOutput);

  const kindSelect = byIdOrNull<HTMLSelectElement>('select-dedup-retention-kind');
  if (kindSelect && document.activeElement !== kindSelect) kindSelect.value = dedup.retentionKind;
  const valueInput = byIdOrNull<HTMLInputElement>('input-dedup-retention-value');
  if (valueInput && document.activeElement !== valueInput) valueInput.value = dedup.retentionValueText;
  autoOpenAdvanced(kindSelect, dedupRetentionDiffers(dedup)); // Issue #407
}

// One row per chosen key field plus a shared <select>/button pair to add a
// new one, filtered to exclude names already chosen — the same shape the
// required-fields hardening list uses. A chosen name that has since
// dropped out of the current field list stays visible (marked) instead of
// vanishing silently; buildDeduplicationConfig leaves it out of the request.
function renderKeyFieldList(state: State, dedup: SFDraft.DeduplicationState): void {
  const available = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
  const list = byIdOrNull('dedup-key-fields-list');
  if (list) {
    list.innerHTML = '';
    dedup.keyFields.forEach((name, i) => {
      const missing = !available.includes(name);
      const rowEl = document.createElement('div');
      rowEl.className = 'hardening-required-field-row';
      rowEl.innerHTML =
        `<span class="hardening-required-field-name">${escapeHtml(name)}${missing ? ` <em>(${escapeHtml(t('idle.dedupKeyFieldMissing'))})</em>` : ''}</span>` +
        `<button type="button" class="btn-danger btn-tiny btn-remove-dedup-key-field" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
      list.appendChild(rowEl);
    });
  }

  const addable = available.filter(name => !dedup.keyFields.includes(name));
  const select = byIdOrNull<HTMLSelectElement>('select-dedup-key-field');
  if (select) {
    select.innerHTML = addable.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    select.disabled = addable.length === 0;
  }
  const addBtn = byIdOrNull<HTMLButtonElement>('btn-add-dedup-key-field');
  if (addBtn) addBtn.disabled = addable.length === 0;
}

export function wireDedupEvents(bridge: PopupBridge): void {
  byIdOrNull('toggle-dedup')?.addEventListener('change', (e) => {
    patchDedup(bridge, { enabled: (e.target as HTMLInputElement).checked });
  });
  byIdOrNull('btn-add-dedup-key-field')?.addEventListener('click', () => {
    const select = byIdOrNull<HTMLSelectElement>('select-dedup-key-field');
    const name = select?.value;
    if (!name) return;
    const next = addKeyField(bridge.getState().deduplication, name);
    patchDedup(bridge, { keyFields: next.keyFields });
  });
  byIdOrNull('dedup-key-fields-list')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.btn-remove-dedup-key-field');
    if (!btn) return;
    const next = removeKeyField(bridge.getState().deduplication, Number(btn.getAttribute('data-index')));
    patchDedup(bridge, { keyFields: next.keyFields });
  });
  byIdOrNull('toggle-dedup-incremental')?.addEventListener('change', (e) => {
    patchDedup(bridge, { incremental: (e.target as HTMLInputElement).checked });
  });
  byIdOrNull('btn-dedup-output-delta')?.addEventListener('click', () => patchDedup(bridge, { appendOutput: false }));
  byIdOrNull('btn-dedup-output-append')?.addEventListener('click', () => patchDedup(bridge, { appendOutput: true }));
  byIdOrNull('select-dedup-retention-kind')?.addEventListener('change', (e) => {
    const next = setRetentionKind(bridge.getState().deduplication, (e.target as HTMLSelectElement).value === 'MaxAge' ? 'MaxAge' : 'MaxCount');
    patchDedup(bridge, { retentionKind: next.retentionKind, retentionValueText: next.retentionValueText });
  });
  byIdOrNull('input-dedup-retention-value')?.addEventListener('input', (e) => {
    patchDedup(bridge, { retentionValueText: (e.target as HTMLInputElement).value });
  });
}
