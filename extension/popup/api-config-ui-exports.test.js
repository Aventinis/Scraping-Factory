// Issue #390: api-config-ui.ts was split into focused modules and re-exports every
// name it used to export, so popup.ts, idle-screen-ui.ts and the tests import
// unchanged. This pins that public surface: a name dropped (or silently turned
// into something else) by a later edit fails here instead of at a click.
const apiConfigUi = require('./api-config-ui');

const EXPORTED_BY_API_CONFIG_UI = [
  'buildApiTreeNodeEl',
  'renderApiTree',
  'renderApiCandidates',
  'renderApiEntriesList',
  'renderApiConfigScreen',
  'renderApiConfigUrlParts',
  'renderApiConfigParameters',
  'renderRangeFormatFields',
  'renderDiscoverySourceFields',
  'renderBrowserDiscoverySourceFields',
  'renderApiConfigHeaders',
  'bodyNodeLabel',
  'buildBodyTreeNodeEl',
  'renderBodyTree',
  'startApiCapture',
  'stopApiCapture',
  'toggleApiCapture',
  'startApiFieldSearch',
  'confirmApiFieldCandidate',
  'loadInitialBodyTreeForCandidate',
  'cancelApiConfig',
  'confirmEmbeddedJsonFieldCandidate',
  'startApiTreeFieldSearch',
  'confirmApiTreeFieldCandidate',
  'openApiGroupModal',
  'confirmApiGroupModal',
  'cancelApiGroupModal',
  'setApiTreeNodeName',
  'openApiFieldTransformsModal',
  'confirmApiFieldTransformsModal',
  'cancelApiFieldTransformsModal',
  'startDiscoverySearch',
  'confirmDiscoveryCandidate',
  'toggleApiConfigPartVariable',
  'setApiConfigPartName',
  'setApiConfigSourceKind',
  'patchApiConfigSource',
  'setApiConfigHeaderDecision',
  'addDiscoveryAction',
  'removeDiscoveryAction',
  'updateDiscoveryAction',
  'toggleBodyLeafToVariable',
  'toggleBodyLeafToFixed',
  'setBodyLeafParameter',
  'setBodyLeafCoerceTo',
  'openBodyParameterModal',
  'confirmBodyParameterModal',
  'cancelBodyParameterModal',
  'confirmApiConfig',
  'fetchApiCaptureEntries',
  'toggleApiEntriesPanel',
  'fillStaticListFromPool',
  'renderApiConfigModals',
  'wireApiConfigEvents'
];

describe('api-config-ui.ts public surface', () => {
  test.each(EXPORTED_BY_API_CONFIG_UI)('still exports %s as a function', (name) => {
    expect(typeof apiConfigUi[name]).toBe('function');
  });

  test('exports nothing but that surface', () => {
    expect(Object.keys(apiConfigUi).sort()).toEqual([...EXPORTED_BY_API_CONFIG_UI].sort());
  });

  test('each re-exported name is the very function of its focused module', () => {
    const modules = [
      './api-response-tree-ui', './api-capture-ui', './api-parameters-ui',
      './api-browser-discovery-ui', './api-request-ui', './api-config-shared-ui',
    ].map((path) => require(path));
    for (const name of EXPORTED_BY_API_CONFIG_UI) {
      if (['renderApiConfigScreen', 'cancelApiConfig', 'confirmApiConfig', 'renderApiConfigModals', 'wireApiConfigEvents'].includes(name)) continue;
      const owner = modules.find((m) => m[name]);
      expect(owner && owner[name]).toBe(apiConfigUi[name]);
    }
  });
});
