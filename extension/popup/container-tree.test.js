// Issue #213: focused unit coverage for buildFieldNode/serializeGroupTree's
// new `download` handling. container-tree.js's other pure functions had no
// dedicated test file before this (only indirect coverage via popup.test.js's
// own integration-style tests) — this file stays scoped to what this issue
// actually touched rather than retroactively covering the whole module.
const { buildFieldNode, serializeGroupTree } = require('./container-tree');

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
