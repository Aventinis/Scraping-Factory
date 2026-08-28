// Custom i18n for the popup UI — plain JSON dictionaries per language,
// picked by an in-popup selector rather than chrome.i18n's _locales system
// (which is tied to the browser's own UI language and can't be switched
// from inside the extension the way a picker needs).

const SUPPORTED_LANGUAGES = ['de', 'en', 'es'];
const FALLBACK_LANGUAGE = 'en';
const STORAGE_KEY = 'language';

// In the real extension, the three dictionaries are genuinely separate
// files (de.json/en.json/es.json), fetched at runtime via
// chrome.runtime.getURL — an extension page fetching its own bundled
// resource needs no `web_accessible_resources` entry (that only gates
// access from content scripts/web pages). Under Jest (no `chrome`/`fetch`),
// they're loaded synchronously via `require`, the same dual-environment
// pattern already used by shared/logger.js — this also means the test
// suite never touches the network.
const bundledDictionaries = typeof require !== 'undefined'
  ? { de: require('./de.json'), en: require('./en.json'), es: require('./es.json') }
  : null;

function detectDefaultLanguage(navigatorLanguage) {
  const lang = String(navigatorLanguage || '').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : FALLBACK_LANGUAGE;
}

async function fetchDictionary(lang) {
  const url = chrome.runtime.getURL(`i18n/${lang}.json`);
  const res = await fetch(url);
  return res.json();
}

async function loadDictionary(lang) {
  if (bundledDictionaries) return bundledDictionaries[lang] || bundledDictionaries[FALLBACK_LANGUAGE];
  return fetchDictionary(lang);
}

// chrome.storage.local (not .session, unlike the rest of the popup's state)
// — a language choice is a long-lived device preference that should
// survive a browser restart, not just a popup close/reopen.
async function getStoredLanguage() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : null;
  } catch {
    return null;
  }
}

async function persistLanguage(lang) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: lang });
  } catch {
    // Best-effort — a failed write just means the choice won't survive a restart.
  }
}

let currentLanguage = FALLBACK_LANGUAGE;
let currentDictionary = null;

function lookup(key) {
  return key.split('.').reduce((obj, part) => (obj && typeof obj === 'object' ? obj[part] : undefined), currentDictionary);
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match));
}

// A missing key resolves to the key itself, so a gap in a dictionary shows
// up as an obviously-wrong string in the UI instead of blank text or a
// thrown error.
function t(key, params) {
  const value = lookup(key);
  return typeof value === 'string' ? interpolate(value, params) : key;
}

async function initI18n(navigatorLanguage) {
  const stored = await getStoredLanguage();
  currentLanguage = stored || detectDefaultLanguage(navigatorLanguage);
  currentDictionary = await loadDictionary(currentLanguage);
  return currentLanguage;
}

async function setLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) return currentLanguage;
  currentDictionary = await loadDictionary(lang);
  currentLanguage = lang;
  await persistLanguage(lang);
  return currentLanguage;
}

function getLanguage() {
  return currentLanguage;
}

const api = { SUPPORTED_LANGUAGES, FALLBACK_LANGUAGE, detectDefaultLanguage, initI18n, setLanguage, getLanguage, t };

if (typeof module !== 'undefined') {
  module.exports = api;
} else {
  self.SFI18n = api;
}
