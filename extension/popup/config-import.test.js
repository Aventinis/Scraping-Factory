const { applyOutputBlueprintConfig } = require('./config-import');

// Issue #191/#244: applyOutputBlueprintConfig is the reverse of
// buildOutputBlueprintMapping — reproducing the mapping picker's own state
// from a wire-format OutputBlueprintMapping (e.g. loaded from a saved
// configuration's own config.outputBlueprint), without a round trip back to
// the companion.
describe('config-import: applyOutputBlueprintConfig', () => {
  test('null wire resets to the empty (no blueprint picked) state', () => {
    expect(applyOutputBlueprintConfig(null)).toEqual({
      selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
      selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
    });
  });

  test('Flat wire reproduces the target-field list and mapping draft', () => {
    const wire = {
      blueprintId: 7,
      schemaKind: 'Flat',
      fields: [
        { targetField: 'name', sourceField: 'Titel' },
        { targetField: 'cost', sourceField: 'Preis' },
      ],
    };

    expect(applyOutputBlueprintConfig(wire)).toEqual({
      selectedOutputBlueprintId: '7',
      selectedOutputBlueprintFieldNames: ['name', 'cost'],
      outputBlueprintMapping: { name: 'Titel', cost: 'Preis' },
      selectedOutputBlueprintSchemaKind: 'Flat',
      selectedOutputBlueprintTree: [],
      outputBlueprintTreeMapping: {},
    });
  });

  test('Flat wire without a blueprintId leaves the id blank', () => {
    const wire = { schemaKind: 'Flat', fields: [{ targetField: 'name', sourceField: 'Titel' }] };
    expect(applyOutputBlueprintConfig(wire).selectedOutputBlueprintId).toBe('');
  });

  // Issue #244: the tree-shaped counterpart — rebuilds both the target tree
  // (without the leaf's own sourceField, matching the shape
  // createTreeMappingDraft's own tree parameter expects) and the path-keyed
  // mapping draft in one walk.
  test('Tree wire reproduces the target tree and the path-keyed mapping draft', () => {
    const wire = {
      blueprintId: 9,
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
    };

    const result = applyOutputBlueprintConfig(wire);

    expect(result.selectedOutputBlueprintId).toBe('9');
    expect(result.selectedOutputBlueprintSchemaKind).toBe('Tree');
    expect(result.selectedOutputBlueprintFieldNames).toEqual([]);
    expect(result.outputBlueprintMapping).toEqual({});
    expect(result.selectedOutputBlueprintTree).toEqual([
      {
        name: 'Kategorien',
        children: [
          { name: 'Name' },
          { name: 'Gerichte', children: [{ name: 'Preis' }] },
        ],
      },
      { name: 'Zutaten', children: [{ name: 'Name' }] },
    ]);
    expect(result.outputBlueprintTreeMapping).toEqual({
      '0.0': 'KategorieName',
      '0.1.0': 'Preis',
      '1.0': 'ZutatName',
    });
  });
});
