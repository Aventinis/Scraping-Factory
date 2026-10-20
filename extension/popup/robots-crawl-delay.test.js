// Issue #228: "Respect the site's robots.txt (Crawl-delay)" — a plain
// boolean (draft → wire in buildScrapingConfig, reverse in applyConfigToState)
// and the settings checkbox in the real popup.
const { buildScrapingConfig, buildConfigExport } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const fields = [{ name: 'Titel', selector: 'h1' }];
// Positional tail: ... discoveredUrls, preflight, requestDelay, retry, deduplication, requestHeaders, respectRobotsDelay
const build = (mode, respect, extra = {}) => buildScrapingConfig(
  'https://example.com', mode, extra.fields ?? fields, extra.groups ?? [], extra.apiConfig ?? null, null, null, 'Static', [], false, false,
  [], null, null, null, null, false, false, false, extra.combined ?? null, extra.blocks ?? null, null, [], {}, 'Flat', [], {},
  null, false, null, null, null, null, respect,
);

describe('buildScrapingConfig', () => {
  const groups = [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'F', selector: '.f', mode: 'text', transforms: [] }] }];

  test.each([
    ['flat', {}], ['container', { groups }], ['api', { apiConfig: { urlTemplate: 'https://example.com/api', fields: [] } }],
  ])('%s mode sends respectRobotsDelay only when it is on', (mode, extra) => {
    expect(build(mode, true, extra).respectRobotsDelay).toBe(true);
    expect(build(mode, false, extra)).not.toHaveProperty('respectRobotsDelay');
  });

  test('works on its own, without any explicit pause', () => {
    const config = build('flat', true);
    expect(config).not.toHaveProperty('requestDelay');
    expect(config.respectRobotsDelay).toBe(true);
  });

  test('Combined mode never sends it (rejected on the outer request)', () => {
    const combined = [{ savedConfigId: 1, name: 'a', config: { url: 'https://a.example', fields } }, { savedConfigId: 2, name: 'b', config: { url: 'https://b.example', fields } }];
    expect(build('combined', true, { combined })).not.toHaveProperty('respectRobotsDelay');
  });

  test('is part of the exported configuration', () => {
    const exported = buildConfigExport(
      'https://example.com', 'flat', fields, [], {}, null, null, null, 'Static', [], false, false,
      [], null, null, null, null, false, false, false, null, null, null, [], {}, 'Flat', [], {}, null, false, null, null, null, null, true,
    );
    expect(exported.config.respectRobotsDelay).toBe(true);
  });
});

describe('loading a config restores it', () => {
  const base = { url: 'https://example.com', fields, outputFormat: 'Csv' };

  test('present → true, absent → false', () => {
    expect(applyConfigToState({ ...base, respectRobotsDelay: true }).respectRobotsDelay).toBe(true);
    expect(applyConfigToState(base).respectRobotsDelay).toBe(false);
  });

  test('a Blocks config restores it, a Combined config does not carry it', () => {
    const blocks = [
      { name: 'a', fields },
      { name: 'b', fields },
    ];
    expect(applyConfigToState({ url: 'https://example.com', blocks, respectRobotsDelay: true }).respectRobotsDelay).toBe(true);
    expect(applyConfigToState({ url: 'https://example.com', combined: [], respectRobotsDelay: true }).respectRobotsDelay).toBe(false);
  });

  test('round-trips through buildScrapingConfig', () => {
    const state = applyConfigToState({ ...base, respectRobotsDelay: true });
    expect(build('flat', state.respectRobotsDelay).respectRobotsDelay).toBe(true);
  });
});

describe('the checkbox in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <label><input type="checkbox" id="toggle-respect-robots-delay" /></label>
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

  test('is off by default and persisted with the rest of the scrape configuration when toggled', () => {
    const toggle = document.getElementById('toggle-respect-robots-delay');
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(chrome.storage.session.set.mock.calls.at(-1)[0].respectRobotsDelay).toBe(true);
    expect(document.getElementById('toggle-respect-robots-delay').checked).toBe(true);
  });
});
