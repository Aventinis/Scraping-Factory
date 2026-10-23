// Issue #225: deduplication by key field(s) — pure draft/wire logic
// (dedup-config.ts), the builder integration (buildScrapingConfig), the
// reverse mapping for a loaded config (applyConfigToState) and the settings
// UI in the real popup.
const {
  createDefaultDeduplication, setRetentionKind, addKeyField, removeKeyField, parseRetentionValue,
  buildDeduplicationConfig, applyDeduplicationConfig, DEFAULT_MAX_COUNT, DEFAULT_MAX_AGE_DAYS,
} = require('./dedup-config');
const { buildScrapingConfig } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const draft = (patch = {}) => ({ ...createDefaultDeduplication(), enabled: true, keyFields: ['Titel'], ...patch });

describe('draft helpers', () => {
  test('defaults are off with an empty key and the count-based retention', () => {
    expect(createDefaultDeduplication()).toEqual({
      enabled: false, keyFields: [], incremental: false, appendOutput: false,
      retentionKind: 'MaxCount', retentionValueText: String(DEFAULT_MAX_COUNT),
    });
  });

  test('addKeyField ignores a blank or already-present name; removeKeyField removes by index', () => {
    let d = createDefaultDeduplication();
    d = addKeyField(d, 'A');
    d = addKeyField(d, 'A');
    d = addKeyField(d, '');
    d = addKeyField(d, 'B');
    expect(d.keyFields).toEqual(['A', 'B']);
    expect(removeKeyField(d, 0).keyFields).toEqual(['B']);
  });

  test('switching the retention kind swaps in that kind\'s own default value', () => {
    const aged = setRetentionKind(createDefaultDeduplication(), 'MaxAge');
    expect(aged).toMatchObject({ retentionKind: 'MaxAge', retentionValueText: String(DEFAULT_MAX_AGE_DAYS) });
    expect(setRetentionKind(aged, 'MaxAge')).toBe(aged);
    expect(setRetentionKind(aged, 'MaxCount').retentionValueText).toBe(String(DEFAULT_MAX_COUNT));
  });

  test.each([
    ['500', 'MaxCount', 500],
    [' 30 ', 'MaxAge', 30],
    ['', 'MaxCount', DEFAULT_MAX_COUNT],
    ['abc', 'MaxAge', DEFAULT_MAX_AGE_DAYS],
    ['0', 'MaxCount', DEFAULT_MAX_COUNT],
    ['-5', 'MaxAge', DEFAULT_MAX_AGE_DAYS],
  ])('parseRetentionValue(%j, %s) → %d', (text, kind, expected) => {
    expect(parseRetentionValue(text, kind)).toBe(expected);
  });
});

describe('buildDeduplicationConfig', () => {
  test('within-run only: just the key fields, no incremental keys at all', () => {
    expect(buildDeduplicationConfig(draft({ keyFields: ['A', 'B'] }))).toEqual({ keyFields: ['A', 'B'] });
  });

  test('incremental sends the output mode and the retention', () => {
    expect(buildDeduplicationConfig(draft({ incremental: true, retentionValueText: '250' }))).toEqual({
      keyFields: ['Titel'], incremental: true, incrementalOutput: 'Delta', retention: { kind: 'MaxCount', value: 250 },
    });
    expect(buildDeduplicationConfig(draft({ incremental: true, appendOutput: true, retentionKind: 'MaxAge', retentionValueText: '14' })))
      .toEqual({ keyFields: ['Titel'], incremental: true, incrementalOutput: 'Append', retention: { kind: 'MaxAge', value: 14 } });
  });

  test('the Append output is sent as chosen (every output format can append, Issue #342)', () => {
    expect(buildDeduplicationConfig(draft({ incremental: true, appendOutput: true })).incrementalOutput).toBe('Append');
    expect(buildDeduplicationConfig(draft({ incremental: true, appendOutput: false })).incrementalOutput).toBe('Delta');
  });

  test('the sidecar-related keys are omitted without incremental, even if the draft carries them', () => {
    const wire = buildDeduplicationConfig(draft({ appendOutput: true, retentionKind: 'MaxAge' }));
    expect(wire).toEqual({ keyFields: ['Titel'] });
  });

  test('key fields that no longer exist in the field list are dropped; none left means off', () => {
    expect(buildDeduplicationConfig(draft({ keyFields: ['Alt', 'Titel'] }), ['Titel', 'Preis'])).toEqual({ keyFields: ['Titel'] });
    expect(buildDeduplicationConfig(draft({ keyFields: ['Alt'] }), ['Titel'])).toBeNull();
  });

  test.each([
    [draft({ enabled: false })],
    [draft({ keyFields: [] })],
    [null],
    [undefined],
  ])('%j is treated as off', (input) => {
    expect(buildDeduplicationConfig(input)).toBeNull();
  });
});

describe('buildScrapingConfig', () => {
  const fields = [{ name: 'Titel', selector: 'h1' }, { name: 'Preis', selector: '.price' }];
  // Same positional layout retry.test.js uses, plus the new trailing parameter.
  const build = (mode, dedup, extra = {}) => buildScrapingConfig({
    url: 'https://example.com',
    mode,
    fields: extra.fields ?? fields,
    groups: extra.groups ?? [],
    apiConfig: extra.apiConfig ?? null,
    deduplication: dedup,
  });

  test('flat mode sends the deduplication block only when configured', () => {
    expect(build('flat', draft()).deduplication).toEqual({ keyFields: ['Titel'] });
    expect(build('flat', draft({ enabled: false }))).not.toHaveProperty('deduplication');
    expect(build('flat', undefined)).not.toHaveProperty('deduplication');
  });

  test('a key field that is not in the flat field list is not sent', () => {
    expect(build('flat', draft({ keyFields: ['Geloescht'] }))).not.toHaveProperty('deduplication');
  });

  test('container mode: leaf field names count as key fields, and Append is allowed', () => {
    const groups = [{
      kind: 'group', name: 'Gericht', selector: '.item', repeating: true,
      children: [{ kind: 'field', name: 'Name', selector: 'h1', mode: 'text' }],
    }];
    const wire = build('container', draft({ keyFields: ['Name'], incremental: true, appendOutput: true }), { groups }).deduplication;
    expect(wire).toMatchObject({ keyFields: ['Name'], incremental: true, incrementalOutput: 'Append' });
  });

  test('API mode: both response shapes may append', () => {
    const treeApi = { urlTemplate: 'https://example.com/a', groups: [{ name: 'Artikel', path: 'items', children: [{ name: 'Id', path: 'id' }] }] };
    const flatApi = { urlTemplate: 'https://example.com/a', itemsPath: 'items', fields: [{ name: 'Id', path: 'id' }] };
    const dedup = draft({ keyFields: ['Id'], incremental: true, appendOutput: true });
    expect(build('api', dedup, { apiConfig: treeApi }).deduplication.incrementalOutput).toBe('Append');
    expect(build('api', dedup, { apiConfig: flatApi }).deduplication.incrementalOutput).toBe('Append');
  });

  test('Blocks and Combined never send it', () => {
    expect(build('blocks', draft())).not.toHaveProperty('deduplication');
    expect(build('combined', draft())).not.toHaveProperty('deduplication');
  });
});

describe('loading a config restores the deduplication settings', () => {
  const base = { url: 'https://example.com', fields: [{ name: 'Titel', selector: 'h1' }], outputFormat: 'Csv' };

  test('round-trips every property', () => {
    const wire = { keyFields: ['Titel', 'Preis'], incremental: true, incrementalOutput: 'Append', retention: { kind: 'MaxAge', value: 14 } };
    const state = applyConfigToState({ ...base, deduplication: wire }).deduplication;
    expect(state).toEqual({
      enabled: true, keyFields: ['Titel', 'Preis'], incremental: true, appendOutput: true,
      retentionKind: 'MaxAge', retentionValueText: '14',
    });
    expect(buildDeduplicationConfig(state)).toEqual(wire);
  });

  test('a within-run-only config round-trips without picking up incremental settings', () => {
    const state = applyDeduplicationConfig({ keyFields: ['Titel'] });
    expect(state).toMatchObject({ enabled: true, incremental: false, appendOutput: false, retentionKind: 'MaxCount' });
    expect(buildDeduplicationConfig(state)).toEqual({ keyFields: ['Titel'] });
  });

  test('no deduplication (or no key field) means off with the defaults', () => {
    expect(applyConfigToState(base).deduplication).toEqual(createDefaultDeduplication());
    expect(applyDeduplicationConfig({ keyFields: [] })).toEqual(createDefaultDeduplication());
  });
});

describe('Deduplication settings in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const mount = async (stored = {}) => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <div id="dedup-section">
          <input type="checkbox" id="toggle-dedup" />
          <div id="dedup-config" class="hidden">
            <div id="dedup-key-fields-list"></div>
            <select id="select-dedup-key-field"></select>
            <button id="btn-add-dedup-key-field"></button>
            <input type="checkbox" id="toggle-dedup-incremental" />
            <div id="dedup-incremental-config" class="hidden">
              <button id="btn-dedup-output-delta" class="mode-btn active"></button>
              <button id="btn-dedup-output-append" class="mode-btn"></button>
              <select id="select-dedup-retention-kind"><option value="MaxCount"></option><option value="MaxAge"></option></select>
              <input type="text" id="input-dedup-retention-value" />
            </div>
          </div>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue(stored), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
  };

  const fields = [{ name: 'Titel', selector: 'h1' }, { name: 'Preis', selector: '.price' }];
  const lastPersisted = () => chrome.storage.session.set.mock.calls.at(-1)[0].deduplication;
  const change = (id, patch) => {
    const el = document.getElementById(id);
    Object.assign(el, patch);
    el.dispatchEvent(new Event(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };

  beforeEach(async () => { await mount({ mode: 'flat', fields }); });

  test('is off by default; enabling reveals the config and lists the available fields', () => {
    expect(document.getElementById('dedup-config').classList.contains('hidden')).toBe(true);
    change('toggle-dedup', { checked: true });

    expect(document.getElementById('dedup-config').classList.contains('hidden')).toBe(false);
    expect([...document.getElementById('select-dedup-key-field').options].map(o => o.value)).toEqual(['Titel', 'Preis']);
  });

  test('adding and removing key fields updates the list and what is persisted', () => {
    change('toggle-dedup', { checked: true });
    change('select-dedup-key-field', { value: 'Preis' });
    document.getElementById('btn-add-dedup-key-field').click();

    expect(lastPersisted().keyFields).toEqual(['Preis']);
    expect(document.querySelectorAll('#dedup-key-fields-list .btn-remove-dedup-key-field')).toHaveLength(1);
    // an added field is no longer offered again
    expect([...document.getElementById('select-dedup-key-field').options].map(o => o.value)).toEqual(['Titel']);

    document.querySelector('#dedup-key-fields-list .btn-remove-dedup-key-field').click();
    expect(lastPersisted().keyFields).toEqual([]);
  });

  test('incremental options appear with the toggle, and the retention kind swaps the default value', () => {
    change('toggle-dedup', { checked: true });
    expect(document.getElementById('dedup-incremental-config').classList.contains('hidden')).toBe(true);
    change('toggle-dedup-incremental', { checked: true });
    expect(document.getElementById('dedup-incremental-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-dedup-retention-value').value).toBe(String(DEFAULT_MAX_COUNT));

    change('select-dedup-retention-kind', { value: 'MaxAge' });
    expect(lastPersisted()).toMatchObject({ retentionKind: 'MaxAge', retentionValueText: String(DEFAULT_MAX_AGE_DAYS) });
    expect(document.getElementById('input-dedup-retention-value').value).toBe(String(DEFAULT_MAX_AGE_DAYS));
  });

  test('append output can be chosen for flat output', () => {
    change('toggle-dedup', { checked: true });
    change('toggle-dedup-incremental', { checked: true });
    document.getElementById('btn-dedup-output-append').click();

    expect(lastPersisted().appendOutput).toBe(true);
    expect(document.getElementById('btn-dedup-output-append').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-dedup-output-delta').classList.contains('active')).toBe(false);
  });

  test('the append choice is available for container mode too (Issue #342: every format can append)', async () => {
    await mount({
      mode: 'container',
      groups: [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'N', selector: 'h1', mode: 'text' }] }],
      deduplication: { ...createDefaultDeduplication(), enabled: true, incremental: true, appendOutput: true, keyFields: ['N'] },
    });

    expect(document.getElementById('btn-dedup-output-append').disabled).toBe(false);
    expect(document.getElementById('btn-dedup-output-append').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-dedup-output-delta').classList.contains('active')).toBe(false);
  });

  test('the section is hidden for Combined and Blocks mode', async () => {
    await mount({ mode: 'combined' });
    expect(document.getElementById('dedup-section').classList.contains('hidden')).toBe(true);
    await mount({ mode: 'blocks' });
    expect(document.getElementById('dedup-section').classList.contains('hidden')).toBe(true);
    await mount({ mode: 'flat', fields });
    expect(document.getElementById('dedup-section').classList.contains('hidden')).toBe(false);
  });

  test('a stored configuration is restored when the popup reopens', async () => {
    await mount({
      mode: 'flat', fields,
      deduplication: { ...createDefaultDeduplication(), enabled: true, keyFields: ['Titel'] },
    });
    expect(document.getElementById('toggle-dedup').checked).toBe(true);
    expect(document.getElementById('dedup-config').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#dedup-key-fields-list .btn-remove-dedup-key-field')).toHaveLength(1);
  });
});
