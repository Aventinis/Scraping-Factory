// Issue #397: the shared UI half of "type the name of an environment variable".
// Every such input carries `data-env-var`; this module gives all of them the same
// inline validation (a human message right under the input, `aria-invalid`, a red
// border) and every feature the same "What is an environment variable?" line with
// the one shared help popover (`help.envVar.what`) — so none of the seven places
// has its own copy of the label, the popover or the check. Logic (what is valid) is
// in env-var.js.
//
//   - static inputs (idle.html): mark with `data-env-var`;
//   - inputs built in JS: add `data-env-var` to the input and put envVarNoteHtml()
//     where the explanation line should go;
//   - popup.js's render() calls refreshEnvVarValidation() at its end (dynamic rows
//     are rebuilt on every render, the message with them) and wires the live check
//     once with wireEnvVarValidation().
const { t } = require('../i18n/i18n');
const { validateEnvVarName } = require('./env-var');
const { helpHostHtml } = require('./help-popover');

const ERROR_CLASS = 'env-var-error';

/**
 * The "What is an environment variable?" line with its "?" popover. The row is the
 * popover's anchor, so the panel opens right below it instead of inside a flex row.
 */
function envVarNoteHtml() {
  return `<p class="env-var-note" data-help-anchor><span>${t('envVar.whatLabel')}</span>${helpHostHtml('help.envVar.what')}</p>`;
}

// Where the message goes: right after the input's own row (a message inside a
// flex row of several inputs would be squeezed between them). In a <ul>/<ol> the
// message is an <li>.
function messageSlot(input) {
  const row = input.closest('[data-env-var-row], .output-settings-row, .browser-action-field-row, .request-header-row, li') || input.parentElement;
  return row;
}

function existingMessage(row) {
  const next = row.nextElementSibling;
  return next && next.classList.contains(ERROR_CLASS) ? next : null;
}

/**
 * Validates one input and shows or clears its message.
 * @param {HTMLInputElement} input
 */
function applyEnvVarValidation(input) {
  const result = validateEnvVarName(input.value);
  const row = messageSlot(input);
  if (!row) return;
  let message = existingMessage(row);

  if (result.ok) {
    input.classList.remove('env-var-invalid');
    input.removeAttribute('aria-invalid');
    if (message) message.remove();
    return;
  }

  input.classList.add('env-var-invalid');
  input.setAttribute('aria-invalid', 'true');
  if (!message) {
    message = document.createElement(row.parentElement && /^(UL|OL)$/.test(row.parentElement.tagName) ? 'li' : 'p');
    message.className = ERROR_CLASS;
    message.setAttribute('role', 'alert');
    row.insertAdjacentElement('afterend', message);
  }
  message.textContent = t(`envVar.${result.reason}`, { name: input.value.trim() });
}

/** Re-checks every env-var input on the page (after a render rebuilt some of them). */
function refreshEnvVarValidation() {
  document.querySelectorAll('input[data-env-var]').forEach((el) => applyEnvVarValidation(/** @type {HTMLInputElement} */ (el)));
}

let wired = false;

// Live check while typing, delegated on the document so it covers inputs that are
// rebuilt later; wired once.
function wireEnvVarValidation() {
  if (wired) return;
  wired = true;
  document.addEventListener('input', (e) => {
    const target = /** @type {Element} */ (e.target);
    if (target && target.matches && target.matches('input[data-env-var]')) applyEnvVarValidation(/** @type {HTMLInputElement} */ (target));
  });
}

module.exports = { envVarNoteHtml, applyEnvVarValidation, refreshEnvVarValidation, wireEnvVarValidation };
