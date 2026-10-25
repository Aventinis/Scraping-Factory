require('./test-support/popup-env');
const {
  buildGroupNode,
  buildFieldNode,
  resolveGroupNode,
  insertContainerNode,
  removeGroupTreeNode,
  updateGroupTreeNode,
  moveGroupTreeNode,
  formatGroupNodeLabel,
  serializeGroupTree,
  renderGroupTree,
  hasRepeatingAncestor,
} = require('./popup');

// ── Container-Mode tree helpers ──────────────────────────────────────────────

describe('buildGroupNode / buildFieldNode', () => {
  test('buildGroupNode starts with empty children', () => {
    expect(buildGroupNode('Kategorie', 'section', true)).toEqual({
      kind: 'group', name: 'Kategorie', selector: 'section', repeating: true, children: [], framePath: null,
    });
  });

  test('buildFieldNode nulls attribute unless mode is attribute', () => {
    expect(buildFieldNode('Titel', 'h2', 'text', 'href')).toEqual({
      kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, framePath: null, transforms: null,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    });
    expect(buildFieldNode('Link', 'a', 'attribute', 'href')).toEqual({
      kind: 'field', name: 'Link', selector: 'a', mode: 'attribute', attribute: 'href', framePath: null, transforms: null,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    });
  });

  // Issue #84
  test('buildFieldNode carries transforms except for Exists mode', () => {
    const transforms = [{ kind: 'regexExtract', pattern: '\\d+', group: 0 }];
    expect(buildFieldNode('Preis', '.price', 'text', null, null, transforms)).toEqual({
      kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null, framePath: null, transforms,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    });
    expect(buildFieldNode('Vegan', '.vegan', 'exists', null, null, transforms)).toEqual({
      kind: 'field', name: 'Vegan', selector: '.vegan', mode: 'exists', attribute: null, framePath: null, transforms: null,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    });
  });

  // Issue #42, Phase 7
  test('buildGroupNode / buildFieldNode carry a framePath when given', () => {
    expect(buildGroupNode('Kategorie', 'section', true, ['#price-widget']).framePath).toEqual(['#price-widget']);
    expect(buildFieldNode('Titel', 'h2', 'text', null, ['#price-widget', '#reviews-widget']).framePath)
      .toEqual(['#price-widget', '#reviews-widget']);
  });
});

describe('resolveGroupNode / insertContainerNode / removeGroupTreeNode', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
      children: [
        { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null },
      ],
    },
  ];

  test('resolveGroupNode returns null for a null/empty path', () => {
    expect(resolveGroupNode(tree(), null)).toBeNull();
    expect(resolveGroupNode(tree(), [])).toBeNull();
  });

  test('resolveGroupNode walks nested paths', () => {
    expect(resolveGroupNode(tree(), [0]).name).toBe('Kategorie');
    expect(resolveGroupNode(tree(), [0, 0]).name).toBe('Titel');
  });

  test('insertContainerNode appends at root when parentPath is null', () => {
    const node = buildGroupNode('Suppen', 'section.soup', true);
    const result = insertContainerNode(tree(), null, node);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(node);
  });

  test('insertContainerNode appends into a nested group', () => {
    const node = buildFieldNode('Preis', '.price', 'text', null);
    const result = insertContainerNode(tree(), [0], node);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[1]).toEqual(node);
  });

  test('insertContainerNode does not mutate the original tree', () => {
    const original = tree();
    insertContainerNode(original, [0], buildFieldNode('X', '.x', 'text', null));
    expect(original[0].children).toHaveLength(1);
  });

  test('removeGroupTreeNode removes a root node', () => {
    const result = removeGroupTreeNode(tree(), [0]);
    expect(result).toEqual([]);
  });

  test('removeGroupTreeNode removes a nested node', () => {
    const result = removeGroupTreeNode(tree(), [0, 0]);
    expect(result[0].children).toEqual([]);
  });
});

// Issue #177
describe('updateGroupTreeNode', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
      children: [
        { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null },
      ],
    },
    { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null },
  ];

  test('renames a root node without touching its siblings', () => {
    const result = updateGroupTreeNode(tree(), [1], (node) => ({ ...node, name: 'Kosten' }));
    expect(result[1].name).toBe('Kosten');
    expect(result[0].name).toBe('Kategorie'); // untouched
  });

  test('renames a nested node without touching its parent or siblings', () => {
    const result = updateGroupTreeNode(tree(), [0, 0], (node) => ({ ...node, name: 'Name' }));
    expect(result[0].children[0].name).toBe('Name');
    expect(result[0].name).toBe('Kategorie');
    expect(result[0].selector).toBe('section.menu-category');
  });

  test('does not mutate the original tree', () => {
    const original = tree();
    updateGroupTreeNode(original, [1], (node) => ({ ...node, name: 'Kosten' }));
    expect(original[1].name).toBe('Preis');
  });
});

// Issue #177
describe('moveGroupTreeNode', () => {
  const tree = () => [
    { kind: 'field', name: 'A', selector: '.a', mode: 'text', attribute: null },
    { kind: 'field', name: 'B', selector: '.b', mode: 'text', attribute: null },
    {
      kind: 'group', name: 'Kategorie', selector: 'section', repeating: true,
      children: [
        { kind: 'field', name: 'X', selector: '.x', mode: 'text', attribute: null },
        { kind: 'field', name: 'Y', selector: '.y', mode: 'text', attribute: null },
      ],
    },
  ];

  test('swaps two root-level siblings moving down', () => {
    const result = moveGroupTreeNode(tree(), [0], 1);
    expect(result.map(n => n.name)).toEqual(['B', 'A', 'Kategorie']);
  });

  test('swaps two root-level siblings moving up', () => {
    const result = moveGroupTreeNode(tree(), [1], -1);
    expect(result.map(n => n.name)).toEqual(['B', 'A', 'Kategorie']);
  });

  test('swaps two nested siblings under the same parent', () => {
    const result = moveGroupTreeNode(tree(), [2, 0], 1);
    expect(result[2].children.map(n => n.name)).toEqual(['Y', 'X']);
  });

  test('no-ops past the top boundary', () => {
    const result = moveGroupTreeNode(tree(), [0], -1);
    expect(result).toEqual(tree());
  });

  test('no-ops past the bottom boundary', () => {
    const result = moveGroupTreeNode(tree(), [2], 1);
    expect(result).toEqual(tree());
  });

  test('no-ops for a single-child list', () => {
    const single = [{ kind: 'field', name: 'Solo', selector: '.solo', mode: 'text', attribute: null }];
    expect(moveGroupTreeNode(single, [0], 1)).toEqual(single);
    expect(moveGroupTreeNode(single, [0], -1)).toEqual(single);
  });

  test('does not mutate the original tree', () => {
    const original = tree();
    moveGroupTreeNode(original, [0], 1);
    expect(original.map(n => n.name)).toEqual(['A', 'B', 'Kategorie']);
  });
});

// ── hasRepeatingAncestor ─────────────────────────────────────────────────────
// Determines whether a new node's selector will be re-evaluated once per
// repeating instance — see content-script.ts's avoidId (an id-based
// selector would then only ever match one of the N instances).

describe('hasRepeatingAncestor', () => {
  const treeWithRepeatingRoot = () => [
    {
      kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
      children: [
        {
          kind: 'group', name: 'Speise', selector: 'li.menu-item', repeating: false,
          children: [],
        },
      ],
    },
  ];

  const treeWithNonRepeatingRoot = () => [
    {
      kind: 'group', name: 'Header', selector: 'header', repeating: false,
      children: [
        { kind: 'field', name: 'Titel', selector: 'h1', mode: 'text', attribute: null },
      ],
    },
  ];

  test('false for a null/empty path', () => {
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), null)).toBe(false);
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), [])).toBe(false);
  });

  test('true when the immediate parent is repeating', () => {
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), [0])).toBe(true);
  });

  test('true when a non-repeating parent has a repeating ancestor further up', () => {
    // path [0, 0] = the non-repeating "Speise" group, nested inside repeating "Kategorie"
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), [0, 0])).toBe(true);
  });

  test('false when neither the parent nor any ancestor repeats', () => {
    expect(hasRepeatingAncestor(treeWithNonRepeatingRoot(), [0])).toBe(false);
  });
});

describe('serializeGroupTree', () => {
  test('strips internal `kind` and shapes group/field nodes for the wire', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
        children: [
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null },
          { kind: 'field', name: 'Link', selector: 'a', mode: 'attribute', attribute: 'href' },
          { kind: 'field', name: 'Vegan', selector: '.vegan', mode: 'exists', attribute: null },
        ],
      },
    ];

    expect(serializeGroupTree(groups)).toEqual([
      {
        name: 'Kategorie', selector: 'section.menu-category', repeating: true,
        children: [
          { name: 'Titel', selector: 'h2', mode: 'Text' },
          { name: 'Link', selector: 'a', mode: 'Attribute', attribute: 'href' },
          { name: 'Vegan', selector: '.vegan', mode: 'Exists' },
        ],
      },
    ]);
  });

  test('a text/exists field has no attribute key at all', () => {
    const groups = [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }];
    expect(serializeGroupTree(groups)[0]).not.toHaveProperty('attribute');
  });

  // Issue #169
  test('an ownText field serializes to wire mode "OwnText" with no attribute key', () => {
    const groups = [{ kind: 'field', name: 'Name', selector: 'h3.item-name', mode: 'ownText', attribute: null }];
    const [field] = serializeGroupTree(groups);
    expect(field.mode).toBe('OwnText');
    expect(field).not.toHaveProperty('attribute');
  });

  // Issue #42, Phase 7
  test('includes framePath on both group and field nodes when set, omits it when null', () => {
    const groups = [
      {
        kind: 'group', name: 'Preisvergleich', selector: '#price-widget', repeating: false,
        framePath: ['#price-widget'],
        children: [
          { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null, framePath: ['#price-widget'] },
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, framePath: null },
        ],
      },
    ];
    const [group] = serializeGroupTree(groups);
    expect(group.framePath).toEqual(['#price-widget']);
    expect(group.children[0].framePath).toEqual(['#price-widget']);
    expect(group.children[1]).not.toHaveProperty('framePath');
  });

  // Issue #84
  test('includes transforms on a field node when set, omits it when null', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', selector: 'section', repeating: true,
        children: [
          { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', transforms: [{ kind: 'trim' }, { kind: 'toNumber' }] },
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', transforms: null },
        ],
      },
    ];
    const [group] = serializeGroupTree(groups);
    expect(group.children[0].transforms).toEqual([{ kind: 'trim' }, { kind: 'toNumber' }]);
    expect(group.children[1]).not.toHaveProperty('transforms');
  });
});

describe('formatGroupNodeLabel', () => {
  test('group label includes repeating/single', () => {
    expect(formatGroupNodeLabel(buildGroupNode('Kategorie', 'section', true))).toBe('Kategorie (wiederholend)');
    expect(formatGroupNodeLabel(buildGroupNode('Header', 'header', false))).toBe('Header (einzeln)');
  });

  test('field label reflects mode', () => {
    expect(formatGroupNodeLabel(buildFieldNode('Titel', 'h2', 'text', null))).toBe('Titel — Text');
    expect(formatGroupNodeLabel(buildFieldNode('Link', 'a', 'attribute', 'href'))).toBe('Link — Attribut: href');
    expect(formatGroupNodeLabel(buildFieldNode('Vegan', '.v', 'exists', null))).toBe('Vegan — Vorhanden?');
    // Issue #169
    expect(formatGroupNodeLabel(buildFieldNode('Name', 'h3.item-name', 'ownText', null))).toBe('Name — Nur eigener Text');
  });
});

describe('renderGroupTree', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="group-tree-root"></ul>';
  });

  test('renders nested groups and fields with add/remove buttons', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
        children: [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }],
      },
    ]);

    const nodes = document.querySelectorAll('.group-tree-node');
    expect(nodes).toHaveLength(2);

    const groupRow = document.querySelector('[data-path="[0]"] > .group-tree-row');
    expect(groupRow.querySelector('.group-tree-name').value).toBe('Kategorie');
    expect(groupRow.querySelector('.group-tree-label').textContent).toBe('(wiederholend)');
    expect(groupRow.querySelector('.btn-add-subcontainer')).not.toBeNull();
    expect(groupRow.querySelector('.btn-add-subfield')).not.toBeNull();
    expect(groupRow.querySelector('.btn-remove-group-node')).not.toBeNull();

    const fieldRow = document.querySelector('[data-path="[0,0]"] > .group-tree-row');
    expect(fieldRow.querySelector('.group-tree-name').value).toBe('Titel');
    expect(fieldRow.querySelector('.group-tree-label').textContent).toBe('— Text');
    expect(fieldRow.querySelector('.btn-add-subcontainer')).toBeNull(); // fields can't have children
    expect(fieldRow.querySelector('.btn-remove-group-node')).not.toBeNull();
  });

  test('nested groups start expanded, unlike the DOM tree view', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Kategorie', selector: 'section', repeating: true,
        children: [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }],
      },
    ]);
    const childUl = document.querySelector('[data-path="[0]"] > .group-tree-children');
    expect(childUl.classList.contains('hidden')).toBe(false);
  });

  // Issue #139: the toggle used to swap between two Unicode glyphs (▸/▾) via
  // textContent; it's now one static chevron SVG rotated via a .collapsed
  // class, toggled together with the existing .hidden class on the children.
  test('the toggle renders a chevron icon and toggles .collapsed together with the children', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Kategorie', selector: 'section', repeating: true,
        children: [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }],
      },
    ]);
    const toggle = document.querySelector('[data-path="[0]"] > .group-tree-row .group-tree-toggle');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(toggle.classList.contains('collapsed')).toBe(false); // starts expanded

    const childUl = document.querySelector('[data-path="[0]"] > .group-tree-children');
    toggle.click();
    expect(childUl.classList.contains('hidden')).toBe(true);
    expect(toggle.classList.contains('collapsed')).toBe(true);

    toggle.click();
    expect(childUl.classList.contains('hidden')).toBe(false);
    expect(toggle.classList.contains('collapsed')).toBe(false);
  });

  // Issue #42, Phase 7
  test('shows an iframe badge only for a node with a framePath', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Preisvergleich', selector: '#price-widget', repeating: false,
        framePath: ['#price-widget'],
        children: [
          { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null, framePath: ['#price-widget'] },
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, framePath: null },
        ],
      },
    ]);

    const groupRow = document.querySelector('[data-path="[0]"] > .group-tree-row');
    expect(groupRow.querySelector('.frame-badge').title).toContain('#price-widget');

    const framedFieldRow = document.querySelector('[data-path="[0,0]"] > .group-tree-row');
    expect(framedFieldRow.querySelector('.frame-badge')).not.toBeNull();

    const plainFieldRow = document.querySelector('[data-path="[0,1]"] > .group-tree-row');
    expect(plainFieldRow.querySelector('.frame-badge')).toBeNull();
  });
});
