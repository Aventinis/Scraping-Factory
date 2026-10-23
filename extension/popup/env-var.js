// @ts-check
// Issue #397: the one place that knows what a valid environment-variable *name*
// is. Six features (change detection, proxy, login Fill actions, custom request
// headers, API headers, the API auth bootstrap — plus the Fill action of an API
// browser-discovery source) ask the user to type such a name, and the companion
// rejects a bad one only at /generate. This validates it up front, with a message
// a person can act on, and can scan a finished wire config for every env-var name
// in it so no feature has to remember to check its own.
//
// The pattern is the companion's own (ScrapingPlanValidator
// EnvironmentVariableNamePattern): letters, digits and underscores, not starting
// with a digit. Lower-case is allowed; the examples just recommend UPPER_CASE.
const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * An empty name is "not set" (most inputs are optional, or simply not filled in
 * yet) and is never an error here — whether a blank is allowed is each
 * feature's own completeness rule.
 * @param {string | null | undefined} name
 * @returns {{ ok: true } | { ok: false, reason: 'startsWithDigit' | 'invalidChars' }}
 */
function validateEnvVarName(name) {
  const value = String(name ?? '').trim();
  if (value === '' || ENV_VAR_NAME_PATTERN.test(value)) return { ok: true };
  return { ok: false, reason: /^[0-9]/.test(value) ? 'startsWithDigit' : 'invalidChars' };
}

// Every wire-format property that holds an environment-variable name: Fill
// actions / request headers / API headers / bootstrap fields / proxy use
// `environmentVariableName`; change detection uses `…EnvVar`.
/** @param {string} key */
function isEnvVarKey(key) {
  return key === 'environmentVariableName' || /EnvVar$/.test(key);
}

/**
 * Every invalid environment-variable name anywhere in a wire config (the object
 * that is about to be sent to /generate), with where it was found.
 * @param {unknown} config
 * @returns {Array<{ path: string, name: string, reason: 'startsWithDigit' | 'invalidChars' }>}
 */
function findInvalidEnvVarNames(config) {
  /** @type {Array<{ path: string, name: string, reason: 'startsWithDigit' | 'invalidChars' }>} */
  const found = [];
  (function walk(node, path) {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (typeof value === 'string' && isEnvVarKey(key)) {
        const result = validateEnvVarName(value);
        if (!result.ok) found.push({ path: here, name: value.trim(), reason: result.reason });
      } else {
        walk(value, here);
      }
    }
  })(config, '');
  return found;
}

module.exports = { ENV_VAR_NAME_PATTERN, validateEnvVarName, findInvalidEnvVarNames };
