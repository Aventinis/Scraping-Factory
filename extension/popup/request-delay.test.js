// Issue #222: "Pause between requests" — draft → wire conversion
// (buildRequestDelayConfig/buildScrapingConfig), its reverse for loading a
// saved/exported config (applyConfigToState), and the settings UI in the
// real popup.
const { buildRequestDelayConfig, buildScrapingConfig } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const draft = (minSecondsText, maxSecondsText = '', enabled = true) => ({ enabled, minSecondsText, maxSecondsText });

describe('buildRequestDelayConfig', () => {
  test.each([
    [draft('2'), { minMs: 2000, maxMs: 2000 }],          // blank "to" = fixed pause
    [draft('1', '3'), { minMs: 1000, maxMs: 3000 }],
    [draft('1,5', '2.25'), { minMs: 1500, maxMs: 2250 }], // decimal comma and point
    [draft('0', ''), { minMs: 0, maxMs: 0 }],
    [draft('3', '1'), { minMs: 3000, maxMs: 3000 }],      // "to" below "from" is raised to it
    [draft('90', '120'), { minMs: 60000, maxMs: 60000 }], // clamped to the 60 s per-pause cap
  ])('%j → %j', (input, expected) => {
    expect(buildRequestDelayConfig(input)).toEqual(expected);
  });

  test.each([
    [draft('2', '', false)],
    [draft('')],
    [draft('abc')],
    [draft('-1')],
    [null],
  ])('%j is treated as off', (input) => {
    expect(buildRequestDelayConfig(input)).toBeNull();
  });

  test('buildScrapingConfig only sends requestDelay when it is on and complete', () => {
    const fields = [{ name: 'Titel', selector: 'h1' }];
    const args = (requestDelay) => ['https://example.com', 'flat', fields, [], null, null, null, 'Static', [], false, false,
      [], null, null, null, null, false, false, false, null, null, null, [], {}, 'Flat', [], {}, null, false, requestDelay];
    expect(buildScrapingConfig(...args(draft('1', '2'))).requestDelay).toEqual({ minMs: 1000, maxMs: 2000 });
    expect(buildScrapingConfig(...args(draft('1', '2', false)))).not.toHaveProperty('requestDelay');
    expect(buildScrapingConfig(...args(undefined))).not.toHaveProperty('requestDelay');
  });

  test('applies to API and container mode too', () => {
    const groups = [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'F', selector: '.f', mode: 'text', transforms: [] }] }];
    const containerConfig = buildScrapingConfig('https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false,
      [], null, null, null, null, false, false, false, null, null, null, [], {}, 'Flat', [], {}, null, false, draft('2'));
    expect(containerConfig.requestDelay).toEqual({ minMs: 2000, maxMs: 2000 });
  });
});

describe('loading a config restores the pause', () => {
  const base = { url: 'https://example.com', fields: [{ name: 'Titel', selector: 'h1' }], outputFormat: 'Csv' };

  test('a range comes back as from/to seconds', () => {
    expect(applyConfigToState({ ...base, requestDelay: { minMs: 1500, maxMs: 3000 } }).requestDelay)
      .toEqual({ enabled: true, minSecondsText: '1.5', maxSecondsText: '3' });
  });

  test('a fixed pause leaves "to" blank', () => {
    expect(applyConfigToState({ ...base, requestDelay: { minMs: 2000, maxMs: 2000 } }).requestDelay)
      .toEqual({ enabled: true, minSecondsText: '2', maxSecondsText: '' });
  });

  test('no requestDelay means off, with the default draft', () => {
    expect(applyConfigToState(base).requestDelay).toEqual({ enabled: false, minSecondsText: '1', maxSecondsText: '' });
  });

  test('round-trips through buildScrapingConfig', () => {
    const wire = { minMs: 750, maxMs: 2500 };
    expect(buildRequestDelayConfig(applyConfigToState({ ...base, requestDelay: wire }).requestDelay)).toEqual(wire);
  });
});

describe('Pause between requests in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <label><input type="checkbox" id="toggle-request-delay" /></label>
        <div id="request-delay-config" class="hidden">
          <input type="text" id="input-request-delay-min" />
          <input type="text" id="input-request-delay-max" />
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

  const type = (id, value) => {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  test('is off by default; enabling it reveals the inputs with a 1 s default', () => {
    expect(document.getElementById('request-delay-config').classList.contains('hidden')).toBe(true);

    const toggle = document.getElementById('toggle-request-delay');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('request-delay-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-request-delay-min').value).toBe('1');
  });

  test('typed values are persisted with the rest of the scrape configuration', () => {
    const toggle = document.getElementById('toggle-request-delay');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    type('input-request-delay-min', '1,5');
    type('input-request-delay-max', '4');

    expect(chrome.storage.session.set.mock.calls.at(-1)[0].requestDelay).toEqual({ enabled: true, minSecondsText: '1,5', maxSecondsText: '4' });
  });
});
