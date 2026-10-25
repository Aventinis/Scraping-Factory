// The default output file name (Issue #509): what a run uses when the "Output file name" field is left empty. Pure; the setting itself
// lives in shared/global-settings.ts and is never part of a saved configuration (see docs/design-notes/extension.md).
import { sanitizeFileNameBase } from './scraping-config-builder';

export interface OutputNameSettings {
  outputNameMode?: 'fixed' | 'script';
  outputNameFixed?: string;
}

// typed name → else the chosen default → else null (today's `output`). The default passes through the same sanitizing as a typed name,
// reserved names and an empty result included, so a stored "CON" or "!!!" ends up as the fallback instead of an invalid file name.
// `scriptFileName` is the script name the run uses (typed or default, see name-defaults.ts).
export function resolveOutputFileName(typed: string | null | undefined, scriptFileName: string, settings: OutputNameSettings): string | null {
  if (typed && typed.trim()) return typed;
  if (settings.outputNameMode === 'script') return sanitizeFileNameBase(scriptFileName, 'scraper');
  const fixed = (settings.outputNameFixed ?? '').trim();
  return fixed ? sanitizeFileNameBase(fixed, 'output') : null;
}
