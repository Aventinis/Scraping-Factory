// @ts-check
// Issue #399: the "Recommended checks" preset of the Monitoring section — one
// click for people who don't want to understand all five hardening checks. Pure
// state logic; the button and its message are wired in settings-panel-ui.js.
//
// What it switches on, deliberately small and low-risk:
//   - "empty result" as a warning — the script finished but found nothing, the
//     classic "the site changed its layout" case; costs nothing and drops nothing;
//   - "required field" for the FIRST field — a row without it is dropped from the
//     output, so it is only suggested for the first field (usually the name or ID
//     that makes a row meaningful), never for all of them (that would silently drop
//     rows whose optional fields are legitimately empty), and only as a warning.
// A check the user has already switched on — or already configured fields for —
// is left exactly as it is; the preset only ever adds.

/**
 * @typedef {{ noResult: boolean, requiredField: string | null }} RecommendedApplied
 */

/**
 * @param {SFDraft.HardeningState} hardening
 * @param {string[]} fieldNames the fields of the current configuration, in order
 * @returns {{ hardening: SFDraft.HardeningState, applied: RecommendedApplied, needsFields: boolean }}
 *   `needsFields`: the required-field suggestion could not be made because there
 *   are no fields yet
 */
function applyRecommendedHardening(hardening, fieldNames) {
  const next = { ...hardening };
  /** @type {RecommendedApplied} */
  const applied = { noResult: false, requiredField: null };
  let needsFields = false;

  if (!hardening.noResult.enabled) {
    next.noResult = { ...hardening.noResult, enabled: true, severity: 'Warning' };
    applied.noResult = true;
  }

  const required = hardening.requiredFields;
  if (!required.enabled && required.fields.length === 0) {
    const [first] = fieldNames;
    if (first) {
      next.requiredFields = { ...required, enabled: true, severity: 'Warning', fields: [first] };
      applied.requiredField = first;
    } else {
      needsFields = true;
    }
  }

  return { hardening: next, applied, needsFields };
}

module.exports = { applyRecommendedHardening };
