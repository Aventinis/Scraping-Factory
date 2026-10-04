// Issue #279: reusable transform-chain presets — pure logic
// (transform-presets.js) plus the wired-up popup: applying/saving a preset
// from the flat field modal's transform editor and managing presets on the
// Settings screen.
const {
  BUILTIN_TRANSFORM_PRESETS, allTransformPresets, applyTransformPreset, transformChainIsSaveable,
} = require('./transform-presets');

const SAVED = [{ id: 7, name: 'Semikolon weg', savedAt: '2026-10-04T00:00:00Z', transforms: [{ kind: 'trim' }, { kind: 'replace', find: ';', replacement: '' }] }];

describe('transform-presets.js', () => {
  test('built-ins come first, followed by the saved presets, with non-colliding ids', () => {
    const presets = allTransformPresets(SAVED, key => `T(${key})`);
    expect(presets.map(p => [p.id, p.name, p.builtin])).toEqual([
      ['builtin:price-comma-decimal', 'T(transformPresets.builtinPriceCommaDecimal)', true],
      ['builtin:price-dot-decimal', 'T(transformPresets.builtinPriceDotDecimal)', true],
      ['saved:7', 'Semikolon weg', false],
    ]);
    expect(presets[2].savedId).toBe(7);
  });

  test('the built-in price presets are trim + the currency conversion in each format', () => {
    expect(BUILTIN_TRANSFORM_PRESETS.map(p => p.transforms)).toEqual([
      [{ kind: 'trim' }, { kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' }],
      [{ kind: 'trim' }, { kind: 'toCurrency', format: '1,234.56', onError: 'KeepOriginal', defaultValue: '' }],
    ]);
  });

  test('no saved presets (companion unavailable) still yields the built-ins', () => {
    expect(allTransformPresets(null, k => k)).toHaveLength(2);
  });

  test('applying appends a copy of the steps, never replacing the existing chain', () => {
    const existing = [{ kind: 'regexExtract', pattern: '\\d+', group: 0 }];
    const result = applyTransformPreset(existing, SAVED[0]);
    expect(result).toEqual([existing[0], { kind: 'trim' }, { kind: 'replace', find: ';', replacement: '' }]);

    result[2].find = ',';
    expect(SAVED[0].transforms[1].find).toBe(';'); // editing the applied step never reaches the preset
  });

  test('a chain is saveable only when non-empty, complete, and free of combine/split steps', () => {
    expect(transformChainIsSaveable([{ kind: 'trim' }])).toBe(true);
    expect(transformChainIsSaveable([])).toBe(false);
    expect(transformChainIsSaveable([{ kind: 'regexExtract', pattern: '', group: 0 }])).toBe(false);
    expect(transformChainIsSaveable([{ kind: 'trim' }, { kind: 'combineFields', sourceFieldNames: ['a', 'b'], separator: ' ' }])).toBe(false);
    expect(transformChainIsSaveable([{ kind: 'splitField', sourceFieldName: 'a', separator: ' ', index: 0 }])).toBe(false);
  });
});

describe('transform presets in the real popup', () => {
  let capturedListener;
  let savedPresets;
  let presetsEndpointAvailable;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  // A tiny fake companion: /transform-presets is backed by `savedPresets`;
  // everything else answers 200 with an empty list.
  function fakeFetch(url, options = {}) {
    const method = options.method || 'GET';
    const path = new URL(url).pathname;
    if (path.startsWith('/transform-presets')) {
      if (!presetsEndpointAvailable) return Promise.resolve(jsonResponse(404, {}));
      if (method === 'GET') return Promise.resolve(jsonResponse(200, savedPresets));
      if (method === 'POST') {
        const { name, transforms } = JSON.parse(options.body);
        if (savedPresets.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          return Promise.resolve(jsonResponse(409, { error: `A preset named '${name}' already exists.` }));
        }
        const preset = { id: savedPresets.length + 100, name, savedAt: 'now', transforms };
        savedPresets = [...savedPresets, preset];
        return Promise.resolve(jsonResponse(201, preset));
      }
      const id = parseInt(path.split('/').pop(), 10);
      if (method === 'PUT') {
        const { name } = JSON.parse(options.body);
        savedPresets = savedPresets.map(p => (p.id === id ? { ...p, name } : p));
        return Promise.resolve(jsonResponse(200, { id, name }));
      }
      if (method === 'DELETE') {
        savedPresets = savedPresets.filter(p => p.id !== id);
        return Promise.resolve(jsonResponse(204, null));
      }
    }
    return Promise.resolve(jsonResponse(200, []));
  }

  async function loadPopup() {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <button id="btn-open-settings"></button>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden"><button id="btn-cancel-selection"></button></section>
      <section id="screen-settings" class="hidden">
        <button id="btn-close-settings"></button>
        <div id="transform-presets-list"></div>
        <p id="transform-presets-unavailable" class="hidden"></p>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <div class="field-transforms-section">
          <ul id="field-transform-list"></ul>
          <button type="button" id="btn-field-transform-add"></button>
          <div class="transform-preset-controls" data-preset-target="flat"></div>
          <p id="field-transform-preview" class="transform-preview hidden"></p>
        </div>
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: (fn) => { capturedListener = fn; } }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn(fakeFetch);
    require('./popup');
    await flushMicrotasks();
    await flushMicrotasks();
  }

  beforeEach(() => {
    savedPresets = [...SAVED];
    presetsEndpointAvailable = true;
  });

  function openFieldModal() {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', rawText: ' 1.299,00 € ' });
  }

  const controls = () => document.querySelector('#modal-field-name .transform-preset-controls');
  const applySelect = () => controls().querySelector('.transform-preset-apply-select');
  const transformKinds = () => Array.from(document.querySelectorAll('#field-transform-list .transform-kind-select')).map(s => s.value);
  const change = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };

  test('the apply dropdown lists the built-ins and the saved presets', async () => {
    await loadPopup();
    openFieldModal();

    expect(Array.from(applySelect().options).map(o => o.value)).toEqual(['', 'builtin:price-comma-decimal', 'builtin:price-dot-decimal', 'saved:7']);
  });

  test('applying a built-in preset appends its steps and resets the dropdown', async () => {
    await loadPopup();
    openFieldModal();
    document.getElementById('btn-field-transform-add').click(); // an existing step is kept

    change(applySelect(), 'builtin:price-comma-decimal');

    expect(transformKinds()).toEqual(['trim', 'trim', 'toCurrency']);
    expect(applySelect().value).toBe('');
  });

  test('saving the current chain as a preset POSTs it and offers it in the dropdown afterwards', async () => {
    await loadPopup();
    openFieldModal();
    change(applySelect(), 'builtin:price-dot-decimal');

    controls().querySelector('.btn-transform-preset-save').click();
    controls().querySelector('.transform-preset-name-input').value = 'Mein Preis';
    controls().querySelector('.btn-transform-preset-save-confirm').click();
    await flushMicrotasks();
    await flushMicrotasks();

    const post = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(post[1].body)).toEqual({
      name: 'Mein Preis',
      transforms: [{ kind: 'trim' }, { kind: 'toCurrency', format: '1,234.56', onError: 'KeepOriginal', defaultValue: '' }],
    });
    expect(controls().querySelector('.transform-preset-name-input')).toBeNull();
    expect(Array.from(applySelect().options).map(o => o.textContent)).toContain('Mein Preis');
  });

  test('a duplicate name shows the companion\'s error and keeps the form open', async () => {
    await loadPopup();
    openFieldModal();
    document.getElementById('btn-field-transform-add').click();

    controls().querySelector('.btn-transform-preset-save').click();
    controls().querySelector('.transform-preset-name-input').value = 'semikolon WEG';
    controls().querySelector('.btn-transform-preset-save-confirm').click();
    await flushMicrotasks();

    expect(document.getElementById('error-toast-message').textContent).toContain("already exists");
    expect(controls().querySelector('.transform-preset-name-input')).not.toBeNull();
  });

  test('"Save as preset" is disabled for an empty chain', async () => {
    await loadPopup();
    openFieldModal();

    expect(controls().querySelector('.btn-transform-preset-save').disabled).toBe(true);
    document.getElementById('btn-field-transform-add').click();
    expect(controls().querySelector('.btn-transform-preset-save').disabled).toBe(false);
  });

  test('typing a preset name survives an unrelated re-render', async () => {
    await loadPopup();
    openFieldModal();
    document.getElementById('btn-field-transform-add').click();
    controls().querySelector('.btn-transform-preset-save').click();
    controls().querySelector('.transform-preset-name-input').value = 'Halb getippt';

    change(document.querySelector('#field-transform-list .transform-kind-select'), 'toNumber'); // re-renders the modal

    expect(controls().querySelector('.transform-preset-name-input').value).toBe('Halb getippt');
  });

  test('cancelling the field modal closes an open save form for next time', async () => {
    await loadPopup();
    openFieldModal();
    document.getElementById('btn-field-transform-add').click();
    controls().querySelector('.btn-transform-preset-save').click();

    document.getElementById('btn-field-cancel').click();
    openFieldModal();

    expect(controls().querySelector('.transform-preset-name-input')).toBeNull();
  });

  test('without the companion endpoint only built-ins are offered and saving is disabled', async () => {
    presetsEndpointAvailable = false;
    await loadPopup();
    openFieldModal();
    document.getElementById('btn-field-transform-add').click();

    expect(Array.from(applySelect().options).map(o => o.value)).toEqual(['', 'builtin:price-comma-decimal', 'builtin:price-dot-decimal']);
    expect(controls().querySelector('.btn-transform-preset-save').disabled).toBe(true);
  });

  describe('Settings: managing presets', () => {
    async function openSettings() {
      await loadPopup();
      document.getElementById('btn-open-settings').click();
    }

    const rows = () => Array.from(document.querySelectorAll('#transform-presets-list .transform-preset-row'));

    test('lists built-ins read-only and saved presets with a step summary and actions', async () => {
      await openSettings();

      expect(rows()).toHaveLength(3);
      expect(rows()[0].querySelector('button')).toBeNull();
      expect(rows()[2].querySelector('.transform-preset-name').textContent).toBe('Semikolon weg');
      expect(rows()[2].querySelector('.transform-preset-summary').textContent).toContain('→');
      expect(rows()[2].querySelector('.btn-transform-preset-rename')).not.toBeNull();
    });

    test('rename sends a PUT and shows the new name', async () => {
      await openSettings();
      rows()[2].querySelector('.btn-transform-preset-rename').click();
      rows()[2].querySelector('.transform-preset-rename-input').value = 'Ohne Semikolon';
      rows()[2].querySelector('.btn-transform-preset-rename-confirm').click();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(fetch.mock.calls.some(([url, o]) => o?.method === 'PUT' && url.endsWith('/transform-presets/7'))).toBe(true);
      expect(rows()[2].querySelector('.transform-preset-name').textContent).toBe('Ohne Semikolon');
    });

    test('delete asks for confirmation first, then removes the preset', async () => {
      await openSettings();
      rows()[2].querySelector('.btn-transform-preset-delete').click();
      expect(fetch.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);

      rows()[2].querySelector('.btn-transform-preset-delete-yes').click();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(rows()).toHaveLength(2);
    });

    test('shows the unavailable hint when the companion has no presets endpoint', async () => {
      presetsEndpointAvailable = false;
      await openSettings();

      expect(document.getElementById('transform-presets-unavailable').classList.contains('hidden')).toBe(false);
      expect(rows()).toHaveLength(2);
    });
  });
});
