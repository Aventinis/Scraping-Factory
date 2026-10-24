require('./test-support/popup-env');
const {
  escapeHtml,
  renderFields,
  renderApiCandidates,
  renderApiEntriesList,
  renderDataPreview,
} = require('./popup');

// ── escapeHtml ────────────────────────────────────────────────────────────────
describe('escapeHtml', () => {
  test('escapes <, >, &, and "', () => {
    expect(escapeHtml('<b class="x">a & b</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;a &amp; b&lt;/b&gt;'
    );
  });

  test('passes through plain text unchanged', () => {
    expect(escapeHtml('Produkttitel')).toBe('Produkttitel');
  });

  test('coerces non-string to string first', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

// ── renderFields ─────────────────────────────────────────────────────────────

describe('renderFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fields-list"></div>';
  });

  test('sets full selector as title attribute so it is visible despite CSS truncation', () => {
    const longSelector = '#vorspeisen > ul.menu-list > li.item > span.name';
    renderFields([{ name: 'Titel', selector: longSelector, attribute: null }]);

    const selectorEl = document.querySelector('.field-selector');
    expect(selectorEl.title).toBe(longSelector);
    expect(selectorEl.textContent).toBe(longSelector);
  });

  test('sets full name as title attribute too', () => {
    renderFields([{ name: 'Ein sehr langer Feldname', selector: 'h1', attribute: null }]);

    const nameEl = document.querySelector('.field-name');
    expect(nameEl.title).toBe('Ein sehr langer Feldname');
  });

  // Issue #42, Phase 7
  test('shows an iframe badge only for a field with a framePath', () => {
    renderFields([
      { name: 'Preis', selector: '.price', attribute: null, framePath: ['#price-widget'] },
      { name: 'Titel', selector: 'h1', attribute: null, framePath: null },
    ]);

    const rows = document.querySelectorAll('.field-row');
    expect(rows[0].querySelector('.frame-badge')).not.toBeNull();
    expect(rows[0].querySelector('.frame-badge').title).toContain('#price-widget');
    expect(rows[1].querySelector('.frame-badge')).toBeNull();
  });
});

// Issue #122 — deliberately not named "renderPreview": that name already
// belongs to the unrelated DOM-highlight feature (togglePreview et al.).
describe('renderDataPreview', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="data-preview-panel" class="hidden">
        <div id="data-preview-table-wrap" class="hidden"></div>
        <pre id="data-preview-text" class="hidden"></pre>
        <p id="data-preview-truncated" class="hidden"></p>
      </div>
    `;
  });

  test('hides the panel entirely when preview is null', () => {
    renderDataPreview(null);
    expect(document.getElementById('data-preview-panel').classList.contains('hidden')).toBe(true);
  });

  test('renders a Csv preview as a table, one row per sample entry', () => {
    renderDataPreview({
      outputFormat: 'Csv', totalCount: 2, truncated: false, columns: ['Titel'],
      rows: [{ Titel: 'Suppe' }, { Titel: 'Salat' }],
    });

    expect(document.getElementById('data-preview-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('data-preview-text').classList.contains('hidden')).toBe(true);
    const table = document.querySelector('.data-preview-table');
    expect(table.querySelectorAll('th')).toHaveLength(1);
    expect(table.querySelectorAll('th')[0].textContent).toBe('Titel');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('td').textContent).toBe('Suppe');
    expect(rows[1].querySelector('td').textContent).toBe('Salat');
    expect(document.getElementById('data-preview-truncated').classList.contains('hidden')).toBe(true);
  });

  // Proves table cells use textContent, not innerHTML — a scraped value
  // that happens to look like markup must show up as literal text, not be
  // interpreted/dropped as an element.
  test('does not interpret HTML-like scraped values', () => {
    renderDataPreview({
      outputFormat: 'Csv', totalCount: 1, truncated: false, columns: ['Titel'],
      rows: [{ Titel: '<b>fett</b>' }],
    });

    const cell = document.querySelector('.data-preview-table tbody td');
    expect(cell.textContent).toBe('<b>fett</b>');
    expect(cell.querySelector('b')).toBeNull();
  });

  test('shows a "showing N of M" note when a Csv preview was truncated', () => {
    renderDataPreview({
      outputFormat: 'Csv', totalCount: 60, truncated: true, columns: ['Titel'],
      rows: Array.from({ length: 50 }, (_, i) => ({ Titel: `Eintrag ${i}` })),
    });

    const note = document.getElementById('data-preview-truncated');
    expect(note.classList.contains('hidden')).toBe(false);
    expect(note.textContent).toContain('50');
    expect(note.textContent).toContain('60');
  });

  test('renders an Xml preview as read-only text, not a table', () => {
    renderDataPreview({ outputFormat: 'Xml', totalCount: 3, truncated: false, xmlSample: '<Ergebnis><Kategorie/></Ergebnis>' });

    expect(document.getElementById('data-preview-table-wrap').classList.contains('hidden')).toBe(true);
    const textEl = document.getElementById('data-preview-text');
    expect(textEl.classList.contains('hidden')).toBe(false);
    expect(textEl.textContent).toBe('<Ergebnis><Kategorie/></Ergebnis>');
  });

  test('shows a generic truncation note for a truncated Xml preview (no shown/total counts)', () => {
    renderDataPreview({ outputFormat: 'Xml', totalCount: 999, truncated: true, xmlSample: '<Ergebnis/>' });

    const note = document.getElementById('data-preview-truncated');
    expect(note.classList.contains('hidden')).toBe(false);
    expect(note.textContent.length).toBeGreaterThan(0);
  });

  // Issue #86: Json's flat shape (an array of records) reuses the table
  // renderer exactly like Csv — driven by the presence of columns/rows, not
  // by outputFormat === 'Csv' specifically.
  test('renders a flat Json preview as a table, same as Csv', () => {
    renderDataPreview({
      outputFormat: 'Json', totalCount: 2, truncated: false, columns: ['Titel'],
      rows: [{ Titel: 'Suppe' }, { Titel: 'Salat' }],
    });

    expect(document.getElementById('data-preview-text').classList.contains('hidden')).toBe(true);
    const table = document.querySelector('.data-preview-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('td').textContent).toBe('Suppe');
  });

  // Json's tree shape (a nested object) reuses the same text-sample renderer
  // as Xml, via jsonSample instead of xmlSample.
  test('renders a tree-shaped Json preview as read-only text, not a table', () => {
    renderDataPreview({ outputFormat: 'Json', totalCount: 3, truncated: false, jsonSample: '{"Kategorie": []}' });

    expect(document.getElementById('data-preview-table-wrap').classList.contains('hidden')).toBe(true);
    const textEl = document.getElementById('data-preview-text');
    expect(textEl.classList.contains('hidden')).toBe(false);
    expect(textEl.textContent).toBe('{"Kategorie": []}');
  });
});

describe('renderApiCandidates (Issue #53 Phase 4)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <p id="api-candidates-target"></p>
      <ul id="api-candidates-list"></ul>
    `;
  });

  test('shows the searched-for target and an empty-state message when there are no candidates', () => {
    renderApiCandidates({ target: 'Suppe', candidates: [] });

    expect(document.getElementById('api-candidates-target').textContent).toBe('Gesucht: "Suppe"');
    expect(document.querySelector('.api-candidates-empty')).not.toBeNull();
  });

  test('renders one row per candidate with url/path/value', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{ url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [] }],
    });

    const row = document.querySelector('.api-candidate');
    expect(row.querySelector('.api-candidate-url').textContent).toContain('https://example.com/api');
    expect(row.querySelector('.api-candidate-path').textContent).toBe('items[0].name');
    expect(row.querySelector('.api-candidate-value').textContent).toContain('Suppe');
  });

  test('renders a one-click chip per sibling suggestion', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{ url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [{ name: 'price', path: 'items[0].price', value: 3.5 }] }],
    });

    const chip = document.querySelector('.api-sibling-chip');
    expect(chip.textContent).toBe('+ price');
  });

  test('renders a "select all" button alongside the sibling chips, initially labeled to select', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{
        url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe',
        siblings: [{ name: 'price', path: 'items[0].price', value: 3.5 }, { name: 'unit', path: 'items[0].unit', value: 'kg' }],
      }],
    });

    const selectAllBtn = document.querySelector('.api-sibling-select-all');
    expect(selectAllBtn).not.toBeNull();
    expect(selectAllBtn.textContent).toBe('Alle auswählen');
  });

  test('no select-all button when a candidate has no siblings', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{ url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [] }],
    });
    expect(document.querySelector('.api-sibling-select-all')).toBeNull();
  });
});

describe('renderApiEntriesList (recorded-endpoints viewer)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<ul id="api-entries-list"></ul>`;
  });

  test('shows an empty-state message when nothing was recorded', () => {
    renderApiEntriesList([]);
    expect(document.querySelector('.api-candidates-empty')).not.toBeNull();
  });

  test('treats a missing/null entries list the same as empty', () => {
    renderApiEntriesList(null);
    expect(document.querySelector('.api-candidates-empty')).not.toBeNull();
  });

  test('renders one row per entry with method, status and URL, plus content type when present', () => {
    renderApiEntriesList([
      { url: 'https://example.com/api/items', method: 'GET', status: 200, contentType: 'application/json' },
      { url: 'https://example.com/img.png', method: 'GET', status: 200, contentType: 'image/png', bodySkipped: true },
    ]);

    const rows = document.querySelectorAll('.api-candidate');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.api-candidate-url').textContent).toBe('GET 200 https://example.com/api/items');
    expect(rows[0].querySelector('.api-candidate-path').textContent).toBe('application/json');
    // The status is always known (read off the response before the
    // body-skip decision, see api-capture.ts) — bodySkipped only affects
    // whether a body was captured, not whether the row shows a status.
    expect(rows[1].querySelector('.api-candidate-url').textContent).toBe('GET 200 https://example.com/img.png');
  });

  test('omits the content-type line entirely when none was recorded', () => {
    renderApiEntriesList([{ url: 'https://example.com/api', method: 'GET', status: 200, contentType: null }]);
    expect(document.querySelector('.api-candidate-path')).toBeNull();
  });

  test('shows a captured POST body', () => {
    renderApiEntriesList([
      { url: 'https://example.com/api/search', method: 'POST', status: 200, contentType: 'application/json', requestBody: '{"category":"electronics"}' },
    ]);
    const bodyEl = document.querySelector('.api-candidate-body');
    expect(bodyEl).not.toBeNull();
    expect(bodyEl.textContent).toBe('{"category":"electronics"}');
    expect(bodyEl.classList.contains('api-candidate-body-skipped')).toBe(false);
  });

  test('shows a "[not captured]" note for a skipped request body', () => {
    renderApiEntriesList([
      { url: 'https://example.com/api/search', method: 'POST', status: 200, contentType: 'multipart/form-data', requestBodySkipped: true },
    ]);
    const bodyEl = document.querySelector('.api-candidate-body');
    expect(bodyEl).not.toBeNull();
    expect(bodyEl.classList.contains('api-candidate-body-skipped')).toBe(true);
  });

  test('omits the body line entirely for a GET entry with no request body', () => {
    renderApiEntriesList([
      { url: 'https://example.com/api', method: 'GET', status: 200, contentType: 'application/json', requestBody: '', requestBodySkipped: false },
    ]);
    expect(document.querySelector('.api-candidate-body')).toBeNull();
  });
});
