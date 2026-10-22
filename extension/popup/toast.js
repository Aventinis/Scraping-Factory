// ── Toast notifications + last-error tracking ──────────────────────────────
// Extracted from popup.js (popup.js had grown past 4000 lines — see
// CLAUDE.md's "Popup module boundaries" architecture decision). setLastError
// lives here (not in bug-report.js) because showToast itself calls it
// whenever a toast carries a `context` — bug-report.js only ever reads the
// result via getLastError().
const { t } = require('../i18n/i18n');
const { containerCountAdvice } = require('./choice-guidance');

let lastReportedError = null; // { message, context, ts } — feeds the next bug report

function getLastError() {
  return lastReportedError;
}

function setLastError(message, context) {
  lastReportedError = { message, context, ts: new Date().toISOString() };
}

let hideTimer = null;

function scheduleHide(toast, delayMs) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = delayMs === null ? null : setTimeout(() => toast.classList.add('hidden'), delayMs);
}

// Back to the plain message-only shape a non-error-toast caller expects: the
// Issue #401 parts (hint, details, close button) only exist for showErrorToast.
function resetErrorToastParts() {
  document.getElementById('error-toast-hint')?.classList.add('hidden');
  const details = document.getElementById('error-toast-details');
  if (details) { details.classList.add('hidden'); details.open = false; }
  document.getElementById('btn-toast-close')?.classList.add('hidden');
}

// `context` is a short human label (e.g. "Script generation"); passing it
// marks the error as reportable — the toast then also offers "Report bug"
// and the message/context are attached to the next bug report.
// `variant` ('info' | 'warn') is Issue #85's own non-error use of this same
// toast (container-group match-count feedback, see showMatchCountToast) —
// omitted, it's the original red error styling, unchanged.
function showToast(message, context, variant) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;

  const msgEl = document.getElementById('error-toast-message');
  if (msgEl) msgEl.textContent = message; else toast.textContent = message;
  resetErrorToastParts();

  const reportBtn = document.getElementById('btn-report-bug-toast');
  if (reportBtn) reportBtn.classList.toggle('hidden', !context);
  if (context) setLastError(message, context);

  toast.classList.remove('toast-info', 'toast-warn');
  if (variant === 'info') toast.classList.add('toast-info');
  if (variant === 'warn') toast.classList.add('toast-warn');

  toast.classList.remove('hidden');
  scheduleHide(toast, context ? 8000 : 4000);
}

// Issue #401: a failure the plain-language mapping recognised (error-messages.js)
// — the title and hint say what happened and what to try, the companion's/script's
// original text stays available behind "Details" (copyable) and is what "Report
// bug" sends. Such a toast stays until closed: "Details" is useless on a toast
// that disappears after eight seconds. `context` null = no "Report bug" (a
// configuration problem, not a defect), as for showToast.
function showErrorToast({ title, hint, details }, context) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;

  const msgEl = document.getElementById('error-toast-message');
  if (msgEl) msgEl.textContent = title;
  const hintEl = document.getElementById('error-toast-hint');
  if (hintEl) { hintEl.textContent = hint; hintEl.classList.toggle('hidden', !hint); }
  const detailsEl = /** @type {HTMLDetailsElement | null} */ (document.getElementById('error-toast-details'));
  if (detailsEl) {
    const textEl = document.getElementById('error-toast-details-text');
    if (textEl) textEl.textContent = details;
    detailsEl.open = false;
    detailsEl.classList.toggle('hidden', !details);
  }
  document.getElementById('btn-toast-close')?.classList.remove('hidden');

  const reportBtn = document.getElementById('btn-report-bug-toast');
  if (reportBtn) reportBtn.classList.toggle('hidden', !context);
  if (context) setLastError(details || title, context);

  toast.classList.remove('toast-info', 'toast-warn');
  toast.classList.remove('hidden');
  scheduleHide(toast, null);
}

function hideToast() {
  const toast = document.getElementById('error-toast');
  if (toast) toast.classList.add('hidden');
  scheduleHide(toast, null);
}

// Wired once from popup.js's wireEvents(): the close and copy buttons of the
// plain-language error toast.
function wireErrorToastEvents() {
  document.getElementById('btn-toast-close')?.addEventListener('click', hideToast);
  document.getElementById('btn-toast-copy-details')?.addEventListener('click', async (e) => {
    const button = /** @type {HTMLElement} */ (e.currentTarget);
    const text = document.getElementById('error-toast-details-text')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = t('errors.copied');
      setTimeout(() => { button.textContent = original; }, 1500);
    } catch {
      // Clipboard unavailable — the text is selectable in the details box.
    }
  });
}

// Issue #85: existence/quantity feedback for a container-group's own
// selector, right after it was inserted straight into the tree (see the
// ELEMENT_SELECTED handler in popup.js) — the direct-insert flow has no
// confirmation modal to show a match-count hint in the way
// renderMatchCountHint does for a flat/container field pick, so a toast is
// the next best surfacing. Amber for a 0-match pick (the exact case this
// issue exists to catch early, instead of only failing much later at
// /generate), green otherwise. Silently skipped if the content script
// couldn't compute a count at all (matchCount === null).
//
// Issue #398: `repeating` is the type chosen beforehand in modal-container-new
// — when the count contradicts it (several matches for a "single" container,
// one match for a "repeating" one) the toast says so instead of just counting,
// since the type is asked before the element is picked and so can't show the
// count next to the choice. Omitted → the plain count, as before.
function showMatchCountToast(containerName, matchCount, repeating) {
  if (matchCount === null) return;
  const advice = containerCountAdvice(matchCount, repeating);
  if (advice === 'singleMany') {
    showToast(t('toast.containerSingleMany', { name: containerName, count: matchCount }), null, 'warn');
    return;
  }
  if (advice === 'repeatingOne') {
    showToast(t('toast.containerRepeatingOne', { name: containerName }), null, 'info');
    return;
  }
  showToast(t('toast.containerAdded', { name: containerName, count: matchCount }), null, matchCount === 0 ? 'warn' : 'info');
}

module.exports = { showToast, showErrorToast, hideToast, wireErrorToastEvents, showMatchCountToast, getLastError, setLastError };

