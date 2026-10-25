// The two small pieces both field modals share: flat mode's modal-field-name and container mode's modal-field-extended show the same
// "N elements found" hint beside the name input and the same attribute picker, differing only in their element ids.
import { t } from '../i18n/i18n';
import { guessUrlAttribute } from './container-tree';
import { byIdOrNull, escapeHtml } from './dom';

// Match-count feedback next to the name input the instant a selector is picked. `count` is null before a pick or if the content script
// could not compute it; the hint stays hidden then.
export function renderMatchCountHint(elId: string, count: number | null | undefined): void {
  const el = byIdOrNull(elId);
  if (!el) return;
  if (count === null || count === undefined) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = t('modals.matchCount.found', { count });
  el.classList.toggle('warn', count === 0);
  el.classList.remove('hidden');
}

// Populates the attribute picker with the clicked element's own attributes ("name: value preview") instead of a free-text field: typing
// an HTML attribute name blind defeats a visual tool. guessUrlAttribute preselects the likeliest resource URL; every attribute stays
// pickable.
export function populateAttributeSelect(selectId: string, attributes: Record<string, string> | null | undefined): void {
  const select = byIdOrNull<HTMLSelectElement>(selectId);
  if (!select) return;
  const entries = Object.entries(attributes || {});
  if (entries.length === 0) {
    select.innerHTML = `<option value="">${escapeHtml(t('modals.fieldExtended.noAttributesFound'))}</option>`;
    return;
  }
  const guess = guessUrlAttribute(attributes);
  select.innerHTML = entries.map(([name, value]) => {
    const preview = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    const label = preview ? `${name}: ${preview}` : name;
    return `<option value="${escapeHtml(name)}"${name === guess ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}
