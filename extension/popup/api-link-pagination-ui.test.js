// Issue #321: integration coverage for the API_CONFIG screen's Link-header
// pagination section (and its exclusivity with the cursor section) — the full wired-up popup (require('./popup'), real DOM
// clicks, simulated chrome.runtime messages), per Architecture Decision #12's
// test-split convention.
describe('API-Mode Link-header pagination section (Issue #321)', () => {
  let capturedListener;
  let captureEntries;

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
        <div id="api-cursor-section">
          <input type="checkbox" id="toggle-api-cursor" />
          <div id="api-cursor-config" class="hidden"></div>
        </div>
        <div id="api-link-section">
          <input type="checkbox" id="toggle-api-link" />
          <p id="api-link-detected-hint" class="hidden"></p>
          <p id="api-link-post-hint" class="hidden"></p>
          <div id="api-link-config" class="hidden">
            <input type="number" id="input-api-link-max-pages" value="50" />
          </div>
        </div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    captureEntries = [
      {
        id: 1, url: 'https://example.com/api/items?category=Elektronik&page=1', method: 'GET', status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: [{ name: 'Titel-Test' }] }, pageInfo: { endCursor: 'abc', hasNextPage: true } }),
      },
    ];

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn((message) => Promise.resolve(message?.type === 'GET_API_CAPTURE_ENTRIES' ? captureEntries : undefined)),
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
    url: 'https://example.com/api/items?category=Elektronik&page=1',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
    requestHeaders: [],
  };

  function confirmPrimaryCandidate(candidate = PRIMARY_CANDIDATE) {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [candidate] });
    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  function change(el, value) {
    if (typeof value === 'boolean') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const confirm = () => document.getElementById('btn-api-config-confirm');
  const sentApiConfig = () => chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;

  test('off by default; Apply sends no linkHeaderPagination', () => {
    confirmPrimaryCandidate();
    expect(document.getElementById('toggle-api-link').checked).toBe(false);
    expect(document.getElementById('api-link-config').classList.contains('hidden')).toBe(true);
    confirm().click();
    expect(sentApiConfig().linkHeaderPagination).toBeUndefined();
  });

  test('enabling it reveals the page cap and sends linkHeaderPagination on the wire', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-link'), true);

    expect(document.getElementById('api-link-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-api-link-max-pages').value).toBe('50');
    expect(confirm().disabled).toBe(false);

    change(document.getElementById('input-api-link-max-pages'), '7');
    confirm().click();
    expect(sentApiConfig().linkHeaderPagination).toEqual({ maxPages: 7 });
  });

  test('a blank/invalid page cap falls back to the default instead of blocking', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-link'), true);
    change(document.getElementById('input-api-link-max-pages'), '0');
    confirm().click();
    expect(sentApiConfig().linkHeaderPagination).toEqual({ maxPages: 50 });
  });

  test('is suggested only when the recorded response carried a rel="next" Link header', () => {
    confirmPrimaryCandidate({ ...PRIMARY_CANDIDATE, hasNextLink: true });
    expect(document.getElementById('api-link-detected-hint').classList.contains('hidden')).toBe(false);
    change(document.getElementById('toggle-api-link'), true);
    expect(document.getElementById('api-link-detected-hint').classList.contains('hidden')).toBe(true);
  });

  test('no suggestion without a Link header in the recording', () => {
    confirmPrimaryCandidate();
    expect(document.getElementById('api-link-detected-hint').classList.contains('hidden')).toBe(true);
  });

  test('is mutually exclusive with cursor pagination, in both directions', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-cursor'), true);
    change(document.getElementById('toggle-api-link'), true);
    expect(document.getElementById('toggle-api-cursor').checked).toBe(false);
    expect(document.getElementById('api-cursor-config').classList.contains('hidden')).toBe(true);
    expect(confirm().disabled).toBe(false);

    change(document.getElementById('toggle-api-cursor'), true);
    expect(document.getElementById('toggle-api-link').checked).toBe(false);
    expect(document.getElementById('api-link-config').classList.contains('hidden')).toBe(true);
  });

  test('is unavailable for a POST request, with an explanation', () => {
    confirmPrimaryCandidate({ ...PRIMARY_CANDIDATE, method: 'POST' });
    expect(document.getElementById('toggle-api-link').disabled).toBe(true);
    expect(document.getElementById('api-link-post-hint').classList.contains('hidden')).toBe(false);
  });

  test('disabling it removes the pagination again', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-link'), true);
    change(document.getElementById('toggle-api-link'), false);
    expect(document.getElementById('api-link-config').classList.contains('hidden')).toBe(true);
    confirm().click();
    expect(sentApiConfig().linkHeaderPagination).toBeUndefined();
  });
});
