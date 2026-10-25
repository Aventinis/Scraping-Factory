// Issue #292: "Skip the trial run" — a plain boolean from the Global Settings
// tab, sent for every mode (the companion reads it from the outer request).
const { buildScrapingConfig, buildConfigExport } = require('./scraping-config-builder');

const fields = [{ name: 'Titel', selector: 'h1' }];
const groups = [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'F', selector: '.f', mode: 'text', transforms: [] }] }];
const apiConfig = { urlTemplate: 'https://example.com/api', fields: [] };
const combined = [
  { savedConfigId: 1, name: 'a', config: { url: 'https://a.example', fields } },
  { savedConfigId: 2, name: 'b', config: { url: 'https://b.example', fields } },
];
const blocks = [
  { name: 'a', shape: 'flat', fields, groups: [], outputFileName: '' },
  { name: 'b', shape: 'flat', fields, groups: [], outputFileName: '' },
];

// Positional tail: ... requestHeaders, respectRobotsDelay, skipVerification
const build = (mode, skip, extra = {}) => buildScrapingConfig({
  url: 'https://example.com',
  mode,
  fields: extra.fields ?? fields,
  groups: extra.groups ?? [],
  apiConfig: extra.apiConfig ?? null,
  combinedComponents: extra.combined ?? null,
  blocks: extra.blocks ?? null,
  skipVerification: skip,
});

describe('buildScrapingConfig', () => {
  test.each([
    ['flat', {}], ['container', { groups }], ['api', { apiConfig }], ['combined', { combined }], ['blocks', { blocks }],
  ])('%s mode sends skipVerification only when it is on', (mode, extra) => {
    expect(build(mode, true, extra).skipVerification).toBe(true);
    expect(build(mode, false, extra)).not.toHaveProperty('skipVerification');
  });

  test('is part of the exported configuration (the literal /generate body)', () => {
    const exported = buildConfigExport({ url: 'https://example.com', mode: 'flat', fields, skipVerification: true });
    expect(exported.config.skipVerification).toBe(true);
  });
});
