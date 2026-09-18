Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

describe('Preview toggle (btn-preview)', () => {
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
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, one field restored from storage
  });

  test('disabled with no config, enabled once a field exists (seeded above)', () => {
    expect(document.getElementById('btn-preview').disabled).toBe(false);
  });

  test('clicking sends PREVIEW_START with the current mode/fields and turns the button active', () => {
    document.getElementById('btn-preview').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'PREVIEW_START',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(true);
  });

  test('clicking again sends PREVIEW_STOP and turns the button back off', () => {
    document.getElementById('btn-preview').click();
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-preview').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(false);
  });

  test('a PREVIEW_RESULT while active fills in the summary line', () => {
    document.getElementById('btn-preview').click();
    capturedListener({ type: 'PREVIEW_RESULT', total: 4, empty: [], truncated: false });

    const summary = document.getElementById('preview-summary');
    expect(summary.classList.contains('hidden')).toBe(false);
    expect(summary.textContent).toContain('4 Element(e) markiert');
    expect(summary.classList.contains('warn')).toBe(false);
  });

  test('a PREVIEW_RESULT with empty fields lists them and adds the warn style', () => {
    document.getElementById('btn-preview').click();
    capturedListener({ type: 'PREVIEW_RESULT', total: 1, empty: ['Preis'], truncated: false });

    const summary = document.getElementById('preview-summary');
    expect(summary.textContent).toContain('ohne Treffer: Preis');
    expect(summary.classList.contains('warn')).toBe(true);
  });

  test('PREVIEW_UNAVAILABLE turns preview off and shows a toast', () => {
    document.getElementById('btn-preview').click();
    capturedListener({ type: 'PREVIEW_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(false);
    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
    // Regression coverage: setLastError() alone doesn't reveal the button —
    // showToast() needs its own context argument too (see the analogous
    // SELECTION_UNAVAILABLE regression test).
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(false);
  });

  test('adding a new field while preview is active stops it first', async () => {
    document.getElementById('btn-preview').click();
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(true);
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-add-field').click(); // → STATES.SELECTING

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(false);
  });

  test('switching mode while preview is active stops it first', () => {
    document.getElementById('btn-preview').click();
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-mode-container').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
  });

  test('removing a field while preview is active stops it first', () => {
    document.getElementById('btn-preview').click();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-remove-field').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
  });
});
