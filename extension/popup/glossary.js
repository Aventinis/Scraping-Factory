// @ts-check
// Issue #407: the Settings screen's glossary — one plain sentence for each term
// the UI keeps (or renamed). Every explanation is an existing help popover
// text (help.<area>.<field>), so there is one place to reword it and the
// popover next to the option and the glossary can never disagree.
const { getHelpEntry } = require('./help-popover');

/** @type {ReadonlyArray<{ termKey: string, helpKey: string }>} */
const GLOSSARY_ENTRIES = [
  { termKey: 'idle.outputBlueprintLabel', helpKey: 'help.outputLayout.overview' },
  { termKey: 'glossary.safetyChecks', helpKey: 'help.safetyChecks.overview' },
  { termKey: 'idle.preflightToggle', helpKey: 'help.preflight.overview' },
  { termKey: 'idle.dedupToggle', helpKey: 'help.dedup.overview' },
  { termKey: 'apiConfig.sourceKindDiscovery', helpKey: 'help.apiConfig.sourceDiscovery' },
  { termKey: 'apiConfig.sourceKindBrowserDiscovery', helpKey: 'help.apiConfig.sourceBrowserDiscovery' },
  { termKey: 'envVar.whatLabel', helpKey: 'help.envVar.what' },
];

/**
 * @param {(key: string) => string} t
 * @returns {Array<{ term: string, text: string, example: string | null }>}
 *   entries whose texts are missing in the active language are left out
 */
function buildGlossary(t) {
  /** @type {Array<{ term: string, text: string, example: string | null }>} */
  const out = [];
  for (const { termKey, helpKey } of GLOSSARY_ENTRIES) {
    const term = t(termKey);
    const entry = getHelpEntry(t, helpKey);
    if (!term || term === termKey || !entry) continue;
    out.push({ term, text: entry.text, example: entry.example });
  }
  return out;
}

module.exports = { GLOSSARY_ENTRIES, buildGlossary };
