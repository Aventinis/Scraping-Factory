// Issue #402: the common-header picker — pure preset logic, the wired-up
// picker/notes in the real popup, and proof that the wire output is the
// same as for a hand-typed header.
const {
  REQUEST_HEADER_PRESETS, OTHER_PRESET_ID, presetById, presetForName, rowFromPreset,
  isSecretHeaderName, suggestHeaderEnvName,
} = require('./request-header-presets');
const { buildRequestHeadersConfig, appendHeaderRow, createDefaultRequestHeaders } = require('./request-headers');

describe('presets', () => {
  test('every preset yields a complete row, and secrets start as an environment variable', () => {
    for (const preset of REQUEST_HEADER_PRESETS) {
      const row = rowFromPreset(preset);
      expect(row.name).toBe(preset.name);
      expect(row.value.trim()).not.toBe('');
      if (preset.secret) expect(row.kind).toBe('env');
    }
    expect(REQUEST_HEADER_PRESETS.filter((p) => p.secret).map((p) => p.name).sort()).toEqual(['Authorization', 'Cookie', 'X-Api-Key']);
  });

  test('a suggested variable name is a valid environment-variable name', () => {
    for (const preset of REQUEST_HEADER_PRESETS.filter((p) => p.kind === 'env')) {
      expect(preset.value).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  test('presetForName / presetById look presets up, case-insensitively for names', () => {
    expect(presetForName('accept-language')?.id).toBe('acceptLanguage');
    expect(presetForName('  AUTHORIZATION ')?.id).toBe('authorization');
    expect(presetForName('X-Something')).toBeNull();
    expect(presetForName('')).toBeNull();
    expect(presetById('referer')?.name).toBe('Referer');
    expect(presetById(OTHER_PRESET_ID)).toBeNull();
  });

  test('credential-looking names are recognised, harmless ones are not', () => {
    for (const name of ['Authorization', 'cookie', 'Proxy-Authorization', 'X-Api-Key', 'apikey', 'X-Auth-Token', 'X-Secret', 'X-Client-Secret', 'Access-Key', 'X_PASSWORD']) {
      expect(isSecretHeaderName(name)).toBe(true);
    }
    for (const name of ['Accept-Language', 'Referer', 'User-Agent', 'X-Requested-With', 'Accept', '', '   ']) {
      expect(isSecretHeaderName(name)).toBe(false);
    }
  });

  test('suggestHeaderEnvName derives a valid name; presets keep their own', () => {
    expect(suggestHeaderEnvName('X-Auth-Token')).toBe('X_AUTH_TOKEN');
    expect(suggestHeaderEnvName('Authorization')).toBe('AUTH_TOKEN');
    expect(suggestHeaderEnvName('')).toBe('HEADER_VALUE');
    expect(suggestHeaderEnvName('1st-Token')).toBe('HEADER_1ST_TOKEN');
    expect(suggestHeaderEnvName('X Funny (Header)')).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });
});

describe('wire output', () => {
  test('a picked preset produces exactly what the same hand-typed header produces', () => {
    const picked = appendHeaderRow({ ...createDefaultRequestHeaders(), enabled: true }, rowFromPreset(presetById('acceptLanguage')));
    const typed = { enabled: true, rows: [{ name: 'Accept-Language', kind: 'value', value: 'en-US,en;q=0.9' }] };
    expect(buildRequestHeadersConfig(picked)).toEqual(buildRequestHeadersConfig(typed));
    expect(buildRequestHeadersConfig(picked)).toEqual([{ name: 'Accept-Language', value: 'en-US,en;q=0.9' }]);
  });

  test('a secret preset is sent as an environment-variable header, never a literal', () => {
    const picked = appendHeaderRow({ ...createDefaultRequestHeaders(), enabled: true }, rowFromPreset(presetById('authorization')));
    expect(buildRequestHeadersConfig(picked)).toEqual([{ name: 'Authorization', environmentVariableName: 'AUTH_TOKEN' }]);
  });
});

describe('the picker in the real popup', () => {
  const flushMicrotasks = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

  const mount = async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <div id="request-headers-section">
          <input type="checkbox" id="toggle-request-headers" />
          <div id="request-headers-config" class="hidden">
            <div id="request-headers-list"></div>
            <select id="select-add-request-header"></select>
          </div>
        </div>
        <button id="btn-generate" disabled></button>
      </section>`;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue({ mode: 'flat', fields: [{ name: 'T', selector: 'h1' }] }), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
    const toggle = document.getElementById('toggle-request-headers');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const rows = () => [...document.querySelectorAll('#request-headers-list .request-header-row')];
  const select = () => document.getElementById('select-add-request-header');
  const pick = (id) => { select().value = id; select().dispatchEvent(new Event('change', { bubbles: true })); };
  const lastPersisted = () => chrome.storage.session.set.mock.calls.at(-1)[0].requestHeaders;
  const commit = (el, patch) => { Object.assign(el, patch); el.dispatchEvent(new Event('change', { bubbles: true })); };

  beforeEach(mount);

  test('lists the common headers plus "Other", and goes back to its placeholder after a pick', () => {
    const values = [...select().options].map((o) => o.value);
    expect(values).toEqual(['', ...REQUEST_HEADER_PRESETS.map((p) => p.id), OTHER_PRESET_ID]);
    pick('referer');
    expect(select().value).toBe('');
  });

  test('picking a common header creates a complete row with a description', () => {
    pick('acceptLanguage');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.request-header-name').value).toBe('Accept-Language');
    expect(rows()[0].querySelector('.request-header-value').value).toBe('en-US,en;q=0.9');
    expect(lastPersisted().rows).toEqual([{ name: 'Accept-Language', kind: 'value', value: 'en-US,en;q=0.9' }]);
    expect(rows()[0].querySelector('.request-header-desc')).not.toBeNull();
    expect(rows()[0].querySelector('.request-header-secret-warning')).toBeNull();
  });

  test('a secret preset starts as an environment variable (no warning) with a test-value box', () => {
    pick('authorization');
    const row = rows()[0];
    expect(row.querySelector('.request-header-kind').value).toBe('env');
    expect(row.querySelector('.request-header-value').value).toBe('AUTH_TOKEN');
    expect(row.querySelector('.request-header-test-value')).not.toBeNull();
    expect(row.querySelector('.request-header-secret-warning')).toBeNull();
  });

  test('an already-used header is no longer offered', () => {
    pick('cookie');
    const option = [...select().options].find((o) => o.value === 'cookie');
    expect(option.disabled).toBe(true);
    expect([...select().options].find((o) => o.value === 'referer').disabled).toBe(false);
  });

  test('a fixed value for a credential-looking header shows the warning; switching fixes it', () => {
    pick('other');
    commit(rows()[0].querySelector('.request-header-name'), { value: 'X-Auth-Token' });
    commit(rows()[0].querySelector('.request-header-value'), { value: 'abc123' });
    expect(rows()[0].querySelector('.request-header-secret-warning')).not.toBeNull();
    // still sent as the user typed it — the warning never blocks
    expect(lastPersisted().rows[0]).toEqual({ name: 'X-Auth-Token', kind: 'value', value: 'abc123' });

    rows()[0].querySelector('.request-header-switch-env').click();
    expect(lastPersisted().rows[0]).toEqual({ name: 'X-Auth-Token', kind: 'env', value: 'X_AUTH_TOKEN' });
    expect(rows()[0].querySelector('.request-header-secret-warning')).toBeNull();
    expect(rows()[0].querySelector('.request-header-kind').value).toBe('env');
  });

  test('renaming a row refreshes its note without replacing the focused inputs', () => {
    pick('other');
    const valueInput = rows()[0].querySelector('.request-header-value');
    commit(rows()[0].querySelector('.request-header-name'), { value: 'Referer' });
    expect(rows()[0].querySelector('.request-header-desc')).not.toBeNull();
    expect(rows()[0].querySelector('.request-header-value')).toBe(valueInput);
    commit(rows()[0].querySelector('.request-header-name'), { value: 'X-Whatever' });
    expect(rows()[0].querySelector('.request-header-desc')).toBeNull();
  });
});
