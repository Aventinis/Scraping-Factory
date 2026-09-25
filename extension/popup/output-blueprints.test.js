const {
  addBlueprintFieldName, removeBlueprintFieldName, updateBlueprintFieldName, moveBlueprintFieldName,
  blueprintDraftIsValid,
  buildBlueprintSchemaGroup, buildBlueprintSchemaField, parseBlueprintSchemaTree, serializeBlueprintSchemaTree,
  blueprintTreeSchemaIsValid,
  createMappingDraft, updateMappingSource, mappingIsComplete,
  createTreeMappingDraft, updateTreeMappingSource, treeMappingIsComplete,
  buildOutputBlueprintMapping,
} = require('./output-blueprints');

describe('output-blueprints (Issue #191): editing a blueprint\'s own field-name list', () => {
  test('addBlueprintFieldName appends one blank entry without mutating the original', () => {
    const original = ['Title'];
    const result = addBlueprintFieldName(original);
    expect(result).toEqual(['Title', '']);
    expect(original).toEqual(['Title']);
  });

  test('removeBlueprintFieldName drops the entry at the given index', () => {
    expect(removeBlueprintFieldName(['A', 'B', 'C'], 1)).toEqual(['A', 'C']);
  });

  test('updateBlueprintFieldName replaces only the targeted entry', () => {
    expect(updateBlueprintFieldName(['A', 'B'], 1, 'Renamed')).toEqual(['A', 'Renamed']);
  });

  test('moveBlueprintFieldName swaps with the adjacent sibling', () => {
    expect(moveBlueprintFieldName(['A', 'B', 'C'], 0, 1)).toEqual(['B', 'A', 'C']);
    expect(moveBlueprintFieldName(['A', 'B', 'C'], 2, -1)).toEqual(['A', 'C', 'B']);
  });

  test('moveBlueprintFieldName is a no-op past either boundary', () => {
    const fieldNames = ['A', 'B'];
    expect(moveBlueprintFieldName(fieldNames, 0, -1)).toBe(fieldNames);
    expect(moveBlueprintFieldName(fieldNames, 1, 1)).toBe(fieldNames);
  });

  test('blueprintDraftIsValid requires a non-blank name and at least one field', () => {
    expect(blueprintDraftIsValid('', ['Title'])).toBe(false);
    expect(blueprintDraftIsValid('  ', ['Title'])).toBe(false);
    expect(blueprintDraftIsValid('My blueprint', [])).toBe(false);
  });

  test('blueprintDraftIsValid rejects a blank field name', () => {
    expect(blueprintDraftIsValid('My blueprint', ['Title', '  '])).toBe(false);
  });

  test('blueprintDraftIsValid rejects duplicate field names after trimming', () => {
    expect(blueprintDraftIsValid('My blueprint', ['Title', ' Title '])).toBe(false);
  });

  test('blueprintDraftIsValid accepts a well-formed draft', () => {
    expect(blueprintDraftIsValid('My blueprint', ['Title', 'Price'])).toBe(true);
  });
});

// Issue #244: the tree-shaped counterpart to the flat field-name list above —
// editing a blueprint's own target schema tree (create/edit modal).
describe('output-blueprints (Issue #244): editing a blueprint\'s own target tree', () => {
  test('buildBlueprintSchemaGroup/buildBlueprintSchemaField build the internal {kind,...} node shape', () => {
    expect(buildBlueprintSchemaGroup('Kategorien')).toEqual({ kind: 'group', name: 'Kategorien', children: [] });
    expect(buildBlueprintSchemaField('Preis')).toEqual({ kind: 'field', name: 'Preis' });
  });

  test('parseBlueprintSchemaTree converts the wire shape (no kind tag) into the internal editor shape', () => {
    const wire = [
      { name: 'Kategorien', children: [{ name: 'Name' }, { name: 'Gerichte', children: [{ name: 'Preis' }] }] },
    ];
    expect(parseBlueprintSchemaTree(wire)).toEqual([
      {
        kind: 'group', name: 'Kategorien',
        children: [
          { kind: 'field', name: 'Name' },
          { kind: 'group', name: 'Gerichte', children: [{ kind: 'field', name: 'Preis' }] },
        ],
      },
    ]);
  });

  test('serializeBlueprintSchemaTree is the exact reverse of parseBlueprintSchemaTree', () => {
    const wire = [
      { name: 'Kategorien', children: [{ name: 'Name' }, { name: 'Gerichte', children: [{ name: 'Preis' }] }] },
    ];
    expect(serializeBlueprintSchemaTree(parseBlueprintSchemaTree(wire))).toEqual(wire);
  });

  test('blueprintTreeSchemaIsValid requires a non-blank blueprint name and at least one node', () => {
    expect(blueprintTreeSchemaIsValid('', [buildBlueprintSchemaField('A')])).toBe(false);
    expect(blueprintTreeSchemaIsValid('My blueprint', [])).toBe(false);
  });

  test('blueprintTreeSchemaIsValid rejects a blank node name at any depth', () => {
    const group = buildBlueprintSchemaGroup('Kategorien');
    group.children = [buildBlueprintSchemaField('  ')];
    expect(blueprintTreeSchemaIsValid('My blueprint', [group])).toBe(false);
  });

  test('blueprintTreeSchemaIsValid rejects a group with no children', () => {
    expect(blueprintTreeSchemaIsValid('My blueprint', [buildBlueprintSchemaGroup('Empty')])).toBe(false);
  });

  test('blueprintTreeSchemaIsValid accepts a well-formed nested tree', () => {
    const group = buildBlueprintSchemaGroup('Kategorien');
    group.children = [buildBlueprintSchemaField('Name')];
    expect(blueprintTreeSchemaIsValid('My blueprint', [group])).toBe(true);
  });
});

describe('output-blueprints (Issue #191): per-scrape mapping draft', () => {
  test('createMappingDraft seeds every target field unset', () => {
    expect(createMappingDraft(['Title', 'Price'])).toEqual({ Title: null, Price: null });
  });

  test('updateMappingSource sets a target field\'s source without touching others', () => {
    const draft = createMappingDraft(['Title', 'Price']);
    const result = updateMappingSource(draft, 'Title', 'h1');
    expect(result).toEqual({ Title: 'h1', Price: null });
    expect(draft.Title).toBeNull(); // original untouched
  });

  test('updateMappingSource clears a source back to null when given an empty string', () => {
    const draft = updateMappingSource(createMappingDraft(['Title']), 'Title', 'h1');
    expect(updateMappingSource(draft, 'Title', '')).toEqual({ Title: null });
  });

  test('mappingIsComplete is false while any target field is unmapped', () => {
    const draft = updateMappingSource(createMappingDraft(['Title', 'Price']), 'Title', 'h1');
    expect(mappingIsComplete(['Title', 'Price'], draft)).toBe(false);
  });

  test('mappingIsComplete is false for an empty target field list', () => {
    expect(mappingIsComplete([], {})).toBe(false);
  });

  test('mappingIsComplete is true once every target field has a source', () => {
    let draft = createMappingDraft(['Title', 'Price']);
    draft = updateMappingSource(draft, 'Title', 'h1');
    draft = updateMappingSource(draft, 'Price', '.price');
    expect(mappingIsComplete(['Title', 'Price'], draft)).toBe(true);
  });

  test('buildOutputBlueprintMapping returns null when no blueprint is picked', () => {
    expect(buildOutputBlueprintMapping('', 'Flat', ['Title'], { Title: 'h1' })).toBeNull();
  });

  test('buildOutputBlueprintMapping returns null while the mapping is incomplete', () => {
    expect(buildOutputBlueprintMapping('3', 'Flat', ['Title', 'Price'], { Title: 'h1', Price: null })).toBeNull();
  });

  test('buildOutputBlueprintMapping builds the wire shape, parsing the id and preserving target order', () => {
    const draft = { Price: '.price', Title: 'h1' };
    expect(buildOutputBlueprintMapping('3', 'Flat', ['Title', 'Price'], draft)).toEqual({
      blueprintId: 3,
      schemaKind: 'Flat',
      fields: [
        { targetField: 'Title', sourceField: 'h1' },
        { targetField: 'Price', sourceField: '.price' },
      ],
    });
  });
});

// Issue #244: the tree-shaped counterpart to the flat mapping draft above.
describe('output-blueprints (Issue #244): per-scrape tree mapping draft', () => {
  const tree = [
    {
      name: 'Kategorien',
      children: [
        { name: 'Name' },
        { name: 'Gerichte', children: [{ name: 'Preis' }] },
      ],
    },
    { name: 'Zutaten', children: [{ name: 'Name' }] },
  ];

  test('createTreeMappingDraft seeds every leaf path unset, keyed by dot-joined index path', () => {
    expect(createTreeMappingDraft(tree)).toEqual({
      '0.0': null, '0.1.0': null, '1.0': null,
    });
  });

  test('updateTreeMappingSource sets one leaf path\'s source without touching others', () => {
    const draft = createTreeMappingDraft(tree);
    const result = updateTreeMappingSource(draft, '0.0', 'KategorieName');
    expect(result['0.0']).toBe('KategorieName');
    expect(result['1.0']).toBeNull();
    expect(draft['0.0']).toBeNull(); // original untouched
  });

  test('updateTreeMappingSource clears a source back to null when given an empty string', () => {
    let draft = createTreeMappingDraft(tree);
    draft = updateTreeMappingSource(draft, '0.0', 'KategorieName');
    expect(updateTreeMappingSource(draft, '0.0', '')['0.0']).toBeNull();
  });

  test('treeMappingIsComplete is false while any leaf is unmapped, and for an empty tree', () => {
    let draft = createTreeMappingDraft(tree);
    draft = updateTreeMappingSource(draft, '0.0', 'KategorieName');
    expect(treeMappingIsComplete(tree, draft)).toBe(false);
    expect(treeMappingIsComplete([], {})).toBe(false);
  });

  test('treeMappingIsComplete is true once every leaf has a source', () => {
    let draft = createTreeMappingDraft(tree);
    draft = updateTreeMappingSource(draft, '0.0', 'KategorieName');
    draft = updateTreeMappingSource(draft, '0.1.0', 'Preis');
    draft = updateTreeMappingSource(draft, '1.0', 'ZutatName');
    expect(treeMappingIsComplete(tree, draft)).toBe(true);
  });

  test('buildOutputBlueprintMapping (Tree) returns null while the tree mapping is incomplete', () => {
    const draft = createTreeMappingDraft(tree);
    expect(buildOutputBlueprintMapping('3', 'Tree', [], {}, tree, draft)).toBeNull();
  });

  test('buildOutputBlueprintMapping (Tree) builds the nested wire shape, one node at a time', () => {
    let draft = createTreeMappingDraft(tree);
    draft = updateTreeMappingSource(draft, '0.0', 'KategorieName');
    draft = updateTreeMappingSource(draft, '0.1.0', 'Preis');
    draft = updateTreeMappingSource(draft, '1.0', 'ZutatName');

    expect(buildOutputBlueprintMapping('3', 'Tree', [], {}, tree, draft)).toEqual({
      blueprintId: 3,
      schemaKind: 'Tree',
      tree: [
        {
          name: 'Kategorien',
          children: [
            { name: 'Name', sourceField: 'KategorieName' },
            { name: 'Gerichte', children: [{ name: 'Preis', sourceField: 'Preis' }] },
          ],
        },
        { name: 'Zutaten', children: [{ name: 'Name', sourceField: 'ZutatName' }] },
      ],
    });
  });
});
