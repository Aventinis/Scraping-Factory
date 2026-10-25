Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'screens', name), 'utf8');
const $ = (id) => document.getElementById(id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Issue #506: Edit on the API panel reopens the applied configuration, in the real popup with the real idle / API / modal markup.
describe('reopening an applied API configuration', () => {
  let buildApiConfigFromDraft;
  let buildDraft;

  async function loadPopupWith({ withSnapshot }) {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">${read('idle.html')}</section>
      <section id="screen-selecting" class="hidden"><button id="btn-cancel-selection"></button></section>
      <section id="screen-api-config" class="hidden">${read('api-config.html')}</section>
      ${read('modals.html')}`;
    ({ buildApiConfigFromDraft } = require('./api-config-reopen'));
    const { parseUrlTemplateParts, buildApiGroupDraft, buildApiFieldDraft } = require('./api-config');
    buildDraft = () => ({
      sourceUrl: 'http://example.test/api/catalog',
      urlParts: parseUrlTemplateParts('http://example.test/api/catalog'),
      groups: [{ ...buildApiGroupDraft('Produkte', 'items'), children: [buildApiFieldDraft('Titel', 'title', null, 'Smartphone X')] }],
      capturedHeaders: [], parameterSources: {}, headerDecisions: {}, method: 'GET',
      bodyTree: null, bodyParameters: [], nextBodyParameterSeq: 0, embeddedJsonSource: null,
    });
    const applied = buildDraft();
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        local: { get: jest.fn().mockResolvedValue({ language: 'en' }), set: jest.fn() },
        session: {
          get: jest.fn().mockResolvedValue({
            url: 'https://example.com', mode: 'api',
            apiConfig: JSON.parse(JSON.stringify(buildApiConfigFromDraft(applied))),
            ...(withSnapshot ? { apiConfigApplied: JSON.parse(JSON.stringify(applied)) } : {}),
          }),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flush();
    await flush();
  }

  const persisted = (key) => chrome.storage.session.set.mock.calls.map(c => c[0]).filter(c => key in c).pop()?.[key];
  const rename = (value) => {
    const input = document.querySelector('#api-tree-root .api-tree-name');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const treeNames = () => [...document.querySelectorAll('#api-tree-root .api-tree-name')].map(i => i.value);

  describe('with the draft kept by Apply', () => {
    beforeEach(async () => { await loadPopupWith({ withSnapshot: true }); });

    test('the panel offers Edit and not the "loaded" hint', () => {
      expect($('api-config-panel').classList.contains('hidden')).toBe(false);
      expect($('btn-api-config-edit').classList.contains('hidden')).toBe(false);
      expect($('btn-api-config-edit').textContent).toBe('Edit');
      expect($('api-config-not-editable').classList.contains('hidden')).toBe(true);
    });

    test('Edit reopens the API screen with the tree exactly as it was applied', () => {
      $('btn-api-config-edit').click();
      expect($('screen-api-config').classList.contains('hidden')).toBe(false);
      expect($('screen-idle').classList.contains('hidden')).toBe(true);
      expect(treeNames()).toEqual(['Produkte', 'Titel']);
      expect($('btn-api-config-confirm').disabled).toBe(false);
    });

    test('Apply after an edit replaces the confirmed configuration and the snapshot', () => {
      $('btn-api-config-edit').click();
      rename('Produkte neu');
      $('btn-api-config-confirm').click();

      expect($('screen-idle').classList.contains('hidden')).toBe(false);
      expect(persisted('apiConfig').groups[0].name).toBe('Produkte neu');
      expect(persisted('apiConfigApplied').groups[0].name).toBe('Produkte neu');
      expect(persisted('apiConfigDraft')).toBeNull();
      expect($('btn-api-config-edit').classList.contains('hidden')).toBe(false); // can be reopened again
    });

    test('Cancel leaves the earlier configuration and its snapshot unchanged', () => {
      $('btn-api-config-edit').click();
      rename('Wird verworfen');
      $('btn-api-config-cancel').click();

      expect($('screen-idle').classList.contains('hidden')).toBe(false);
      expect(persisted('apiConfigDraft')).toBeNull();
      expect(persisted('apiConfig').groups[0].name).toBe('Produkte');
      expect(persisted('apiConfigApplied').groups[0].name).toBe('Produkte');
      $('btn-api-config-edit').click();
      expect(treeNames()).toEqual(['Produkte', 'Titel']); // the discarded edit is gone
    });

    test('Discard still drops everything, snapshot included', () => {
      $('btn-api-config-discard').click();
      expect($('api-config-panel').classList.contains('hidden')).toBe(true);
      expect(persisted('apiConfig')).toBeNull();
      expect(persisted('apiConfigApplied')).toBeNull();
    });
  });

  describe('with a configuration that was loaded (no draft)', () => {
    beforeEach(async () => { await loadPopupWith({ withSnapshot: false }); });

    test('Edit is not offered and a hint says why; Discard still works', () => {
      expect($('api-config-panel').classList.contains('hidden')).toBe(false);
      expect($('btn-api-config-edit').classList.contains('hidden')).toBe(true);
      expect($('api-config-not-editable').classList.contains('hidden')).toBe(false);
      $('btn-api-config-discard').click();
      expect($('api-config-panel').classList.contains('hidden')).toBe(true);
    });
  });
});
