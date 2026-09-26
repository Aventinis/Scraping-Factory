// Issue #213: focused unit coverage for buildFieldNode/serializeGroupTree's
// new `download` handling. container-tree.js's other pure functions had no
// dedicated test file before this (only indirect coverage via popup.test.js's
// own integration-style tests) — this file stays scoped to what this issue
// actually touched rather than retroactively covering the whole module.
const { buildFieldNode, serializeGroupTree, guessUrlAttribute } = require('./container-tree');

describe('container-tree (Issue #213): buildFieldNode download handling', () => {
  test('carries download through for Attribute mode', () => {
    const node = buildFieldNode('Bild', 'img.photo', 'attribute', 'src', null, [], true);
    expect(node.download).toBe(true);
  });

  test('forces download to false for any non-Attribute mode, even if the caller passed true', () => {
    expect(buildFieldNode('Titel', 'h2', 'text', null, null, [], true).download).toBe(false);
    expect(buildFieldNode('Vorhanden', '.badge', 'exists', null, null, [], true).download).toBe(false);
    expect(buildFieldNode('Name', 'h3', 'ownText', null, null, [], true).download).toBe(false);
  });

  test('defaults to false when omitted', () => {
    expect(buildFieldNode('Bild', 'img.photo', 'attribute', 'src').download).toBe(false);
  });
});

describe('container-tree (Issue #213): serializeGroupTree download handling', () => {
  test('includes download:true only for an Attribute-mode field with it enabled', () => {
    const groups = [
      { kind: 'field', name: 'Bild', selector: 'img.photo', mode: 'attribute', attribute: 'src', download: true },
    ];
    expect(serializeGroupTree(groups)).toEqual([
      { name: 'Bild', selector: 'img.photo', mode: 'Attribute', attribute: 'src', download: true },
    ]);
  });

  test('omits the download key entirely when false (not sent as false)', () => {
    const groups = [
      { kind: 'field', name: 'Bild', selector: 'img.photo', mode: 'attribute', attribute: 'src', download: false },
    ];
    const [serialized] = serializeGroupTree(groups);
    expect(serialized).not.toHaveProperty('download');
  });

  test('omits download for a non-Attribute-mode field even if the in-memory node carries download:true', () => {
    // Defensive — buildFieldNode itself already prevents this combination,
    // but serializeGroupTree's own gate should hold regardless of how the
    // node was constructed.
    const groups = [
      { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, download: true },
    ];
    const [serialized] = serializeGroupTree(groups);
    expect(serialized).not.toHaveProperty('download');
  });

  test('works the same way nested inside a group', () => {
    const groups = [
      {
        kind: 'group', name: 'Item', selector: '.item', repeating: true,
        children: [
          { kind: 'field', name: 'Bild', selector: 'img.photo', mode: 'attribute', attribute: 'src', download: true },
        ],
      },
    ];
    expect(serializeGroupTree(groups)[0].children[0]).toEqual(
      { name: 'Bild', selector: 'img.photo', mode: 'Attribute', attribute: 'src', download: true },
    );
  });
});

// Issue #213 follow-up: guesses which of a clicked element's own attributes
// most likely holds a downloadable resource URL, so the extension can
// pre-select it in the picker instead of the user needing to know HTML
// attribute names at all (per CLAUDE.md's "no programming knowledge" target
// audience). A convenience default only — every attribute stays listed and
// pickable regardless of what this guesses.
describe('container-tree (Issue #213): guessUrlAttribute', () => {
  test('picks "src" over an unrelated attribute', () => {
    expect(guessUrlAttribute({ class: 'photo', src: '/images/dish1.jpg' })).toBe('src');
  });

  test('picks a lazy-load data-* attribute when src looks like a placeholder', () => {
    expect(guessUrlAttribute({ src: 'data:image/gif;base64,R0lGOD', 'data-src': '/images/real.jpg' })).toBe('data-src');
  });

  test('falls back to href when nothing else is present', () => {
    expect(guessUrlAttribute({ class: 'link', href: '/produkt/42' })).toBe('href');
  });

  test('prefers src over href when both are present', () => {
    expect(guessUrlAttribute({ href: '/fallback', src: '/images/dish1.jpg' })).toBe('src');
  });

  test('returns null when nothing looks like a resource URL at all', () => {
    expect(guessUrlAttribute({ class: 'menu-item', id: 'item-1' })).toBeNull();
  });

  test('returns null for an empty or missing attribute map', () => {
    expect(guessUrlAttribute({})).toBeNull();
    expect(guessUrlAttribute(null)).toBeNull();
    expect(guessUrlAttribute(undefined)).toBeNull();
  });

  test('recognizes a resource-like extension even on an unusual attribute name', () => {
    expect(guessUrlAttribute({ 'data-background': '/images/hero.webp' })).toBe('data-background');
  });

  test('never picks a data: URI, even with no better alternative', () => {
    expect(guessUrlAttribute({ src: 'data:image/png;base64,abcd' })).toBeNull();
  });
});
