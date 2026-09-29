// Fixes the popup's language-detection default to German, same as
// popup.test.js's own top-level setup — every assertion below (written
// against the original hardcoded German copy) depends on it via each
// integration test's own require('./popup') (which calls initI18n()
// itself as part of init()).
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

describe('saved configuration history (Issue #141)', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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
      </div>
      <div id="save-output-create-config" class="hidden">
        <input id="input-save-output-config-name" />
      </div>
      <input id="input-save-output-name" />
      <button id="btn-save-output-cancel"></button>
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let fetchMock;

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
        </div>
        <div id="save-output-create-config" class="hidden">
          <input id="input-save-output-config-name" />
        </div>
        <input id="input-save-output-name" />
        <button id="btn-save-output-cancel"></button>
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

    let nextConfigId = 2;
    fetchMock = jest.fn((url, init) => {
      const method = init?.method || 'GET';
      const urlStr = String(url);
      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.includes('/configs?url=')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (urlStr.endsWith('/generate')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ script: '# script', outputFile: { fileName: 'output.csv', content: 'a\n' } }),
        });
      }
      // Issue #209: "Save output" create-and-link — POST /configs first
      // (createSavedConfig), then POST /configs/{id}/outputs with the
      // newly-minted id (saveCurrentOutput).
      if (urlStr.endsWith('/configs') && method === 'POST') {
        const body = JSON.parse(init.body);
        const created = { id: nextConfigId++, url: body.url, name: body.name, savedAt: '2026-01-02T00:00:00.000Z' };
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) });
      }
      const outputsListMatch = urlStr.match(/\/configs\/(\d+)\/outputs$/);
      if (outputsListMatch && method === 'POST') {
        const body = JSON.parse(init.body);
        return Promise.resolve({
          ok: true, status: 201,
          json: () => Promise.resolve({ id: 100, savedConfigId: Number(outputsListMatch[1]), name: body.name, fileName: body.fileName, savedAt: '2026-01-03T00:00:00.000Z' }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;

    require('./popup');
    await flushMicrotasks();

    document.getElementById('toggle-include-output-file').checked = true;
    document.getElementById('toggle-include-output-file').dispatchEvent(new Event('change'));
    document.getElementById('btn-generate').click();
    await flushMicrotasks();
  });

  test('Save output shows an inline "create configuration" form, prefilled with the hostname, instead of the picker', () => {
    document.getElementById('btn-save-output').click();

    expect(document.getElementById('save-output-picker').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('save-output-create-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-save-output-config-name').value).toBe('example.com');
  });

  test('confirming Save output creates a new configuration and links this output to it in one action', async () => {
    document.getElementById('btn-save-output').click();

    document.getElementById('input-save-output-config-name').value = 'Product listing';
    document.getElementById('input-save-output-name').value = 'First run';
    document.getElementById('btn-save-output-confirm').click();
    await flushMicrotasks();

    const configPostCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/configs') && init?.method === 'POST');
    expect(configPostCall).toBeDefined();
    expect(JSON.parse(configPostCall[1].body)).toMatchObject({ url: 'https://example.com/products', name: 'Product listing' });

    const outputPostCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/configs/2/outputs') && init?.method === 'POST');
    expect(outputPostCall).toBeDefined();
    expect(JSON.parse(outputPostCall[1].body)).toEqual({ name: 'First run', fileName: 'output.csv', content: 'a\n' });

    expect(document.getElementById('modal-save-output').classList.contains('hidden')).toBe(true);
  });
});

describe('replay hardening checks against saved outputs (Issue #207)', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let fetchMock;
  let savedConfigs;
  let savedOutputsByConfigId;
  let replayResults;

  const html = `
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <button id="btn-generate" disabled></button>
      <div id="hardening-config">
        <input type="checkbox" id="toggle-hardening-no-result" />
        <input type="checkbox" id="toggle-hardening-baseline" />
        <input type="number" id="input-hardening-baseline-threshold" />
      </div>
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
      </div>
      <div id="save-output-create-config" class="hidden">
        <input id="input-save-output-config-name" />
      </div>
      <input id="input-save-output-name" />
      <button id="btn-save-output-cancel"></button>
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
      { id: 1, url: 'https://example.com/products', name: 'My config', savedAt: '2026-01-01T00:00:00.000Z', blueprintId: null },
    ];
    savedOutputsByConfigId = {
      1: [{ id: 100, savedConfigId: 1, name: 'Run 1', fileName: 'output.csv', savedAt: '2026-01-02T00:00:00.000Z' }],
    };
    replayResults = [{ kind: 'noResult', severity: 'Warning', outcome: 'Passed', message: '3 row(s)/element(s) found.' }];

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/products' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com/products',
          }),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    fetchMock = jest.fn((url, init) => {
      const method = init?.method || 'GET';
      const urlStr = String(url);

      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.includes('/configs?url=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedConfigs) });
      }

      const outputsListMatch = urlStr.match(/\/configs\/(\d+)\/outputs$/);
      if (outputsListMatch && method === 'GET') {
        const configId = Number(outputsListMatch[1]);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedOutputsByConfigId[configId] || []) });
      }

      const replayMatch = urlStr.match(/\/configs\/(\d+)\/outputs\/(\d+)\/replay-hardening$/);
      if (replayMatch && method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: replayResults }) });
      }

      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, saved-configs list fetched

    document.querySelector('.btn-saved-config-outputs-toggle').click();
    await flushMicrotasks(); // outputs panel expanded, its own list fetched
  });

  function enableNoResultCheck() {
    const toggle = document.getElementById('toggle-hardening-no-result');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
  }

  test('shows a "Test hardening" button on a saved output row', () => {
    expect(document.querySelector('.btn-saved-output-replay-hardening')).not.toBeNull();
  });

  test('clicking it with no hardening checks configured shows a toast instead of calling the companion', async () => {
    document.querySelector('.btn-saved-output-replay-hardening').click();
    await flushMicrotasks();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('replay-hardening'))).toBe(false);
    expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(false);
  });

  test('clicking it with a check configured sends buildHardeningConfig\'s own output and renders the results', async () => {
    enableNoResultCheck();
    document.querySelector('.btn-saved-output-replay-hardening').click();
    await flushMicrotasks();

    const replayCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/configs/1/outputs/100/replay-hardening'));
    expect(replayCall).toBeDefined();
    expect(JSON.parse(replayCall[1].body)).toEqual({ checks: [{ kind: 'noResult', severity: 'Warning' }], compareBasis: 'config' });

    const resultsList = document.querySelector('.hardening-replay-results-list');
    expect(resultsList).not.toBeNull();
    expect(resultsList.textContent).toContain('noResult');
  });

  test('a Baseline check with no Blueprint on this config skips the compare-basis picker and runs immediately', async () => {
    document.getElementById('toggle-hardening-baseline').checked = true;
    document.getElementById('toggle-hardening-baseline').dispatchEvent(new Event('change'));
    document.querySelector('.btn-saved-output-replay-hardening').click();
    await flushMicrotasks();

    expect(document.querySelector('.hardening-replay-compare-basis-toggle')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('replay-hardening'))).toBe(true);
  });

  test('a Baseline check with a Blueprint set on this config shows the compare-basis picker and waits for "Run"', async () => {
    savedConfigs[0].blueprintId = 42;
    document.getElementById('toggle-hardening-baseline').checked = true;
    document.getElementById('toggle-hardening-baseline').dispatchEvent(new Event('change'));
    document.querySelector('.btn-saved-output-replay-hardening').click();
    await flushMicrotasks();

    expect(document.querySelector('.hardening-replay-compare-basis-toggle')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('replay-hardening'))).toBe(false);

    document.querySelector('.btn-hardening-replay-basis[data-basis="blueprint"]').click();
    document.querySelector('.btn-hardening-replay-run').click();
    await flushMicrotasks();

    const replayCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/configs/1/outputs/100/replay-hardening'));
    expect(JSON.parse(replayCall[1].body).compareBasis).toBe('blueprint');
  });

  test('a fetch failure shows an inline error with a way to dismiss it', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));
    // The above mockImplementationOnce only intercepts the very next call —
    // wrap it back into the branching mock for every call after.
    const original = fetchMock.getMockImplementation();
    let first = true;
    fetchMock.mockImplementation((url, init) => {
      if (first && String(url).includes('replay-hardening')) {
        first = false;
        return Promise.resolve({ ok: false, status: 500 });
      }
      return original(url, init);
    });

    enableNoResultCheck();
    document.querySelector('.btn-saved-output-replay-hardening').click();
    await flushMicrotasks();

    expect(document.querySelector('.hardening-replay-error')).not.toBeNull();

    document.querySelector('.btn-hardening-replay-cancel').click();
    expect(document.querySelector('.hardening-replay-panel')).toBeNull();
  });
});

// Issue-driven follow-up: the global Settings tab's own cross-site saved-
// configurations section (renderAllSavedConfigsList/wireAllSavedConfigsEvents)
// — the unscoped counterpart to the per-site "Saved configurations" panel
// above, reachable via the header's #btn-open-settings icon.
describe('global Settings tab: cross-site saved configurations', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let fetchMock;
  let allSavedConfigs;
  let savedOutputsByConfigId;

  const html = `
    <div id="header-bar">
      <button id="btn-open-settings"></button>
    </div>
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <button id="btn-generate" disabled></button>
      <div id="saved-configs-list"></div>
      <p id="saved-configs-empty" class="hidden"></p>
    </section>
    <section id="screen-generating" class="hidden"></section>
    <section id="screen-settings" class="hidden">
      <button id="btn-close-settings"></button>
      <input type="checkbox" id="toggle-output-json" />
      <input type="checkbox" id="toggle-include-data-preview" />
      <input type="checkbox" id="toggle-include-output-file" />
      <input type="checkbox" id="toggle-external-config" />
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
    document.body.innerHTML = html;

    allSavedConfigs = [
      { id: 1, url: 'https://a.example.com/products', name: 'Site A config', savedAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, url: 'https://b.example.com/listing', name: 'Site B config', savedAt: '2026-01-02T00:00:00.000Z' },
    ];
    savedOutputsByConfigId = {
      1: [{ id: 100, savedConfigId: 1, name: 'Run 1', fileName: 'output.csv', savedAt: '2026-01-03T00:00:00.000Z' }],
    };

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://a.example.com/products' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({ fields: [], url: 'https://a.example.com/products' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    fetchMock = jest.fn((url, init) => {
      const method = init?.method || 'GET';
      const urlStr = String(url);
      if (urlStr.endsWith('/health')) return Promise.resolve({ ok: true });
      if (urlStr.includes('/configs?url=')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (urlStr.endsWith('/configs') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(allSavedConfigs) });
      }
      if (urlStr.endsWith('/blueprints') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      const outputsMatch = urlStr.match(/\/configs\/(\d+)\/outputs$/);
      if (outputsMatch && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedOutputsByConfigId[Number(outputsMatch[1])] || []) });
      }
      if (/\/configs\/\d+$/.test(urlStr) && method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, allSavedConfigs fetched
  });

  function openSettings() {
    document.getElementById('btn-open-settings').click();
  }

  test('lists every saved configuration regardless of host, with no Load button', () => {
    openSettings();
    const rows = document.querySelectorAll('#all-saved-configs-list .saved-config-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Site A config');
    expect(rows[1].textContent).toContain('Site B config');
    expect(document.querySelector('#all-saved-configs-list .btn-saved-config-load')).toBeNull();
  });

  test('Delete requires an inline confirm before sending DELETE, then refreshes the list — down to the empty-state hint once nothing is left', async () => {
    openSettings();
    document.querySelectorAll('#all-saved-configs-list .btn-all-saved-config-delete')[0].click();

    expect(document.querySelector('.btn-all-saved-config-delete-confirm')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    allSavedConfigs = allSavedConfigs.filter((c) => c.id !== 1);
    document.querySelector('.btn-all-saved-config-delete-confirm').click();
    await flushMicrotasks();

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/configs/1') && init?.method === 'DELETE')).toBe(true);
    let rows = document.querySelectorAll('#all-saved-configs-list .saved-config-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Site B config');
    expect(document.getElementById('all-saved-configs-empty').classList.contains('hidden')).toBe(true);

    document.querySelectorAll('#all-saved-configs-list .btn-all-saved-config-delete')[0].click();
    allSavedConfigs = [];
    document.querySelector('.btn-all-saved-config-delete-confirm').click();
    await flushMicrotasks();

    rows = document.querySelectorAll('#all-saved-configs-list .saved-config-row');
    expect(rows).toHaveLength(0);
    expect(document.getElementById('all-saved-configs-empty').classList.contains('hidden')).toBe(false);
  });

  test('Delete confirm can be cancelled without sending the DELETE request', () => {
    openSettings();
    document.querySelectorAll('#all-saved-configs-list .btn-all-saved-config-delete')[0].click();
    document.querySelector('.btn-all-saved-config-delete-cancel').click();

    expect(document.querySelector('.btn-all-saved-config-delete-confirm')).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  test('a row\'s own "Outputs" toggle expands its saved-output list, same as the per-site panel', async () => {
    openSettings();
    document.querySelectorAll('#all-saved-configs-list .btn-saved-config-outputs-toggle')[0].click();
    await flushMicrotasks();

    const outputRows = document.querySelectorAll('.saved-output-row');
    expect(outputRows).toHaveLength(1);
    expect(outputRows[0].textContent).toContain('Run 1');
  });
});
