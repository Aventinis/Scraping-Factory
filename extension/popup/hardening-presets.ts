// The "Recommended checks" preset of the Monitoring section: one click for people who do not want to understand all five
// hardening checks. Pure state logic; the button and its message are wired in settings-panel-ui.js.
//
// It switches on, deliberately small and low-risk:
//   - "empty result" as a warning: the script finished but found nothing, the classic "the site changed its layout" case;
//   - "required field" for the FIRST field only, as a warning: a row without it is dropped from the output, so it is suggested
//     for the field that usually makes a row meaningful (name or ID), never for all (that would silently drop rows whose optional
//     fields are legitimately empty).
// A check the user already switched on, or already configured fields for, stays exactly as it is: the preset only ever adds.

export interface RecommendedApplied { noResult: boolean; requiredField: string | null }

export interface RecommendedHardening {
  hardening: SFDraft.HardeningState;
  applied: RecommendedApplied;
  /** The required-field suggestion could not be made because there are no fields yet. */
  needsFields: boolean;
}

/** `fieldNames` are the fields of the current configuration, in order. */
export function applyRecommendedHardening(hardening: SFDraft.HardeningState, fieldNames: string[]): RecommendedHardening {
  const next = { ...hardening };
  const applied: RecommendedApplied = { noResult: false, requiredField: null };
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
