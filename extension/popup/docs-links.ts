// The one table of "Learn more" targets. The popup never writes a documentation path by hand: markup says `data-doc="<key>"` and
// this table maps the key to a page and heading of docs/user/*.md (bundled as docs/<page>.html, see extension/docs-build.js). A
// renamed heading breaks exactly this table, and docs-links.test.js fails instead of the extension shipping a dead link. Anchors
// are GitHub's heading slugs (docs-build.js `slugify`).


/** key -> "page" or "page#anchor" */
export const DOC_TARGETS: Readonly<Record<string, string>> = Object.freeze({
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

/** docs/anchors.json: for each German page, its English heading anchors mapped to the German ones. */
export interface DocAnchors { de?: Record<string, Record<string, string>> }

export interface DocTarget { page: string; anchor: string; file: string }

/**
 * `file` is the path inside the extension: docs/[de/]<page>.html[#anchor]. Only German has its own pages; a German page that does
 * not exist (or a missing anchor table) falls back to the English page.
 */
export function resolveDocTarget(key: string, language = 'en', anchors: DocAnchors | null = null): DocTarget | null {
  const target = Object.prototype.hasOwnProperty.call(DOC_TARGETS, key) ? DOC_TARGETS[key] : null;
  if (!target) return null;
  const [page, anchor = ''] = target.split('#');
  const german = language === 'de' && anchors && anchors.de && anchors.de[page];
  if (german) {
    const germanAnchor = anchor ? (german[anchor] || '') : '';
    return { page, anchor: germanAnchor, file: `docs/de/${page}.html${germanAnchor ? `#${germanAnchor}` : ''}` };
  }
  return { page, anchor, file: `docs/${page}.html${anchor ? `#${anchor}` : ''}` };
}

/** Every `data-doc="…"` key in a piece of HTML, de-duplicated (for the sync test). */
export function collectDocKeysFromHtml(html: string): string[] {
  return [...new Set([...html.matchAll(/data-doc="([A-Za-z]+)"/g)].map((m) => m[1]))];
}
