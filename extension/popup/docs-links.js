// @ts-check
// Issue #354 Part B: the one table of "Learn more" targets. The popup never
// writes a documentation path by hand — markup says `data-doc="<key>"` and this
// table maps the key to a page and heading of docs/user/*.md (bundled as
// docs/<page>.html inside the extension, see extension/docs-build.js). So a
// renamed heading breaks exactly one place, and docs-links.test.js fails until
// it is fixed instead of the extension shipping a dead link.
//
// Anchors are GitHub's heading slugs (docs-build.js `slugify`): lower-case,
// punctuation dropped, spaces → hyphens.

/** @type {Readonly<Record<string, string>>} key → "page" or "page#anchor" */
const DOC_TARGETS = Object.freeze({
  start: 'getting-started',
  companionUnreachable: 'troubleshooting#the-panel-says-companion-app-unreachable',
  modes: 'modes',
  textFilter: 'modes#elements-that-look-alike',
  modesApi: 'modes#api',
  modesCombined: 'modes#combined',
  modesBlocks: 'modes#blocks',
  browserEngine: 'browser-engine',
  loginFlow: 'browser-engine#a-login-flow',
  browserActions: 'browser-engine#browser-actions',
  persistentSession: 'browser-engine#things-to-know',
  pagination: 'pagination',
  transforms: 'transforms',
  presets: 'transforms#presets',
  combineSplit: 'transforms#combine-and-split-fields',
  monitoring: 'monitoring',
  safetyChecks: 'monitoring#safety-checks',
  changeDetection: 'monitoring#change-detection',
  skipIfUnchanged: 'monitoring#skip-if-the-page-hasnt-changed',
  savedConfigs: 'saved-configurations',
  outputFormat: 'output#output-format',
  skipTrialRun: 'output#skip-the-trial-run',
  editableConfig: 'output#editable-config-file',
  appendOutput: 'output#append-instead-of-replace',
  dedup: 'output#remove-duplicates',
  outputLayouts: 'output#output-layouts',
  pause: 'network-settings#pause-between-requests',
  retry: 'network-settings#retry-on-transient-errors',
  robots: 'network-settings#robotstxt',
  headers: 'network-settings#custom-request-headers',
  proxy: 'network-settings#use-a-proxy',
  envVars: 'network-settings#environment-variables-in-practice',
  accounts: 'authentication',
  accessKey: 'authentication#using-a-shared-companion',
});

/**
 * @param {string} key a DOC_TARGETS key
 * @returns {{ page: string, anchor: string, file: string } | null}
 *   `file` is the path inside the extension: docs/<page>.html[#anchor]
 */
function resolveDocTarget(key) {
  const target = Object.prototype.hasOwnProperty.call(DOC_TARGETS, key) ? DOC_TARGETS[key] : null;
  if (!target) return null;
  const [page, anchor = ''] = target.split('#');
  return { page, anchor, file: `docs/${page}.html${anchor ? `#${anchor}` : ''}` };
}

/**
 * Every `data-doc="…"` key in a piece of HTML, de-duplicated (for the sync test).
 * @param {string} html
 * @returns {string[]}
 */
function collectDocKeysFromHtml(html) {
  return [...new Set([...html.matchAll(/data-doc="([A-Za-z]+)"/g)].map((m) => m[1]))];
}

module.exports = { DOC_TARGETS, resolveDocTarget, collectDocKeysFromHtml };
