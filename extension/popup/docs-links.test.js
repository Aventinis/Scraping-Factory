// Issue #354 Part B: every "Learn more" key resolves to a real page and heading of docs/user.
const fs = require('fs');
const path = require('path');
const { DOC_TARGETS, resolveDocTarget, collectDocKeysFromHtml } = require('./docs-links');
const { anchorsOf } = require('../docs-build');

const DOCS_DIR = path.join(__dirname, '..', '..', 'docs', 'user');
const anchorsByPage = {};
for (const f of fs.readdirSync(DOCS_DIR).filter((n) => n.endsWith('.md'))) {
  anchorsByPage[f.slice(0, -3)] = anchorsOf(fs.readFileSync(path.join(DOCS_DIR, f), 'utf8'));
}

function sourceFiles() {
  const dirs = [__dirname, path.join(__dirname, 'screens')];
  return dirs.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)))
    .filter((f) => /\.(html|js)$/.test(f) && !/\.test\.js$/.test(f));
}

describe('DOC_TARGETS', () => {
  test.each(Object.entries(DOC_TARGETS))('%s → %s exists in docs/user', (_key, target) => {
    const [page, anchor] = target.split('#');
    expect(anchorsByPage[page]).toBeDefined();
    if (anchor) expect(anchorsByPage[page].has(anchor)).toBe(true);
  });
});

describe('resolveDocTarget', () => {
  test('builds the bundled path, with and without an anchor', () => {
    expect(resolveDocTarget('monitoring')).toEqual({ page: 'monitoring', anchor: '', file: 'docs/monitoring.html' });
    expect(resolveDocTarget('safetyChecks')).toEqual({ page: 'monitoring', anchor: 'safety-checks', file: 'docs/monitoring.html#safety-checks' });
  });

  test('an unknown key — including an inherited property name — is null', () => {
    expect(resolveDocTarget('nope')).toBeNull();
    expect(resolveDocTarget('constructor')).toBeNull();
    expect(resolveDocTarget('')).toBeNull();
  });
});

describe('resolveDocTarget in German', () => {
  const anchors = { de: { monitoring: { 'safety-checks': 'sicherheitspruefungen' }, output: {} } };

  test('German with a translated page opens docs/de at the German anchor', () => {
    expect(resolveDocTarget('safetyChecks', 'de', anchors)).toEqual({ page: 'monitoring', anchor: 'sicherheitspruefungen', file: 'docs/de/monitoring.html#sicherheitspruefungen' });
    expect(resolveDocTarget('monitoring', 'de', anchors).file).toBe('docs/de/monitoring.html');
  });

  test('a heading without a mapping opens the German page without an anchor', () => {
    expect(resolveDocTarget('dedup', 'de', anchors).file).toBe('docs/de/output.html');
  });

  test('English, Spanish, no table, or a page without a German version stay English', () => {
    expect(resolveDocTarget('safetyChecks', 'en', anchors).file).toBe('docs/monitoring.html#safety-checks');
    expect(resolveDocTarget('safetyChecks', 'es', anchors).file).toBe('docs/monitoring.html#safety-checks');
    expect(resolveDocTarget('safetyChecks', 'de', null).file).toBe('docs/monitoring.html#safety-checks');
    expect(resolveDocTarget('pause', 'de', anchors).file).toBe('docs/network-settings.html#pause-between-requests');
  });
});

describe('the markup and the code only use registered keys', () => {
  const used = new Set();
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    collectDocKeysFromHtml(text).forEach((k) => used.add(k));
    for (const m of text.matchAll(/learnMoreHtml\('([^']+)'\)/g)) used.add(m[1]);
  }

  test('every data-doc / learnMoreHtml key is in DOC_TARGETS', () => {
    const unknown = [...used].filter((k) => !(k in DOC_TARGETS));
    expect(unknown).toEqual([]);
  });

  test('every registered key is used somewhere (no dead targets)', () => {
    const unused = Object.keys(DOC_TARGETS).filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });
});
