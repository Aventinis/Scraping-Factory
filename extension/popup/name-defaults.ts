// The script and output file names (Issues #510, #509): both fields stay empty until the user types, and the default is shown as the
// placeholder and applied when a request is built. Pure; the settings are shared/global-settings.ts.
import { deriveScriptFileNameFromHostname, sanitizeFileNameBase } from './scraping-config-builder';

export interface NameDefaultSettings {
  scriptNameMode?: 'fixed' | 'hostname';
  scriptNameFixed?: string;
  outputNameMode?: 'fixed' | 'script';
  outputNameFixed?: string;
}

// The script name used while the field is empty: the current site's host name ("From website"), else the fixed name; `scraper` when
// that comes out empty.
export function defaultScriptName(url: string, settings: NameDefaultSettings): string {
  const fixed = sanitizeFileNameBase(settings.scriptNameFixed ?? '', 'scraper');
  return settings.scriptNameMode === 'hostname' ? deriveScriptFileNameFromHostname(url, fixed) : fixed;
}

// A typed name wins and is kept as typed (the companion sanitizes it); an empty field resolves to the default.
export function resolveScriptFileName(typed: string | null | undefined, url: string, settings: NameDefaultSettings): string {
  return typed && typed.trim() ? typed : defaultScriptName(url, settings);
}

// The base name of the script file that results, sanitized like the companion does (the download and its label use it).
export function scriptFileBase(typed: string | null | undefined, url: string, settings: NameDefaultSettings): string {
  return sanitizeFileNameBase(resolveScriptFileName(typed, url, settings), 'scraper');
}

// The output file name used while its field is empty: "same as the script name" follows the script name (typed or default), a custom
// name is sanitized like a typed one, and `output` is today's behavior.
export function defaultOutputName(typedScriptName: string | null | undefined, url: string, settings: NameDefaultSettings): string {
  if (settings.outputNameMode === 'script') return scriptFileBase(typedScriptName, url, settings);
  const fixed = (settings.outputNameFixed ?? '').trim();
  return fixed ? sanitizeFileNameBase(fixed, 'output') : 'output';
}
