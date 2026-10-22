// Issue #406: renders the structured explanation on the COMPANION_ERROR
// screen (logic in companion-guidance.js). Called from popup.js's render()
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
const { t } = require('../i18n/i18n');
const { DEFAULT_COMPANION_URL } = require('../shared/companion-config');
const { getResolvedCompanionUrl, getCompanionFailure } = require('./companion-client');
const {
  detectPlatform, installerName, installCommand, installedProgramPath, likelySituations, isCompanionReached,
} = require('./companion-guidance');

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderCompanionGuidance() {
  const platform = detectPlatform(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const longForm = !isCompanionReached();

  document.getElementById('error-guidance-long')?.classList.toggle('hidden', !longForm);
  document.getElementById('error-hint-short')?.classList.toggle('hidden', longForm);
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
  for (const situation of ['install', 'start', 'address']) {
    const el = document.getElementById(`error-situation-${situation}`);
    if (!el) continue;
    const isLikely = likely.includes(situation);
    el.classList.toggle('likely', isLikely);
    el.querySelector('.error-likely')?.classList.toggle('hidden', !isLikely);
  }
}

module.exports = { renderCompanionGuidance };
