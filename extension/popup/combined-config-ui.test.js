// Fixes the popup's language-detection default to German, same as
// popup.test.js's own top-level setup.
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

describe('Combined mode (Issue #239)', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let fetchMock;
  let allSavedConfigs;
  let savedConfigRecords;

  const html = `
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <div class="mode-toggle">
        <button id="btn-mode-flat" class="mode-btn active"></button>
        <button id="btn-mode-container" class="mode-btn"></button>
        <button id="btn-mode-api" class="mode-btn"></button>
        <button id="btn-mode-combined" class="mode-btn"></button>
      </div>
      <div id="flat-mode-section"></div>
      <div id="container-mode-section" class="hidden"></div>
      <div id="api-mode-section" class="hidden"></div>
      <div id="combined-mode-section" class="hidden">
        <ul id="combined-components-list"></ul>
        <select id="select-combined-add-component"></select>
        <button id="btn-combined-add-component"></button>
        <p id="combined-no-saved-configs-hint" class="hidden"></p>
      </div>
      <button id="btn-generate" disabled></button>
      <div id="saved-configs-list"></div>
      <p id="saved-configs-empty" class="hidden"></p>
    </section>
    <section id="screen-generating" class="hidden"></section>
    <section id="screen-done" class="hidden"></section>
    <div id="error-toast" class="hidden">
      <span id="error-toast-message"></span>
      <button id="btn-report-bug-toast" class="hidden"></button>
    </div>
  `;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = html;

    allSavedConfigs = [
      { id: 1, url: 'https://shop.example.com/a', name: 'Products', savedAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, url: 'https://other-site.com/b', name: 'Reviews', savedAt: '2026-01-02T00:00:00.000Z' },
    ];
    savedConfigRecords = {
      1: { id: 1, url: 'https://shop.example.com/a', name: 'Products', savedAt: '2026-01-01T00:00:00.000Z', config: { version: '1', url: 'https://shop.example.com/a', fields: [{ name: 'Preis', selector: '.price', attribute: null }] } },
      2: { id: 2, url: 'https://other-site.com/b', name: 'Reviews', savedAt: '2026-01-02T00:00:00.000Z', config: { version: '1', url: 'https://other-site.com/b', fields: [{ name: 'Sterne', selector: '.stars', attribute: null }] } },
    };

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
      if (urlStr.includes('/configs?url=')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (urlStr.endsWith('/configs') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(allSavedConfigs) });
      }
      const byIdMatch = urlStr.match(/\/configs\/(\d+)$/);
      if (byIdMatch && method === 'GET') {
        const record = savedConfigRecords[Number(byIdMatch[1])];
        return record
          ? Promise.resolve({ ok: true, json: () => Promise.resolve(record) })
          : Promise.resolve({ ok: false, status: 404 });
      }
      if (urlStr.endsWith('/generate') && method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('# combined script') });
      }
      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, allSavedConfigs fetched
  });

  test('switching to Combined mode shows its section and hides the others', () => {
    document.getElementById('btn-mode-combined').click();

    expect(document.getElementById('combined-mode-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-mode-combined').classList.contains('active')).toBe(true);
  });

  test('the add-component picker is populated from every saved configuration, regardless of host', () => {
    document.getElementById('btn-mode-combined').click();

    const options = [...document.querySelectorAll('#select-combined-add-component option')];
    expect(options.map((o) => o.value)).toEqual(['1', '2']);
    expect(document.getElementById('combined-no-saved-configs-hint').classList.contains('hidden')).toBe(true);
  });

  test('adding two components and generating resolves each one live and posts a combined request', async () => {
    document.getElementById('btn-mode-combined').click();

    const selectEl = document.getElementById('select-combined-add-component');
    selectEl.value = '1';
    document.getElementById('btn-combined-add-component').click();
    selectEl.value = '2';
    document.getElementById('btn-combined-add-component').click();

    const rows = document.querySelectorAll('.combined-component-row');
    expect(rows).toHaveLength(2);
    expect(document.getElementById('btn-generate').disabled).toBe(false);

    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/configs/1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/configs/2');

    const generateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/generate') && init?.method === 'POST');
    expect(generateCall).toBeDefined();
    const body = JSON.parse(generateCall[1].body);
    expect(body.combined).toEqual([
      { name: 'Products', config: savedConfigRecords[1].config, savedConfigId: 1 },
      { name: 'Reviews', config: savedConfigRecords[2].config, savedConfigId: 2 },
    ]);
  });

  test('removing a component and reordering the remaining two update the list', () => {
    document.getElementById('btn-mode-combined').click();
    const selectEl = document.getElementById('select-combined-add-component');
    selectEl.value = '1';
    document.getElementById('btn-combined-add-component').click();
    selectEl.value = '2';
    document.getElementById('btn-combined-add-component').click();
    selectEl.value = '1';
    document.getElementById('btn-combined-add-component').click();

    let rows = document.querySelectorAll('.combined-component-row');
    expect(rows).toHaveLength(3);

    rows[1].querySelector('.btn-combined-remove').click();
    rows = document.querySelectorAll('.combined-component-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.combined-component-name-input').value).toBe('Products');
    expect(rows[1].querySelector('.combined-component-name-input').value).toBe('Products');

    // Rename the second one so the move can be told apart from the first.
    const secondNameInput = rows[1].querySelector('.combined-component-name-input');
    secondNameInput.value = 'Products (again)';
    secondNameInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.querySelectorAll('.combined-component-row')[0].querySelector('.btn-combined-move-down').click();
    const namesAfterMove = [...document.querySelectorAll('.combined-component-name-input')].map((i) => i.value);
    expect(namesAfterMove).toEqual(['Products (again)', 'Products']);
  });

  test('renaming a component updates its merge-key name', async () => {
    document.getElementById('btn-mode-combined').click();
    const selectEl = document.getElementById('select-combined-add-component');
    selectEl.value = '1';
    document.getElementById('btn-combined-add-component').click();
    selectEl.value = '2';
    document.getElementById('btn-combined-add-component').click();

    const nameInput = document.querySelectorAll('.combined-component-name-input')[0];
    nameInput.value = 'renamed-products';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/generate') && init?.method === 'POST');
    const body = JSON.parse(generateCall[1].body);
    expect(body.combined[0].name).toBe('renamed-products');
  });

  test('a restored component whose saved configuration no longer exists is shown as unavailable', async () => {
    // Simulates reopening the popup with a Combined config restored from
    // chrome.storage.session (see session-restore.js) whose component id
    // (999) has since been deleted from the saved-configs store.
    jest.resetModules();
    document.body.innerHTML = html;
    global.chrome.storage.session.get = jest.fn().mockResolvedValue({
      url: 'https://example.com/products',
      mode: 'combined',
      combinedComponents: [{ savedConfigId: 999, name: 'gone' }],
    });

    require('./popup');
    await flushMicrotasks();

    const sourceEl = document.querySelector('.combined-component-source');
    expect(sourceEl.textContent).toBe('nicht mehr verfügbar');
    expect(sourceEl.classList.contains('warn')).toBe(true);
  });
});
