// Issue #388: the live transform preview (applyTransformsPreview) is a
// hand-kept mirror of the generated scripts' _apply_transforms. Both run the
// same table, test-vectors/transforms.json — the companion half is
// companion/ScrapingFactory.Tests/TransformVectorTests.cs, which executes the
// real helper from a generated script.
const { loadVectors } = require('../../test-vectors/load');
const { applyTransformsPreview } = require('./field-transforms');

const { cases } = loadVectors('transforms.json');

describe('applyTransformsPreview (shared vectors)', () => {
  test.each(cases.filter((c) => !c.appliesTo || c.appliesTo.includes('js')).map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(applyTransformsPreview(c.value, c.transforms)).toBe(c.expected);
  });
});
