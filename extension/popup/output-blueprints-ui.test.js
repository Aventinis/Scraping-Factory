// Fixes the popup's language-detection default to German, same as
// popup.test.js's/combined-config-ui.test.js's own top-level setup.
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

describe('Output Blueprints (Issue #191)', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let fetchMock;
  let blueprints;
  let blueprintRecords;

  const html = `
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div>
      <div id="fields-list"></div>
      <div class="mode-toggle">
        <button id="btn-mode-flat" class="mode-btn active"></button>
        <button id="btn-mode-container" class="mode-btn"></button>
        <button id="btn-mode-api" class="mode-btn"></button>
      </div>
      <div id="flat-mode-section"></div>
      <div id="container-mode-section" class="hidden"></div>
      <div id="api-mode-section" class="hidden"></div>
      <div id="settings-section">
        <div id="output-blueprint-toggle-row">
          <select id="select-output-blueprint"></select>
          <button type="button" id="btn-manage-blueprints"></button>
        </div>
        <div id="output-blueprint-mapping" class="hidden">
          <ul id="output-blueprint-mapping-list"></ul>
        </div>
      </div>
      <button id="btn-generate" disabled></button>
      <div id="saved-configs-list"></div>
      <p id="saved-configs-empty" class="hidden"></p>
    </section>
    <section id="screen-generating" class="hidden"></section>
    <section id="screen-done" class="hidden"></section>
    <div id="modal-manage-blueprints" class="modal hidden">
      <div id="manage-blueprints-list"></div>
      <p id="manage-blueprints-empty" class="hidden"></p>
      <button type="button" id="btn-blueprint-new"></button>
      <button id="btn-manage-blueprints-close"></button>
    </div>
    <div id="modal-blueprint-edit" class="modal hidden">
      <input id="input-blueprint-name" type="text" />
      <ul id="blueprint-field-list"></ul>
      <button type="button" id="btn-blueprint-field-add"></button>
      <button id="btn-blueprint-edit-cancel"></button>
      <button id="btn-blueprint-edit-save"></button>
    </div>
    <div id="error-toast" class="hidden">
      <span id="error-toast-message"></span>
      <button id="btn-report-bug-toast" class="hidden"></button>
    </div>
  `;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = html;

    blueprints = [
      { id: 1, name: 'Standard export', fieldCount: 2 },
    ];
    blueprintRecords = {
      1: { id: 1, name: 'Standard export', fieldNames: ['Title', 'Price'] },
    };

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/products' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [
              { name: 'Title', selector: 'h1', attribute: null },
              { name: 'Price', selector: '.price', attribute: null },
            ],
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
      if (urlStr.endsWith('/configs') && method === 'GET') return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (urlStr.endsWith('/blueprints') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(blueprints) });
      }
      if (urlStr.endsWith('/blueprints') && method === 'POST') {
        const body = JSON.parse(init.body);
        const record = { id: 2, name: body.name, fieldNames: body.fieldNames };
        blueprintRecords[2] = record;
        blueprints = [...blueprints, { id: 2, name: body.name, fieldCount: body.fieldNames.length }];
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(record) });
      }
      const byIdMatch = urlStr.match(/\/blueprints\/(\d+)$/);
      if (byIdMatch && method === 'GET') {
        const record = blueprintRecords[Number(byIdMatch[1])];
        return record
          ? Promise.resolve({ ok: true, json: () => Promise.resolve(record) })
          : Promise.resolve({ ok: false, status: 404 });
      }
      if (byIdMatch && method === 'PUT') {
        const id = Number(byIdMatch[1]);
        const body = JSON.parse(init.body);
        blueprintRecords[id] = { id, name: body.name, fieldNames: body.fieldNames };
        blueprints = blueprints.map((bp) => (bp.id === id ? { ...bp, name: body.name, fieldCount: body.fieldNames.length } : bp));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(blueprintRecords[id]) });
      }
      if (byIdMatch && method === 'DELETE') {
        const id = Number(byIdMatch[1]);
        delete blueprintRecords[id];
        blueprints = blueprints.filter((bp) => bp.id !== id);
        return Promise.resolve({ ok: true, status: 204 });
      }
      if (urlStr.endsWith('/generate') && method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('# script') });
      }
      return Promise.reject(new Error(`unexpected fetch: ${method} ${urlStr}`));
    });
    global.fetch = fetchMock;

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, blueprint list fetched
  });

  test('the blueprint list is fetched on companion connect and populates the picker', () => {
    const options = [...document.querySelectorAll('#select-output-blueprint option')];
    // First option is the "None" placeholder (see renderOutputBlueprintMappingSection).
    expect(options.map((o) => o.value)).toEqual(['', '1']);
    expect(options[1].textContent).toContain('Standard export');
  });

  test('the mapping picker is hidden for container mode and shown again for flat mode', () => {
    document.getElementById('btn-mode-container').click();
    expect(document.getElementById('output-blueprint-toggle-row').classList.contains('hidden')).toBe(true);

    document.getElementById('btn-mode-flat').click();
    expect(document.getElementById('output-blueprint-toggle-row').classList.contains('hidden')).toBe(false);
  });

  test('picking a blueprint renders one mapping row per target field, sourced from the current mode\'s own fields', async () => {
    const selectEl = document.getElementById('select-output-blueprint');
    selectEl.value = '1';
    selectEl.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    const rows = document.querySelectorAll('.output-blueprint-mapping-row');
    expect(rows).toHaveLength(2);
    expect([...rows].map((r) => r.dataset.target)).toEqual(['Title', 'Price']);
    const sourceOptions = [...rows[0].querySelector('select').options].map((o) => o.value);
    expect(sourceOptions).toEqual(['', 'Title', 'Price']);
  });

  test('"Generate" stays disabled until every target field is mapped, then sends the mapping', async () => {
    const selectEl = document.getElementById('select-output-blueprint');
    selectEl.value = '1';
    selectEl.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.getElementById('btn-generate').disabled).toBe(true);

    // renderOutputBlueprintMappingSection rebuilds the row list's innerHTML
    // on every re-render (triggered by each change event's own patchState),
    // so the row/select elements must be re-queried after each change
    // instead of reused — a stale, now-detached select's change event would
    // never reach the delegated listener on #output-blueprint-mapping-list.
    let rows = document.querySelectorAll('.output-blueprint-mapping-row');
    rows[0].querySelector('select').value = 'Title';
    rows[0].querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('btn-generate').disabled).toBe(true); // Price still unmapped

    rows = document.querySelectorAll('.output-blueprint-mapping-row');
    rows[1].querySelector('select').value = 'Price';
    rows[1].querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('btn-generate').disabled).toBe(false);

    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/generate') && init?.method === 'POST');
    expect(generateCall).toBeDefined();
    const body = JSON.parse(generateCall[1].body);
    expect(body.outputBlueprint).toEqual({
      blueprintId: 1,
      fields: [
        { targetField: 'Title', sourceField: 'Title' },
        { targetField: 'Price', sourceField: 'Price' },
      ],
    });
  });

  test('picking "None" clears an already-picked mapping', async () => {
    const selectEl = document.getElementById('select-output-blueprint');
    selectEl.value = '1';
    selectEl.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(document.querySelectorAll('.output-blueprint-mapping-row')).toHaveLength(2);

    selectEl.value = '';
    selectEl.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.getElementById('output-blueprint-mapping').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-generate').disabled).toBe(false); // no longer blocked
  });

  test('switching mode clears a picked mapping', async () => {
    const selectEl = document.getElementById('select-output-blueprint');
    selectEl.value = '1';
    selectEl.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-mode-flat').click();

    expect(document.getElementById('select-output-blueprint').value).toBe('');
    expect(document.getElementById('output-blueprint-mapping').classList.contains('hidden')).toBe(true);
  });

  test('creating a new blueprint via the management modal posts it and refreshes the picker', async () => {
    document.getElementById('btn-manage-blueprints').click();
    expect(document.getElementById('modal-manage-blueprints').classList.contains('hidden')).toBe(false);

    document.getElementById('btn-blueprint-new').click();
    expect(document.getElementById('modal-blueprint-edit').classList.contains('hidden')).toBe(false);
    // openBlueprintCreateModal already seeds one blank field row — both the
    // name and that field are still blank at this point.
    expect(document.getElementById('btn-blueprint-edit-save').disabled).toBe(true);

    document.getElementById('input-blueprint-name').value = 'New blueprint';
    document.getElementById('input-blueprint-name').dispatchEvent(new Event('change'));

    const nameInput = document.querySelector('.blueprint-field-name-input');
    nameInput.value = 'Title';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('btn-blueprint-edit-save').disabled).toBe(false);

    document.getElementById('btn-blueprint-edit-save').click();
    await flushMicrotasks();

    const postCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/blueprints') && init?.method === 'POST');
    expect(postCall).toBeDefined();
    expect(JSON.parse(postCall[1].body)).toEqual({ name: 'New blueprint', fieldNames: ['Title'] });
    expect(document.getElementById('modal-blueprint-edit').classList.contains('hidden')).toBe(true);

    const options = [...document.querySelectorAll('#select-output-blueprint option')];
    expect(options.map((o) => o.value)).toEqual(['', '1', '2']);
  });

  test('editing an existing blueprint loads its fields, reorders one, and saves via PUT', async () => {
    document.getElementById('btn-manage-blueprints').click();
    document.querySelector('.btn-blueprint-edit').click();
    await flushMicrotasks();

    const inputs = document.querySelectorAll('.blueprint-field-name-input');
    expect([...inputs].map((i) => i.value)).toEqual(['Title', 'Price']);

    document.querySelectorAll('.blueprint-field-row')[1].querySelector('.btn-blueprint-field-move-up').click();
    const reordered = [...document.querySelectorAll('.blueprint-field-name-input')].map((i) => i.value);
    expect(reordered).toEqual(['Price', 'Title']);

    document.getElementById('btn-blueprint-edit-save').click();
    await flushMicrotasks();

    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/blueprints/1') && init?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(putCall[1].body)).toEqual({ name: 'Standard export', fieldNames: ['Price', 'Title'] });
  });

  test('deleting a blueprint asks for confirmation before sending DELETE', async () => {
    document.getElementById('btn-manage-blueprints').click();
    document.querySelector('.btn-blueprint-delete').click();

    expect(document.querySelector('.btn-blueprint-delete-confirm')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/blueprints/1') && init?.method === 'DELETE')).toBe(false);

    document.querySelector('.btn-blueprint-delete-confirm').click();
    await flushMicrotasks();

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/blueprints/1') && init?.method === 'DELETE')).toBe(true);
    const options = [...document.querySelectorAll('#select-output-blueprint option')];
    expect(options.map((o) => o.value)).toEqual(['']);
  });
});
