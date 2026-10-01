const {
  isDerivedField, buildCombineFieldsTransform, buildSplitFieldTransform,
  combineFieldsIsValid, splitFieldIsValid,
} = require('./combine-split-fields');

describe('isDerivedField', () => {
  test('true when the first transform is combineFields', () => {
    expect(isDerivedField([{ kind: 'combineFields', sourceFieldNames: ['A', 'B'], separator: ' ' }])).toBe(true);
  });

  test('true when the first transform is splitField', () => {
    expect(isDerivedField([{ kind: 'splitField', sourceFieldName: 'A', separator: ',', index: 0 }])).toBe(true);
  });

  test('false when the first transform is a different kind', () => {
    expect(isDerivedField([{ kind: 'trim' }, { kind: 'combineFields', sourceFieldNames: ['A', 'B'] }])).toBe(false);
  });

  test('false for null/undefined/empty transforms', () => {
    expect(isDerivedField(null)).toBe(false);
    expect(isDerivedField(undefined)).toBe(false);
    expect(isDerivedField([])).toBe(false);
  });
});

describe('buildCombineFieldsTransform / buildSplitFieldTransform', () => {
  test('buildCombineFieldsTransform defaults separator to a single space', () => {
    expect(buildCombineFieldsTransform(['A', 'B'], '')).toEqual({ kind: 'combineFields', sourceFieldNames: ['A', 'B'], separator: ' ' });
  });

  test('buildCombineFieldsTransform keeps an explicit separator', () => {
    expect(buildCombineFieldsTransform(['A', 'B'], ', ')).toEqual({ kind: 'combineFields', sourceFieldNames: ['A', 'B'], separator: ', ' });
  });

  test('buildSplitFieldTransform defaults separator/index', () => {
    expect(buildSplitFieldTransform('A', '', null)).toEqual({ kind: 'splitField', sourceFieldName: 'A', separator: ' ', index: 0 });
  });

  test('buildSplitFieldTransform keeps an explicit separator/index', () => {
    expect(buildSplitFieldTransform('A', ',', 2)).toEqual({ kind: 'splitField', sourceFieldName: 'A', separator: ',', index: 2 });
  });

  test('buildSplitFieldTransform rejects a negative index back to 0', () => {
    expect(buildSplitFieldTransform('A', ',', -1).index).toBe(0);
  });
});

describe('combineFieldsIsValid / splitFieldIsValid', () => {
  test('combineFieldsIsValid requires at least 2 picked fields', () => {
    expect(combineFieldsIsValid([])).toBe(false);
    expect(combineFieldsIsValid(['A'])).toBe(false);
    expect(combineFieldsIsValid(['A', 'B'])).toBe(true);
  });

  test('splitFieldIsValid requires a non-blank picked field', () => {
    expect(splitFieldIsValid('')).toBe(false);
    expect(splitFieldIsValid('   ')).toBe(false);
    expect(splitFieldIsValid('A')).toBe(true);
  });
});
