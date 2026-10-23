// Issue #354 Part B: the docs build (docs-build.js) — markdown → bundled HTML.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { slugify, anchorsOf, anchorListOf, headingStructureOf, listDocPages, sourceHash, stampedHash, stampTranslation, translationStatus } = require('./docs-build');

// Jest cannot load `marked` (an ES module), so the build runs in a real Node process.
function buildDocs({ docsDir, outdir }) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'docs-build.js'), docsDir, outdir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    throw new Error(err.stderr || err.message);
  }
  return fs.readdirSync(outdir + '/docs').filter((f) => f.endsWith('.html')).map((f) => ({ name: f.slice(0, -5) }));
}

const REAL_DOCS = path.join(__dirname, '..', 'docs', 'user');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sf-docs-')); }

function makeDocs(files) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'images'));
  fs.writeFileSync(path.join(dir, 'images', 'pic.png'), 'x');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

describe('slugify / anchorsOf', () => {
  test('follows GitHub: lower case, punctuation dropped, spaces to hyphens', () => {
    expect(slugify("Skip if the page hasn't changed")).toBe('skip-if-the-page-hasnt-changed');
    expect(slugify('Output formats & `layouts`')).toBe('output-formats--layouts');
  });

  test('repeated headings get -1, -2 like GitHub, and fenced code is ignored', () => {
    const anchors = anchorsOf('# A\n## Same\n## Same\n```\n# not a heading\n```\n');
    expect([...anchors]).toEqual(['a', 'same', 'same-1']);
  });
});

describe('buildDocs', () => {
  test('writes one html page per markdown page with heading ids, navigation and the stylesheet', () => {
    const docs = makeDocs({ 'README.md': '# Home\n\nSee [the guide](guide.md#first-step).\n', 'guide.md': '# Guide\n\n## First step\n\n![shot](images/pic.png)\n' });
    const out = tmp();
    buildDocs({ docsDir: docs, outdir: out });
    const home = fs.readFileSync(path.join(out, 'docs/README.html'), 'utf8');
    const guide = fs.readFileSync(path.join(out, 'docs/guide.html'), 'utf8');
    expect(home).toContain('<a href="guide.html#first-step">the guide</a>');
    expect(home).toContain('<link rel="stylesheet" href="docs.css">');
    expect(home).toContain('aria-current="page"');
    expect(guide).toContain('<h2 id="first-step">');
    expect(guide).toContain('<img src="images/pic.png"');
    expect(fs.existsSync(path.join(out, 'docs/images/pic.png'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'docs/docs.css'))).toBe(true);
    expect(home).not.toMatch(/<script/i); // an extension page may not run inline script
  });

  test('a link out of docs/user is shown as plain text, an http link is kept', () => {
    const docs = makeDocs({ 'README.md': '# Home\n\nDevelopers: [CLAUDE.md](../../CLAUDE.md) and <http://127.0.0.1:8504/>.\n' });
    const out = tmp();
    buildDocs({ docsDir: docs, outdir: out });
    const html = fs.readFileSync(path.join(out, 'docs/README.html'), 'utf8');
    expect(html).toContain('Developers: CLAUDE.md and');
    expect(html).not.toContain('CLAUDE.md</a>');
    expect(html).toContain('href="http://127.0.0.1:8504/"');
  });

  test.each([
    ['a missing page', '[x](nope.md)', 'nope.md'],
    ['a missing anchor', '[x](guide.md#nope)', 'no heading with that anchor'],
    ['a missing image', '![x](images/missing.png)', 'missing.png'],
    ['a missing anchor on the same page', '[x](#nope)', 'no heading with that anchor'],
  ])('fails the build for %s', (_label, link, expected) => {
    const docs = makeDocs({ 'README.md': `# Home\n\n${link}\n`, 'guide.md': '# Guide\n' });
    expect(() => buildDocs({ docsDir: docs, outdir: tmp() })).toThrow(expected);
  });

  test('pages come in the documented order, unknown ones last', () => {
    const docs = makeDocs({ 'zzz.md': '# Z\n', 'README.md': '# R\n', 'modes.md': '# M\n' });
    expect(listDocPages(docs).map((p) => p.name)).toEqual(['README', 'modes', 'zzz']);
  });
});

describe('German translation', () => {
  function makeBilingual(en, de) {
    const dir = makeDocs(en);
    fs.mkdirSync(path.join(dir, 'de', 'images'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'de', 'images', 'pic.png'), 'x');
    for (const [name, text] of Object.entries(de)) fs.writeFileSync(path.join(dir, 'de', name), text);
    return dir;
  }
  const EN = { 'README.md': '# Home\n\nSee [the guide](guide.md#first-step).\n', 'guide.md': '# Guide\n\n## First step\n\n![shot](images/pic.png)\n' };
  const DE = { 'README.md': '# Start\n\nSiehe [die Anleitung](guide.md#erster-schritt).\n', 'guide.md': '# Anleitung\n\n## Erster Schritt\n\n![Bild](images/pic.png)\n' };

  test('builds both languages with a link to the twin page and its own images', () => {
    const dir = makeBilingual(EN, DE);
    const out = tmp();
    buildDocs({ docsDir: dir, outdir: out });
    const de = fs.readFileSync(path.join(out, 'docs/de/guide.html'), 'utf8');
    const en = fs.readFileSync(path.join(out, 'docs/guide.html'), 'utf8');
    expect(de).toContain('<html lang="de">');
    expect(de).toContain('<h2 id="erster-schritt">');
    expect(de).toContain('href="../docs.css"');
    expect(de).toContain('<a href="../guide.html" hreflang="en"');
    expect(en).toContain('<a href="de/guide.html" hreflang="de"');
    expect(fs.existsSync(path.join(out, 'docs/de/images/pic.png'))).toBe(true);
    expect(fs.readFileSync(path.join(out, 'docs/de/README.html'), 'utf8')).toContain('<a href="guide.html#erster-schritt">die Anleitung</a>');
  });

  test('anchors.json maps every English heading to its German one by position', () => {
    const out = tmp();
    buildDocs({ docsDir: makeBilingual(EN, DE), outdir: out });
    const anchors = JSON.parse(fs.readFileSync(path.join(out, 'docs/anchors.json'), 'utf8'));
    expect(anchors.de.guide).toEqual({ guide: 'anleitung', 'first-step': 'erster-schritt' });
    expect(anchors.de.README).toEqual({ home: 'start' });
  });

  test('an English page without a translation has no twin link and no mapping', () => {
    const out = tmp();
    buildDocs({ docsDir: makeBilingual(EN, { 'README.md': DE['README.md'].replace('guide.md#erster-schritt', 'README.md') }), outdir: out });
    expect(fs.readFileSync(path.join(out, 'docs/guide.html'), 'utf8')).not.toContain('hreflang');
    expect(JSON.parse(fs.readFileSync(path.join(out, 'docs/anchors.json'), 'utf8')).de.guide).toBeUndefined();
  });

  test('a broken link or image in a German page fails the build and names the file', () => {
    const dir = makeBilingual(EN, { ...DE, 'guide.md': '# Anleitung\n\n## Erster Schritt\n\n[x](nope.md) ![y](images/missing.png) [z](#falsch)\n' });
    let error;
    try { buildDocs({ docsDir: dir, outdir: tmp() }); } catch (err) { error = err; }
    expect(String(error.message)).toContain('docs/user/de/guide.md');
    expect(String(error.message)).toContain('nope.md');
    expect(String(error.message)).toContain('missing.png');
    expect(String(error.message)).toContain('#falsch');
  });

  test('a different heading structure is reported and not mapped', () => {
    const dir = makeBilingual(EN, { 'README.md': '# Start\n\nText.\n', 'guide.md': '# Anleitung\n\n## Eins\n\n## Zwei\n' });
    const out = tmp();
    buildDocs({ docsDir: dir, outdir: out });
    expect(JSON.parse(fs.readFileSync(path.join(out, 'docs/anchors.json'), 'utf8')).de.guide).toEqual({});
    expect(translationStatus(dir).structure).toEqual(['guide']);
  });

  test('the source stamp tells a stale translation apart', () => {
    const dir = makeBilingual(EN, DE);
    expect(translationStatus(dir).unstamped).toEqual(['README', 'guide']);
    stampTranslation(dir, 'guide');
    stampTranslation(dir, 'README');
    expect(translationStatus(dir)).toEqual({ missing: [], stale: [], unstamped: [], structure: [] });
    expect(stampedHash(fs.readFileSync(path.join(dir, 'de/guide.md'), 'utf8'))).toBe(sourceHash(EN['guide.md']));

    fs.writeFileSync(path.join(dir, 'guide.md'), EN['guide.md'] + '\nMore text.\n');
    expect(translationStatus(dir).stale).toEqual(['guide']);
    stampTranslation(dir, 'guide');
    stampTranslation(dir, 'guide'); // stamping twice replaces the marker instead of stacking
    expect(translationStatus(dir).stale).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'de/guide.md'), 'utf8').match(/<!-- source:/g)).toHaveLength(1);
  });

  test('a missing translation is listed', () => {
    expect(translationStatus(makeBilingual(EN, { 'README.md': DE['README.md'] })).missing).toEqual(['guide']);
  });

  test('heading helpers keep order and structure', () => {
    expect(anchorListOf('# A\n## B\n## B\n### C\n')).toEqual(['a', 'b', 'b-1', 'c']);
    expect(headingStructureOf('# A\n```\n# x\n```\n## B\n')).toEqual([1, 2]);
  });
});

test('the real docs/user builds without a broken link, and every page has an <h1>', () => {
  const out = tmp();
  const pages = buildDocs({ docsDir: REAL_DOCS, outdir: out });
  expect(pages.length).toBeGreaterThanOrEqual(10);
  for (const { name } of pages) {
    expect(fs.readFileSync(path.join(out, 'docs', `${name}.html`), 'utf8')).toMatch(/<h1 id="/);
  }
});

// Issue #436: the real German tree. A page without a translation or one that went stale is
// reported but does not fail (the panel falls back to English); what would break the anchor
// mapping — a different heading structure — or an unstamped page does.
describe('the real German translation', () => {
  const status = translationStatus(REAL_DOCS);

  test('every German page has the heading structure of its English source', () => {
    expect(status.structure).toEqual([]);
  });

  test('every German page carries its source stamp', () => {
    expect(status.unstamped).toEqual([]);
  });

  test('missing and stale translations are reported, not failed', () => {
    if (status.missing.length) console.warn(`no German page for: ${status.missing.join(', ')}`);
    if (status.stale.length) console.warn(`German pages older than their English source: ${status.stale.join(', ')} (node extension/docs-build.js --stamp <page> after updating them)`);
    expect(Array.isArray(status.stale)).toBe(true);
  });

  test('the built docs carry every German page and a complete anchor table', () => {
    const out = tmp();
    buildDocs({ docsDir: REAL_DOCS, outdir: out });
    const anchors = JSON.parse(fs.readFileSync(path.join(out, 'docs/anchors.json'), 'utf8'));
    for (const { name } of listDocPages(REAL_DOCS)) {
      if (status.missing.includes(name)) continue;
      expect(fs.existsSync(path.join(out, 'docs/de', `${name}.html`))).toBe(true);
      const english = anchorListOf(fs.readFileSync(path.join(REAL_DOCS, `${name}.md`), 'utf8'));
      expect(Object.keys(anchors.de[name])).toEqual(english);
    }
    // The anchors the panel's key table uses all have a German counterpart.
    const { DOC_TARGETS } = require('./popup/docs-links');
    for (const target of Object.values(DOC_TARGETS)) {
      const [page, anchor] = target.split('#');
      if (!anchor || status.missing.includes(page)) continue;
      expect(anchors.de[page][anchor]).toEqual(expect.any(String));
    }
  });
});
