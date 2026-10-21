// Issue #342: "Append to the existing output file" — a plain boolean (draft →
// wire in buildScrapingConfig, reverse in applyConfigToState) and the
// checkbox in the real popup.
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

// Positional tail: ... skipVerification, robotsDisallow, appendOutput
const build = (mode, append, extra = {}) => buildScrapingConfig(
  'https://example.com', mode, extra.fields ?? fields, extra.groups ?? [], extra.apiConfig ?? null, null, null, 'Static', [], false, false,
  [], null, null, null, null, false, false, false, extra.combined ?? null, extra.blocks ?? null, null, [], {}, 'Flat', [], {},
  null, false, null, null, null, null, false, false, null, append,
);

describe('buildScrapingConfig', () => {
  test.each([
    ['flat', {}], ['container', { groups }], ['api', { apiConfig }], ['blocks', { blocks }],
  ])('%s mode sends appendOutput only when it is on', (mode, extra) => {
    expect(build(mode, true, extra).appendOutput).toBe(true);
    expect(build(mode, false, extra)).not.toHaveProperty('appendOutput');
  });

  test('Combined mode never sends it (rejected on the outer request)', () => {
    expect(build('combined', true, { combined })).not.toHaveProperty('appendOutput');
  });

  test('is part of the exported configuration', () => {
    const exported = buildConfigExport(
      'https://example.com', 'flat', fields, [], {}, null, null, null, 'Static', [], false, false,
      [], null, null, null, null, false, false, false, null, null, null, [], {}, 'Flat', [], {}, null, false, null, null, null, null, false, false, null, true,
    );
    expect(exported.config.appendOutput).toBe(true);
  });
});

describe('loading a config restores it', () => {
  const base = { url: 'https://example.com', fields, outputFormat: 'Csv' };

  test('present → true, absent → false', () => {
    expect(applyConfigToState({ ...base, appendOutput: true }).appendOutput).toBe(true);
    expect(applyConfigToState(base).appendOutput).toBe(false);
  });

  test('a Blocks config restores it, a Combined config does not carry it', () => {
    const wireBlocks = [{ name: 'a', fields }, { name: 'b', fields }];
    expect(applyConfigToState({ url: 'https://example.com', blocks: wireBlocks, appendOutput: true }).appendOutput).toBe(true);
    expect(applyConfigToState({ url: 'https://example.com', combined: [], appendOutput: true }).appendOutput).toBe(false);
  });

  test('round-trips through buildScrapingConfig', () => {
    const state = applyConfigToState({ ...base, appendOutput: true });
    expect(build('flat', state.appendOutput).appendOutput).toBe(true);
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
        <div id="append-output-row"><label><input type="checkbox" id="toggle-append-output" /></label></div>
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
    const toggle = document.getElementById('toggle-append-output');
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(chrome.storage.session.set.mock.calls.at(-1)[0].appendOutput).toBe(true);
    expect(document.getElementById('toggle-append-output').checked).toBe(true);
    expect(document.getElementById('append-output-row').classList.contains('hidden')).toBe(false);
  });
});
