// Issue #354 Part B: the docs build (docs-build.js) — markdown → bundled HTML.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { slugify, anchorsOf, listDocPages } = require('./docs-build');

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

test('the real docs/user builds without a broken link, and every page has an <h1>', () => {
  const out = tmp();
  const pages = buildDocs({ docsDir: REAL_DOCS, outdir: out });
  expect(pages.length).toBeGreaterThanOrEqual(10);
  for (const { name } of pages) {
    expect(fs.readFileSync(path.join(out, 'docs', `${name}.html`), 'utf8')).toMatch(/<h1 id="/);
  }
});
