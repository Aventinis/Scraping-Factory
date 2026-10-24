require('./test-support/popup-env');
const {
  STATES,
} = require('./popup');

// API-Mode network recording (Issue #53 Phase 3) — a standalone toggle, not
// gated by Fields/Groups config the way btn-preview is (no third API mode
// in the popup yet, see btn-mode-flat/-container).
describe('Network recording toggle (btn-api-capture)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-preview" disabled></button>
        <p id="preview-summary" class="hidden"></p>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
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
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({ url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('clicking sends API_CAPTURE_START and turns the button active', () => {
    document.getElementById('btn-api-capture').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CAPTURE_START' });
    expect(document.getElementById('btn-api-capture').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-api-capture').textContent).toContain('beenden');
  });

  test('clicking again sends API_CAPTURE_STOP and turns the button back off', () => {
    document.getElementById('btn-api-capture').click();
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-api-capture').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CAPTURE_STOP' });
    expect(document.getElementById('btn-api-capture').classList.contains('active')).toBe(false);
  });

  test('API_CAPTURE_ENTRY messages increment the recorded-count summary while active', () => {
    document.getElementById('btn-api-capture').click();

    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 2, url: 'https://example.com/api/b' } });

    const summary = document.getElementById('api-capture-summary');
    expect(summary.classList.contains('hidden')).toBe(false);
    expect(summary.textContent).toContain('2 Anfrage(n) aufgezeichnet');
  });

  test('API_CAPTURE_ENTRY messages are ignored while recording is not active', () => {
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });

    const summary = document.getElementById('api-capture-summary');
    expect(summary.classList.contains('hidden')).toBe(true);
  });

  test('stopping keeps the recorded-count summary visible (Phase 4 searches it after stopping)', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });

    document.getElementById('btn-api-capture').click();

    const summary = document.getElementById('api-capture-summary');
    expect(summary.classList.contains('hidden')).toBe(false);
    expect(summary.textContent).toBe('1 Anfrage(n) aufgezeichnet');
  });

  test('starting a new recording resets the count back to 0', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });
    document.getElementById('btn-api-capture').click(); // stop

    document.getElementById('btn-api-capture').click(); // start again

    expect(document.getElementById('api-capture-summary').classList.contains('hidden')).toBe(true);
  });

  test('API_CAPTURE_UNAVAILABLE turns recording off and shows a toast', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('btn-api-capture').classList.contains('active')).toBe(false);
    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
    // Regression coverage: setLastError() alone doesn't reveal the button —
    // showToast() needs its own context argument too (see the analogous
    // SELECTION_UNAVAILABLE regression test).
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(false);
  });
});

describe('API-mode candidate search (btn-api-search, Issue #53 Phase 4)', () => {
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
        <button id="btn-api-search" disabled></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
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

  function recordOneEntry() {
    document.getElementById('btn-api-capture').click(); // start
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click(); // stop — count must survive this, see the recording-toggle tests above
    chrome.runtime.sendMessage.mockClear();
  }

  test('stays disabled until something has been recorded', () => {
    expect(document.getElementById('btn-api-search').disabled).toBe(true);
  });

  test('is enabled once at least one request has been recorded, even after stopping', () => {
    recordOneEntry();
    expect(document.getElementById('btn-api-search').disabled).toBe(false);
  });

  test('clicking sends START_SELECTION with apiSearch:true and switches to the selecting screen', () => {
    recordOneEntry();

    document.getElementById('btn-api-search').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', apiSearch: true });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);
  });

  test('an ELEMENT_SELECTED arriving during an api-search round does not open the flat field-name modal', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();

    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [] });

    expect(document.getElementById('modal-field-name').classList.contains('hidden')).toBe(true);
  });

  // Issue #429: a pick is recorded as handled, also in an api-search round (which returns early),
  // so the service worker's late fallback write is recognised as a leftover on the next load.
  test('a live ELEMENT_SELECTED marks its pick as handled, also during an api-search round', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [], pickId: 'k1-abc' });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ handledPickId: 'k1-abc' });
  });

  test('API_CANDIDATES ends the selection round, returns to idle and renders the results', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [] });

    const candidates = [{ url: 'https://example.com/api', method: 'GET', path: 'price', value: '3.50', siblings: [] }];
    capturedListener({ type: 'API_CANDIDATES', target: '3.50', candidates });

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(true);
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('pendingSelector');

    const panel = document.getElementById('api-candidates-panel');
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-candidates-target').textContent).toBe('Gesucht: "3.50"');
    expect(document.querySelectorAll('.api-candidate')).toHaveLength(1);
  });

  test('cancelling an api-search round clears apiSearchSelecting (a later plain click can open the field modal again)', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();

    document.getElementById('btn-cancel-selection').click();
    // A later, unrelated selection round (a normal "+ Feld hinzufügen"
    // click, which also lands in STATES.SELECTING) reaching ELEMENT_SELECTED
    // must behave normally now, not be swallowed by a leftover
    // apiSearchSelecting flag.
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [] });

    expect(document.getElementById('modal-field-name').classList.contains('hidden')).toBe(false);
  });
});
