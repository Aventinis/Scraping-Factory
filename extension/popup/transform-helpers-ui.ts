// Issue #400: DOM side of the two transform-editor helpers (logic in
// transform-helpers.ts) — the regex "Pattern helper" panel under a "Regex extract"
// row, and the date-format hint under a "Convert to date" row. Used by
// field-transforms-ui.js for all three modes' transform modals.
//
// The recipe panel is deliberately stateless as far as the transform is
// concerned: it holds the picked recipe and its text(s) in its own DOM, shows the
// result on the real picked value as the user types, and only on "Use this
// pattern" writes a pattern + group into the transform (like typing it by hand) —
// so the transform objects (sent to the companion as they are) never carry helper
// state, and typing in the panel doesn't re-render the list and steal the focus.
import { t } from '../i18n/i18n';
import { helpHostHtml } from './help-popover';
import { RECIPES, buildRecipe, previewRecipe, inferDateFormat } from './transform-helpers';
import type { Recipe } from './transform-helpers';
import { escapeHtml } from './dom';

const PANEL_CLASS = 'transform-helper-panel';

/** Returns the picked value the transform chain runs on, or null when there is none (read lazily: the modal may change it). */
export type RawValueGetter = () => string | null;

// ── Regex rows ──────────────────────────────────────────────────────────────

/** The "Pattern helper" button and the "?" popover, appended to a Regex extract row. */
export function appendRegexHelperControls(li: HTMLElement): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary btn-tiny btn-transform-helper-toggle';
  button.textContent = t('transforms.helper.button');
  li.appendChild(button);
  li.setAttribute('data-help-anchor', '');
  li.insertAdjacentHTML('beforeend', helpHostHtml('help.transforms.regex'));
}

function recipeOptionsHtml(): string {
  return `<option value="">${escapeHtml(t('transforms.helper.recipePlaceholder'))}</option>` +
    RECIPES.map((recipe) => `<option value="${recipe.id}">${escapeHtml(t(`transforms.helper.recipe.${recipe.id}`))}</option>`).join('');
}

function argsHtml(recipeId: string): string {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return '';
  if (recipe.choice) {
    return `<select class="transform-recipe-arg" aria-label="${escapeHtml(t('transforms.helper.bracketsLabel'))}">` +
      recipe.choice.map((open, i) => {
        const close = ({ '(': ')', '[': ']', '{': '}', '<': '>' } as Record<string, string>)[open];
        return `<option value="${escapeHtml(open)}"${i === 0 ? ' selected' : ''}>${escapeHtml(open)} ${escapeHtml(close)}</option>`;
      }).join('') + '</select>';
  }
  const placeholders = ({
    textAfter: ['transforms.helper.afterPlaceholder'],
    textBefore: ['transforms.helper.beforePlaceholder'],
    textBetween: ['transforms.helper.betweenStartPlaceholder', 'transforms.helper.betweenEndPlaceholder'],
  } as Record<string, string[]>)[recipeId] || [];
  return placeholders.map((key) => `<input type="text" class="transform-recipe-arg" placeholder="${escapeHtml(t(key))}" autocomplete="off" />`).join('');
}

function panelHtml(): string {
  return `
    <select class="transform-recipe-select">${recipeOptionsHtml()}</select>
    <span class="transform-recipe-args"></span>
    <p class="transform-recipe-preview hidden"></p>
    <span class="transform-recipe-actions">
      <button type="button" class="btn-primary btn-tiny btn-transform-recipe-use" disabled>${escapeHtml(t('transforms.helper.use'))}</button>
      <button type="button" class="btn-secondary btn-tiny btn-transform-recipe-cancel">${escapeHtml(t('common.cancel'))}</button>
    </span>`;
}

/** What the panel currently describes: { recipe, args } read from its own DOM. */
function readPanel(panel: Element): { id: string; recipe: Recipe | null } {
  const id = (panel.querySelector('.transform-recipe-select') as HTMLSelectElement).value;
  const args = Array.from(panel.querySelectorAll<HTMLInputElement>('.transform-recipe-arg')).map((el) => el.value);
  return { id, recipe: id ? buildRecipe(id, args) : null };
}

function refreshPanelPreview(panel: Element, getRawValue: RawValueGetter): void {
  const { id, recipe } = readPanel(panel);
  const previewEl = panel.querySelector('.transform-recipe-preview') as HTMLElement;
  const useBtn = panel.querySelector('.btn-transform-recipe-use') as HTMLButtonElement;
  useBtn.disabled = !recipe;
  if (!id) { previewEl.classList.add('hidden'); return; }
  previewEl.classList.remove('hidden');
  previewEl.classList.remove('warn');
  if (!recipe) { previewEl.textContent = t('transforms.helper.needsText'); return; }
  const raw = getRawValue();
  if (raw === null || raw === undefined) { previewEl.textContent = t('transforms.helper.noValue'); return; }
  const result = previewRecipe(raw, recipe);
  if (result === null || result === '') {
    previewEl.classList.add('warn');
    previewEl.textContent = t('transforms.helper.noMatch');
  } else {
    previewEl.textContent = t('transforms.helper.result', { value: result.length > 120 ? `${result.slice(0, 120)}…` : result });
  }
}

/** Opens (or closes) the helper panel under a Regex extract row. */
function toggleRecipePanel(rowEl: HTMLElement, getRawValue: RawValueGetter): void {
  const existing = rowEl.nextElementSibling;
  if (existing && existing.classList.contains(PANEL_CLASS)) { existing.remove(); return; }
  const panel = document.createElement('li');
  panel.className = PANEL_CLASS;
  panel.dataset.index = rowEl.dataset.index as string;
  panel.innerHTML = panelHtml();
  rowEl.insertAdjacentElement('afterend', panel);
  refreshPanelPreview(panel, getRawValue);
  (panel.querySelector('.transform-recipe-select') as HTMLElement).focus();
}

/**
 * Wires the panel's own events on the list root (delegated, so they survive the
 * list's re-renders). `applyPattern(index, { pattern, group })` writes into the
 * transform.
 */
export function wireRecipePanels(root: HTMLElement, getRawValue: RawValueGetter, applyPattern: (index: number, recipe: Recipe) => void): void {
  root.addEventListener('click', (e) => {
    const target = e.target as Element;
    const toggle = target.closest('.btn-transform-helper-toggle');
    if (toggle) { toggleRecipePanel(toggle.closest('.transform-row') as HTMLElement, getRawValue); return; }
    const panel = target.closest(`.${PANEL_CLASS}`);
    if (!panel) return;
    if (target.closest('.btn-transform-recipe-cancel')) { panel.remove(); return; }
    if (target.closest('.btn-transform-recipe-use')) {
      const { recipe } = readPanel(panel);
      if (recipe) applyPattern(parseInt((panel as HTMLElement).dataset.index as string, 10), recipe);
    }
  });
  const onPanelEdit = (e: Event) => {
    const target = e.target as Element;
    const panel = target.closest && target.closest(`.${PANEL_CLASS}`);
    if (!panel) return;
    if (target.classList.contains('transform-recipe-select')) {
      (panel.querySelector('.transform-recipe-args') as HTMLElement).innerHTML = argsHtml((target as HTMLSelectElement).value);
      const firstArg = panel.querySelector<HTMLElement>('.transform-recipe-arg');
      if (firstArg) firstArg.focus();
    }
    refreshPanelPreview(panel, getRawValue);
  };
  root.addEventListener('input', onPanelEdit);
  root.addEventListener('change', onPanelEdit);
}

// ── Date rows ───────────────────────────────────────────────────────────────

/** The "?" popover next to the format input and the hint line below the row. */
export function appendDateHelper(li: HTMLElement, transform: { sourceFormat?: string | null }, getRawValue: RawValueGetter): void {
  li.setAttribute('data-help-anchor', '');
  li.insertAdjacentHTML('beforeend', helpHostHtml('help.transforms.dateFormat'));
  const raw = getRawValue();
  if (raw === null || raw === undefined || String(raw).trim() === '') return;
  const guess = inferDateFormat(raw);
  const hint = document.createElement('p');
  hint.className = 'transform-date-hint';
  if (guess && guess.format === transform.sourceFormat) {
    hint.textContent = guess.alternatives.length
      ? t('transforms.helper.dateDetectedAmbiguous', { format: guess.format, alternative: guess.alternatives[0] })
      : t('transforms.helper.dateDetected', { format: guess.format });
  } else if (guess) {
    hint.textContent = t('transforms.helper.dateLooksLike', { format: guess.format });
  } else {
    hint.textContent = t('transforms.helper.dateNoGuess');
  }
  li.appendChild(hint);
}

/**
 * Selecting "Convert to date" pre-selects the format guessed from the picked
 * value; when there is no guess the default stays.
 */
export function dateFormatPatchFor(rawValue: string | null | undefined): { sourceFormat: string } | null {
  const guess = inferDateFormat(rawValue);
  return guess ? { sourceFormat: guess.format } : null;
}
