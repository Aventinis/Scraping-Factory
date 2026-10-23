// Issue #400: DOM side of the two transform-editor helpers (logic in
// transform-helpers.js) — the regex "Pattern helper" panel under a "Regex extract"
// row, and the date-format hint under a "Convert to date" row. Used by
// field-transforms-ui.js for all three modes' transform modals.
//
// The recipe panel is deliberately stateless as far as the transform is
// concerned: it holds the picked recipe and its text(s) in its own DOM, shows the
// result on the real picked value as the user types, and only on "Use this
// pattern" writes a pattern + group into the transform (like typing it by hand) —
// so the transform objects (sent to the companion as they are) never carry helper
// state, and typing in the panel doesn't re-render the list and steal the focus.
const { t } = require('../i18n/i18n');
const { helpHostHtml } = require('./help-popover');
const { RECIPES, buildRecipe, previewRecipe, inferDateFormat } = require('./transform-helpers');

const PANEL_CLASS = 'transform-helper-panel';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Regex rows ──────────────────────────────────────────────────────────────

/** The "Pattern helper" button and the "?" popover, appended to a Regex extract row. */
function appendRegexHelperControls(li) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary btn-tiny btn-transform-helper-toggle';
  button.textContent = t('transforms.helper.button');
  li.appendChild(button);
  li.setAttribute('data-help-anchor', '');
  li.insertAdjacentHTML('beforeend', helpHostHtml('help.transforms.regex'));
}

function recipeOptionsHtml() {
  return `<option value="">${escapeHtml(t('transforms.helper.recipePlaceholder'))}</option>` +
    RECIPES.map((recipe) => `<option value="${recipe.id}">${escapeHtml(t(`transforms.helper.recipe.${recipe.id}`))}</option>`).join('');
}

function argsHtml(recipeId) {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return '';
  if (recipe.choice) {
    return `<select class="transform-recipe-arg" aria-label="${escapeHtml(t('transforms.helper.bracketsLabel'))}">` +
      recipe.choice.map((open, i) => {
        const close = { '(': ')', '[': ']', '{': '}', '<': '>' }[open];
        return `<option value="${escapeHtml(open)}"${i === 0 ? ' selected' : ''}>${escapeHtml(open)} ${escapeHtml(close)}</option>`;
      }).join('') + '</select>';
  }
  const placeholders = {
    textAfter: ['transforms.helper.afterPlaceholder'],
    textBefore: ['transforms.helper.beforePlaceholder'],
    textBetween: ['transforms.helper.betweenStartPlaceholder', 'transforms.helper.betweenEndPlaceholder'],
  }[recipeId] || [];
  return placeholders.map((key) => `<input type="text" class="transform-recipe-arg" placeholder="${escapeHtml(t(key))}" autocomplete="off" />`).join('');
}

function panelHtml() {
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
function readPanel(panel) {
  const id = /** @type {HTMLSelectElement} */ (panel.querySelector('.transform-recipe-select')).value;
  const args = Array.from(panel.querySelectorAll('.transform-recipe-arg')).map((el) => /** @type {HTMLInputElement} */ (el).value);
  return { id, recipe: id ? buildRecipe(id, args) : null };
}

function refreshPanelPreview(panel, getRawValue) {
  const { id, recipe } = readPanel(panel);
  const previewEl = panel.querySelector('.transform-recipe-preview');
  const useBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('.btn-transform-recipe-use'));
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
function toggleRecipePanel(rowEl, getRawValue) {
  const existing = rowEl.nextElementSibling;
  if (existing && existing.classList.contains(PANEL_CLASS)) { existing.remove(); return; }
  const panel = document.createElement('li');
  panel.className = PANEL_CLASS;
  panel.dataset.index = rowEl.dataset.index;
  panel.innerHTML = panelHtml();
  rowEl.insertAdjacentElement('afterend', panel);
  refreshPanelPreview(panel, getRawValue);
  /** @type {HTMLElement} */ (panel.querySelector('.transform-recipe-select')).focus();
}

/**
 * Wires the panel's own events on the list root (delegated, so they survive the
 * list's re-renders). `applyPattern(index, { pattern, group })` writes into the
 * transform.
 */
function wireRecipePanels(root, getRawValue, applyPattern) {
  root.addEventListener('click', (e) => {
    const target = /** @type {Element} */ (e.target);
    const toggle = target.closest('.btn-transform-helper-toggle');
    if (toggle) { toggleRecipePanel(toggle.closest('.transform-row'), getRawValue); return; }
    const panel = target.closest(`.${PANEL_CLASS}`);
    if (!panel) return;
    if (target.closest('.btn-transform-recipe-cancel')) { panel.remove(); return; }
    if (target.closest('.btn-transform-recipe-use')) {
      const { recipe } = readPanel(panel);
      if (recipe) applyPattern(parseInt(/** @type {HTMLElement} */ (panel).dataset.index, 10), recipe);
    }
  });
  const onPanelEdit = (e) => {
    const target = /** @type {Element} */ (e.target);
    const panel = target.closest && target.closest(`.${PANEL_CLASS}`);
    if (!panel) return;
    if (target.classList.contains('transform-recipe-select')) {
      panel.querySelector('.transform-recipe-args').innerHTML = argsHtml(/** @type {HTMLSelectElement} */ (target).value);
      const firstArg = /** @type {HTMLElement | null} */ (panel.querySelector('.transform-recipe-arg'));
      if (firstArg) firstArg.focus();
    }
    refreshPanelPreview(panel, getRawValue);
  };
  root.addEventListener('input', onPanelEdit);
  root.addEventListener('change', onPanelEdit);
}

// ── Date rows ───────────────────────────────────────────────────────────────

/** The "?" popover next to the format input and the hint line below the row. */
function appendDateHelper(li, transform, getRawValue) {
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
 * @returns {{ sourceFormat: string } | null}
 */
function dateFormatPatchFor(rawValue) {
  const guess = inferDateFormat(rawValue);
  return guess ? { sourceFormat: guess.format } : null;
}

module.exports = { appendRegexHelperControls, wireRecipePanels, appendDateHelper, dateFormatPatchFor };
