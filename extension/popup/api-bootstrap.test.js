// Issue #220: pure-function coverage for the API-mode token/auth bootstrap
// (api-bootstrap.js) and its integration into api-config.js's
// buildApiConfig/buildApiHeaders/apiConfigDraftHasAllSourcesChosen.
const {
  BOOTSTRAP_SOURCE_KIND, createDefaultBootstrapDraft, suggestEnvVarName, parseRecordedBody,
  detectTokenInResponse, bootstrapDraftFromCaptureEntry, suggestHeaderTemplate, wireTokenIntoMainRequest,
  stripBootstrapReferences, bootstrapDraftIsComplete, buildApiBootstrap, resolveBootstrapUrlParts,
  buildBootstrapVerificationValues,
} = require('./api-bootstrap');
const {
  parseUrlTemplateParts, buildApiConfig, buildApiHeaders, apiConfigDraftHasAllSourcesChosen, buildApiGroupDraft, buildApiFieldDraft,
} = require('./api-config');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

function completeBootstrap(overrides = {}) {
  return {
    ...createDefaultBootstrapDraft(),
    url: 'https://example.com/auth/token',
    valuePath: 'access_token',
    bodyFields: [
      { name: 'username', mode: 'literal', value: 'alice', envName: '' },
      { name: 'password', mode: 'env', value: '', envName: 'API_PASSWORD' },
    ],
    ...overrides,
  };
}

describe('suggestEnvVarName', () => {
  test('turns a field name into an API_-prefixed upper-snake env var name', () => {
    expect(suggestEnvVarName('client_secret')).toBe('API_CLIENT_SECRET');
    expect(suggestEnvVarName('x-api-key')).toBe('API_X_API_KEY');
    expect(suggestEnvVarName('')).toBe('API_SECRET');
  });
});

describe('parseRecordedBody', () => {
  test('a flat JSON object becomes Json body fields, credentials defaulting to env mode', () => {
    const { bodyFields, bodyEncoding } = parseRecordedBody('{"username":"alice","password":"hunter2","remember":true}',
      [{ name: 'Content-Type', value: 'application/json' }]);
    expect(bodyEncoding).toBe('Json');
    expect(bodyFields).toEqual([
      { name: 'username', mode: 'literal', value: 'alice', envName: '' },
      { name: 'password', mode: 'env', value: '', envName: 'API_PASSWORD' },
      { name: 'remember', mode: 'literal', value: 'true', envName: '' },
    ]);
  });

  test('a form-encoded body becomes Form body fields, never keeping the recorded secret', () => {
    const { bodyFields, bodyEncoding } = parseRecordedBody('grant_type=client_credentials&client_secret=s3cret',
      [{ name: 'content-type', value: 'application/x-www-form-urlencoded' }]);
    expect(bodyEncoding).toBe('Form');
    expect(bodyFields).toEqual([
      { name: 'grant_type', mode: 'literal', value: 'client_credentials', envName: '' },
      { name: 'client_secret', mode: 'env', value: '', envName: 'API_CLIENT_SECRET' },
    ]);
    expect(JSON.stringify(bodyFields)).not.toContain('s3cret');
  });

  test('a form-looking body without a content-type header is still read as Form', () => {
    expect(parseRecordedBody('a=1&b=2').bodyEncoding).toBe('Form');
  });

  test('an unparseable body yields no fields', () => {
    expect(parseRecordedBody('<xml/>').bodyFields).toEqual([]);
    expect(parseRecordedBody('').bodyFields).toEqual([]);
  });
});

describe('detectTokenInResponse', () => {
  test('prefers the value actually used by the main request', () => {
    const response = { data: { refresh_token: 'other-long-value', session: { value: TOKEN } } };
    expect(detectTokenInResponse(response, [`Bearer ${TOKEN}`])).toEqual({ path: 'data.session.value', value: TOKEN });
  });

  test('falls back to a token-looking key when the value is not seen in the main request', () => {
    expect(detectTokenInResponse({ expires_in: '3600', access_token: 'abc' }, [])).toEqual({ path: 'access_token', value: 'abc' });
  });

  test('never matches a short incidental value against the main request', () => {
    expect(detectTokenInResponse({ lang: 'en' }, ['https://example.com/en/items'])).toBeNull();
  });

  test('builds [n] array paths', () => {
    expect(detectTokenInResponse({ tokens: [{ jwt: TOKEN }] }, [TOKEN])).toEqual({ path: 'tokens[0].jwt', value: TOKEN });
  });
});

describe('bootstrapDraftFromCaptureEntry', () => {
  const entry = {
    id: 7, url: 'https://example.com/auth/token', method: 'POST', status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: { access_token: TOKEN } }),
    requestHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Client-Id', value: 'web' },
      { name: 'X-Api-Key', value: 'k-123' },
    ],
    requestBody: '{"username":"alice","password":"hunter2"}',
  };

  test('seeds method/url/headers/body and detects the value path', () => {
    const { bootstrap, tokenValue } = bootstrapDraftFromCaptureEntry(entry, { capturedHeaders: [{ name: 'Authorization', value: `Bearer ${TOKEN}` }] });
    expect(tokenValue).toBe(TOKEN);
    expect(bootstrap).toMatchObject({ name: 'token', method: 'POST', url: entry.url, valuePath: 'data.access_token', bodyEncoding: 'Json' });
    expect(bootstrap.headers).toEqual([
      { name: 'X-Client-Id', mode: 'literal', value: 'web', envName: '' },
      { name: 'X-Api-Key', mode: 'env', value: '', envName: 'API_X_API_KEY' },
    ]);
    expect(bootstrap.bodyFields.map(f => f.name)).toEqual(['username', 'password']);
  });

  test('a non-JSON response leaves the value path blank', () => {
    const { bootstrap, tokenValue } = bootstrapDraftFromCaptureEntry({ ...entry, body: '<html/>' }, {});
    expect(bootstrap.valuePath).toBe('');
    expect(tokenValue).toBeNull();
  });

  test('a GET entry never gets body fields', () => {
    const { bootstrap } = bootstrapDraftFromCaptureEntry({ ...entry, method: 'GET' }, {}, 'sig');
    expect(bootstrap).toMatchObject({ method: 'GET', name: 'sig', bodyFields: [] });
  });
});

describe('suggestHeaderTemplate', () => {
  test('replaces the token inside the header value with the placeholder', () => {
    expect(suggestHeaderTemplate(`Bearer ${TOKEN}`, TOKEN, 'token')).toBe('Bearer {token}');
  });

  test('returns null when the header does not contain the token', () => {
    expect(suggestHeaderTemplate('application/json', TOKEN, 'token')).toBeNull();
  });
});

describe('wireTokenIntoMainRequest', () => {
  const draft = {
    capturedHeaders: [{ name: 'Authorization', value: `Bearer ${TOKEN}` }, { name: 'Accept', value: 'application/json' }],
    headerDecisions: { Accept: { include: true, mode: 'literal', envName: '' } },
    parameterSources: {},
    urlParts: parseUrlTemplateParts(`https://example.com/api/items?sig=${encodeURIComponent(TOKEN)}&page=1`),
  };

  test('switches token-carrying headers to a bootstrap template and token query params to the bootstrap source', () => {
    const patch = wireTokenIntoMainRequest(draft, TOKEN, 'token');
    expect(patch.headerDecisions.Authorization).toEqual({ include: true, mode: 'bootstrap', envName: '', template: 'Bearer {token}' });
    expect(patch.headerDecisions.Accept).toEqual(draft.headerDecisions.Accept);
    expect(patch.parameterSources['query:sig']).toEqual({ kind: BOOTSTRAP_SOURCE_KIND });
    expect(patch.urlParts.queryParams.find(p => p.key === 'sig').variable).toBe(true);
    expect(patch.urlParts.queryParams.find(p => p.key === 'page').variable).toBe(false);
  });

  test('is a no-op without a detected token', () => {
    expect(wireTokenIntoMainRequest(draft, null, 'token')).toEqual({});
  });
});

describe('stripBootstrapReferences', () => {
  test('reverts bootstrap headers to literal and drops bootstrap URL sources', () => {
    const patch = stripBootstrapReferences({
      headerDecisions: { Authorization: { include: true, mode: 'bootstrap', envName: '', template: 'Bearer {token}' } },
      parameterSources: { 'query:sig': { kind: BOOTSTRAP_SOURCE_KIND }, 'path:1': { kind: 'staticList', valuesText: 'a' } },
    });
    expect(patch.headerDecisions.Authorization).toEqual({ include: true, mode: 'literal', envName: '', template: '' });
    expect(patch.parameterSources).toEqual({ 'path:1': { kind: 'staticList', valuesText: 'a' } });
  });
});

describe('bootstrapDraftIsComplete', () => {
  test('no bootstrap at all is complete', () => {
    expect(bootstrapDraftIsComplete(null)).toBe(true);
  });

  test('a fully filled-in draft is complete', () => {
    expect(bootstrapDraftIsComplete(completeBootstrap())).toBe(true);
  });

  test.each([
    ['blank url', { url: '' }],
    ['url with a placeholder', { url: 'https://example.com/{x}' }],
    ['blank value path', { valuePath: ' ' }],
    ['invalid name', { name: 'my-token' }],
    ['body fields on a GET', { method: 'GET' }],
    ['env row without a valid env name', { bodyFields: [{ name: 'password', mode: 'env', value: '', envName: 'BAD-NAME' }] }],
    ['row without a name', { headers: [{ name: '', mode: 'literal', value: 'x', envName: '' }] }],
  ])('%s is incomplete', (_, overrides) => {
    expect(bootstrapDraftIsComplete(completeBootstrap(overrides))).toBe(false);
  });
});

describe('buildApiBootstrap', () => {
  test('serializes literal and env rows to the wire shape', () => {
    expect(buildApiBootstrap(completeBootstrap({ headers: [{ name: 'X-Client', mode: 'literal', value: 'web', envName: '' }] }))).toEqual({
      name: 'token',
      method: 'POST',
      url: 'https://example.com/auth/token',
      headers: [{ name: 'X-Client', value: 'web' }],
      bodyFields: [{ name: 'username', value: 'alice' }, { name: 'password', environmentVariableName: 'API_PASSWORD' }],
      bodyEncoding: 'Json',
      valuePath: 'access_token',
    });
  });

  test('omits body fields/encoding for a GET and empty header lists', () => {
    expect(buildApiBootstrap(completeBootstrap({ method: 'GET', bodyFields: [] }))).toEqual({
      name: 'token', method: 'GET', url: 'https://example.com/auth/token', valuePath: 'access_token',
    });
  });

  test('null in, null out', () => {
    expect(buildApiBootstrap(null)).toBeNull();
  });
});

describe('resolveBootstrapUrlParts', () => {
  test('renames only bootstrap-sourced variable parts to the bootstrap name', () => {
    const urlParts = parseUrlTemplateParts('https://example.com/api/v1/items?sig=abc&cat=x');
    urlParts.pathSegments[1] = { ...urlParts.pathSegments[1], variable: true, name: '' };
    urlParts.queryParams[1] = { ...urlParts.queryParams[1], variable: true };
    const resolved = resolveBootstrapUrlParts(urlParts, { 'path:1': { kind: BOOTSTRAP_SOURCE_KIND } }, 'token');
    expect(resolved.pathSegments[1].name).toBe('token');
    expect(resolved.queryParams[1].name).toBe('cat');
  });
});

describe('buildBootstrapVerificationValues', () => {
  test('keeps only test values for env vars the bootstrap declares', () => {
    const apiConfig = { bootstrap: buildApiBootstrap(completeBootstrap()) };
    expect(buildBootstrapVerificationValues(apiConfig, { API_PASSWORD: 's3cret', OTHER: 'x' })).toEqual({ API_PASSWORD: 's3cret' });
    expect(buildBootstrapVerificationValues({}, { API_PASSWORD: 's3cret' })).toEqual({});
  });
});

describe('api-config.js integration', () => {
  test('buildApiHeaders renders a bootstrap-mode header as a template', () => {
    expect(buildApiHeaders(
      [{ name: 'Authorization', value: `Bearer ${TOKEN}` }],
      { Authorization: { include: true, mode: 'bootstrap', template: 'Bearer {token}' } },
    )).toEqual([{ name: 'Authorization', template: 'Bearer {token}' }]);
  });

  test('buildApiConfig adds the bootstrap and keeps its placeholder out of parameters', () => {
    const urlParts = parseUrlTemplateParts('https://example.com/api/items?sig=abc&cat=x');
    urlParts.queryParams = urlParts.queryParams.map(p => ({ ...p, variable: true, name: p.key === 'sig' ? 'token' : 'cat' }));
    const apiConfig = buildApiConfig({
      urlParts,
      groups: [{ ...buildApiGroupDraft('Items', 'items'), children: [buildApiFieldDraft('Title', 'title')] }],
      parameterSources: { cat: { kind: 'staticList', values: ['x'] } },
      capturedHeaders: [],
      headerDecisions: {},
      bootstrap: completeBootstrap(),
    });
    expect(apiConfig.urlTemplate).toBe('https://example.com/api/items?sig={token}&cat={cat}');
    expect(apiConfig.parameters).toEqual([{ name: 'cat', source: { kind: 'staticList', values: ['x'] } }]);
    expect(apiConfig.bootstrap).toMatchObject({ name: 'token', valuePath: 'access_token' });
  });

  test('buildApiConfig without a bootstrap sends no bootstrap key', () => {
    const apiConfig = buildApiConfig({
      urlParts: parseUrlTemplateParts('https://example.com/api/items'),
      groups: [{ ...buildApiGroupDraft('Items', 'items'), children: [buildApiFieldDraft('Title', 'title')] }],
      parameterSources: {}, capturedHeaders: [], headerDecisions: {},
    });
    expect(apiConfig).not.toHaveProperty('bootstrap');
  });

  describe('apiConfigDraftHasAllSourcesChosen', () => {
    function draftWith(overrides) {
      const urlParts = parseUrlTemplateParts('https://example.com/api/items?sig=abc');
      urlParts.queryParams[0] = { ...urlParts.queryParams[0], variable: true, name: '' };
      return {
        urlParts,
        groups: [{ ...buildApiGroupDraft('Items', 'items'), children: [buildApiFieldDraft('Title', 'title')] }],
        parameterSources: { 'query:sig': { kind: BOOTSTRAP_SOURCE_KIND } },
        capturedHeaders: [{ name: 'Authorization', value: 'x' }],
        headerDecisions: { Authorization: { include: true, mode: 'bootstrap', template: 'Bearer {token}' } },
        bootstrap: completeBootstrap(),
        ...overrides,
      };
    }

    test('a bootstrap-sourced URL part needs no name of its own', () => {
      expect(apiConfigDraftHasAllSourcesChosen(draftWith({}))).toBe(true);
    });

    test('a bootstrap-sourced URL part without a bootstrap blocks Apply', () => {
      expect(apiConfigDraftHasAllSourcesChosen(draftWith({ bootstrap: null, headerDecisions: {} }))).toBe(false);
    });

    test('an incomplete bootstrap blocks Apply', () => {
      expect(apiConfigDraftHasAllSourcesChosen(draftWith({ bootstrap: completeBootstrap({ valuePath: '' }) }))).toBe(false);
    });

    test('a bootstrap header template not referencing the bootstrap blocks Apply', () => {
      expect(apiConfigDraftHasAllSourcesChosen(draftWith({
        headerDecisions: { Authorization: { include: true, mode: 'bootstrap', template: 'Bearer {other}' } },
      }))).toBe(false);
    });
  });
});
