// Issue #396: DOM rendering + wiring of the reusable help popover (pure
// logic in help-popover.js). Every `[data-help]` host element gets a "?"
// button; its explanation lives in a panel inserted right after the host's
// row (not a floating overlay: in a 280 px side panel an in-flow block is the
// one placement that can never run off-screen). Needs no `bridge` — it owns
// no popup state, only the DOM it renders.
//
// Behavior:
//   - Enter/Space (native button), click → toggle; Escape closes and puts
//     focus back on the button; a click anywhere else closes; only one
//     popover is open at a time.
//   - aria-expanded + aria-controls + aria-describedby on the button.
//   - The button preventDefaults its click: a host inside a checkbox's
//     <label> (the common case — "? " next to the toggle text) would
//     otherwise toggle the checkbox too.
//   - initHelpPopovers() is idempotent and re-run on a language change, so
//     the texts follow the language while an open panel stays open.
//
// Where the panel goes: after the host's closest `[data-help-anchor]`, else
// its closest <label>, else the host itself.
const { t } = require('../i18n/i18n');
const { getHelpEntry, isValidHelpKey, nextOpenHelpId } = require('./help-popover');

let nextUid = 0;
let wired = false;

function panelFor(button) {
  const id = button.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

function openButton() {
  return /** @type {HTMLElement | null} */ (document.querySelector('.help-btn[aria-expanded="true"]'));
}

function setOpen(button, open) {
  button.setAttribute('aria-expanded', String(open));
  panelFor(button)?.classList.toggle('hidden', !open);
}

function closeAll() {
  document.querySelectorAll('.help-btn[aria-expanded="true"]').forEach((b) => setOpen(b, false));
}

function fillPanel(panel, entry, key) {
  const text = panel.querySelector('.help-popover-text');
  const example = panel.querySelector('.help-popover-example');
  if (text) text.textContent = entry ? entry.text : key;
  if (example) {
    example.textContent = entry && entry.example ? entry.example : '';
    example.classList.toggle('hidden', !(entry && entry.example));
  }
}

function buildHost(host, key) {
  const uid = String(++nextUid);
  host.dataset.helpUid = uid;
  const panelId = `help-popover-${uid}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-btn';
  button.textContent = '?';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panelId);
  button.setAttribute('aria-describedby', panelId);
  host.appendChild(button);

  // Inside a list the panel is a list item too (e.g. the transform editor's rows).
  const anchor = host.closest('[data-help-anchor]') || host.closest('label') || host;
  const panel = document.createElement(anchor.parentElement && /^(UL|OL)$/.test(anchor.parentElement.tagName) ? 'li' : 'div');
  panel.id = panelId;
  panel.className = 'help-popover hidden';
  panel.setAttribute('role', 'note');
  const text = document.createElement('p');
  text.className = 'help-popover-text';
  const example = document.createElement('code');
  example.className = 'help-popover-example hidden';
  panel.append(text, example);

  anchor.insertAdjacentElement('afterend', panel);
  return { button, panel };
}

/**
 * Builds (once) and translates every help host under `root`.
 * @param {ParentNode} [root]
 */
function initHelpPopovers(root = document) {
  root.querySelectorAll('[data-help]').forEach((el) => {
    const host = /** @type {HTMLElement} */ (el);
    const key = host.dataset.help || '';
    if (!isValidHelpKey(key)) return;
    let button = /** @type {HTMLElement | null} */ (host.querySelector('.help-btn'));
    let panel = button ? panelFor(button) : null;
    if (!button || !panel) ({ button, panel } = buildHost(host, key));
    const label = t('common.helpBtn');
    button.setAttribute('aria-label', label);
    button.title = label;
    fillPanel(panel, getHelpEntry(t, key), key);
  });
}

// Delegated on document so DOM added later (modals, re-rendered rows)
// works without per-element listeners; wired once.
function wireHelpPopoverEvents() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', (e) => {
    const target = /** @type {Element} */ (e.target);
    const button = target.closest && target.closest('.help-btn');
    if (button) {
      e.preventDefault();
      const current = openButton();
      const requested = button.getAttribute('aria-controls') || '';
      const next = nextOpenHelpId(current ? current.getAttribute('aria-controls') : null, requested);
      closeAll();
      if (next) setOpen(button, true);
      return;
    }
    if (!(target.closest && target.closest('.help-popover'))) closeAll();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = openButton();
    if (!open) return;
    setOpen(open, false);
    open.focus();
    e.stopPropagation();
  });
}

module.exports = { initHelpPopovers, wireHelpPopoverEvents };

