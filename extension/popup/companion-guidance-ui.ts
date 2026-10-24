// Issue #406: renders the structured explanation on the COMPANION_ERROR
// screen (logic in companion-guidance.ts). Called from popup.ts's render()
// next to renderCompanionErrorScreen(); needs no `bridge` — it only reads the
// last health-check failure and the persisted "reached" flag.
//
//   - first run (no companion has ever answered): the long form — what the
//     companion is, and the three situations (not installed / installed but not
//     running / another address) each with its concrete next step; the most
//     likely situation(s) for this particular failure carry a "Most likely" mark;
//   - afterwards: the one-line hint. Both forms keep the "Why can't it connect?"
//     popover (a #396 help host, see help.companionError.causes).
// Wording with a parameter (installer name) is set here, not via data-i18n,
// since applyStaticTranslations() passes no parameters.
import { t } from '../i18n/i18n';
import { DEFAULT_COMPANION_URL } from '../shared/companion-config';
import { getResolvedCompanionUrl, getCompanionFailure } from './companion-client';
import {
  detectPlatform, installerName, installCommand, installedProgramPath, likelySituations, isCompanionReached,
} from './companion-guidance';
import type { Situation } from './companion-guidance';
import { byIdOrNull } from './dom';

function setText(id: string, text: string): void {
  const el = byIdOrNull(id);
  if (el) el.textContent = text;
}

export function renderCompanionGuidance(): void {
  const platform = detectPlatform(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const longForm = !isCompanionReached();

  byIdOrNull('error-guidance-long')?.classList.toggle('hidden', !longForm);
  byIdOrNull('error-hint-short')?.classList.toggle('hidden', longForm);
  if (!longForm) return;

  setText('error-install-text', t('error.install.text', { installer: installerName(platform) }));
  setText('error-install-command', installCommand(platform));
  setText('error-start-text', t('error.start.text'));
  setText('error-start-path', installedProgramPath(platform));

  const failure = getCompanionFailure();
  const likely = likelySituations({
    url: getResolvedCompanionUrl(),
    defaultUrl: DEFAULT_COMPANION_URL,
    errorMessage: failure && failure.message,
  });
  const situations: Situation[] = ['install', 'start', 'address'];
  for (const situation of situations) {
    const el = byIdOrNull(`error-situation-${situation}`);
    if (!el) continue;
    const isLikely = likely.includes(situation);
    el.classList.toggle('likely', isLikely);
    el.querySelector('.error-likely')?.classList.toggle('hidden', !isLikely);
  }
}
