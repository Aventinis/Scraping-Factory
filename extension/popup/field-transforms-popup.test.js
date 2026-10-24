require('./test-support/popup-env');
const {
  createDefaultTransform,
  addTransform,
  removeTransform,
  updateTransform,
  changeTransformKind,
  moveTransform,
  transformsAreValid,
  applyTransformsPreview,
  toNumberPreview,
  toIntegerPreview,
  toBooleanPreview,
  toDatePreview,
} = require('./popup');

// Issue #84: pure data helpers for a field's transform chain.
describe('field-transforms.ts (createDefaultTransform / add / remove / update / changeKind / move / validate)', () => {
  test('createDefaultTransform returns the right shape per kind', () => {
    expect(createDefaultTransform('trim')).toEqual({ kind: 'trim' });
    expect(createDefaultTransform('regexExtract')).toEqual({ kind: 'regexExtract', pattern: '', group: 0 });
    expect(createDefaultTransform('replace')).toEqual({ kind: 'replace', find: '', replacement: '' });
    expect(createDefaultTransform('toNumber')).toEqual({ kind: 'toNumber' });
  });

  test('createDefaultTransform falls back to trim for an unknown kind', () => {
    expect(createDefaultTransform('nonsense')).toEqual({ kind: 'trim' });
  });

  test('addTransform appends a default trim step', () => {
    const result = addTransform([{ kind: 'toNumber' }]);
    expect(result).toEqual([{ kind: 'toNumber' }, { kind: 'trim' }]);
  });

  test('addTransform does not mutate the original array', () => {
    const original = [{ kind: 'trim' }];
    addTransform(original);
    expect(original).toHaveLength(1);
  });

  test('removeTransform removes only the given index', () => {
    const transforms = [{ kind: 'trim' }, { kind: 'toNumber' }, { kind: 'replace', find: 'a', replacement: 'b' }];
    expect(removeTransform(transforms, 1)).toEqual([{ kind: 'trim' }, { kind: 'replace', find: 'a', replacement: 'b' }]);
  });

  test('updateTransform patches only the given index', () => {
    const transforms = [{ kind: 'regexExtract', pattern: '', group: 0 }, { kind: 'trim' }];
    const result = updateTransform(transforms, 0, { pattern: '\\d+' });
    expect(result[0]).toEqual({ kind: 'regexExtract', pattern: '\\d+', group: 0 });
    expect(result[1]).toEqual({ kind: 'trim' });
  });

  test('changeTransformKind replaces the step with fresh defaults for the new kind', () => {
    const transforms = [{ kind: 'replace', find: 'a', replacement: 'b' }];
    expect(changeTransformKind(transforms, 0, 'regexExtract')).toEqual([{ kind: 'regexExtract', pattern: '', group: 0 }]);
  });

  test('moveTransform swaps with the previous/next step', () => {
    const transforms = [{ kind: 'trim' }, { kind: 'toNumber' }];
    expect(moveTransform(transforms, 1, -1)).toEqual([{ kind: 'toNumber' }, { kind: 'trim' }]);
    expect(moveTransform(transforms, 0, 1)).toEqual([{ kind: 'toNumber' }, { kind: 'trim' }]);
  });

  test('moveTransform is a no-op past either end', () => {
    const transforms = [{ kind: 'trim' }, { kind: 'toNumber' }];
    expect(moveTransform(transforms, 0, -1)).toBe(transforms);
    expect(moveTransform(transforms, 1, 1)).toBe(transforms);
  });

  test('transformsAreValid rejects a regexExtract step with a blank pattern', () => {
    expect(transformsAreValid([{ kind: 'trim' }, { kind: 'regexExtract', pattern: '  ', group: 0 }])).toBe(false);
    expect(transformsAreValid([{ kind: 'trim' }, { kind: 'regexExtract', pattern: '\\d+', group: 0 }])).toBe(true);
  });

  test('transformsAreValid accepts an empty chain', () => {
    expect(transformsAreValid([])).toBe(true);
  });

  // Issue #205
  test('createDefaultTransform returns the right shape for the type-conversion kinds', () => {
    expect(createDefaultTransform('toInteger')).toEqual({ kind: 'toInteger', onError: 'KeepOriginal', defaultValue: '' });
    expect(createDefaultTransform('toBoolean')).toEqual({ kind: 'toBoolean', onError: 'KeepOriginal', defaultValue: '' });
    expect(createDefaultTransform('toDate')).toEqual({ kind: 'toDate', sourceFormat: '{yyyy}-{mm}-{dd}', onError: 'KeepOriginal', defaultValue: '' });
  });

  test('transformsAreValid rejects a toDate step with a blank sourceFormat', () => {
    expect(transformsAreValid([{ kind: 'toDate', sourceFormat: '  ', onError: 'KeepOriginal', defaultValue: '' }])).toBe(false);
    expect(transformsAreValid([{ kind: 'toDate', sourceFormat: '{yyyy}-{mm}-{dd}', onError: 'KeepOriginal', defaultValue: '' }])).toBe(true);
  });

  // Issue #206
  test('createDefaultTransform returns the right shape for combineFields/splitField', () => {
    expect(createDefaultTransform('combineFields')).toEqual({ kind: 'combineFields', sourceFieldNames: [], separator: ' ' });
    expect(createDefaultTransform('splitField')).toEqual({ kind: 'splitField', sourceFieldName: '', separator: ' ', index: 0 });
  });

  test('transformsAreValid rejects combineFields with fewer than 2 source fields', () => {
    expect(transformsAreValid([{ kind: 'combineFields', sourceFieldNames: [], separator: ' ' }])).toBe(false);
    expect(transformsAreValid([{ kind: 'combineFields', sourceFieldNames: ['A'], separator: ' ' }])).toBe(false);
    expect(transformsAreValid([{ kind: 'combineFields', sourceFieldNames: ['A', 'B'], separator: ' ' }])).toBe(true);
  });

  test('transformsAreValid rejects splitField with a blank source field', () => {
    expect(transformsAreValid([{ kind: 'splitField', sourceFieldName: '', separator: ' ', index: 0 }])).toBe(false);
    expect(transformsAreValid([{ kind: 'splitField', sourceFieldName: 'Adresse', separator: ' ', index: 0 }])).toBe(true);
  });
});

// Issue #143: JS mirror of the Python runtime's _apply_transforms/_to_number
// (see any of the six .py.j2 templates) — used for the transform-chain live
// preview, so both sides must independently reach the same result for the
// same input.
describe('applyTransformsPreview / toNumberPreview', () => {
  test('empty chain returns the raw value unchanged', () => {
    expect(applyTransformsPreview('  Suppe  ', [])).toBe('  Suppe  ');
  });

  test('trim strips leading/trailing whitespace', () => {
    expect(applyTransformsPreview('  Suppe  ', [{ kind: 'trim' }])).toBe('Suppe');
  });

  test('regexExtract returns the given capture group', () => {
    expect(applyTransformsPreview('SKU-12345', [{ kind: 'regexExtract', pattern: 'SKU-(\\d+)', group: 1 }])).toBe('12345');
  });

  test('regexExtract with no match returns an empty string', () => {
    expect(applyTransformsPreview('no digits here', [{ kind: 'regexExtract', pattern: '\\d+', group: 0 }])).toBe('');
  });

  test('regexExtract with an invalid-for-JS pattern returns null', () => {
    expect(applyTransformsPreview('anything', [{ kind: 'regexExtract', pattern: '(unclosed', group: 0 }])).toBeNull();
  });

  test('replace replaces every occurrence', () => {
    expect(applyTransformsPreview('a-b-c', [{ kind: 'replace', find: '-', replacement: '_' }])).toBe('a_b_c');
  });

  test('toNumber normalizes a comma-decimal price', () => {
    expect(toNumberPreview('Preis: 12,99 €')).toBe('12.99');
  });

  test('toNumber normalizes a dot-decimal price', () => {
    expect(toNumberPreview('12.99')).toBe('12.99');
  });

  test('toNumber strips thousands separators', () => {
    expect(toNumberPreview('1.234,56')).toBe('1234.56');
  });

  test('toNumber returns an empty string when nothing numeric is found', () => {
    expect(toNumberPreview('no number here')).toBe('');
  });

  test('a chained trim -> regexExtract -> toNumber pipeline', () => {
    const transforms = [
      { kind: 'trim' },
      { kind: 'regexExtract', pattern: '[\\d,]+', group: 0 },
      { kind: 'toNumber' },
    ];
    expect(applyTransformsPreview('  Preis: 12,99 €  ', transforms)).toBe('12.99');
  });

  // Issue #205: mirrors the Python runtime's _to_integer/_to_boolean/_to_date
  // and their shared _type_conversion_fallback onError contract.
  test('toInteger accepts a plain signed integer', () => {
    expect(toIntegerPreview(' -42 ')).toBe('-42');
    expect(toIntegerPreview('7')).toBe('7');
  });

  test('toInteger rejects a decimal or non-numeric value', () => {
    expect(toIntegerPreview('12.5')).toBeNull();
    expect(toIntegerPreview('not a number')).toBeNull();
  });

  test('toInteger with onError KeepOriginal passes the raw value through on failure', () => {
    const transforms = [{ kind: 'toInteger', onError: 'KeepOriginal', defaultValue: '0' }];
    expect(applyTransformsPreview('12.5', transforms)).toBe('12.5');
  });

  test('toInteger with onError UseDefault substitutes the default value on failure', () => {
    const transforms = [{ kind: 'toInteger', onError: 'UseDefault', defaultValue: '0' }];
    expect(applyTransformsPreview('not a number', transforms)).toBe('0');
    expect(applyTransformsPreview('42', transforms)).toBe('42');
  });

  test('toBoolean recognizes the fixed true/false vocabulary case-insensitively', () => {
    expect(toBooleanPreview('Yes')).toBe('True');
    expect(toBooleanPreview('1')).toBe('True');
    expect(toBooleanPreview('NO')).toBe('False');
    expect(toBooleanPreview('0')).toBe('False');
    expect(toBooleanPreview('maybe')).toBeNull();
  });

  test('toDate parses against a custom sourceFormat and normalizes to ISO', () => {
    expect(toDatePreview('24.09.2026', '{dd}.{mm}.{yyyy}')).toBe('2026-09-24');
    expect(toDatePreview('2026-09-24', '{yyyy}-{mm}-{dd}')).toBe('2026-09-24');
  });

  test('toDate rejects a value that does not match the format', () => {
    expect(toDatePreview('2026/09/24', '{dd}.{mm}.{yyyy}')).toBeNull();
  });

  test('toDate rejects a structurally-matching but non-existent calendar date', () => {
    expect(toDatePreview('2026-02-30', '{yyyy}-{mm}-{dd}')).toBeNull();
  });

  test('toDate treats sourceFormat as a literal mini-template, not regex syntax', () => {
    // "(unclosed" would be invalid regex syntax if treated literally as one
    // — since sourceFormat is fully escaped first, it's just a (non-
    // matching) literal string instead of a compile error.
    expect(toDatePreview('2026-09-24', '(unclosed')).toBeNull();
  });

  test('a chained trim -> toDate pipeline with UseDefault on failure', () => {
    const transforms = [
      { kind: 'trim' },
      { kind: 'toDate', sourceFormat: '{dd}.{mm}.{yyyy}', onError: 'UseDefault', defaultValue: 'unknown' },
    ];
    expect(applyTransformsPreview('  24.09.2026  ', transforms)).toBe('2026-09-24');
    expect(applyTransformsPreview('  not a date  ', transforms)).toBe('unknown');
  });

  // Issue #206: no sibling field's value is available client-side at
  // preview time — both kinds signal "preview unavailable" (null), the same
  // as an invalid regexExtract pattern, rather than showing this field's own
  // untouched raw value.
  test('combineFields/splitField have no client-side preview', () => {
    expect(applyTransformsPreview('anything', [{ kind: 'combineFields', sourceFieldNames: ['A', 'B'], separator: ' ' }])).toBeNull();
    expect(applyTransformsPreview('anything', [{ kind: 'splitField', sourceFieldName: 'A', separator: ',', index: 0 }])).toBeNull();
  });
});
