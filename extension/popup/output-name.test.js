require('./test-support/popup-env');
const { resolveOutputFileName } = require('./output-name');

// Issue #509: typed name → else the chosen default → else null (today's `output`).
describe('resolveOutputFileName', () => {
  test('the settings untouched change nothing: no name is sent', () => {
    expect(resolveOutputFileName('', 'shop-example-com', { outputNameMode: 'fixed', outputNameFixed: '' })).toBeNull();
    expect(resolveOutputFileName(undefined, 'shop', {})).toBeNull();
    expect(resolveOutputFileName(null, 'shop', { outputNameMode: 'fixed' })).toBeNull();
  });

  test('a typed name always wins, in both modes, and is passed on as typed', () => {
    expect(resolveOutputFileName('mein Name', 'shop', { outputNameMode: 'script' })).toBe('mein Name');
    expect(resolveOutputFileName('mein Name', 'shop', { outputNameMode: 'fixed', outputNameFixed: 'custom' })).toBe('mein Name');
  });

  test('a name of only blanks counts as empty', () => {
    expect(resolveOutputFileName('   ', 'shop', { outputNameMode: 'script' })).toBe('shop');
  });

  test('"same as the script name" uses the effective script name, sanitized', () => {
    expect(resolveOutputFileName('', 'shop-example-com', { outputNameMode: 'script' })).toBe('shop-example-com');
    expect(resolveOutputFileName('', 'Mein Skript!', { outputNameMode: 'script' })).toBe('Mein_Skript');
  });

  test('"same as the script name" falls back to the script default while the script name is empty', () => {
    expect(resolveOutputFileName('', '', { outputNameMode: 'script' })).toBe('scraper');
  });

  test('a custom name applies when the field is empty, sanitized like a typed one', () => {
    expect(resolveOutputFileName('', 'shop', { outputNameMode: 'fixed', outputNameFixed: 'daily data' })).toBe('daily_data');
  });

  test('a custom name that sanitizes to nothing falls back to "output" instead of an invalid file name', () => {
    expect(resolveOutputFileName('', 'shop', { outputNameMode: 'fixed', outputNameFixed: '!!!' })).toBe('output');
  });
});
