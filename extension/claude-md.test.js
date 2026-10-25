// Issue #379: CLAUDE.md is loaded into every session, so it holds only rules that apply to every change. Per-feature
// behavior and rationale live in docs/design-notes/ (docs/ARCHITECTURE.md is the structural map). These tests keep the
// split from eroding: a size cap, the Comments rules being present, and no dead links.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const MAX_BYTES = 40 * 1024;

describe('CLAUDE.md', () => {
  const text = read('CLAUDE.md');

  test(`stays under ${MAX_BYTES / 1024} KB`, () => {
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MAX_BYTES) {
      throw new Error(`CLAUDE.md is ${Math.round(size / 1024)} KB (cap ${MAX_BYTES / 1024} KB). `
        + 'Only rules that apply to every change belong there; put the feature\'s behavior and rationale in docs/design-notes/ '
        + 'and its file index in docs/ARCHITECTURE.md.');
    }
  });

  test('keeps the comment rules and the pointers to the design notes', () => {
    expect(text).toMatch(/^## Comments$/m);
    expect(text).toContain('docs/design-notes/');
    expect(text).toMatch(/^## Architecture Decisions$/m);
  });

  test('every relative link resolves', () => {
    const missing = [];
    for (const match of text.matchAll(/\]\((?!https?:)([\w./-]+\.(?:md|json|js|ts|cs|html|py))(?:#[^)]*)?\)/g)) {
      if (!fs.existsSync(path.join(ROOT, match[1]))) missing.push(match[1]);
    }
    expect(missing).toEqual([]);
  });
});

describe('docs/design-notes', () => {
  const dir = path.join(ROOT, 'docs', 'design-notes');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

  test('has the expected files, each listed in the README', () => {
    const readme = read('docs/design-notes/README.md');
    for (const name of ['extension.md', 'companion.md', 'compiler.md', 'templates.md', 'feature-scope.md']) {
      expect(files).toContain(name);
      expect(readme).toContain(`](${name})`);
    }
  });

  test('every relative link inside the notes resolves', () => {
    const missing = [];
    for (const file of files) {
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of body.matchAll(/\]\((?!https?:)([\w./-]+\.(?:md|json|js|ts|cs|html|py))(?:#[^)]*)?\)/g)) {
        if (!fs.existsSync(path.join(dir, match[1]))) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
