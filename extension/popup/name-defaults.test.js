require('./test-support/popup-env');
const { defaultScriptName, resolveScriptFileName, scriptFileBase, defaultOutputName } = require('./name-defaults');
const { resolveOutputFileName } = require('./output-name');

const URL_A = 'https://shop.example.com/menu';
const hostname = { scriptNameMode: 'hostname', scriptNameFixed: 'scraper', outputNameMode: 'fixed', outputNameFixed: '' };
const fixed = { scriptNameMode: 'fixed', scriptNameFixed: 'my-default', outputNameMode: 'fixed', outputNameFixed: '' };

// Issue #510: both fields stay empty; the default is the placeholder and what an empty field resolves to.
describe('script name default', () => {
  test('"From website" is the current page\'s host name', () => {
    expect(defaultScriptName(URL_A, hostname)).toBe('shop_example_com');
  });

  test('"From website" follows the site: another URL, another default', () => {
    expect(defaultScriptName('https://other.org/', hostname)).toBe('other_org');
  });

  test('"From website" falls back to the fixed name when there is no usable URL', () => {
    expect(defaultScriptName('', { ...hostname, scriptNameFixed: 'fallback' })).toBe('fallback');
    expect(defaultScriptName('not a url', hostname)).toBe('scraper');
  });

  test('"Fixed name" is the fixed name, whatever the site', () => {
    expect(defaultScriptName(URL_A, fixed)).toBe('my-default');
    expect(defaultScriptName('https://other.org/', fixed)).toBe('my-default');
  });

  test('a fixed name that sanitizes to nothing falls back to scraper', () => {
    expect(defaultScriptName(URL_A, { ...fixed, scriptNameFixed: '!!!' })).toBe('scraper');
    expect(defaultScriptName(URL_A, { scriptNameMode: 'fixed' })).toBe('scraper');
  });
});

describe('resolveScriptFileName / scriptFileBase', () => {
  test('an empty field resolves to the default, also one of only blanks', () => {
    expect(resolveScriptFileName('', URL_A, hostname)).toBe('shop_example_com');
    expect(resolveScriptFileName('   ', URL_A, hostname)).toBe('shop_example_com');
    expect(resolveScriptFileName(undefined, URL_A, fixed)).toBe('my-default');
  });

  test('a typed name wins, as typed', () => {
    expect(resolveScriptFileName('mein Name', URL_A, hostname)).toBe('mein Name');
  });

  test('the file base is sanitized like the companion does', () => {
    expect(scriptFileBase('mein Name!', URL_A, hostname)).toBe('mein_Name');
    expect(scriptFileBase('', URL_A, hostname)).toBe('shop_example_com');
  });
});

describe('output name default (the placeholder)', () => {
  test('is "output" while the setting is untouched', () => {
    expect(defaultOutputName('', URL_A, hostname)).toBe('output');
  });

  test('"same as the script name" follows the default script name, and a typed one live', () => {
    const settings = { ...hostname, outputNameMode: 'script' };
    expect(defaultOutputName('', URL_A, settings)).toBe('shop_example_com');
    expect(defaultOutputName('', URL_A, { ...fixed, outputNameMode: 'script' })).toBe('my-default');
    expect(defaultOutputName('mein Skript', URL_A, settings)).toBe('mein_Skript');
  });

  test('a custom name is shown sanitized, like it will be used', () => {
    expect(defaultOutputName('', URL_A, { ...hostname, outputNameFixed: 'daily data' })).toBe('daily_data');
  });

  test('the placeholder shows what an empty field really resolves to', () => {
    for (const settings of [hostname, fixed, { ...hostname, outputNameMode: 'script' }, { ...fixed, outputNameFixed: 'custom' }]) {
      const placeholder = defaultOutputName('typed script', URL_A, settings);
      const resolved = resolveOutputFileName('', scriptFileBase('typed script', URL_A, settings), settings);
      expect(resolved ?? 'output').toBe(placeholder);
    }
  });
});
