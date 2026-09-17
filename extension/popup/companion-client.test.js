// Fixes the popup's language-detection default to German, same as
// popup.test.js's own top-level setup — every assertion below (written
// against the original hardcoded German copy) depends on it, both via the
// explicit initI18n() call for the pure-function test below and via each
// integration test's own require('./popup') (which calls initI18n()
// itself as part of init()).
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

// buildVerificationErrorMessage (below) renders translated copy via
// i18n.js's t() — needs a real dictionary loaded, same as
// scraping-config-builder.test.js's own setup for frameBadgeHtml.
global.chrome = global.chrome || { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
const { initI18n } = require('../i18n/i18n');
beforeAll(() => initI18n('de-DE'));

const { buildVerificationErrorMessage } = require('./companion-client');

describe('buildVerificationErrorMessage', () => {
  test('uses the error message from the response', () => {
    const msg = buildVerificationErrorMessage({
      error: 'Script ran without errors but returned no data (output.csv only contains the header row).',
    });
    expect(msg).toBe('Script ran without errors but returned no data (output.csv only contains the header row).');
  });

  test('passes through a script-crash error message', () => {
    const msg = buildVerificationErrorMessage({ error: 'Skript (python3) wurde mit Fehler beendet (Exit-Code 1): Traceback...' });
    expect(msg).toBe('Skript (python3) wurde mit Fehler beendet (Exit-Code 1): Traceback...');
  });

  test('handles a missing/empty response gracefully', () => {
    expect(buildVerificationErrorMessage(null)).toBe('Verifikation der Konfiguration fehlgeschlagen.');
    expect(buildVerificationErrorMessage(undefined)).toBe('Verifikation der Konfiguration fehlgeschlagen.');
    expect(buildVerificationErrorMessage({})).toBe('Verifikation der Konfiguration fehlgeschlagen.');
  });
});

describe('generate() surfaces companion verification failures', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="fields-list"></div>
        <button id="btn-generate"></button>
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
            fields: [{ name: 'Preis', selector: '.price', attribute: null }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true });
      if (String(url).endsWith('/generate')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({
            error: 'Script ran without errors but returned no data (output.csv only contains the header row).',
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('shows a toast with the verification error and offers to report it', async () => {
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent).toContain('returned no data');
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(false);
  });
});

describe('generate() surfaces a 400 config rejection without inviting a bug report', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="fields-list"></div>
        <button id="btn-generate"></button>
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
            fields: [{ name: 'Preis', selector: '.price', attribute: null, framePath: ['#widget'] }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true });
      if (String(url).endsWith('/generate')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({
            error: "FramePath is only allowed with Engine 'Browser'.",
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('shows a toast with the rejection reason but keeps the "Report bug" button hidden', async () => {
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent).toContain('FramePath is only allowed with Engine');
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(true);
  });
});

describe('COMPANION_ERROR screen: manual companion URL override', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  let storedOverride;
  let storageSet;
  let storageRemove;

  beforeEach(async () => {
    jest.resetModules();
    storedOverride = {};

    document.body.innerHTML = `
      <section id="screen-error" class="hidden">
        <p id="error-current-url"></p>
        <button id="btn-retry"></button>
        <div class="companion-url-override">
          <input type="text" id="input-companion-url" />
          <button id="btn-use-companion-url"></button>
          <button id="btn-reset-companion-url"></button>
        </div>
      </section>
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
      </section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
      </div>
    `;

    storageSet = jest.fn(async (values) => { storedOverride = { ...storedOverride, ...values }; });
    storageRemove = jest.fn(async () => { storedOverride = {}; });

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
        local: {
          get: jest.fn(async () => storedOverride),
          set: storageSet,
          remove: storageRemove,
        },
      },
    };
    // First call (init()'s own health check) always fails, landing on
    // COMPANION_ERROR regardless of any stored override — the flow under
    // test starts from there.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 0 });

    require('./popup');
    await flushMicrotasks(); // → STATES.COMPANION_ERROR
  });

  afterEach(() => {
    delete global.chrome;
    delete global.fetch;
  });

  test('shows the address the health check just tried', () => {
    expect(document.getElementById('error-current-url').textContent).toContain('http://localhost:5000');
  });

  test('an invalid address is rejected with a toast and does not retry', () => {
    document.getElementById('input-companion-url').value = 'not-a-url';
    document.getElementById('btn-use-companion-url').click();

    expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent).toContain('Ungültige Adresse');
    expect(storageSet).not.toHaveBeenCalled();
  });

  test('a valid custom address is persisted and used for the retry health check', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true }); // the retry against the new address succeeds
    document.getElementById('input-companion-url').value = 'http://localhost:5050/';
    document.getElementById('btn-use-companion-url').click();
    await flushMicrotasks();

    expect(storageSet).toHaveBeenCalledWith({ companionUrlOverride: 'http://localhost:5050' });
    // Issue #141: a successful health check now also kicks off a
    // fire-and-forget GET /configs?url=... (fetchSavedConfigs) — so the
    // health request is no longer necessarily the *last* fetch call.
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:5050/health');
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
  });

  test('a persisted override is reused on the next health check without re-entering it', async () => {
    storedOverride = { companionUrlOverride: 'http://localhost:5050' };
    global.fetch.mockResolvedValueOnce({ ok: true });

    document.getElementById('btn-retry').click();
    await flushMicrotasks();

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:5050/health');
  });

  test('resetting clears the stored override and retries against the default address', async () => {
    storedOverride = { companionUrlOverride: 'http://localhost:5050' };
    global.fetch.mockResolvedValueOnce({ ok: false, status: 0 });

    document.getElementById('btn-reset-companion-url').click();
    await flushMicrotasks();

    expect(storageRemove).toHaveBeenCalledWith('companionUrlOverride');
    expect(global.fetch).toHaveBeenLastCalledWith('http://localhost:5000/health');
  });
});

describe('robots.txt check (btn-check-robots)', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <button id="btn-check-robots"></button>
        <p id="robots-txt-result" class="hidden"></p>
      </section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/produkte' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('starts out hidden with the default label', () => {
    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-check-robots').textContent).toBe('robots.txt prüfen');
  });

  test('clicking sends CHECK_ROBOTS_TXT and shows a disallowed result in red', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/produkte',
      notFound: false, allowed: false, matchedRule: { type: 'disallow', pattern: '/produkte' },
    });

    document.getElementById('btn-check-robots').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CHECK_ROBOTS_TXT' });
    expect(document.getElementById('btn-check-robots').textContent).toBe('Prüfe robots.txt…');
    expect(document.getElementById('btn-check-robots').disabled).toBe(true);

    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('hidden')).toBe(false);
    expect(result.classList.contains('robots-txt-disallowed')).toBe(true);
    expect(result.textContent).toContain('Verboten');
    expect(result.textContent).toContain('/produkte');
    expect(document.getElementById('btn-check-robots').disabled).toBe(false);
  });

  test('an allowed result is shown in green', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/produkte',
      notFound: false, allowed: true, matchedRule: null,
    });

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-allowed')).toBe(true);
    expect(result.textContent).toContain('Erlaubt');
  });

  test('no robots.txt found (404) is shown as allowed', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/produkte',
      notFound: true, allowed: true, matchedRule: null,
    });

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-allowed')).toBe(true);
    expect(result.textContent).toContain('Keine robots.txt gefunden');
  });

  test('a failed check is shown in gray with the error message', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Keine aktive Seite gefunden.' });

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-unknown')).toBe(true);
    expect(result.textContent).toContain('Keine aktive Seite gefunden.');
  });

  test('a rejected sendMessage is handled the same way as an {ok:false} result', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('No content script'));

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-unknown')).toBe(true);
    expect(result.textContent).toContain('No content script');
    expect(document.getElementById('btn-check-robots').disabled).toBe(false);
  });
});
