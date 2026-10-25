require('./test-support/popup-env');

// Issue #509: only a real run takes the default output file name — a saved or exported configuration keeps what the user typed.
describe('the default output file name in the requests', () => {
  const { buildScrapingConfig, configOptionsFromState } = require('./scraping-config-builder');
  const { resolveOutputFileName } = require('./output-name');

  const state = (over = {}) => ({
    url: 'https://example.com/menu', mode: 'flat', fields: [{ name: 'Preis', selector: '.price', attribute: null, framePath: null, transforms: null, download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false }],
    groups: [], apiConfig: null, scriptFileName: 'shop-example-com', outputFileName: '', engine: 'Static', browserActions: [],
    ...over,
  });

  const generateConfig = (s, settings) => buildScrapingConfig(configOptionsFromState(s, settings, {
    outputFileName: resolveOutputFileName(s.outputFileName, s.scriptFileName, settings),
  }));
  const savedConfig = (s, settings) => buildScrapingConfig(configOptionsFromState(s, settings, { includeOutputFile: false }));

  test('with the setting untouched the request is the one it always was', () => {
    expect(generateConfig(state(), { outputNameMode: 'fixed', outputNameFixed: '' }).outputFileName).toBeNull();
  });

  test('"same as the script name" names the run after the script', () => {
    expect(generateConfig(state(), { outputNameMode: 'script' }).outputFileName).toBe('shop-example-com');
  });

  test('a custom default names the run, a typed name still wins', () => {
    const settings = { outputNameMode: 'fixed', outputNameFixed: 'daily' };
    expect(generateConfig(state(), settings).outputFileName).toBe('daily');
    expect(generateConfig(state({ outputFileName: 'typed' }), settings).outputFileName).toBe('typed');
  });

  test('a saved or exported configuration never carries the default', () => {
    expect(savedConfig(state(), { outputNameMode: 'script' }).outputFileName).toBeNull();
    expect(savedConfig(state({ outputFileName: 'typed' }), { outputNameMode: 'script' }).outputFileName).toBe('typed');
  });

  test('Blocks mode names no file at the top level, whatever the setting', () => {
    const blocks = [{ shape: 'flat', name: 'A', outputFileName: 'a', fields: [], groups: [] }];
    const config = generateConfig(state({ mode: 'blocks', blocks }), { outputNameMode: 'script' });
    expect(config.outputFileName).toBeUndefined();
    expect(config.blocks[0].outputFileName).toBe('a');
  });
});
