require('./test-support/popup-env');
const {
  buildFieldNode,
  serializeGroupTree,
  buildApiGroupDraft,
  buildApiFieldDraft,
  resolveApiTreeNode,
  insertApiTreeNode,
  removeApiTreeNode,
  collectPrecedingApiFieldSiblingNames,
  serializeApiTree,
  renderApiTree,
  updateApiTreeNode,
  apiTreeNodesHaveNonBlankNames,
  lastPathSegmentName,
  buildApiSubtreeFromCandidate,
  resolveApiGroupScopePath,
  countApiConfigFields,
} = require('./popup');

// ── API-Mode tree (ApiGroup/ApiField, Issue #54 Phase A4) ───────────────────
// Near-verbatim mirror of the Container-Mode tree tests above — same tree
// machinery, different field names (path instead of selector, no
// mode/attribute/repeating/framePath).

describe('resolveApiTreeNode / insertApiTreeNode / removeApiTreeNode', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', path: 'categories',
      children: [
        { kind: 'field', name: 'Name', path: 'name' },
      ],
    },
  ];

  test('resolveApiTreeNode returns null for a null/empty path', () => {
    expect(resolveApiTreeNode(tree(), null)).toBeNull();
    expect(resolveApiTreeNode(tree(), [])).toBeNull();
  });

  test('resolveApiTreeNode walks nested paths', () => {
    expect(resolveApiTreeNode(tree(), [0]).name).toBe('Kategorie');
    expect(resolveApiTreeNode(tree(), [0, 0]).name).toBe('Name');
  });

  test('insertApiTreeNode appends at root when parentPath is null', () => {
    const node = buildApiGroupDraft('Produkte', 'products');
    const result = insertApiTreeNode(tree(), null, node);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(node);
  });

  test('insertApiTreeNode appends into a nested group', () => {
    const node = buildApiFieldDraft('Preis', 'price');
    const result = insertApiTreeNode(tree(), [0], node);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[1]).toEqual(node);
  });

  test('insertApiTreeNode does not mutate the original tree', () => {
    const original = tree();
    insertApiTreeNode(original, [0], buildApiFieldDraft('X', 'x'));
    expect(original[0].children).toHaveLength(1);
  });

  test('removeApiTreeNode removes a root node', () => {
    expect(removeApiTreeNode(tree(), [0])).toEqual([]);
  });

  test('removeApiTreeNode removes a nested node', () => {
    const result = removeApiTreeNode(tree(), [0, 0]);
    expect(result[0].children).toEqual([]);
  });
});

// Issue #206: the combineFields/splitField source-field picker's option list
// for an *already-placed* ApiField leaf (modal-api-field-transforms reopens
// against an existing node, unlike flat/container mode's own "always a new
// field" modals) — only siblings declared strictly before its own position
// within the same parent group are offered.
describe('collectPrecedingApiFieldSiblingNames', () => {
  const groups = () => [
    {
      kind: 'group', name: 'Kategorie', path: 'categories',
      children: [
        { kind: 'field', name: 'Strasse', path: 'street' },
        { kind: 'group', name: 'Innen', path: 'inner', children: [{ kind: 'field', name: 'Tief', path: 'deep' }] },
        { kind: 'field', name: 'Hausnummer', path: 'number' },
        { kind: 'field', name: 'Adresse', path: 'address' },
      ],
    },
  ];

  test('returns an empty list for a null/empty path', () => {
    expect(collectPrecedingApiFieldSiblingNames(groups(), null)).toEqual([]);
    expect(collectPrecedingApiFieldSiblingNames(groups(), [])).toEqual([]);
  });

  test('returns only field siblings declared before the given path, excluding groups', () => {
    // path [0, 3] is "Adresse" — preceding siblings are Strasse, Innen (a
    // group, excluded), Hausnummer.
    expect(collectPrecedingApiFieldSiblingNames(groups(), [0, 3])).toEqual(['Strasse', 'Hausnummer']);
  });

  test('does not offer a sibling declared after the given path', () => {
    // path [0, 0] is "Strasse" itself — nothing precedes it.
    expect(collectPrecedingApiFieldSiblingNames(groups(), [0, 0])).toEqual([]);
  });

  test('scopes strictly to the immediate parent group', () => {
    expect(collectPrecedingApiFieldSiblingNames(groups(), [0, 1, 0])).toEqual([]);
  });
});

// Issue #84 follow-up: buildApiFieldDraft carries an optional transform
// chain, mirroring Container-Mode's own buildFieldNode default.
describe('buildApiFieldDraft transforms', () => {
  test('defaults to null when no transforms are given', () => {
    expect(buildApiFieldDraft('Preis', 'price')).toEqual({ kind: 'field', name: 'Preis', path: 'price', transforms: null, sampleValue: undefined, hiddenFromOutput: false });
  });

  test('carries an explicit transform chain', () => {
    const transforms = [{ kind: 'trim' }, { kind: 'toNumber' }];
    expect(buildApiFieldDraft('Preis', 'price', transforms)).toEqual({ kind: 'field', name: 'Preis', path: 'price', transforms, sampleValue: undefined, hiddenFromOutput: false });
  });

  // Issue #147: sampleValue is the popup-internal raw value the
  // transform-chain modal's live preview runs against later.
  test('sampleValue defaults to undefined when not given', () => {
    expect(buildApiFieldDraft('Preis', 'price').sampleValue).toBeUndefined();
  });

  test('carries an explicit sampleValue', () => {
    expect(buildApiFieldDraft('Preis', 'price', null, '12,99 €').sampleValue).toBe('12,99 €');
  });
});

describe('serializeApiTree', () => {
  test('strips internal `kind` and shapes group/field nodes for the wire, round-tripping a 3-level tree', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [
          { kind: 'field', name: 'Name', path: 'name' },
          {
            kind: 'group', name: 'Subkategorie', path: 'subcategories',
            children: [
              { kind: 'field', name: 'Name', path: 'name' },
              {
                kind: 'group', name: 'Produkt', path: 'products',
                children: [{ kind: 'field', name: 'Titel', path: 'title' }],
              },
            ],
          },
        ],
      },
    ];

    expect(serializeApiTree(groups)).toEqual([
      {
        name: 'Kategorie', path: 'categories',
        children: [
          { name: 'Name', path: 'name' },
          {
            name: 'Subkategorie', path: 'subcategories',
            children: [
              { name: 'Name', path: 'name' },
              { name: 'Produkt', path: 'products', children: [{ name: 'Titel', path: 'title' }] },
            ],
          },
        ],
      },
    ]);
  });

  test('a group with an empty path (array-of-arrays, see ApiGroup.Path) round-trips unchanged', () => {
    const groups = [{ kind: 'group', name: 'Zeile', path: '', children: [{ kind: 'field', name: 'Titel', path: 'title' }] }];
    expect(serializeApiTree(groups)[0].path).toBe('');
  });

  test('a field node never has a `children` key', () => {
    const groups = [{ kind: 'field', name: 'Titel', path: 'title' }];
    expect(serializeApiTree(groups)[0]).not.toHaveProperty('children');
  });

  // Issue #84 follow-up: same "omit rather than send an empty/null key"
  // convention Container-Mode's own serializeGroupTree already uses.
  test('a field with a non-empty transform chain includes it on the wire', () => {
    const groups = [{ kind: 'field', name: 'Preis', path: 'price', transforms: [{ kind: 'trim' }, { kind: 'toNumber' }] }];
    expect(serializeApiTree(groups)[0].transforms).toEqual([{ kind: 'trim' }, { kind: 'toNumber' }]);
  });

  test('a field with a null or empty transform chain omits the key entirely', () => {
    const groups = [
      { kind: 'field', name: 'A', path: 'a', transforms: null },
      { kind: 'field', name: 'B', path: 'b', transforms: [] },
    ];
    const result = serializeApiTree(groups);
    expect(result[0]).not.toHaveProperty('transforms');
    expect(result[1]).not.toHaveProperty('transforms');
  });
});

describe('updateApiTreeNode / apiTreeNodesHaveNonBlankNames (Phase A5)', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', path: 'categories',
      children: [{ kind: 'field', name: 'Name', path: 'name' }],
    },
  ];

  test('updateApiTreeNode renames a root node', () => {
    const result = updateApiTreeNode(tree(), [0], node => ({ ...node, name: 'Kat.' }));
    expect(result[0].name).toBe('Kat.');
    expect(result[0].children).toEqual(tree()[0].children);
  });

  test('updateApiTreeNode renames a nested node without touching siblings', () => {
    const result = updateApiTreeNode(tree(), [0, 0], node => ({ ...node, name: 'Titel' }));
    expect(result[0].children[0].name).toBe('Titel');
    expect(result[0].name).toBe('Kategorie');
  });

  test('updateApiTreeNode does not mutate the original tree', () => {
    const original = tree();
    updateApiTreeNode(original, [0], node => ({ ...node, name: 'X' }));
    expect(original[0].name).toBe('Kategorie');
  });

  test('apiTreeNodesHaveNonBlankNames is true when every node (recursively) has a name', () => {
    expect(apiTreeNodesHaveNonBlankNames(tree())).toBe(true);
  });

  test('apiTreeNodesHaveNonBlankNames is false when a leaf name is blank', () => {
    const blank = updateApiTreeNode(tree(), [0, 0], node => ({ ...node, name: '  ' }));
    expect(apiTreeNodesHaveNonBlankNames(blank)).toBe(false);
  });

  test('apiTreeNodesHaveNonBlankNames is false when a group name is blank, even if its children are fine', () => {
    const blank = updateApiTreeNode(tree(), [0], node => ({ ...node, name: '' }));
    expect(apiTreeNodesHaveNonBlankNames(blank)).toBe(false);
  });
});

describe('lastPathSegmentName (Phase A5)', () => {
  test('returns the last plain key of a dot-path', () => {
    expect(lastPathSegmentName('data.categories')).toBe('categories');
    expect(lastPathSegmentName('subcategories')).toBe('subcategories');
  });

  test('returns null for an empty path (the array-of-arrays case)', () => {
    expect(lastPathSegmentName('')).toBeNull();
  });
});

describe('resolveApiGroupScopePath (Phase A5)', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', path: 'categories',
      children: [{
        kind: 'group', name: 'Subkategorie', path: 'subcategories',
        children: [{ kind: 'field', name: 'Name', path: 'name' }],
      }],
    },
  ];

  test('a root group scope is its own path plus a first-instance index', () => {
    expect(resolveApiGroupScopePath(tree(), [0])).toBe('categories[0]');
  });

  test('a nested group scope chains each ancestor\'s first-instance index', () => {
    expect(resolveApiGroupScopePath(tree(), [0, 0])).toBe('categories[0].subcategories[0]');
  });

  test('an empty-path group (array-of-arrays) appends its index directly, no dot', () => {
    const arrayOfArrays = [{ kind: 'group', name: 'Zeile', path: 'rows', children: [{ kind: 'group', name: 'Eintrag', path: '', children: [] }] }];
    expect(resolveApiGroupScopePath(arrayOfArrays, [0, 0])).toBe('rows[0][0]');
  });
});

describe('buildApiSubtreeFromCandidate (Phase A5)', () => {
  // Mirrors Phase 0's catalog fixture: categories[*] → subcategories[*] →
  // products[*], three independent repeating levels.
  const deepCandidate = { path: 'categories[0].subcategories[1].products[2].title', treeSkeleton: [
    { kind: 'group', path: 'categories' }, { kind: 'group', path: 'subcategories' },
    { kind: 'group', path: 'products' }, { kind: 'field', path: 'title' },
  ] };

  test('a single-level match (skipSegments 0) becomes one auto-named group wrapping the named field', () => {
    const oneLevel = { path: 'data.items[0].name', treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }] };
    expect(buildApiSubtreeFromCandidate(oneLevel, 'Titel', [])).toEqual([
      { kind: 'group', name: 'items', path: 'data.items', children: [{ kind: 'field', name: 'Titel', path: 'name', transforms: null, sampleValue: undefined, hiddenFromOutput: false }] },
    ]);
  });

  test('a multi-level match (skipSegments 0) nests every intermediate group, auto-named from its own path', () => {
    const [root] = buildApiSubtreeFromCandidate(deepCandidate, 'Titel', []);
    expect(root).toEqual({
      kind: 'group', name: 'categories', path: 'categories',
      children: [{
        kind: 'group', name: 'subcategories', path: 'subcategories',
        children: [{
          kind: 'group', name: 'products', path: 'products',
          children: [{ kind: 'field', name: 'Titel', path: 'title', transforms: null, sampleValue: undefined, hiddenFromOutput: false }],
        }],
      }],
    });
  });

  test('sibling names become extra field leaves at the innermost scope, keyed by their own name', () => {
    const oneLevel = { path: 'data.items[0].name', treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }] };
    const [root] = buildApiSubtreeFromCandidate(oneLevel, 'Titel', ['price', 'unit']);
    expect(root.children).toEqual([
      { kind: 'field', name: 'Titel', path: 'name', transforms: null, sampleValue: undefined, hiddenFromOutput: false },
      { kind: 'field', name: 'price', path: 'price', transforms: null, sampleValue: undefined, hiddenFromOutput: false },
      { kind: 'field', name: 'unit', path: 'unit', transforms: null, sampleValue: undefined, hiddenFromOutput: false },
    ]);
  });

  // Issue #147: the leaf field's own sampleValue comes from candidate.value;
  // each picked sibling's sampleValue is looked up by name in
  // candidate.siblings (content-script.ts's siblingFields shape).
  test('the leaf field and picked siblings carry their own sampleValue from the candidate', () => {
    const oneLevel = {
      path: 'data.items[0].name', value: 'Smartphone X',
      treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
      siblings: [{ name: 'price', path: 'price', value: 499 }, { name: 'unit', path: 'unit', value: null }],
    };
    const [root] = buildApiSubtreeFromCandidate(oneLevel, 'Titel', ['price', 'unit']);
    expect(root.children.map(c => c.sampleValue)).toEqual(['Smartphone X', 499, null]);
  });

  test('a sibling name with no matching candidate.siblings entry gets an undefined sampleValue', () => {
    const oneLevel = {
      path: 'data.items[0].name', value: 'Smartphone X',
      treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
      siblings: [],
    };
    const [root] = buildApiSubtreeFromCandidate(oneLevel, 'Titel', ['price']);
    expect(root.children[1].sampleValue).toBeUndefined();
  });

  test('a candidate with no siblings array at all (older fixture shape) does not throw', () => {
    const oneLevel = { path: 'data.items[0].name', treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }] };
    expect(() => buildApiSubtreeFromCandidate(oneLevel, 'Titel', ['price'])).not.toThrow();
  });

  // skipSegments (Phase A5's "add sub-field"/"add root group" reuse): the
  // target group's own tree depth's worth of leading skeleton segments are
  // already represented by existing ancestors — see resolveApiGroupScopePath.
  test('skipSegments strips already-represented ancestor levels — a sibling field at the innermost scope needs no new group at all', () => {
    expect(buildApiSubtreeFromCandidate(deepCandidate, 'Titel', [], 3)).toEqual([{ kind: 'field', name: 'Titel', path: 'title', transforms: null, sampleValue: undefined, hiddenFromOutput: false }]);
  });

  test('skipSegments partway through still nests the remaining levels', () => {
    const [node] = buildApiSubtreeFromCandidate(deepCandidate, 'Titel', [], 1);
    expect(node).toEqual({
      kind: 'group', name: 'subcategories', path: 'subcategories',
      children: [{ kind: 'group', name: 'products', path: 'products', children: [{ kind: 'field', name: 'Titel', path: 'title', transforms: null, sampleValue: undefined, hiddenFromOutput: false }] }],
    });
  });

  test('an empty-path group segment (array-of-arrays) falls back to the generic default name', () => {
    const arrayOfArrays = { path: 'rows[0][0].title', treeSkeleton: [
      { kind: 'group', path: 'rows' }, { kind: 'group', path: '' }, { kind: 'field', path: 'title' },
    ] };
    const [root] = buildApiSubtreeFromCandidate(arrayOfArrays, 'Titel', []);
    expect(root.children[0].name).toBe('Gruppe'); // apiTree.defaultGroupName (German, this test file's fixed language)
    expect(root.children[0].path).toBe('');
  });
});

describe('countApiConfigFields (Phase A5)', () => {
  test('counts a flat ApiConfig.Fields array directly', () => {
    expect(countApiConfigFields({ fields: [{ name: 'a', path: 'a' }, { name: 'b', path: 'b' }] })).toBe(2);
  });

  test('counts every leaf ApiField anywhere in a tree-shaped ApiConfig.Groups, at any depth', () => {
    const apiConfig = {
      groups: [{
        name: 'Kategorie', path: 'categories',
        children: [
          { name: 'Name', path: 'name' },
          { name: 'Subkategorie', path: 'subcategories', children: [{ name: 'Titel', path: 'title' }, { name: 'Preis', path: 'price' }] },
        ],
      }],
    };
    expect(countApiConfigFields(apiConfig)).toBe(3);
  });
});

describe('renderApiTree', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="api-tree-root"></ul>';
  });

  test('renders nested groups and fields with add/remove buttons', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [{ kind: 'field', name: 'Titel', path: 'name' }],
      },
    ]);

    const nodes = document.querySelectorAll('.api-tree-node');
    expect(nodes).toHaveLength(2);

    const groupRow = document.querySelector('[data-path="[0]"] > .api-tree-row');
    expect(groupRow.querySelector('.api-tree-name').value).toBe('Kategorie');
    expect(groupRow.querySelector('.api-tree-path').textContent).toBe('categories');
    expect(groupRow.querySelector('.btn-add-api-subgroup')).not.toBeNull();
    expect(groupRow.querySelector('.btn-add-api-subfield')).not.toBeNull();
    expect(groupRow.querySelector('.btn-remove-api-node')).not.toBeNull();

    const fieldRow = document.querySelector('[data-path="[0,0]"] > .api-tree-row');
    expect(fieldRow.querySelector('.api-tree-name').value).toBe('Titel');
    expect(fieldRow.querySelector('.api-tree-path').textContent).toBe('name');
    expect(fieldRow.querySelector('.btn-add-api-subgroup')).toBeNull(); // fields can't have children
    expect(fieldRow.querySelector('.btn-remove-api-node')).not.toBeNull();
  });

  // Issue #139: same chevron-SVG-plus-.collapsed-class refactor as the
  // Container-Mode tree above, applied identically here.
  test('the toggle renders a chevron icon and toggles .collapsed together with the children', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [{ kind: 'field', name: 'Titel', path: 'name' }],
      },
    ]);
    const toggle = document.querySelector('[data-path="[0]"] > .api-tree-row .api-tree-toggle');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(toggle.classList.contains('collapsed')).toBe(false); // starts expanded

    const childUl = document.querySelector('[data-path="[0]"] > .api-tree-children');
    toggle.click();
    expect(childUl.classList.contains('hidden')).toBe(true);
    expect(toggle.classList.contains('collapsed')).toBe(true);
  });

  test('a 3-level tree renders with correct nesting/indentation', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [
          {
            kind: 'group', name: 'Subkategorie', path: 'subcategories',
            children: [
              {
                kind: 'group', name: 'Produkt', path: 'products',
                children: [{ kind: 'field', name: 'Titel', path: 'title' }],
              },
            ],
          },
        ],
      },
    ]);

    expect(document.querySelectorAll('.api-tree-node')).toHaveLength(4);
    const leafRow = document.querySelector('[data-path="[0,0,0,0]"] > .api-tree-row');
    expect(leafRow.querySelector('.api-tree-name').value).toBe('Titel');
    expect(leafRow.querySelector('.api-tree-path').textContent).toBe('title');
    // Each level is indented 12px further than its parent (depth * 12px).
    const rootRow = document.querySelector('[data-path="[0]"] > .api-tree-row');
    expect(rootRow.style.paddingLeft).toBe('0px');
    expect(leafRow.style.paddingLeft).toBe('36px');
  });

  test('groups start expanded, unlike the DOM tree view', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [{ kind: 'field', name: 'Titel', path: 'name' }],
      },
    ]);
    const childUl = document.querySelector('[data-path="[0]"] > .api-tree-children');
    expect(childUl.classList.contains('hidden')).toBe(false);
  });
});
