Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'screens', name), 'utf8');
const $ = (id) => document.getElementById(id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Issue #510: the script and output file name fields stay empty, the defaults are their placeholders.
describe('script and output name placeholders', () => {
  let onMessage;

  async function loadPopupWith({ stored = {}, settings = {}, tabUrl = 'https://shop.example.com/menu' } = {}) {
    jest.resetModules();
    document.body.innerHTML = `<section id="screen-idle" class="hidden">${read('idle.html')}</section>${read('modals.html')}`;
    global.chrome = {
      runtime: { onMessage: { addListener: (fn) => { onMessage = fn; } }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: tabUrl }])) },
      storage: {
        local: {
          get: jest.fn().mockResolvedValue({ language: 'en', globalSettings: settings }),
          set: jest.fn(),
        },
        session: {
          get: jest.fn().mockResolvedValue({ mode: 'flat', ...stored }),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => null } });
    require('./popup');
    await flush();
    await flush();
  }

  const type = (id, value) => { const el = $(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };

  test('a fresh configuration: both fields empty, the defaults as placeholders ("From website")', async () => {
    await loadPopupWith({ settings: { scriptNameMode: 'hostname' } });
    expect($('input-script-filename').value).toBe('');
    expect($('input-script-filename').placeholder).toBe('shop_example_com');
    expect($('input-output-filename').value).toBe('');
    expect($('input-output-filename').placeholder).toBe('output');
  });

  test('the fixed script name and a custom output name are the placeholders after the setting changes', async () => {
    await loadPopupWith({ settings: { scriptNameMode: 'fixed', scriptNameFixed: 'my-default', outputNameMode: 'fixed', outputNameFixed: 'daily' } });
    expect($('input-script-filename').placeholder).toBe('my-default');
    expect($('input-output-filename').placeholder).toBe('daily');
    expect($('input-script-filename').value).toBe('');
  });

  test('"same as the script name": the output placeholder follows the script field live', async () => {
    await loadPopupWith({ settings: { scriptNameMode: 'hostname', outputNameMode: 'script' } });
    expect($('input-output-filename').placeholder).toBe('shop_example_com');
    type('input-script-filename', 'mein-skript');
    expect($('input-output-filename').placeholder).toBe('mein-skript');
    type('input-script-filename', '');
    expect($('input-output-filename').placeholder).toBe('shop_example_com');
  });

  test('typing needs no deleting first and is kept; clearing the field returns to the default', async () => {
    await loadPopupWith({ settings: { scriptNameMode: 'hostname' } });
    type('input-script-filename', 'eigener-name');
    expect($('input-script-filename').value).toBe('eigener-name');
    const stored = () => chrome.storage.session.set.mock.calls.map(c => c[0]).filter(c => 'scriptFileName' in c).pop().scriptFileName;
    expect(stored()).toBe('eigener-name');
    type('input-script-filename', '');
    expect(stored()).toBe('');
    expect($('input-script-filename').placeholder).toBe('shop_example_com');
  });

  test('names stored by an earlier version are real typed values and keep working', async () => {
    await loadPopupWith({ stored: { scriptFileName: 'shop_example_com', outputFileName: 'ergebnisse' }, settings: { scriptNameMode: 'hostname' } });
    expect($('input-script-filename').value).toBe('shop_example_com');
    expect($('input-output-filename').value).toBe('ergebnisse');
  });

  test('another site changes the placeholder, not the typed text', async () => {
    const stored = { scriptFileName: 'getippt', fields: [{ name: 'A', selector: '.a' }] };
    const settings = { scriptNameMode: 'hostname', outputNameMode: 'script' };

    await loadPopupWith({ stored, settings, tabUrl: 'https://other.org/page' });

    expect($('input-script-filename').value).toBe('getippt');
    type('input-script-filename', '');
    expect($('input-script-filename').placeholder).toBe('other_org');
    expect($('input-output-filename').placeholder).toBe('other_org');
  });

  test('the download button names the script after the default while the field is empty', async () => {
    await loadPopupWith({ settings: { scriptNameMode: 'hostname' }, stored: { fields: [{ name: 'A', selector: '.a' }] } });
    const { triggerDownload } = require('./download-helpers');
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    global.URL.revokeObjectURL = jest.fn();
    const anchors = [];
    const create = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => { const el = create(tag); if (tag === 'a') anchors.push(el); return el; });
    triggerDownload({ getState: () => ({ scriptText: 'x', scriptFileName: '', url: 'https://shop.example.com/menu' }) });
    expect(anchors[0].download).toBe('shop_example_com.py');
    jest.restoreAllMocks();
  });
});
