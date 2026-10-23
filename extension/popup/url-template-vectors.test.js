// Issue #388: findUrlTemplateMatches (api-config.js) picks the recorded requests that are "the same endpoint,
// different value" for the auto-fill of a value list. The generated script's _match_url_against_template does the
// same at run time for browser discovery. Both run test-vectors/url-template.json (UrlTemplateVectorTests.cs is the
// script half).
const { loadVectors } = require('../../test-vectors/load');
const { parseUrlTemplateParts, findUrlTemplateMatches } = require('./api-config');

// The vectors state the template with {name} placeholders; the extension works on a recorded URL whose parts the
// user marked as variable. Recreate that: swap each placeholder for a stand-in value, parse, and flag those parts.
function urlPartsFor(template, target) {
  const marker = (name) => `__sf_${name}__`;
  const recorded = template.replace(/\{([^{}]+)\}/g, (_m, name) => marker(name));
  const urlParts = parseUrlTemplateParts(recorded);
  let targetPartId = null;
  urlParts.pathSegments.forEach((segment, index) => {
    if (segment.value.startsWith('__sf_')) {
      segment.variable = true;
      if (segment.value === marker(target)) targetPartId = `path:${index}`;
    }
  });
  urlParts.queryParams.forEach((param) => {
    if (param.value.startsWith('__sf_')) {
      param.variable = true;
      if (param.value === marker(target)) targetPartId = `query:${param.key}`;
    }
  });
  return { urlParts, targetPartId };
}

describe('findUrlTemplateMatches (shared vectors)', () => {
  const { cases } = loadVectors('url-template.json');
  test.each(cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const { urlParts, targetPartId } = urlPartsFor(c.template, c.target);
    expect(targetPartId).not.toBeNull();
    expect(findUrlTemplateMatches(urlParts, targetPartId, c.candidates.map((url) => ({ url })))).toEqual(c.expected);
  });
});
