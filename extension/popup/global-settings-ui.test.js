// Fixes the popup's language-detection default to German, same as
// test-support/popup-env.js's setup — every assertion below (written
// against the original hardcoded German copy) depends on it via each
// integration test's own require('./popup') (which calls initI18n() itself
// as part of init()).
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

// The global Settings tab (screens/settings.html) — cross-session
// preferences persisted via chrome.storage.local (shared/global-settings.ts),
// reached from the header's #btn-open-settings icon. Covers the four
// preference toggles and the default-script-name preference's own UI;
// generate() actually reading these values back is covered separately by
// companion-client.test.js, and the cross-site saved-configurations section
// by saved-configs-ui.test.js.
describe('global Settings tab: preferences', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let storedGlobalSettings;

  const html = `
    <div id="header-bar">
      <button id="btn-open-settings"></button>
    </div>
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <button id="btn-generate" disabled></button>
    </section>
    <section id="screen-generating" class="hidden"></section>
    <section id="screen-settings" class="hidden">
      <button id="btn-close-settings"></button>
      <select id="select-output-format"><option value="default"></option><option value="json"></option><option value="sqlite"></option><option value="xlsx"></option></select>
      <input type="checkbox" id="toggle-include-data-preview" />
      <input type="checkbox" id="toggle-include-output-file" />
      <input type="checkbox" id="toggle-external-config" />
      <input type="checkbox" id="toggle-skip-verification" />
      <div class="mode-toggle" id="script-name-mode-toggle">
        <button id="btn-script-name-mode-fixed" class="mode-btn"></button>
        <button id="btn-script-name-mode-hostname" class="mode-btn"></button>
      </div>
      <div class="mode-toggle" id="output-name-mode-toggle">
        <button id="btn-output-name-mode-script" class="mode-btn"></button>
        <button id="btn-output-name-mode-fixed" class="mode-btn"></button>
      </div>
      <div id="output-name-fixed-row">
        <input type="text" id="input-output-name-fixed" />
      </div>
      <div id="script-name-fixed-row">
        <input type="text" id="input-script-name-fixed" />
      </div>
      <div id="manage-blueprints-list"></div>
      <p id="manage-blueprints-empty" class="hidden"></p>
      <div id="all-saved-configs-list"></div>
      <p id="all-saved-configs-empty" class="hidden"></p>
    </section>
    <div id="error-toast" class="hidden">
      <span id="error-toast-message"></span>
      <button id="btn-report-bug-toast" class="hidden"></button>
    </div>
  `;

  beforeEach(async () => {
    jest.resetModules();
    storedGlobalSettings = undefined;
    document.body.innerHTML = html;

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({ fields: [], url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
        local: {
          get: jest.fn(() => Promise.resolve(storedGlobalSettings ? { globalSettings: storedGlobalSettings } : {})),
          set: jest.fn((obj) => {
            storedGlobalSettings = obj.globalSettings;
            return Promise.resolve();
          }),
        },
      },
    };

    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true });
      if (String(url).includes('/configs')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (String(url).endsWith('/blueprints')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, global settings loaded (defaults, nothing stored yet)
  });

  function openSettings() {
    document.getElementById('btn-open-settings').click();
  }

  test('opening Settings shows the screen and pre-fills the defaults', () => {
    openSettings();
    expect(document.getElementById('screen-settings').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('select-output-format').value).toBe('default');
    expect(document.getElementById('toggle-include-data-preview').checked).toBe(false);
    expect(document.getElementById('toggle-include-output-file').checked).toBe(false);
    expect(document.getElementById('toggle-external-config').checked).toBe(false);
    expect(document.getElementById('toggle-skip-verification').checked).toBe(false);
    // Default scriptNameMode is 'fixed' — the fixed-name row is shown, the
    // hostname hint is hidden, and the input carries the default fixed name.
    expect(document.getElementById('btn-script-name-mode-fixed').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-script-name-mode-hostname').classList.contains('active')).toBe(false);
    expect(document.getElementById('script-name-fixed-row').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-script-name-fixed').value).toBe('scraper');
  });

  test('"Back" returns to the idle screen with no patch', () => {
    openSettings();
    document.getElementById('btn-close-settings').click();
    expect(document.getElementById('screen-settings').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
  });

  test('changing each of the four preferences persists it via chrome.storage.local', () => {
    openSettings();
    const format = document.getElementById('select-output-format');
    format.value = 'sqlite';
    format.dispatchEvent(new Event('change'));
    for (const id of ['toggle-include-data-preview', 'toggle-include-output-file', 'toggle-external-config', 'toggle-skip-verification']) {
      const el = document.getElementById(id);
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    }
    expect(storedGlobalSettings).toEqual({
      outputFormat: 'sqlite', includeDataPreview: true, includeOutputFile: true, externalConfig: true, skipVerification: true,
      scriptNameMode: 'fixed', scriptNameFixed: 'scraper', outputNameMode: 'fixed', outputNameFixed: '',
    });
  });

  test('switching scriptNameMode to "hostname" persists it and swaps which row is shown', () => {
    openSettings();
    document.getElementById('btn-script-name-mode-hostname').click();

    expect(storedGlobalSettings.scriptNameMode).toBe('hostname');
    expect(document.getElementById('btn-script-name-mode-hostname').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-script-name-mode-fixed').classList.contains('active')).toBe(false);
    expect(document.getElementById('script-name-fixed-row').classList.contains('hidden')).toBe(true);
  });

  test('editing the fixed script name persists it', () => {
    openSettings();
    const input = document.getElementById('input-script-name-fixed');
    input.value = 'my-default-name';
    input.dispatchEvent(new Event('change'));

    expect(storedGlobalSettings.scriptNameFixed).toBe('my-default-name');
  });

  // Issue #509
  test('the default output file name starts as today\'s behavior: a custom name, left empty', () => {
    openSettings();
    expect(document.getElementById('btn-output-name-mode-fixed').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-output-name-mode-script').classList.contains('active')).toBe(false);
    expect(document.getElementById('output-name-fixed-row').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-output-name-fixed').value).toBe('');
  });

  test('choosing "same as the script name" persists it and hides the custom name row', () => {
    openSettings();
    document.getElementById('btn-output-name-mode-script').click();

    expect(storedGlobalSettings.outputNameMode).toBe('script');
    expect(document.getElementById('btn-output-name-mode-script').classList.contains('active')).toBe(true);
    expect(document.getElementById('output-name-fixed-row').classList.contains('hidden')).toBe(true);
  });

  test('editing the custom output file name persists it', () => {
    openSettings();
    const input = document.getElementById('input-output-name-fixed');
    input.value = 'my-data';
    input.dispatchEvent(new Event('change'));

    expect(storedGlobalSettings.outputNameFixed).toBe('my-data');
  });

  test('preferences survive a popup reload (chrome.storage.local round trip)', async () => {
    openSettings();
    const select = document.getElementById('select-output-format');
    select.value = 'xlsx';
    select.dispatchEvent(new Event('change'));
    expect(storedGlobalSettings.outputFormat).toBe('xlsx');

    // Simulate the popup closing and reopening — a fresh require('./popup')
    // re-runs init()'s loadGlobalSettings() against the same (now populated)
    // chrome.storage.local mock.
    jest.resetModules();
    document.body.innerHTML = html;
    require('./popup');
    await flushMicrotasks();

    openSettings();
    expect(document.getElementById('select-output-format').value).toBe('xlsx');
  });
});
