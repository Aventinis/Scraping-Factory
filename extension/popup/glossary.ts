// The Settings screen's glossary: one plain sentence per term. Every explanation is an existing help popover text
// (help.<area>.<field>), so the popover next to an option and the glossary cannot disagree.
import { getHelpEntry } from './help-popover';

interface GlossaryEntry { termKey: string; helpKey: string }
export interface GlossaryItem { term: string; text: string; example: string | null }

export const GLOSSARY_ENTRIES: ReadonlyArray<GlossaryEntry> = [
  { termKey: 'idle.outputBlueprintLabel', helpKey: 'help.outputLayout.overview' },
  { termKey: 'glossary.safetyChecks', helpKey: 'help.safetyChecks.overview' },
  { termKey: 'idle.preflightToggle', helpKey: 'help.preflight.overview' },
  { termKey: 'idle.dedupToggle', helpKey: 'help.dedup.overview' },
  { termKey: 'apiConfig.sourceKindDiscovery', helpKey: 'help.apiConfig.sourceDiscovery' },
  { termKey: 'apiConfig.sourceKindBrowserDiscovery', helpKey: 'help.apiConfig.sourceBrowserDiscovery' },
  { termKey: 'envVar.whatLabel', helpKey: 'help.envVar.what' },
];

/** Entries whose texts are missing in the active language are left out. */
export function buildGlossary(t: (key: string) => string): GlossaryItem[] {
  const out: GlossaryItem[] = [];
  for (const { termKey, helpKey } of GLOSSARY_ENTRIES) {
    const term = t(termKey);
    const entry = getHelpEntry(t, helpKey);
    if (!term || term === termKey || !entry) continue;
    out.push({ term, text: entry.text, example: entry.example });
  }
  return out;
}
