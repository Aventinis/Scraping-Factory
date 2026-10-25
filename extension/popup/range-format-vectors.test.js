// Issue #388: compileRangeFormatPattern (api-config.ts) decides which format preset fits a recorded value. It must
// agree with RangeFormat.IsValid on the companion and _compile_range_format in the generated script — all three run
// test-vectors/range-format.json (RangeFormatVectorTests.cs is the other half).
const { loadVectors } = require('../../test-vectors/load');
const { compileRangeFormatPattern } = require('./api-config');

describe('compileRangeFormatPattern (shared vectors)', () => {
  const { cases } = loadVectors('range-format.json');
  test.each(cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(compileRangeFormatPattern(c.format).test(c.value)).toBe(c.matches);
  });
});
