// Issue #333: "Check the site's robots.txt before every request" — a
// { enabled, action } draft → wire robotsDisallow in buildScrapingConfig,
// the reverse in applyConfigToState, and the settings controls in the real popup.
const { buildScrapingConfig, buildConfigExport } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const fields = [{ name: 'Titel', selector: 'h1' }];
const groups = [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'F', selector: '.f', mode: 'text', transforms: [] }] }];
const apiConfig = { urlTemplate: 'https://example.com/api', fields: [] };
const blocks = [
  { name: 'a', shape: 'flat', fields, groups: [], outputFileName: '' },
  { name: 'b', shape: 'flat', fields, groups: [], outputFileName: '' },
];
const combined = [
  { savedConfigId: 1, name: 'a', config: { url: 'https://a.example', fields } },
  { savedConfigId: 2, name: 'b', config: { url: 'https://b.example', fields } },
];

// Positional tail: ... respectRobotsDelay, skipVerification, robotsDisallow
const build = (mode, robotsDisallow, extra = {}) => buildScrapingConfig(
  'https://example.com', mode, extra.fields ?? fields, extra.groups ?? [], extra.apiConfig ?? null, null, null, 'Static', [], false, false,
  [], null, null, null, null, false, false, false, extra.combined ?? null, extra.blocks ?? null, null, [], {}, 'Flat', [], {},
  null, false, null, null, null, null, false, false, robotsDisallow,
);

describe('buildScrapingConfig', () => {
  test.each([
    ['flat', {}], ['container', { groups }], ['api', { apiConfig }], ['blocks', { blocks }],
  ])('%s mode sends the chosen action only when enabled', (mode, extra) => {
    expect(build(mode, { enabled: true, action: 'Abort' }, extra).robotsDisallow).toEqual({ action: 'Abort' });
    expect(build(mode, { enabled: true, action: 'Warn' }, extra).robotsDisallow).toEqual({ action: 'Warn' });
    expect(build(mode, { enabled: false, action: 'Abort' }, extra)).not.toHaveProperty('robotsDisallow');
    expect(build(mode, null, extra)).not.toHaveProperty('robotsDisallow');
  });

  test('Combined mode never sends it (rejected on the outer request)', () => {
    expect(build('combined', { enabled: true, action: 'Skip' }, { combined })).not.toHaveProperty('robotsDisallow');
  });

  test('is part of the exported configuration', () => {
    const exported = buildConfigExport(
      'https://example.com', 'flat', fields, [], {}, null, null, null, 'Static', [], false, false,
      [], null, null, null, null, false, false, false, null, null, null, [], {}, 'Flat', [], {}, null, false, null, null, null, null, false, false,
      { enabled: true, action: 'Skip' },
    );
    expect(exported.config.robotsDisallow).toEqual({ action: 'Skip' });
  });
});

describe('loading a config restores it', () => {
  const base = { url: 'https://example.com', fields, outputFormat: 'Csv' };

  test('present → enabled with its action, absent → off', () => {
    expect(applyConfigToState({ ...base, robotsDisallow: { action: 'Abort' } }).robotsDisallow).toEqual({ enabled: true, action: 'Abort' });
    expect(applyConfigToState({ ...base, robotsDisallow: {} }).robotsDisallow).toEqual({ enabled: true, action: 'Skip' });
    expect(applyConfigToState(base).robotsDisallow).toEqual({ enabled: false, action: 'Skip' });
  });

  test('an unknown action falls back to Skip', () => {
    expect(applyConfigToState({ ...base, robotsDisallow: { action: 'Explode' } }).robotsDisallow.action).toBe('Skip');
  });

  test('a Blocks config restores it, a Combined config does not carry it', () => {
    const wireBlocks = [{ name: 'a', fields }, { name: 'b', fields }];
    expect(applyConfigToState({ url: 'https://example.com', blocks: wireBlocks, robotsDisallow: { action: 'Warn' } }).robotsDisallow)
      .toEqual({ enabled: true, action: 'Warn' });
    expect(applyConfigToState({ url: 'https://example.com', combined: [], robotsDisallow: { action: 'Warn' } }).robotsDisallow.enabled).toBe(false);
  });

  test('round-trips through buildScrapingConfig', () => {
    const state = applyConfigToState({ ...base, robotsDisallow: { action: 'Abort' } });
    expect(build('flat', state.robotsDisallow).robotsDisallow).toEqual({ action: 'Abort' });
  });
});

describe('the controls in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <label><input type="checkbox" id="toggle-robots-disallow" /></label>
        <div id="robots-disallow-config" class="hidden">
          <select id="select-robots-disallow-action">
            <option value="Skip"></option><option value="Warn"></option><option value="Abort"></option>
          </select>
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

  const change = (el, value) => {
    if (typeof value === 'boolean') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const persisted = () => chrome.storage.session.set.mock.calls.at(-1)[0].robotsDisallow;

  test('off by default, with the action choice hidden', () => {
    expect(document.getElementById('toggle-robots-disallow').checked).toBe(false);
    expect(document.getElementById('robots-disallow-config').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('select-robots-disallow-action').value).toBe('Skip');
  });

  test('enabling reveals the action choice and is persisted with the scrape configuration', () => {
    change(document.getElementById('toggle-robots-disallow'), true);

    expect(document.getElementById('robots-disallow-config').classList.contains('hidden')).toBe(false);
    expect(persisted()).toEqual({ enabled: true, action: 'Skip' });
  });

  test('the chosen action is kept and persisted', () => {
    change(document.getElementById('toggle-robots-disallow'), true);
    change(document.getElementById('select-robots-disallow-action'), 'Abort');

    expect(persisted()).toEqual({ enabled: true, action: 'Abort' });
    expect(document.getElementById('select-robots-disallow-action').value).toBe('Abort');

    change(document.getElementById('toggle-robots-disallow'), false);
    expect(persisted()).toEqual({ enabled: false, action: 'Abort' });
  });
});
