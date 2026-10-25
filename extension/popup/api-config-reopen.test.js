require('./test-support/popup-env');
const { buildApiConfigFromDraft, reopenableDraft, reopenPatch } = require('./api-config-reopen');
const { parseUrlTemplateParts, buildApiGroupDraft, buildApiFieldDraft } = require('./api-config');

const draft = () => ({
  sourceUrl: 'http://example.test/api/catalog?category=books',
  urlParts: parseUrlTemplateParts('http://example.test/api/catalog?category=books'),
  groups: [{ ...buildApiGroupDraft('Produkte', 'items'), children: [buildApiFieldDraft('Titel', 'title', null, 'Smartphone X')] }],
  capturedHeaders: [{ name: 'Accept', value: 'application/json' }],
  parameterSources: {},
  headerDecisions: {},
  method: 'GET',
  bodyTree: null,
  bodyParameters: [],
  nextBodyParameterSeq: 0,
  embeddedJsonSource: null,
});

describe('reopenableDraft', () => {
  test('is the snapshot while it still builds exactly the confirmed configuration', () => {
    const applied = draft();
    const apiConfig = buildApiConfigFromDraft(applied);
    expect(reopenableDraft({ apiConfig, apiConfigApplied: applied })).toBe(applied);
  });

  test('survives the JSON round trip of the session storage', () => {
    const applied = JSON.parse(JSON.stringify(draft()));
    const apiConfig = JSON.parse(JSON.stringify(buildApiConfigFromDraft(draft())));
    expect(reopenableDraft({ apiConfig, apiConfigApplied: applied })).toEqual(applied);
  });

  test('a loaded or replaced configuration has no matching draft: nothing to reopen', () => {
    const applied = draft();
    const other = buildApiConfigFromDraft({ ...draft(), groups: [] });
    expect(reopenableDraft({ apiConfig: other, apiConfigApplied: applied })).toBeNull();
    expect(reopenableDraft({ apiConfig: buildApiConfigFromDraft(applied), apiConfigApplied: null })).toBeNull();
    expect(reopenableDraft({ apiConfig: null, apiConfigApplied: applied })).toBeNull();
  });

  test('a snapshot that cannot be built is not offered', () => {
    expect(reopenableDraft({ apiConfig: { urlTemplate: 'x' }, apiConfigApplied: { broken: true } })).toBeNull();
  });
});

describe('reopenPatch', () => {
  test('hands out a deep copy: edits to it never reach the confirmed configuration or its snapshot', () => {
    const applied = draft();
    const apiConfig = buildApiConfigFromDraft(applied);
    const patch = reopenPatch({ apiConfig, apiConfigApplied: applied });
    expect(patch.apiConfigDraft).toEqual(applied);
    patch.apiConfigDraft.groups[0].children[0].name = 'Geändert';
    expect(applied.groups[0].children[0].name).toBe('Titel');
    expect(reopenableDraft({ apiConfig, apiConfigApplied: applied })).toBe(applied);
  });

  test('keeps the recording-dependent parts of the draft that the wire does not carry', () => {
    const applied = draft();
    const patch = reopenPatch({ apiConfig: buildApiConfigFromDraft(applied), apiConfigApplied: applied });
    expect(patch.apiConfigDraft.capturedHeaders).toEqual([{ name: 'Accept', value: 'application/json' }]);
    expect(patch.apiConfigDraft.groups[0].children[0].sampleValue).toBe('Smartphone X');
  });

  test('is null when there is nothing to reopen', () => {
    expect(reopenPatch({ apiConfig: null, apiConfigApplied: null })).toBeNull();
  });
});
