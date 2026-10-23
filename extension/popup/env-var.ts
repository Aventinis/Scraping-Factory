// The one place that knows what a valid environment-variable *name* is. Many features ask the user to type such a name (change
// detection, proxy, login Fill actions, custom request headers, API headers, the API auth bootstrap and the Fill action of an API
// browser-discovery source), and the companion rejects a bad one only at /generate. This validates it up front with a message a
// person can act on, and scans a finished wire config for every env-var name in it so no feature has to remember its own check.
//
// The pattern is the companion's own (ScrapingPlanValidator EnvironmentVariableNamePattern): letters, digits and underscores, not
// starting with a digit. Lower-case is allowed; the examples just recommend UPPER_CASE.

type EnvVarProblem = 'startsWithDigit' | 'invalidChars';
export type EnvVarValidation = { ok: true } | { ok: false; reason: EnvVarProblem };
export interface InvalidEnvVarName { path: string; name: string; reason: EnvVarProblem }

export const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** An empty name is "not set" and never an error here: whether a blank is allowed is each feature's own completeness rule. */
export function validateEnvVarName(name: string | null | undefined): EnvVarValidation {
  const value = String(name ?? '').trim();
  if (value === '' || ENV_VAR_NAME_PATTERN.test(value)) return { ok: true };
  return { ok: false, reason: /^[0-9]/.test(value) ? 'startsWithDigit' : 'invalidChars' };
}

// Every wire property that holds an environment-variable name: `environmentVariableName` (Fill actions, request headers, API
// headers, bootstrap fields, proxy) and `…EnvVar` (change detection).
function isEnvVarKey(key: string): boolean {
  return key === 'environmentVariableName' || /EnvVar$/.test(key);
}

/** Every invalid environment-variable name anywhere in a wire config (about to be sent to /generate), with where it was found. */
export function findInvalidEnvVarNames(config: unknown): InvalidEnvVarName[] {
  const found: InvalidEnvVarName[] = [];
  (function walk(node: unknown, path: string): void {
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
