// Issue #404: guidance on the API_CONFIG screen — everyday value sources up
// front and the rare ones under "Advanced", the body's value type under
// "Advanced", "?" popovers, and the auto-open rule for the advanced options.
const { renderApiConfigParameters } = require('./api-parameters-ui');
const { renderBodyTree } = require('./api-request-ui');
const { autoOpenAdvanced } = require('./api-config-shared-ui');
const { BOOTSTRAP_SOURCE_KIND } = require('./api-bootstrap');

function draftWith(sourceKind, extra = {}) {
  return {
    urlParts: { pathSegments: [{ value: 'weeks', variable: false }, { value: '35', variable: true, name: 'week' }], queryParams: [] },
    parameterSources: { 'path:1': { kind: sourceKind, valuesText: '', actions: [], discoveryUrl: '', type: 'Number', from: '', to: '', format: '' } },
    bodyParameters: [],
    ...extra,
  };
}

const radios = (root) => [...root.querySelectorAll('.api-config-source-kind-radio')].map((r) => r.value);

describe('value sources', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="api-config-parameters"></div>'; });

  test('every source is a plain option of the card: no Advanced sources disclosure (Issue #518)', () => {
    renderApiConfigParameters(draftWith('staticList'), null, null);
    const card = document.querySelector('.api-config-param-card');

    expect(radios(card)).toEqual(['staticList', 'discovery', 'range', 'browserDiscovery']);
    expect(card.querySelector('details')).toBeNull();
    expect(card.querySelector('.api-config-source-kind').querySelectorAll(':scope > label')).toHaveLength(4);
  });

  test('browser discovery stays selectable and chosen when it is the source', () => {
    renderApiConfigParameters(draftWith('browserDiscovery'), null, null);
    const checked = document.querySelector('.api-config-source-kind-radio:checked');
    expect(checked.value).toBe('browserDiscovery');
    expect(document.querySelector('details')).toBeNull();
  });

  test('the token value joins the options only while a bootstrap exists', () => {
    renderApiConfigParameters(draftWith('staticList'), null, null);
    expect(radios(document)).not.toContain(BOOTSTRAP_SOURCE_KIND);

    renderApiConfigParameters(draftWith('staticList', { bootstrap: { name: 'token' } }), null, null);
    expect(radios(document)).toEqual(['staticList', 'discovery', 'range', 'browserDiscovery', BOOTSTRAP_SOURCE_KIND]);
    expect(document.querySelector('details')).toBeNull();
  });

  test('every source has a help host with its own key', () => {
    renderApiConfigParameters(draftWith('staticList', { bootstrap: { name: 'token' } }), null, null);
    const keys = [...document.querySelectorAll('.api-config-source-kind .help-host')].map((h) => h.dataset.help);
    expect(keys).toEqual([
      'help.apiConfig.sourceStaticList', 'help.apiConfig.sourceDiscovery', 'help.apiConfig.sourceRange',
      'help.apiConfig.sourceBrowserDiscovery', 'help.apiConfig.sourceBootstrap',
    ]);
    expect(document.querySelector('.api-config-source-kind').hasAttribute('data-help-anchor')).toBe(true);
  });
});

describe('the body tree\'s value type', () => {
  beforeEach(() => { document.body.innerHTML = '<ul id="body-tree-root"></ul>'; });

  const draft = (coerceTo) => ({
    bodyTree: { kind: 'object', properties: { size: { kind: 'variable', parameterId: 'body:0', coerceTo } } },
    urlParts: { pathSegments: [], queryParams: [] },
    parameterSources: {},
    bodyParameters: [{ id: 'body:0', name: 'size' }],
  });

  test('sits under a collapsed Advanced with a "?"', () => {
    renderBodyTree(draft(undefined));
    const advanced = document.querySelector('.body-tree-row details.advanced-disclosure');
    expect(advanced.dataset.advanced).toBe('api-body-value-type');
    expect(advanced.open).toBe(false);
    expect(advanced.contains(document.querySelector('.body-tree-coerce-to'))).toBe(true);
    expect(advanced.querySelector('.help-host').dataset.help).toBe('help.apiConfig.valueType');
  });

  test('opens by itself when a non-default type is already chosen', () => {
    renderBodyTree(draft('Number'));
    expect(document.querySelector('details[data-advanced="api-body-value-type"]').open).toBe(true);
  });
});

describe('autoOpenAdvanced', () => {
  const mount = () => {
    document.body.innerHTML = '<details class="advanced-disclosure"><summary></summary><div id="inner"></div></details>';
    return { details: document.querySelector('details'), inner: document.getElementById('inner') };
  };

  test('opens once when the option is on, and does not fight a user who closes it', () => {
    const { details, inner } = mount();
    autoOpenAdvanced(inner, true);
    expect(details.open).toBe(true);
    details.open = false;
    autoOpenAdvanced(inner, true);
    expect(details.open).toBe(false);
  });

  test('re-arms once the option is off again', () => {
    const { details, inner } = mount();
    autoOpenAdvanced(inner, true);
    details.open = false;
    autoOpenAdvanced(inner, false);
    autoOpenAdvanced(inner, true);
    expect(details.open).toBe(true);
  });

  test('leaves a section without a disclosure alone', () => {
    document.body.innerHTML = '<div id="inner"></div>';
    expect(() => autoOpenAdvanced(document.getElementById('inner'), true)).not.toThrow();
    expect(() => autoOpenAdvanced(null, true)).not.toThrow();
  });
});
