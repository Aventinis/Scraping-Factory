// Custom i18n for the popup UI — plain JSON dictionaries per language,
// picked by an in-popup selector rather than chrome.i18n's _locales system
// (which is tied to the browser's own UI language and can't be switched
// from inside the extension the way a picker needs).

import de from './de.json';
import en from './en.json';
import es from './es.json';

export type Language = 'de' | 'en' | 'es';
export const SUPPORTED_LANGUAGES: Language[] = ['de', 'en', 'es'];
export const FALLBACK_LANGUAGE: Language = 'en';
const STORAGE_KEY = 'language';

// Looked up by dotted key; the JSON files are plain nested objects of strings.
type Dictionary = { readonly [key: string]: unknown };

// The three dictionaries are imported statically, so the bundler inlines them
// into the popup bundle and Jest loads them the same way — one mechanism for
// both, and no network round trip at startup.
const DICTIONARIES: Record<string, Dictionary> = { de, en, es };

function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

export function detectDefaultLanguage(navigatorLanguage: unknown): Language {
  const lang = String(navigatorLanguage || '').slice(0, 2).toLowerCase();
  return isLanguage(lang) ? lang : FALLBACK_LANGUAGE;
}

async function loadDictionary(lang: string): Promise<Dictionary> {
  return DICTIONARIES[lang] || DICTIONARIES[FALLBACK_LANGUAGE];
}

// chrome.storage.local (not .session, unlike the rest of the popup's state)
// — a language choice is a long-lived device preference that should
// survive a browser restart, not just a popup close/reopen.
async function getStoredLanguage(): Promise<Language | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return isLanguage(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : null;
  } catch {
    return null;
  }
}

async function persistLanguage(lang: Language): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: lang });
  } catch {
    // Best-effort — a failed write just means the choice won't survive a restart.
  }
}

let currentLanguage: Language = FALLBACK_LANGUAGE;
let currentDictionary: Dictionary | null = null;

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (obj, part) => (obj && typeof obj === 'object' ? (obj as Dictionary)[part] : undefined),
    currentDictionary,
  );
}

function interpolate(str: string, params?: Record<string, unknown>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match));
}

// A missing key resolves to the key itself, so a gap in a dictionary
// shows up as an obviously-wrong string in the UI instead of blank text
// or a thrown error.
export function t(key: string, params?: Record<string, unknown>): string {
  const value = lookup(key);
  return typeof value === 'string' ? interpolate(value, params) : key;
}

export async function initI18n(navigatorLanguage?: unknown): Promise<Language> {
  const stored = await getStoredLanguage();
  currentLanguage = stored || detectDefaultLanguage(navigatorLanguage);
  currentDictionary = await loadDictionary(currentLanguage);
  return currentLanguage;
}

export async function setLanguage(lang: string): Promise<Language> {
  if (!isLanguage(lang)) return currentLanguage;
  currentDictionary = await loadDictionary(lang);
  currentLanguage = lang;
  await persistLanguage(lang);
  return currentLanguage;
}

export function getLanguage(): Language {
  return currentLanguage;
}

