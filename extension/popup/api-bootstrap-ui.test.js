// Issue #220: integration coverage for the API_CONFIG screen's "Auth
// bootstrap (token)" section — the full wired-up popup (require('./popup'),
// real DOM clicks, simulated chrome.runtime messages), per Architecture
// Decision #12's test-split convention.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

describe('API-Mode auth bootstrap section (Issue #220)', () => {
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
        <div id="api-bootstrap-section">
          <input type="checkbox" id="toggle-api-bootstrap" />
          <div id="api-bootstrap-config" class="hidden"></div>
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
        id: 5, url: 'https://example.com/auth/token', method: 'POST', status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { access_token: TOKEN, expires_in: 3600 } }),
        requestHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        requestBody: '{"username":"alice","password":"hunter2"}',
      },
      { id: 6, url: 'https://example.com/styles.css', method: 'GET', status: 200, contentType: 'text/css', body: 'body{}' },
      { id: 7, url: 'https://example.com/api/config', method: 'GET', status: 200, contentType: 'application/json', body: '{"lang":"de"}' },
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
    url: 'https://example.com/api/items?category=Elektronik',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
    requestHeaders: [{ name: 'Authorization', value: `Bearer ${TOKEN}` }],
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

  function enableBootstrap() {
    change(document.getElementById('toggle-api-bootstrap'), true);
  }

  async function takeTokenRequestFromRecording() {
    document.getElementById('btn-api-bootstrap-from-recording').click();
    await flushMicrotasks();
    document.querySelector('.api-bootstrap-recording-entry[data-entry-id="5"]').click();
  }

  test('enabling the toggle reveals the section and blocks Apply until the bootstrap is complete', () => {
    confirmPrimaryCandidate();
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);

    enableBootstrap();

    expect(document.getElementById('api-bootstrap-config').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.api-bootstrap-field[data-field="name"]').value).toBe('token');
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);
  });

  test('the recording picker lists only JSON responses, the token request first and marked as likely', async () => {
    confirmPrimaryCandidate();
    enableBootstrap();

    document.getElementById('btn-api-bootstrap-from-recording').click();
    await flushMicrotasks();

    const entries = document.querySelectorAll('.api-bootstrap-recording-entry');
    expect(Array.from(entries).map(el => el.dataset.entryId)).toEqual(['5', '7']);
    expect(entries[0].classList.contains('likely')).toBe(true);
    expect(entries[1].classList.contains('likely')).toBe(false);
  });

  test('taking the token request from the recording fills the bootstrap and wires the Authorization header', async () => {
    confirmPrimaryCandidate();
    enableBootstrap();
    await takeTokenRequestFromRecording();

    expect(document.querySelector('.api-bootstrap-field[data-field="url"]').value).toBe('https://example.com/auth/token');
    expect(document.querySelector('.api-bootstrap-field[data-field="valuePath"]').value).toBe('data.access_token');
    expect(document.querySelector('.api-bootstrap-recording-entry')).toBeNull();
    const passwordRow = Array.from(document.querySelectorAll('.api-bootstrap-pair-name')).find(el => el.value === 'password');
    expect(passwordRow.closest('li').querySelector('.api-bootstrap-pair-env').value).toBe('API_PASSWORD');
    expect(document.querySelector('.api-config-header-template').value).toBe('Bearer {token}');
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });

  test('Apply sends the bootstrap and the header template, never the recorded password or a test value', async () => {
    confirmPrimaryCandidate();
    enableBootstrap();
    await takeTokenRequestFromRecording();
    change(document.querySelector('.api-bootstrap-test-value[data-env-name="API_PASSWORD"]'), 'test-secret');

    document.getElementById('btn-api-config-confirm').click();

    const persisted = chrome.storage.session.set.mock.calls.at(-1)[0];
    expect(persisted.apiConfig.headers).toEqual([{ name: 'Authorization', template: 'Bearer {token}' }]);
    expect(persisted.apiConfig.bootstrap).toEqual({
      name: 'token',
      method: 'POST',
      url: 'https://example.com/auth/token',
      bodyFields: [{ name: 'username', value: 'alice' }, { name: 'password', environmentVariableName: 'API_PASSWORD' }],
      bodyEncoding: 'Json',
      valuePath: 'data.access_token',
    });
    const allPersisted = JSON.stringify(chrome.storage.session.set.mock.calls);
    expect(allPersisted).not.toContain('hunter2');
    expect(allPersisted).not.toContain('test-secret');
  });

  test('renaming the placeholder carries the header template along', async () => {
    confirmPrimaryCandidate();
    enableBootstrap();
    await takeTokenRequestFromRecording();

    change(document.querySelector('.api-bootstrap-field[data-field="name"]'), 'jwt');

    expect(document.querySelector('.api-config-header-template').value).toBe('Bearer {jwt}');
  });

  test('a URL part can take the token value as its source', () => {
    confirmPrimaryCandidate();
    enableBootstrap();
    change(document.querySelector('.api-bootstrap-field[data-field="url"]'), 'https://example.com/auth/token');
    change(document.querySelector('.api-bootstrap-field[data-field="valuePath"]'), 'access_token');

    change(document.querySelector('#api-config-query-params .api-config-part-toggle'), true);
    change(document.querySelector('.api-config-source-kind-radio[value="bootstrap"]'), true);
    document.getElementById('btn-api-config-confirm').click();

    const apiConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(apiConfig.urlTemplate).toBe('https://example.com/api/items?category={token}');
    expect(apiConfig.parameters).toEqual([]);
  });

  test('disabling the bootstrap reverts token headers to their recorded literal value', async () => {
    confirmPrimaryCandidate();
    enableBootstrap();
    await takeTokenRequestFromRecording();

    change(document.getElementById('toggle-api-bootstrap'), false);

    expect(document.getElementById('api-bootstrap-config').classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.api-config-header-template')).toBeNull();
    expect(document.querySelector('.api-config-header-mode-radio[value="literal"]').checked).toBe(true);
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });
});
