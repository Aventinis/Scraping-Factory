// @ts-check
// Plain-language versions of the failures a user hits at the worst moment, a failed Generate. The companion's and the script's messages are
// written for developers and say nothing about what to do next. describeError() recognises the common classes by pattern and returns a
// translated { title, hint }; anything else returns null and keeps the raw text, which always stays available (behind "Details", and
// "Report bug" sends it).
//
// The patterns read the English wording of the companion (ScrapingPlanValidator, PythonScriptVerifier) and of the scripts' "ERROR: ..."
// lines (fragments/request_errors_*.py.j2, require_env_function.py.j2, output_tabular.py.j2), and are deliberately loose about the
// surrounding words; where one would be too brittle, the fix is a stable error code in the companion's response, not a tighter regex.
const { t } = require('../i18n/i18n');

/**
 * @typedef {{ code: string, params: Record<string, string | number> }} ErrorClass
 */

/** @type {Array<{ test: RegExp, build: (m: RegExpMatchArray) => ErrorClass }>} */
const RULES = [
  // ── Configuration rejected before anything ran (HTTP 400) ──────────────────
  { test: /Invalid start URL #(\d+) '([^']*)'/, build: (m) => ({ code: 'invalidStartUrl', params: { index: m[1], url: m[2] } }) },
  { test: /^Invalid ScrapingConfig: Url and at least one/, build: () => ({ code: 'noFields', params: {} }) },
  { test: /Invalid regular expression '([^']*)' for ([^:\n]+):/, build: (m) => ({ code: 'invalidRegex', params: { pattern: m[1], field: m[2] } }) },
  { test: /Invalid environment variable name '([^']*)'/, build: (m) => ({ code: 'invalidEnvVarName', params: { name: m[1] } }) },
  { test: /Duplicate field names: (.+?)\.?$/m, build: (m) => ({ code: 'duplicateFieldNames', params: { names: m[1] } }) },
  { test: /Field name must not be empty/, build: () => ({ code: 'emptyFieldName', params: {} }) },
  { test: /[Ss]elector (?:of (?:group|data field)|for field) '([^']*)' must not be empty/, build: (m) => ({ code: 'emptySelector', params: { name: m[1] } }) },
  { test: /Selector of a (?:WaitFor|Fill|Click)Step must not be empty/, build: () => ({ code: 'emptySelector', params: {} }) },

  // ── The script ran (or tried to) ───────────────────────────────────────────
  { test: /required environment variable '([^']+)' is not set/, build: (m) => ({ code: 'missingEnvVar', params: { name: m[1] } }) },
  { test: /returned no data/, build: () => ({ code: 'noData', params: {} }) },
  { test: /exceeded the \d+s timeout/, build: () => ({ code: 'trialTimeout', params: {} }) },
  { test: /robots\.txt disallows/, build: () => ({ code: 'robotsDisallowed', params: {} }) },
  { test: /No Python interpreter found/, build: () => ({ code: 'pythonMissing', params: {} }) },
  { test: /No module named '([^'.]+)/, build: (m) => ({ code: 'packageMissing', params: { name: m[1] } }) },
  { test: /needs the '([^']+)' package/, build: (m) => ({ code: 'packageMissing', params: { name: m[1] } }) },
  { test: /could not load the page \(([^)]*)\)/, build: (m) => ({ code: /timeout/i.test(m[1]) ? 'pageLoadTimeout' : 'pageLoadFailed', params: {} }) },
  { test: /could not reach the (?:site|API)/, build: () => ({ code: 'siteUnreachable', params: {} }) },
  { test: /failed: HTTP (\d{3})/, build: (m) => ({ code: httpClass(Number(m[1])), params: { status: m[1] } }) },
  { test: /\b(?:Request|Discovery request|Navigation|Preflight request|bootstrap request) to \S+ failed/i, build: () => ({ code: 'requestFailed', params: {} }) },
  { test: /Script did not produce /, build: () => ({ code: 'noOutput', params: {} }) },
  { test: /exited with an error \(exit code (\d+)\)/, build: (m) => ({ code: 'scriptCrash', params: { code: m[1] } }) },

  // ── The companion itself ───────────────────────────────────────────────────
  { test: /^(?:Failed to fetch|NetworkError|Load failed)/i, build: () => ({ code: 'companionUnreachable', params: {} }) },
  { test: /^HTTP 5\d\d$/, build: () => ({ code: 'companionError', params: {} }) },
];

/** @param {number} status */
function httpClass(status) {
  if (status === 401 || status === 403) return 'siteForbidden';
  if (status === 404) return 'pageNotFound';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'siteError';
  return 'httpError';
}

/**
 * Which failure class a raw message belongs to, or null when it is none we know.
 * @param {string | null | undefined} rawMessage
 * @returns {ErrorClass | null}
 */
function classifyError(rawMessage) {
  const text = String(rawMessage || '');
  for (const rule of RULES) {
    const match = text.match(rule.test);
    if (match) return rule.build(match);
  }
  return null;
}

// Some classes read better with a variant of the hint: "no data" suggests the
// Browser engine only where the Static engine is in use, and an empty selector
// names the element when the message did.
/**
 * @param {ErrorClass} errorClass
 * @param {string | undefined} engine
 */
function hintKey(errorClass, engine) {
  const base = `errors.${errorClass.code}.hint`;
  if (errorClass.code === 'noData' && engine === 'Static') return `${base}Static`;
  if (errorClass.code === 'emptySelector' && errorClass.params.name) return `${base}Named`;
  return base;
}

/**
 * The plain-language message for a raw failure text, in the current UI language.
 * @param {string | null | undefined} rawMessage
 * @param {{ engine?: string }} [context]
 * @returns {{ code: string, title: string, hint: string } | null}
 */
function describeError(rawMessage, context = {}) {
  const errorClass = classifyError(rawMessage);
  if (!errorClass) return null;
  return {
    code: errorClass.code,
    title: t(`errors.${errorClass.code}.title`, errorClass.params),
    hint: t(hintKey(errorClass, context.engine), errorClass.params),
  };
}

module.exports = { classifyError, describeError };
