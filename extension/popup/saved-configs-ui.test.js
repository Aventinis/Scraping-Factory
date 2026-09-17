// Fixes the popup's language-detection default to German, same as
// popup.test.js's own top-level setup — every assertion below (written
// against the original hardcoded German copy) depends on it via each
// integration test's own require('./popup') (which calls initI18n()
// itself as part of init()).
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

describe('saved configuration history (Issue #141)', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  let fetchMock;

  const idleScreenHtml = `
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <button id="btn-generate"></button>
      <button id="btn-export-config"></button>
      <button id="btn-save-config"></button>
      <div id="saved-configs-list"></div>
      <p id="saved-configs-empty" class="hidden"></p>
    </section>
    <div id="modal-save-config" class="modal hidden">
      <input id="input-save-config-name" />
      <button id="btn-save-config-cancel"></button>
      <button id="btn-save-config-confirm"></button>
    </div>
    <section id="screen-generating" class="hidden"></section>
    <div id="error-toast" class="hidden">
      <span id="error-toast-message"></span>
      <button id="btn-report-bug-toast" class="hidden"></button>
    </div>
  `;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = idleScreenHtml;

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/products' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Preis', selector: '.price', attribute: null }],
            url: 'https://example.com/products',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    fetchMock = jest.fn((url, init) => {
      const method = init?.method || 'GET';
      const urlStr = String(url);
      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.includes('/configs?url=')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 1, url: 'https://example.com/products', name: 'My config', savedAt: '2026-01-01T00:00:00.000Z' },
          ]),
        });
      }
      if (urlStr.endsWith('/configs') && method === 'POST') {
        return Promise.resolve({
          ok: true, status: 201,
          json: () => Promise.resolve({ id: 2, url: 'https://example.com/products', name: 'New config', savedAt: '2026-01-02T00:00:00.000Z' }),
        });
      }
      if (/\/configs\/\d+$/.test(urlStr) && method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1, url: 'https://example.com/products', name: 'My config', savedAt: '2026-01-01T00:00:00.000Z',
            config: {
              version: '1', url: 'https://example.com/products',
              fields: [{ name: 'Loaded', selector: '.loaded', attribute: null }],
            },
          }),
        });
      }
      if (/\/configs\/\d+$/.test(urlStr) && method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored, saved-configs list fetched
  });

  test('fetches and renders saved configs scoped to the current page on IDLE entry', () => {
    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:5000/configs?url=${encodeURIComponent('https://example.com/products')}`);
    const rows = document.querySelectorAll('.saved-config-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('My config');
  });

  test('Save opens the modal prefilled with the current hostname, then POSTs the current config and refreshes the list', async () => {
    document.getElementById('btn-save-config').click();
    expect(document.getElementById('modal-save-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-save-config-name').value).toBe('example.com');

    document.getElementById('input-save-config-name').value = 'New config';
    document.getElementById('btn-save-config-confirm').click();
    await flushMicrotasks();

    const postCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/configs') && init?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.name).toBe('New config');
    expect(body.url).toBe('https://example.com/products');
    expect(body.config.fields).toEqual([{ name: 'Preis', selector: '.price', attribute: null }]);
    // Save is followed by a re-fetch of the list (fetchSavedConfigs) and the
    // modal closes.
    expect(document.getElementById('modal-save-config').classList.contains('hidden')).toBe(true);
  });

  test('Load applies the saved config back into state without touching the live tab URL', async () => {
    document.querySelector('.btn-saved-config-load').click();
    await flushMicrotasks();

    // _state.url stays whatever the tab reported at startup — see
    // applyConfigToState's own doc comment.
    expect(document.getElementById('url-display').textContent).toBe('https://example.com/products');
    const fieldNames = [...document.querySelectorAll('#fields-list .field-name')].map(el => el.textContent);
    expect(fieldNames).toEqual(['Loaded']);
  });

  test('Delete requires an inline confirm before the DELETE request is actually sent', async () => {
    document.querySelector('.btn-saved-config-delete').click();

    expect(document.querySelector('.btn-saved-config-delete-confirm')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    document.querySelector('.btn-saved-config-delete-confirm').click();
    await flushMicrotasks();

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  test('Delete confirm can be cancelled without sending the DELETE request', () => {
    document.querySelector('.btn-saved-config-delete').click();
    document.querySelector('.btn-saved-config-delete-cancel').click();

    expect(document.querySelector('.btn-saved-config-load')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});

describe('saved configuration history: an older/unreachable companion without /configs', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="fields-list"></div>
        <div id="saved-configs-list"></div>
        <p id="saved-configs-empty" class="hidden"></p>
      </section>
    `;

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: { session: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) } },
    };

    global.fetch = jest.fn((url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.includes('/configs?url=')) return Promise.reject(new Error('404 Not Found'));
      return Promise.reject(new Error(`unexpected fetch: ${urlStr}`));
    });

    require('./popup');
    await flushMicrotasks();
  });

  test('the panel just stays empty instead of surfacing an error', () => {
    expect(document.getElementById('error-toast')).toBeNull();
    expect(document.querySelectorAll('.saved-config-row')).toHaveLength(0);
  });
});

describe('persist and browse run outputs (Issue #202)', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  let fetchMock;
  let savedConfigs;
  let savedOutputsByConfigId;

  const html = `
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <input type="checkbox" id="toggle-include-output-file" />
      <button id="btn-generate" disabled></button>
      <button id="btn-save-config"></button>
      <div id="saved-configs-list"></div>
      <p id="saved-configs-empty" class="hidden"></p>
    </section>
    <section id="screen-generating" class="hidden"></section>
    <section id="screen-done" class="hidden">
      <button id="btn-back-to-config"></button>
      <button id="btn-download"></button>
      <button id="btn-download-output" class="hidden"></button>
      <button id="btn-save-output" class="hidden"></button>
    </section>
    <div id="modal-save-config" class="modal hidden">
      <input id="input-save-config-name" />
      <button id="btn-save-config-cancel"></button>
      <button id="btn-save-config-confirm"></button>
    </div>
    <div id="modal-save-output" class="modal hidden">
      <div id="save-output-picker">
        <select id="select-save-output-config"></select>
        <input id="input-save-output-name" />
      </div>
      <p id="save-output-no-configs-hint" class="hidden"></p>
      <button id="btn-save-output-cancel"></button>
      <button id="btn-save-output-go-to-save-config" class="hidden"></button>
      <button id="btn-save-output-confirm"></button>
    </div>
    <div id="error-toast" class="hidden">
      <span id="error-toast-message"></span>
      <button id="btn-report-bug-toast" class="hidden"></button>
    </div>
  `;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = html;

    savedConfigs = [
      { id: 1, url: 'https://example.com/products', name: 'My config', savedAt: '2026-01-01T00:00:00.000Z' },
    ];
    savedOutputsByConfigId = { 1: [] };

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/products' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com/products',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    fetchMock = jest.fn((url, init) => {
      const method = init?.method || 'GET';
      const urlStr = String(url);

      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.endsWith('/generate') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ script: '# script', outputFile: { fileName: 'output.csv', content: 'Titel\nA\n' } }),
        });
      }
      if (urlStr.includes('/configs?url=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedConfigs) });
      }
      if (urlStr.endsWith('/configs') && method === 'POST') {
        const created = { id: 2, url: 'https://example.com/products', name: 'New config', savedAt: '2026-01-02T00:00:00.000Z' };
        savedConfigs = [...savedConfigs, created];
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) });
      }

      const outputsListMatch = urlStr.match(/\/configs\/(\d+)\/outputs$/);
      if (outputsListMatch && method === 'GET') {
        const configId = Number(outputsListMatch[1]);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedOutputsByConfigId[configId] || []) });
      }
      if (outputsListMatch && method === 'POST') {
        const configId = Number(outputsListMatch[1]);
        const body = JSON.parse(init.body);
        const created = {
          id: 100 + (savedOutputsByConfigId[configId]?.length || 0),
          savedConfigId: configId, name: body.name, fileName: body.fileName, savedAt: '2026-01-03T00:00:00.000Z',
        };
        savedOutputsByConfigId[configId] = [...(savedOutputsByConfigId[configId] || []), created];
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) });
      }

      const outputByIdMatch = urlStr.match(/\/configs\/(\d+)\/outputs\/(\d+)$/);
      if (outputByIdMatch && method === 'GET') {
        const [, configId, id] = outputByIdMatch.map(Number);
        const record = (savedOutputsByConfigId[configId] || []).find((o) => o.id === id);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...record, content: 'Titel\nA\n' }) });
      }
      if (outputByIdMatch && method === 'DELETE') {
        const [, configId, id] = outputByIdMatch.map(Number);
        savedOutputsByConfigId[configId] = (savedOutputsByConfigId[configId] || []).filter((o) => o.id !== id);
        return Promise.resolve({ ok: true, status: 204 });
      }

      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored, saved-configs list fetched
  });

  async function generateWithOutputFile() {
    document.getElementById('toggle-include-output-file').checked = true;
    document.getElementById('toggle-include-output-file').dispatchEvent(new Event('change'));
    document.getElementById('btn-generate').click();
    await flushMicrotasks();
  }

  test('btn-save-output stays hidden until includeOutputFile produced a file, same as btn-download-output', async () => {
    document.getElementById('btn-generate').click();
    await flushMicrotasks();
    expect(document.getElementById('btn-save-output').classList.contains('hidden')).toBe(true);
  });

  test('btn-save-output becomes visible once includeOutputFile produced a file', async () => {
    await generateWithOutputFile();
    expect(document.getElementById('btn-save-output').classList.contains('hidden')).toBe(false);
  });

  test('Save output opens the modal with the saved-configs picker populated', async () => {
    await generateWithOutputFile();

    document.getElementById('btn-save-output').click();

    expect(document.getElementById('modal-save-output').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('save-output-picker').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('select-save-output-config').textContent).toContain('My config');
  });

  test('confirming Save output POSTs name/fileName/content to /configs/{id}/outputs and closes the modal', async () => {
    await generateWithOutputFile();
    document.getElementById('btn-save-output').click();

    document.getElementById('select-save-output-config').value = '1';
    document.getElementById('input-save-output-name').value = 'First run';
    document.getElementById('btn-save-output-confirm').click();
    await flushMicrotasks();

    const postCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/configs/1/outputs') && init?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body).toEqual({ name: 'First run', fileName: 'output.csv', content: 'Titel\nA\n' });
    expect(document.getElementById('modal-save-output').classList.contains('hidden')).toBe(true);
  });

  test('the saved-configs list renders an Outputs toggle, which fetches and shows that config\'s own saved outputs', async () => {
    savedOutputsByConfigId[1] = [
      { id: 101, savedConfigId: 1, name: 'First run', fileName: 'output.csv', savedAt: '2026-01-03T00:00:00.000Z' },
    ];

    document.querySelector('.btn-saved-config-outputs-toggle').click();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:5000/configs/1/outputs`);
    const rows = document.querySelectorAll('.saved-output-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('First run');
  });

  test('the outputs sub-panel shows an empty hint when the config has no saved outputs', async () => {
    document.querySelector('.btn-saved-config-outputs-toggle').click();
    await flushMicrotasks();

    expect(document.querySelector('.saved-outputs-empty')).not.toBeNull();
    expect(document.querySelectorAll('.saved-output-row')).toHaveLength(0);
  });

  test('clicking the Outputs toggle again collapses the sub-panel', async () => {
    document.querySelector('.btn-saved-config-outputs-toggle').click();
    await flushMicrotasks();
    document.querySelector('.btn-saved-config-outputs-toggle').click();

    expect(document.querySelector('.saved-outputs-panel')).toBeNull();
  });

  test('Download on a saved output fetches its full content and downloads it as a blob', async () => {
    savedOutputsByConfigId[1] = [
      { id: 101, savedConfigId: 1, name: 'First run', fileName: 'output.csv', savedAt: '2026-01-03T00:00:00.000Z' },
    ];
    document.querySelector('.btn-saved-config-outputs-toggle').click();
    await flushMicrotasks();

    const appendSpy = jest.spyOn(document.body, 'appendChild');
    document.querySelector('.btn-saved-output-download').click();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/configs/1/outputs/101');
    const anchor = appendSpy.mock.calls.find(([el]) => el.tagName === 'A')?.[0];
    expect(anchor.download).toBe('output.csv');
    appendSpy.mockRestore();
  });

  test('Delete on a saved output requires an inline confirm before the DELETE request is actually sent', async () => {
    savedOutputsByConfigId[1] = [
      { id: 101, savedConfigId: 1, name: 'First run', fileName: 'output.csv', savedAt: '2026-01-03T00:00:00.000Z' },
    ];
    document.querySelector('.btn-saved-config-outputs-toggle').click();
    await flushMicrotasks();

    document.querySelector('.btn-saved-output-delete').click();
    expect(document.querySelector('.btn-saved-output-delete-confirm')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    document.querySelector('.btn-saved-output-delete-confirm').click();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/configs/1/outputs/101', { method: 'DELETE' });
    expect(document.querySelectorAll('.saved-output-row')).toHaveLength(0);
  });
});

describe('persist and browse run outputs (Issue #202): no saved config yet', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="fields-list"></div>
        <input type="checkbox" id="toggle-include-output-file" />
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <section id="screen-done" class="hidden">
        <button id="btn-back-to-config"></button>
        <button id="btn-download"></button>
        <button id="btn-download-output" class="hidden"></button>
        <button id="btn-save-output" class="hidden"></button>
      </section>
      <div id="modal-save-config" class="modal hidden">
        <input id="input-save-config-name" />
        <button id="btn-save-config-cancel"></button>
        <button id="btn-save-config-confirm"></button>
      </div>
      <div id="modal-save-output" class="modal hidden">
        <div id="save-output-picker">
          <select id="select-save-output-config"></select>
          <input id="input-save-output-name" />
        </div>
        <p id="save-output-no-configs-hint" class="hidden"></p>
        <button id="btn-save-output-cancel"></button>
        <button id="btn-save-output-go-to-save-config" class="hidden"></button>
        <button id="btn-save-output-confirm"></button>
      </div>
    `;

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/products' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com/products',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    global.fetch = jest.fn((url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.includes('/configs?url=')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (urlStr.endsWith('/generate')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ script: '# script', outputFile: { fileName: 'output.csv', content: 'a\n' } }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${urlStr}`));
    });

    require('./popup');
    await flushMicrotasks();

    document.getElementById('toggle-include-output-file').checked = true;
    document.getElementById('toggle-include-output-file').dispatchEvent(new Event('change'));
    document.getElementById('btn-generate').click();
    await flushMicrotasks();
  });

  test('Save output shows a "save configuration first" hint instead of the picker', () => {
    document.getElementById('btn-save-output').click();

    expect(document.getElementById('save-output-picker').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('save-output-no-configs-hint').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-save-output-confirm').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-save-output-go-to-save-config').classList.contains('hidden')).toBe(false);
  });

  test('the hint\'s shortcut closes modal-save-output and opens modal-save-config instead', () => {
    document.getElementById('btn-save-output').click();
    document.getElementById('btn-save-output-go-to-save-config').click();

    expect(document.getElementById('modal-save-output').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('modal-save-config').classList.contains('hidden')).toBe(false);
  });
});
