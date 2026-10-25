require('./test-support/popup-env');
const {
  STATES,
} = require('./popup');

// ── API-mode follow-up: recorded-endpoints panel + pool-derived value-list ──
// autofill. Both features read the recorded pool via a new pull-based
// GET_API_CAPTURE_ENTRIES round trip (mirrors GET_LOGS/CHECK_ROBOTS_TXT) —
// content-script.ts itself is out of scope here (covered in its own test
// file), so chrome.runtime.sendMessage is mocked directly to stand in for
// that round trip.

describe('recorded-endpoints panel and pool-derived value-list autofill', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-entries-toggle" disabled></button>
        <div id="api-entries-panel" class="hidden">
          <ul id="api-entries-list"></ul>
        </div>
        <button id="btn-api-search"></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
        <div id="api-config-panel" class="hidden">
          <p id="api-config-summary"></p>
          <button id="btn-api-config-discard"></button>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
      </section>
      <section id="screen-api-config" class="hidden">
        <ul id="api-tree-root"></ul>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn().mockResolvedValue(undefined),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  const PRIMARY_CANDIDATE = {
    entryId: 1,
    url: 'https://example.com/api/category/obst/products',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
    requestHeaders: [],
  };

  function recordOneEntry() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();
  }

  function confirmPrimaryCandidate() {
    recordOneEntry();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [PRIMARY_CANDIDATE] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  test('the toggle button stays disabled until something has been recorded', () => {
    expect(document.getElementById('btn-api-entries-toggle').disabled).toBe(true);
    recordOneEntry();
    expect(document.getElementById('btn-api-entries-toggle').disabled).toBe(false);
  });

  test('opening the panel fetches the pool and renders it; closing does not re-fetch', async () => {
    recordOneEntry();
    chrome.runtime.sendMessage.mockResolvedValueOnce([
      { url: 'https://example.com/api/a', method: 'GET', status: 200, contentType: 'application/json' },
      { url: 'https://example.com/api/b', method: 'GET', status: 404, contentType: null },
    ]);

    document.getElementById('btn-api-entries-toggle').click();
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_API_CAPTURE_ENTRIES' });
    expect(document.getElementById('api-entries-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#api-entries-list .api-candidate')).toHaveLength(2);

    chrome.runtime.sendMessage.mockClear();
    document.getElementById('btn-api-entries-toggle').click();

    expect(document.getElementById('api-entries-panel').classList.contains('hidden')).toBe(true);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('picking "Werteliste" auto-fills the value list from sibling requests in the pool', async () => {
    confirmPrimaryCandidate();

    // /api/category/obst/products → [api, category, obst, products]; "obst"
    // (index 2) is the part being turned into a parameter.
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'category';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.runtime.sendMessage.mockResolvedValueOnce([
      { url: 'https://example.com/api/category/obst/products' },
      { url: 'https://example.com/api/category/gemuese/products' },
      { url: 'https://example.com/api/category/tiefkuehl/products' },
    ]);

    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_API_CAPTURE_ENTRIES' });
    expect(document.querySelector('.api-config-static-list').value).toBe('obst\ngemuese\ntiefkuehl');
  });

  test('the "Aus Aufzeichnung übernehmen" button merges new pool matches without clobbering manual edits', async () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));

    // Pick Werteliste with an empty pool (no auto-fill happens), then type a
    // manual value the pool doesn't know about.
    chrome.runtime.sendMessage.mockResolvedValueOnce([]);
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();

    const textarea = document.querySelector('.api-config-static-list');
    textarea.value = 'handgetippt';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // The pool has since gained a sibling request — clicking the refresh
    // button now should append it, not replace the manual entry.
    chrome.runtime.sendMessage.mockResolvedValueOnce([
      { url: 'https://example.com/api/category/gemuese/products' },
    ]);
    document.querySelector('.api-config-autofill-pool').click();
    await flushMicrotasks();

    expect(document.querySelector('.api-config-static-list').value).toBe('handgetippt\ngemuese');
  });

  test('no new matches leaves the value list untouched', async () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));

    chrome.runtime.sendMessage.mockResolvedValueOnce([]);
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();

    expect(document.querySelector('.api-config-static-list').value).toBe('');
  });
});

// ── API-Mode: third popup mode, /generate wiring (Issue #53 Phase 6) ────────
// switchMode's three-way clearing and the section-gating in render() — see
// the "Container-Mode integration" suite above for the same pattern applied
// to flat/container.

describe('API-Mode third mode integration (Issue #53 Phase 6)', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const seededApiConfig = {
    urlTemplate: 'https://example.com/api/items?category={category}',
    itemsPath: 'data.items',
    fields: [{ name: 'Titel', path: 'name' }],
    parameters: [{ name: 'category', source: { kind: 'staticList', values: ['Elektronik'] } }],
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
          <button id="btn-mode-api" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <div id="api-mode-section" class="hidden">
          <button id="btn-api-capture"></button>
          <p id="api-capture-summary" class="hidden"></p>
          <button id="btn-api-search"></button>
          <div id="api-candidates-panel" class="hidden">
            <p id="api-candidates-target"></p>
            <ul id="api-candidates-list"></ul>
          </div>
          <div id="api-config-panel" class="hidden">
            <p id="api-config-summary"></p>
            <button id="btn-api-config-discard"></button>
          </div>
        </div>
        <div id="preview-section">
          <button id="btn-preview" disabled></button>
          <p id="preview-summary" class="hidden"></p>
        </div>
        <button id="btn-generate" disabled></button>
        <button id="btn-export-config" disabled></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            groups: [],
            apiConfig: seededApiConfig,
            mode: 'flat',
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/generate')) return Promise.resolve({ ok: true, text: () => Promise.resolve('# script') });
      return Promise.resolve({ ok: true });
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields/apiConfig restored from storage
  });

  test('switching to API mode shows only api-mode-section and hides the (meaningless there) preview toggle', () => {
    document.getElementById('btn-mode-api').click();

    expect(document.getElementById('api-mode-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('container-mode-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('preview-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-mode-api').classList.contains('active')).toBe(true);
  });

  test('switching to API mode clears fields/groups; switching away clears the confirmed apiConfig', () => {
    expect(document.getElementById('fields-list').children.length).toBe(1);

    document.getElementById('btn-mode-api').click();
    // Fields cleared like the flat↔container switch already does.
    expect(document.getElementById('fields-list').children.length).toBe(0);
    // apiConfig itself is untouched by switching *into* api mode.
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-generate').disabled).toBe(false);

    document.getElementById('btn-mode-flat').click();
    // Fields stayed empty (flat mode only clears groups/apiConfig, not fields).
    expect(document.getElementById('btn-generate').disabled).toBe(true);

    document.getElementById('btn-mode-api').click();
    // apiConfig was cleared by the switch away from api mode above.
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-generate').disabled).toBe(true);
  });

  test('POSTs {version, url, api} — no fields/groups/outputFormat — once in API mode', async () => {
    document.getElementById('btn-mode-api').click();
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    expect(generateCall).toBeDefined();
    const body = JSON.parse(generateCall[1].body);

    expect(body).toEqual({
      version: '1', url: 'https://example.com', api: seededApiConfig,
      scriptFileName: 'scraper', outputFileName: null,
    });
  });
});

// ── API-Mode range format UI (bug/api-range-format follow-up) ───────────────
// End-to-end reproduction of the reported bug's fix: penny.de encodes a
// year-week as "2026-35" in its own URL, not ISO-8601's "2026-W35" — the
// popup should auto-suggest the matching format the moment "Bereich" is
// picked for that part, instead of requiring the user to type
// "{yyyy}-{ww}" by hand.

describe('API-Mode range format presets (bug/api-range-format follow-up)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search"></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
        <div id="api-config-panel" class="hidden">
          <p id="api-config-summary"></p>
          <button id="btn-api-config-discard"></button>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
      </section>
      <section id="screen-api-config" class="hidden">
        <ul id="api-tree-root"></ul>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://www.penny.de/angebote/' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ url: 'https://www.penny.de/angebote/' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  // Reproduces the reported bug's actual recorded request: path segments
  // are [".rest", "offers", "by-category", "2026-35", "top-angebote"] —
  // "2026-35" at index 3 (nth-child(4) below).
  const PENNY_CANDIDATE = {
    entryId: 1,
    url: 'https://www.penny.de/.rest/offers/by-category/2026-35/top-angebote',
    method: 'GET',
    path: 'offerTiles[0].title',
    value: 'Orangen-Nektar',
    siblings: [],
    itemsPath: 'offerTiles',
    valuePath: 'title',
    treeSkeleton: [{ kind: 'group', path: 'offerTiles' }, { kind: 'field', path: 'title' }],
    requestHeaders: [],
  };

  function confirmPennyCandidate() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: PENNY_CANDIDATE.url } });
    document.getElementById('btn-api-capture').click();

    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Orangen-Nektar', candidates: [PENNY_CANDIDATE] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  const WEEK_SEGMENT_TOGGLE_SELECTOR = '#api-config-segments .api-config-part-row:nth-child(4) .api-config-part-toggle';

  // Common setup every test below builds on: toggles the "2026-35" segment
  // variable, names it "KW", and picks "Bereich" as its source.
  function selectRangeForWeekPart() {
    const toggle = document.querySelector(WEEK_SEGMENT_TOGGLE_SELECTOR);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'KW';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    const rangeRadio = document.querySelector('.api-config-source-kind-radio[value="range"]');
    rangeRadio.checked = true;
    rangeRadio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  test('picking "Bereich" auto-selects the preset matching the captured "2026-35" value', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();

    const formatSelect = document.querySelector('.api-config-range-format-preset');
    expect(formatSelect.value).toBe('{yyyy}-{ww}');
    expect(formatSelect.selectedOptions[0].textContent).toContain('Jahr-Woche ohne Trennzeichen');
    // No custom-format input shown — a preset was matched.
    expect(document.querySelector('.api-config-range-format-custom')).toBeNull();
  });

  test('the live example preview echoes "Von" once it matches the auto-detected format', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();

    const fromInput = document.querySelector('.api-config-range-from');
    fromInput.value = '2026-35';
    fromInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.api-config-range-format-example').textContent).toBe('Beispiel: 2026-35');
  });

  test('switching to "Eigenes Format…" reveals a free-text input and the example follows it', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();

    const formatSelect = document.querySelector('.api-config-range-format-preset');
    formatSelect.value = 'custom';
    formatSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const customInput = document.querySelector('.api-config-range-format-custom');
    expect(customInput).not.toBeNull();
    expect(document.querySelector('.api-config-range-format-example').textContent).toBe('Beispiel: (Format eingeben)');

    customInput.value = '{ww}/{yyyy}';
    customInput.dispatchEvent(new Event('change', { bubbles: true }));
    const fromInput = document.querySelector('.api-config-range-from');
    fromInput.value = '35/2026';
    fromInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.api-config-range-format-example').textContent).toBe('Beispiel: 35/2026');
  });

  test('changing Type re-detects the format against the new type\'s own presets', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart(); // IsoWeek, auto-detected "{yyyy}-{ww}"

    const typeSelect = document.querySelector('.api-config-range-type');
    typeSelect.value = 'Date';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // "2026-35" matches no Date preset → falls back to Date's own
    // ISO-Standard, not IsoWeek's leftover format string.
    expect(document.querySelector('.api-config-range-format-preset').value).toBe('{yyyy}-{mm}-{dd}');
  });

  test('"Übernehmen" persists an ApiParameterSource with the non-default format — the actual fix for the reported bug', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();
    const fromInput = document.querySelector('.api-config-range-from');
    fromInput.value = '2026-35';
    fromInput.dispatchEvent(new Event('change', { bubbles: true }));
    const toInput = document.querySelector('.api-config-range-to');
    toInput.value = '2026-50';
    toInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-config-confirm').click();

    const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(persistedConfig.parameters).toContainEqual({
      name: 'KW',
      source: { kind: 'range', type: 'IsoWeek', from: '2026-35', to: '2026-50', format: '{yyyy}-{ww}' },
    });
  });
});
