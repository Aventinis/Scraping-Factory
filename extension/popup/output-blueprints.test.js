const {
  addBlueprintFieldName, removeBlueprintFieldName, updateBlueprintFieldName, moveBlueprintFieldName,
  blueprintDraftIsValid,
  createMappingDraft, updateMappingSource, mappingIsComplete, buildOutputBlueprintMapping,
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
    expect(buildOutputBlueprintMapping('', ['Title'], { Title: 'h1' })).toBeNull();
  });

  test('buildOutputBlueprintMapping returns null while the mapping is incomplete', () => {
    expect(buildOutputBlueprintMapping('3', ['Title', 'Price'], { Title: 'h1', Price: null })).toBeNull();
  });

  test('buildOutputBlueprintMapping builds the wire shape, parsing the id and preserving target order', () => {
    const draft = { Price: '.price', Title: 'h1' };
    expect(buildOutputBlueprintMapping('3', ['Title', 'Price'], draft)).toEqual({
      blueprintId: 3,
      fields: [
        { targetField: 'Title', sourceField: 'h1' },
        { targetField: 'Price', sourceField: '.price' },
      ],
    });
  });
});
