const { retryStatusCodesDiffer, dedupRetentionDiffers } = require('./advanced-defaults');
const { createDefaultDeduplication, setRetentionKind } = require('./dedup-config');

describe('retryStatusCodesDiffer', () => {
  test('the default list, in any order or separator, is not a change', () => {
    expect(retryStatusCodesDiffer('429, 502, 503, 504')).toBe(false);
    expect(retryStatusCodesDiffer('504 503;502 429 429')).toBe(false);
  });

  test('a different, shorter or longer list is a change', () => {
    expect(retryStatusCodesDiffer('429')).toBe(true);
    expect(retryStatusCodesDiffer('429, 502, 503, 504, 500')).toBe(true);
    expect(retryStatusCodesDiffer('')).toBe(true);
    expect(retryStatusCodesDiffer(undefined)).toBe(true);
  });
});

describe('dedupRetentionDiffers', () => {
  test('a fresh configuration keeps the default', () => {
    expect(dedupRetentionDiffers(createDefaultDeduplication())).toBe(false);
    expect(dedupRetentionDiffers(null)).toBe(false);
  });

  test('another kind or another value is a change', () => {
    const base = createDefaultDeduplication();
    expect(dedupRetentionDiffers({ ...base, retentionValueText: '500' })).toBe(true);
    expect(dedupRetentionDiffers(setRetentionKind(base, 'MaxAge'))).toBe(true);
  });
});
