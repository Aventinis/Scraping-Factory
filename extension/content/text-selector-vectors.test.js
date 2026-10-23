// Issue #388: the content script's splitTextFilter runs the same table as the popup's copy, the companion's
// SelectorTextFilter and the script runtime's _split_text_filter: test-vectors/text-selector.json.
const { loadVectors } = require('../../test-vectors/load');
const { splitTextFilter } = require('./content-script');

describe('content script splitTextFilter (shared vectors)', () => {
  const { cases } = loadVectors('text-selector.json');

  test.each(cases.filter((c) => !c.invalid).map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(splitTextFilter(c.selector)).toEqual({ base: c.base, text: c.text });
  });

  test.each(cases.filter((c) => c.splitUnchanged).map((c) => [c.name, c]))('%s is not a filter', (_name, c) => {
    expect(splitTextFilter(c.selector)).toEqual({ base: c.selector, text: null });
  });
});
