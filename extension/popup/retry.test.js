// Issue #223: "Retry on transient errors" — draft → wire conversion
// (buildRetryConfig/buildScrapingConfig), its reverse for loading a saved/
// exported config (applyConfigToState), and the settings UI in the real
// popup.
const { buildRetryConfig, buildScrapingConfig } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const draft = (overrides = {}) => ({
  enabled: true, maxAttemptsText: '3', delaySecondsText: '2', exponential: true, statusCodesText: '429, 502, 503, 504', ...overrides,
});

describe('buildRetryConfig', () => {
  test('the defaults', () => {
    expect(buildRetryConfig(draft())).toEqual({ maxAttempts: 3, delayMs: 2000, exponential: true, retryOnStatusCodes: [429, 502, 503, 504] });
  });

  test.each([
    [{ maxAttemptsText: '5', delaySecondsText: '1,5', exponential: false }, { maxAttempts: 5, delayMs: 1500, exponential: false }],
    [{ maxAttemptsText: '1' }, { maxAttempts: 2 }],    // clamped to 2-10
    [{ maxAttemptsText: '50' }, { maxAttempts: 10 }],
    [{ maxAttemptsText: 'x' }, { maxAttempts: 3 }],    // unusable → default
    [{ delaySecondsText: '' }, { delayMs: 2000 }],
    [{ delaySecondsText: '120' }, { delayMs: 60000 }], // clamped to 60 s
  ])('%j', (overrides, expected) => {
    expect(buildRetryConfig(draft(overrides))).toMatchObject(expected);
  });

  test('status codes accept any separator, keep only 400-599, and drop duplicates', () => {
    expect(buildRetryConfig(draft({ statusCodesText: '503 500;503, 200, 999, 429' })).retryOnStatusCodes).toEqual([503, 500, 429]);
  });

  test('an empty status-code list is omitted so the companion default applies', () => {
    expect(buildRetryConfig(draft({ statusCodesText: '  ' }))).not.toHaveProperty('retryOnStatusCodes');
  });

  test('off means null', () => {
    expect(buildRetryConfig(draft({ enabled: false }))).toBeNull();
    expect(buildRetryConfig(null)).toBeNull();
  });

  test('buildScrapingConfig only sends retry when it is on', () => {
    const fields = [{ name: 'Titel', selector: 'h1' }];
    const args = (retry) => ['https://example.com', 'flat', fields, [], null, null, null, 'Static', [], false, false,
      [], null, null, null, null, false, false, false, null, null, null, [], {}, 'Flat', [], {}, null, false, null, retry];
    expect(buildScrapingConfig(...args(draft())).retry).toEqual({ maxAttempts: 3, delayMs: 2000, exponential: true, retryOnStatusCodes: [429, 502, 503, 504] });
    expect(buildScrapingConfig(...args(draft({ enabled: false })))).not.toHaveProperty('retry');
    expect(buildScrapingConfig(...args(undefined))).not.toHaveProperty('retry');
  });
});

describe('loading a config restores the retry settings', () => {
  const base = { url: 'https://example.com', fields: [{ name: 'Titel', selector: 'h1' }], outputFormat: 'Csv' };

  test('round-trips', () => {
    const wire = { maxAttempts: 4, delayMs: 500, exponential: false, retryOnStatusCodes: [503] };
    const state = applyConfigToState({ ...base, retry: wire }).retry;
    expect(state).toEqual({ enabled: true, maxAttemptsText: '4', delaySecondsText: '0.5', exponential: false, statusCodesText: '503' });
    expect(buildRetryConfig(state)).toEqual(wire);
  });

  test('no retry means off with the defaults', () => {
    expect(applyConfigToState(base).retry).toEqual(draft({ enabled: false }));
  });
});

describe('Retry on transient errors in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <label><input type="checkbox" id="toggle-retry" /></label>
        <div id="retry-config" class="hidden">
          <input type="text" id="input-retry-attempts" />
          <input type="text" id="input-retry-delay" />
          <input type="checkbox" id="toggle-retry-exponential" />
          <input type="text" id="input-retry-status-codes" />
        </div>
        <button id="btn-generate" disabled></button>
      </section>
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
  });

  const toggle = (id, checked) => {
    const el = document.getElementById(id);
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  test('is off by default; enabling it reveals the defaults', () => {
    expect(document.getElementById('retry-config').classList.contains('hidden')).toBe(true);
    toggle('toggle-retry', true);

    expect(document.getElementById('retry-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-retry-attempts').value).toBe('3');
    expect(document.getElementById('input-retry-delay').value).toBe('2');
    expect(document.getElementById('toggle-retry-exponential').checked).toBe(true);
    expect(document.getElementById('input-retry-status-codes').value).toBe('429, 502, 503, 504');
  });

  test('changes are persisted with the scrape configuration', () => {
    toggle('toggle-retry', true);
    toggle('toggle-retry-exponential', false);
    const attempts = document.getElementById('input-retry-attempts');
    attempts.value = '5';
    attempts.dispatchEvent(new Event('input', { bubbles: true }));

    expect(chrome.storage.session.set.mock.calls.at(-1)[0].retry).toMatchObject({ enabled: true, exponential: false, maxAttemptsText: '5' });
  });
});
