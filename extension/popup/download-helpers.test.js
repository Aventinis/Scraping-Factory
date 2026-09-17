Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

// jsdom's Blob doesn't implement .text() — read via FileReader instead.
function readBlobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

describe('downloadConfigExport (btn-export-config)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-generate" disabled></button>
        <button id="btn-export-config" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
      </section>
      <div id="modal-container-new" class="hidden">
        <input id="input-container-name" />
        <input type="radio" name="container-type" id="radio-container-single" checked />
        <input type="radio" name="container-type" id="radio-container-repeating" />
        <button id="btn-container-confirm"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
        getManifest: jest.fn().mockReturnValue({ version: '9.9.9-test' }),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/speisekarte' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com/speisekarte',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('is disabled with no fields, enabled once a field exists (flat mode)', () => {
    expect(document.getElementById('btn-export-config').disabled).toBe(false); // seeded with one field above
  });

  test('downloads a JSON file containing the exact /generate config plus export metadata', async () => {
    document.getElementById('btn-export-config').click();

    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = global.URL.createObjectURL.mock.calls[0][0];
    expect(blobArg.type).toBe('application/json');

    const text = await readBlobText(blobArg);
    const parsed = JSON.parse(text);

    expect(parsed.extensionVersion).toBe('9.9.9-test');
    expect(parsed.config).toEqual({
      version: '1',
      url: 'https://example.com/speisekarte',
      fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
      outputFormat: 'Csv',
      scriptFileName: null,
      outputFileName: null,
    });
  });

  test('exports groups instead of fields once a container has been added', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('radio-container-repeating').checked = true;
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    expect(document.getElementById('btn-export-config').disabled).toBe(false);

    document.getElementById('btn-export-config').click();
    const blobArg = global.URL.createObjectURL.mock.calls[0][0];
    const parsed = JSON.parse(await readBlobText(blobArg));

    expect(parsed.config).toEqual({
      version: '1',
      url: 'https://example.com/speisekarte',
      groups: [{ name: 'Vorspeisen', selector: 'section.menu-category', repeating: true, children: [] }],
      scriptFileName: null,
      outputFileName: null,
    });
  });
});

describe('download the full trial-run output (Issue #161)', () => {
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
      </section>
    `;

    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true }); // health check
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('the checkbox threads includeOutputFile into the /generate request', async () => {
    document.getElementById('toggle-include-output-file').checked = true;
    document.getElementById('toggle-include-output-file').dispatchEvent(new Event('change'));

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ script: '# script', outputFile: { fileName: 'output.csv', content: 'Titel\nA\n' } }),
    });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(generateCall[1].body);
    expect(body.includeOutputFile).toBe(true);
  });

  test('btn-download-output stays hidden when includeOutputFile was off', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(document.getElementById('btn-download-output').classList.contains('hidden')).toBe(true);
  });

  test('btn-download-output becomes visible with the output filename once includeOutputFile produced a file', async () => {
    document.getElementById('toggle-include-output-file').checked = true;
    document.getElementById('toggle-include-output-file').dispatchEvent(new Event('change'));

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ script: '# script', outputFile: { fileName: 'output.csv', content: 'Titel\nA\n' } }),
    });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const btn = document.getElementById('btn-download-output');
    expect(btn.classList.contains('hidden')).toBe(false);
    expect(btn.textContent).toContain('output.csv');
  });

  test('clicking btn-download-output downloads a blob with the exact output-file content', async () => {
    document.getElementById('toggle-include-output-file').checked = true;
    document.getElementById('toggle-include-output-file').dispatchEvent(new Event('change'));

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ script: '# script', outputFile: { fileName: 'output.csv', content: 'Titel\nA\nB\n' } }),
    });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const appendSpy = jest.spyOn(document.body, 'appendChild');
    document.getElementById('btn-download-output').click();

    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.download).toBe('output.csv');
    const blobArg = global.URL.createObjectURL.mock.calls[0][0];
    expect(blobArg.type).toBe('text/csv');
    expect(await readBlobText(blobArg)).toBe('Titel\nA\nB\n');
    appendSpy.mockRestore();
  });
});
