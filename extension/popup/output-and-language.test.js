require('./test-support/popup-env');
const {
  STATES,
} = require('./popup');

// ── Konfiguration exportieren (btn-export-config) ────────────────────────────


describe('output settings (script/output filename)', () => {
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
        <div id="api-mode-section" class="hidden"></div>
        <input type="text" id="input-script-filename" />
        <input type="text" id="input-output-filename" />
        <span id="output-filename-ext"></span>
        <button id="btn-generate" disabled></button>
        <button id="btn-export-config" disabled></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <section id="screen-done" class="hidden">
        <button id="btn-back-to-config"></button>
        <button id="btn-download"></button>
      </section>
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
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true }); // health check
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('typing into the script/output filename inputs persists them to session storage', () => {
    const scriptInput = document.getElementById('input-script-filename');
    scriptInput.value = 'mein-scraper';
    scriptInput.dispatchEvent(new Event('input'));

    const outputInput = document.getElementById('input-output-filename');
    outputInput.value = 'ergebnisse';
    outputInput.dispatchEvent(new Event('input'));

    expect(global.chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({ scriptFileName: 'mein-scraper', outputFileName: 'ergebnisse' }),
    );
  });

  test('the output extension hint switches between .csv and .xml depending on mode', () => {
    const ext = document.getElementById('output-filename-ext');
    expect(ext.textContent).toBe('.csv');

    document.getElementById('btn-mode-container').click();
    expect(ext.textContent).toBe('.xml');

    document.getElementById('btn-mode-flat').click();
    expect(ext.textContent).toBe('.csv');
  });

  // Issue-driven follow-up: "Output as JSON" moved off per-scrape state to
  // the global Settings tab (shared/global-settings.ts) — the extension
  // hint has to read it from there now, overriding whichever of .csv/.xml
  // the current mode would otherwise show (Architecture Decision, Issue #86).
  test('the output extension hint shows .json when the global "Output as JSON" preference is on', async () => {
    const { updateGlobalSettings } = require('../shared/global-settings');
    await updateGlobalSettings({ outputFormat: 'json' });
    // Any re-render picks the new preference up — switching modes is a
    // convenient one already exercised by the test above.
    document.getElementById('btn-mode-container').click();
    expect(document.getElementById('output-filename-ext').textContent).toBe('.json');
    document.getElementById('btn-mode-flat').click();
    expect(document.getElementById('output-filename-ext').textContent).toBe('.json');
  });

  test('generate() sends the configured script/output filenames to /generate', async () => {
    document.getElementById('input-script-filename').value = 'mein-scraper';
    document.getElementById('input-script-filename').dispatchEvent(new Event('input'));
    document.getElementById('input-output-filename').value = 'ergebnisse';
    document.getElementById('input-output-filename').dispatchEvent(new Event('input'));

    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(generateCall[1].body);
    expect(body.scriptFileName).toBe('mein-scraper');
    expect(body.outputFileName).toBe('ergebnisse');
  });

  test('the downloaded file uses the sanitized script filename', async () => {
    document.getElementById('input-script-filename').value = 'my scraper!';
    document.getElementById('input-script-filename').dispatchEvent(new Event('input'));

    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const appendSpy = jest.spyOn(document.body, 'appendChild');
    document.getElementById('btn-download').click();

    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.download).toBe('my_scraper.py');
    appendSpy.mockRestore();
  });

  test('the downloaded file falls back to "scraper.py" when no script name was typed', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const appendSpy = jest.spyOn(document.body, 'appendChild');
    document.getElementById('btn-download').click();

    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.download).toBe('scraper.py');
    appendSpy.mockRestore();
  });

  test('the done-screen download button label shows the configured (sanitized) script name', async () => {
    document.getElementById('input-script-filename').value = 'mein scraper!';
    document.getElementById('input-script-filename').dispatchEvent(new Event('input'));

    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(document.getElementById('btn-download').textContent).toBe('mein_scraper.py herunterladen');
  });

  test('the done-screen download button label falls back to "scraper.py" when no script name was typed', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(document.getElementById('btn-download').textContent).toBe('scraper.py herunterladen');
  });

  test('btn-back-to-config returns to the idle screen without resetting the existing configuration', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(document.getElementById('screen-done').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);

    global.chrome.storage.session.set.mockClear();
    document.getElementById('btn-back-to-config').click();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-done').classList.contains('hidden')).toBe(true);
    // Unlike btn-new-scraper, going back must not clear the configuration —
    // the field picked up from session storage in beforeEach should still
    // render, and no reset write should have gone out.
    expect(document.getElementById('fields-list').textContent).toContain('Titel');
    expect(global.chrome.storage.session.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ fields: [] }),
    );
  });
});

// ── Download the full trial-run output (Issue #161) ─────────────────────────


// ── Persist and browse run outputs (Issue #202) ─────────────────────────────
// Full flows against the companion's /configs/{id}/outputs endpoints,
// combining the DONE screen's "Save output" action with the "Saved
// configurations" panel's own outputs sub-panel — same DOM-mocking pattern
// as the Issue #141/#161 suites above.







describe('Language selector (lang-select)', () => {
  // initI18n() adds a few extra microtask hops in front of the rest of
  // init()'s async chain (storage read + checkCompanion's fetch) compared
  // to describes elsewhere in this file — a few more iterations than the
  // usual 5 keeps this reliably past STATES.IDLE without depending on
  // exact tick counts.
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  function baseHtml() {
    return `
      <div id="lang-switcher">
        <select id="lang-select">
          <option value="de">Deutsch</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>
      <section id="screen-idle" class="hidden">
        <div class="row-label" data-i18n="idle.urlLabel"></div>
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active" data-i18n="idle.modeFlat"></button>
          <button id="btn-mode-container" class="mode-btn" data-i18n="idle.modeContainer"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field" data-i18n="idle.addFieldBtn"></button>
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
  }

  function baseChromeMock(storageLocalGet) {
    return {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ fields: [{ name: 'Titel', selector: 'h1', attribute: null }] }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
        local: {
          get: jest.fn().mockResolvedValue(storageLocalGet || {}),
          set: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
  }

  afterEach(() => {
    Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });
  });

  test('applies the detected browser language on init, with no stored preference', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    expect(document.getElementById('lang-select').value).toBe('de');
    expect(document.getElementById('btn-mode-flat').textContent).toBe('Felder (flach)');
    expect(document.documentElement.lang).toBe('de');
  });

  test('an unsupported browser language falls back to English', async () => {
    Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true });
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    expect(document.getElementById('lang-select').value).toBe('en');
    expect(document.getElementById('btn-mode-flat').textContent).toBe('Fields (flat)');
  });

  test('a stored preference overrides the detected browser language', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock({ language: 'es' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    expect(document.getElementById('lang-select').value).toBe('es');
    expect(document.getElementById('btn-mode-flat').textContent).toBe('Campos (plano)');
  });

  test('switching language re-translates static text and persists the choice', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    document.getElementById('lang-select').value = 'en';
    document.getElementById('lang-select').dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.getElementById('btn-mode-flat').textContent).toBe('Fields (flat)');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ language: 'en' });
  });

  test('switching language also re-renders dynamic content (e.g. a field row\'s remove button)', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks(); // seeded field ('Titel') is restored from session storage

    expect(document.querySelector('.btn-remove-field').textContent).toBe('Entfernen');

    document.getElementById('lang-select').value = 'en';
    document.getElementById('lang-select').dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.querySelector('.btn-remove-field').textContent).toBe('Remove');
  });
});
