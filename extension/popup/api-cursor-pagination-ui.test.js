// Issue #224: integration coverage for the API_CONFIG screen's cursor
// pagination section — the full wired-up popup (require('./popup'), real DOM
// clicks, simulated chrome.runtime messages), per Architecture Decision #12's
// test-split convention.
describe('API-Mode cursor pagination section (Issue #224)', () => {
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
        <button id="btn-api-search" disabled></button>
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
        id: 1, url: 'https://example.com/api/items?category=Elektronik&cursor=zzz', method: 'GET', status: 200,
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
    url: 'https://example.com/api/items?category=Elektronik&cursor=zzz',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
    requestHeaders: [],
  };

  function confirmPrimaryCandidate() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [PRIMARY_CANDIDATE] });
    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  function change(el, value) {
    if (typeof value === 'boolean') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const cursorField = (name) => document.querySelector(`.api-cursor-field[data-field="${name}"]`);

  test('enabling the toggle reveals the section and blocks Apply until it is complete', () => {
    confirmPrimaryCandidate();
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);

    change(document.getElementById('toggle-api-cursor'), true);

    expect(document.getElementById('api-cursor-config').classList.contains('hidden')).toBe(false);
    expect(cursorField('maxPages').value).toBe('50');
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);
  });

  test('Apply sends the cursor pagination on the wire', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-cursor'), true);
    change(cursorField('nextCursorPath'), 'pageInfo.endCursor');
    change(cursorField('queryParameterName'), 'cursor');
    change(cursorField('maxPages'), '5');
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);

    document.getElementById('btn-api-config-confirm').click();

    const apiConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(apiConfig.cursorPagination).toEqual({
      nextCursorPath: 'pageInfo.endCursor', target: 'Query', queryParameterName: 'cursor', maxPages: 5,
    });
  });

  test('"Detect from recording" fills the paths and drops the recorded cursor from the URL (page 1 has none)', async () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-cursor'), true);

    document.getElementById('btn-api-cursor-detect').click();
    await flushMicrotasks();

    expect(cursorField('nextCursorPath').value).toBe('pageInfo.endCursor');
    expect(cursorField('hasNextPagePath').value).toBe('pageInfo.hasNextPage');
    expect(cursorField('queryParameterName').value).toBe('cursor');
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);

    document.getElementById('btn-api-config-confirm').click();
    const apiConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(apiConfig.urlTemplate).toBe('https://example.com/api/items?category=Elektronik');
    expect(apiConfig.cursorPagination.hasNextPagePath).toBe('pageInfo.hasNextPage');
  });

  test('switching to a body target without a POST body explains why Apply stays blocked', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-cursor'), true);
    change(cursorField('nextCursorPath'), 'next');
    change(cursorField('target'), 'Body');
    change(cursorField('bodyPath'), 'variables.after');

    expect(document.querySelector('#api-cursor-config .browser-actions-hint')).not.toBeNull();
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);
  });

  test('disabling the toggle removes the cursor pagination again', () => {
    confirmPrimaryCandidate();
    change(document.getElementById('toggle-api-cursor'), true);
    change(document.getElementById('toggle-api-cursor'), false);

    expect(document.getElementById('api-cursor-config').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
    document.getElementById('btn-api-config-confirm').click();
    expect(chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig.cursorPagination).toBeUndefined();
  });
});
