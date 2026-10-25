Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'screens', name), 'utf8');
const $ = (id) => document.getElementById(id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Issue #505: the field dialogs reopened on an existing field, in the real popup with the real idle / modals markup.
describe('editing a field after it was created', () => {
  async function loadPopupWith(stored) {
    jest.resetModules();
    document.body.innerHTML = `<section id="screen-idle" class="hidden">${read('idle.html')}</section>${read('modals.html')}`;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        local: { get: jest.fn().mockResolvedValue({ language: 'en' }), set: jest.fn() },
        session: {
          get: jest.fn().mockResolvedValue({ url: 'https://example.com', ...stored }),
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

  const lastPersisted = () => {
    const calls = chrome.storage.session.set.mock.calls;
    return calls[calls.length - 1][0];
  };
  const typeInto = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };

  const FLAT = [
    { name: 'Preis', selector: '.price', attribute: null, framePath: null, transforms: [{ kind: 'trim' }], download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false, sampleValue: ' 12,50 € ' },
    { name: 'Name', selector: '.name', attribute: null, framePath: null, transforms: null, download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false },
  ];

  describe('flat mode', () => {
    beforeEach(async () => { await loadPopupWith({ mode: 'flat', fields: FLAT }); });

    test('each row has an Edit button; it opens the dialog prefilled with name and chain and no pick controls', () => {
      const rows = document.querySelectorAll('#fields-list .field-row');
      expect(rows[0].querySelector('.btn-edit-field').textContent).toBe('Edit');
      rows[0].querySelector('.btn-edit-field').click();

      expect($('modal-field-name').classList.contains('hidden')).toBe(false);
      expect($('input-field-name').value).toBe('Preis');
      expect($('btn-field-confirm').textContent).toBe('Save');
      expect($('field-name-mode-section').classList.contains('hidden')).toBe(true);
      expect($('field-name-text-filter-row').classList.contains('hidden')).toBe(true);
      expect(document.querySelectorAll('#field-transform-list li')).toHaveLength(1);
      expect($('field-transform-preview').textContent).not.toBe(''); // the stored sample feeds the live preview
    });

    test('adding a step and saving changes the field in place and closes the dialog', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[0].click();
      $('btn-field-transform-add').click();
      typeInto($('input-field-name'), 'Preis (EUR)');
      $('btn-field-confirm').click();

      const fields = lastPersisted().fields;
      expect(fields.map(f => f.name)).toEqual(['Preis (EUR)', 'Name']);
      expect(fields[0]).toMatchObject({ selector: '.price', transforms: [{ kind: 'trim' }, { kind: 'trim' }] });
      expect($('modal-field-name').classList.contains('hidden')).toBe(true);
      expect(document.querySelectorAll('#fields-list .field-row')).toHaveLength(2);
    });

    test('the name typed in the dialog survives a transform-row re-render', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[0].click();
      typeInto($('input-field-name'), 'Kosten');
      $('btn-field-transform-add').click();
      expect($('input-field-name').value).toBe('Kosten');
    });

    test('Cancel leaves the field untouched', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[1].click();
      $('btn-field-transform-add').click();
      typeInto($('input-field-name'), 'Etwas anderes');
      $('btn-field-cancel').click();

      expect($('modal-field-name').classList.contains('hidden')).toBe(true);
      const persisted = chrome.storage.session.set.mock.calls.map(c => c[0].fields).filter(Boolean).pop();
      expect(persisted.map(f => f.name)).toEqual(['Preis', 'Name']);
      expect(persisted[1].transforms).toBeNull();
    });

    test('an invalid chain (blank regex) blocks Save; an empty name too', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[1].click();
      $('btn-field-transform-add').click();
      typeInto(document.querySelector('#field-transform-list select'), 'regexExtract');
      $('btn-field-confirm').click();
      expect($('modal-field-name').classList.contains('hidden')).toBe(false);

      typeInto($('input-field-name'), '');
      $('btn-field-confirm').click();
      expect($('modal-field-name').classList.contains('hidden')).toBe(false);
    });

    test('a field without a stored sample shows no preview', async () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[1].click();
      $('btn-field-transform-add').click();
      expect($('field-transform-preview').classList.contains('hidden')).toBe(true);
    });
  });

  describe('flat mode with combine / split fields', () => {
    const DERIVED = [
      { ...FLAT[0], name: 'Vorname' },
      { ...FLAT[1], name: 'Nachname' },
      { name: 'Voller Name', selector: null, attribute: null, framePath: null, transforms: [{ kind: 'combineFields', sourceFieldNames: ['Vorname', 'Nachname'], separator: ' ' }], download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false },
    ];
    beforeEach(async () => { await loadPopupWith({ mode: 'flat', fields: DERIVED }); });

    test('a source of a combine field cannot be renamed: the name is locked with a hint', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[0].click();
      expect($('input-field-name').disabled).toBe(true);
      expect($('field-name-edit-hint').classList.contains('hidden')).toBe(false);
      $('btn-field-cancel').click();

      document.querySelectorAll('#fields-list .btn-edit-field')[2].click();
      expect($('input-combine-field-name').disabled).toBe(false);
    });

    test('Edit on the combine field opens the combine dialog prefilled; Save replaces it in place', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[2].click();

      expect($('modal-field-name').classList.contains('hidden')).toBe(true);
      expect($('modal-combine-field').classList.contains('hidden')).toBe(false);
      expect($('input-combine-field-name').value).toBe('Voller Name');
      expect($('btn-combine-field-confirm').textContent).toBe('Save');
      expect($('combine-field-remove-toggle-row').classList.contains('hidden')).toBe(true);
      const boxes = [...document.querySelectorAll('.combine-field-source-checkbox')];
      expect(boxes.map(b => [b.dataset.fieldName, b.checked])).toEqual([['Vorname', true], ['Nachname', true]]); // only predecessors

      typeInto($('input-combine-field-separator'), ', ');
      $('btn-combine-field-confirm').click();
      const fields = lastPersisted().fields;
      expect(fields).toHaveLength(3);
      expect(fields[2]).toMatchObject({ name: 'Voller Name', selector: null, transforms: [{ kind: 'combineFields', sourceFieldNames: ['Vorname', 'Nachname'], separator: ', ' }] });
    });

    test('opening the combine dialog for a new field afterwards starts blank again', () => {
      document.querySelectorAll('#fields-list .btn-edit-field')[2].click();
      $('btn-combine-field-cancel').click();
      $('btn-add-combine-field').click();
      expect($('input-combine-field-name').value).toBe('');
      expect($('btn-combine-field-confirm').textContent).toBe('Add');
      expect($('combine-field-remove-toggle-row').classList.contains('hidden')).toBe(false);
    });
  });

  describe('container mode', () => {
    const GROUPS = [{
      kind: 'group', name: 'Gericht', selector: '.dish', repeating: true, framePath: null,
      children: [
        { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null, framePath: null, transforms: [{ kind: 'trim' }], download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false, sampleValue: ' 9,90 ' },
        { kind: 'field', name: 'Neu', selector: '.new', mode: 'exists', attribute: null, framePath: null, transforms: null, download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false },
      ],
    }];
    beforeEach(async () => { await loadPopupWith({ mode: 'container', groups: GROUPS }); });

    test('only field rows get an Edit button, and it opens the extended dialog prefilled', () => {
      const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
      expect(rows[0].querySelector('.btn-edit-field')).toBeNull(); // the group
      rows[1].querySelector('.btn-edit-field').click();

      expect($('modal-field-extended').classList.contains('hidden')).toBe(false);
      expect($('input-field-extended-name').value).toBe('Preis');
      expect($('btn-field-extended-confirm').textContent).toBe('Save');
      expect($('field-extended-mode-section').classList.contains('hidden')).toBe(true);
      expect($('field-extended-text-filter-row').classList.contains('hidden')).toBe(true);
      expect(document.querySelectorAll('#field-extended-transform-list li')).toHaveLength(1);
    });

    test('saving writes the new chain to the node at that path', () => {
      document.querySelectorAll('#group-tree-root .btn-edit-field')[0].click();
      $('btn-field-extended-transform-add').click();
      $('btn-field-extended-confirm').click();

      const node = lastPersisted().groups[0].children[0];
      expect(node).toMatchObject({ name: 'Preis', selector: '.price', transforms: [{ kind: 'trim' }, { kind: 'trim' }] });
      expect($('modal-field-extended').classList.contains('hidden')).toBe(true);
    });

    test('an "exists" field offers its name only: no chain editor', () => {
      document.querySelectorAll('#group-tree-root .btn-edit-field')[1].click();
      expect($('field-extended-transforms-section').classList.contains('hidden')).toBe(true);
    });

    test('Cancel leaves the node untouched', () => {
      document.querySelectorAll('#group-tree-root .btn-edit-field')[0].click();
      $('btn-field-extended-transform-add').click();
      $('btn-field-extended-cancel').click();
      const persisted = chrome.storage.session.set.mock.calls.map(c => c[0].groups).filter(Boolean).pop();
      expect(persisted[0].children[0].transforms).toEqual([{ kind: 'trim' }]);
    });
  });

  test('a field created from a pick remembers its raw value for later edits, and the wire never carries it', async () => {
    await loadPopupWith({ mode: 'flat', fields: [] });
    const { buildScrapingConfig } = require('./scraping-config-builder');
    const { addField } = require('./scraping-config-builder');
    const fields = addField([], 'Preis', '.price', { sampleValue: '9,90' });
    expect(fields[0].sampleValue).toBe('9,90');
    const config = buildScrapingConfig({ url: 'https://example.com', fields });
    expect(JSON.stringify(config)).not.toContain('sampleValue');
    expect(addField([], 'Preis', '.price')[0]).not.toHaveProperty('sampleValue');
  });
});
