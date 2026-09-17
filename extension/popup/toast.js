// ── Toast notifications + last-error tracking ──────────────────────────────
// Extracted from popup.js (popup.js had grown past 4000 lines — see
// CLAUDE.md's "Popup module boundaries" architecture decision). setLastError
// lives here (not in bug-report.js) because showToast itself calls it
// whenever a toast carries a `context` — bug-report.js only ever reads the
// result via getLastError(). IIFE-wrapped (same pattern as
// shared/logger.js/api-config-ui.js/etc.) so this file's own top-level
// names (e.g. `t`, `lastReportedError`) don't collide with another
// module's same-named locals when popup.html loads them as classic
// <script> tags sharing one global scope — see classic-script-loading.test.js.
const SFToast = (function() {
  const { t } =
    typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

  let lastReportedError = null; // { message, context, ts } — feeds the next bug report

  function getLastError() {
    return lastReportedError;
  }

  function setLastError(message, context) {
    lastReportedError = { message, context, ts: new Date().toISOString() };
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

    const reportBtn = document.getElementById('btn-report-bug-toast');
    if (reportBtn) reportBtn.classList.toggle('hidden', !context);
    if (context) setLastError(message, context);

    toast.classList.remove('toast-info', 'toast-warn');
    if (variant === 'info') toast.classList.add('toast-info');
    if (variant === 'warn') toast.classList.add('toast-warn');

    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), context ? 8000 : 4000);
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
  function showMatchCountToast(containerName, matchCount) {
    if (matchCount === null) return;
    showToast(t('toast.containerAdded', { name: containerName, count: matchCount }), null, matchCount === 0 ? 'warn' : 'info');
  }

  return { showToast, showMatchCountToast, getLastError, setLastError };
})();

if (typeof module !== 'undefined') module.exports = SFToast;
if (typeof self !== 'undefined') self.SFToast = SFToast;
