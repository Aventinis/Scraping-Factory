// Issue #229: SQLite / Excel output format — the preference migration, the
// wire value, the extension hint in the output row and the base64 download.
const { buildScrapingConfig } = require('./scraping-config-builder');
const { loadGlobalSettings } = require('../shared/global-settings');

const fields = [{ name: 'Titel', selector: 'h1' }];
const groups = [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'F', selector: '.f', mode: 'text', transforms: [] }] }];
const build = (mode, format, extra = {}) => buildScrapingConfig(
  'https://example.com', mode, extra.fields ?? fields, extra.groups ?? [], extra.apiConfig ?? null, null, null, 'Static', [], false, format,
);

describe('the stored preference', () => {
  afterEach(() => { delete global.chrome; });

  test('the former boolean "Output as JSON" is migrated to outputFormat "json"', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({ globalSettings: { outputAsJson: true } }) } } };
    const settings = await loadGlobalSettings();
    expect(settings.outputFormat).toBe('json');
    expect(settings).not.toHaveProperty('outputAsJson');
  });

  test('an explicit outputFormat wins over a leftover outputAsJson', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({ globalSettings: { outputAsJson: true, outputFormat: 'xlsx' } }) } } };
    expect((await loadGlobalSettings()).outputFormat).toBe('xlsx');
  });

  test('defaults to "default"', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}) } } };
    expect((await loadGlobalSettings()).outputFormat).toBe('default');
  });
});

describe('buildScrapingConfig wire value', () => {
  test.each([
    [true, 'Json'], ['json', 'Json'], ['sqlite', 'Sqlite'], ['xlsx', 'Xlsx'],
  ])('flat mode: %j → outputFormat %s', (format, wire) => {
    expect(build('flat', format).outputFormat).toBe(wire);
  });

  test.each([[false], ['default'], [null], [undefined]])('flat mode: %j keeps CSV', (format) => {
    expect(build('flat', format).outputFormat).toBe('Csv');
  });

  test.each([['container', { groups }], ['api', { apiConfig: { urlTemplate: 'https://example.com/api', fields: [] } }]])(
    '%s mode sends the table format and nothing for the default', (mode, extra) => {
      expect(build(mode, 'sqlite', extra).outputFormat).toBe('Sqlite');
      expect(build(mode, 'xlsx', extra).outputFormat).toBe('Xlsx');
      expect(build(mode, 'default', extra)).not.toHaveProperty('outputFormat');
    });
});

describe('downloading a table file', () => {
  const { downloadFile } = require('./download-helpers');
  let created;

  beforeEach(() => {
    created = [];
    global.URL.createObjectURL = jest.fn((blob) => { created.push(blob); return 'blob:x'; });
    global.URL.revokeObjectURL = jest.fn();
  });

  const readBytes = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result)));
    reader.readAsArrayBuffer(blob);
  });

  test('a .sqlite file is decoded from base64 into its bytes', async () => {
    downloadFile('data.sqlite', Buffer.from([83, 81, 76, 0, 255]).toString('base64'));
    expect(created[0].type).toBe('application/vnd.sqlite3');
    expect(await readBytes(created[0])).toEqual([83, 81, 76, 0, 255]);
  });

  test('a .xlsx file gets the spreadsheet MIME type', () => {
    downloadFile('data.xlsx', Buffer.from('PK').toString('base64'));
    expect(created[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  test('text formats are untouched', async () => {
    downloadFile('data.csv', 'a,b\n1,2\n');
    expect(created[0].type).toBe('text/csv');
    expect(created[0].size).toBe(8);
  });
});
