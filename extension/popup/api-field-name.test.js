require('./test-support/popup-env');
const { deriveApiFieldName, collectApiTreeNames } = require('./api-field-name');
const { renderApiCandidates, wireApiCandidateListEvents } = require('./api-capture-ui');

describe('deriveApiFieldName', () => {
  test('takes the last key of the path', () => {
    expect(deriveApiFieldName('price', [], 'Field')).toBe('price');
    expect(deriveApiFieldName('details.price', [], 'Field')).toBe('price');
  });

  test('an array index does not count as a name: the key before it is taken', () => {
    expect(deriveApiFieldName('tags[0]', [], 'Field')).toBe('tags');
  });

  test('falls back to the generic name when the path has no key at all', () => {
    expect(deriveApiFieldName('[0]', [], 'Field')).toBe('Field');
    expect(deriveApiFieldName('', [], 'Field')).toBe('Field');
    expect(deriveApiFieldName(null, [], 'Field')).toBe('Field');
  });

  test('appends a counter while the name is taken', () => {
    expect(deriveApiFieldName('price', ['price'], 'Field')).toBe('price_2');
    expect(deriveApiFieldName('price', ['price', 'price_2'], 'Field')).toBe('price_3');
    expect(deriveApiFieldName('price', ['price_2'], 'Field')).toBe('price');
  });

  test('the generic fallback is made unique too', () => {
    expect(deriveApiFieldName('[0]', ['Field'], 'Field')).toBe('Field_2');
  });

  test('compares names exactly, as the companion does', () => {
    expect(deriveApiFieldName('price', ['Price'], 'Field')).toBe('price');
  });
});

describe('collectApiTreeNames', () => {
  test('collects groups and fields on every level', () => {
    const tree = [
      { kind: 'group', name: 'cats', path: 'cats', children: [
        { kind: 'field', name: 'name', path: 'name' },
        { kind: 'group', name: 'subs', path: 'subs', children: [{ kind: 'field', name: 'name', path: 'name' }] },
      ] },
      { kind: 'field', name: 'id', path: 'id' },
    ];
    expect(collectApiTreeNames(tree)).toEqual(['cats', 'name', 'subs', 'name', 'id']);
    expect(collectApiTreeNames([])).toEqual([]);
  });
});

describe('candidate list: "Use" with an empty field name', () => {
  const candidate = (valuePath, extra = {}) => ({
    url: 'http://x/api', method: 'GET', path: `items[2].${valuePath}`, value: 9, siblings: [],
    itemsPath: 'items', valuePath, treeSkeleton: [{ path: 'items' }, { path: valuePath }], ...extra,
  });

  let candidates;
  let taken;
  let confirmed;

  const setup = (list, takenNames = []) => {
    candidates = list;
    taken = takenNames;
    confirmed = [];
    document.body.innerHTML = '<p id="t"></p><ul id="list"></ul>';
    renderApiCandidates({ target: 'x', candidates }, { targetEl: 't', listEl: 'list' }, taken);
    wireApiCandidateListEvents('list', () => candidates, () => taken, (c, name, siblings) => confirmed.push({ name, siblings }));
  };

  test('Use is enabled without a typed name and the placeholder shows the derived name', () => {
    setup([candidate('price')]);
    expect(document.querySelector('.api-candidate-confirm').disabled).toBe(false);
    expect(document.querySelector('.api-candidate-field-name').placeholder).toBe('price');
  });

  test('an empty input confirms with the derived name', () => {
    setup([candidate('price')]);
    document.querySelector('.api-candidate-confirm').click();
    expect(confirmed).toEqual([{ name: 'price', siblings: [] }]);
  });

  test('a typed name wins, even when it is already taken', () => {
    setup([candidate('price')], ['price']);
    document.querySelector('.api-candidate-field-name').value = '  Preis ';
    document.querySelector('.api-candidate-confirm').click();
    expect(confirmed[0].name).toBe('Preis');
  });

  test('names already in the tree get a counter, in the placeholder and on confirm', () => {
    setup([candidate('price')], ['price']);
    expect(document.querySelector('.api-candidate-field-name').placeholder).toBe('price_2');
    document.querySelector('.api-candidate-confirm').click();
    expect(confirmed[0].name).toBe('price_2');
  });

  test('the tree is read at click time, so two clicks in a row never give the same name', () => {
    setup([candidate('price')]);
    document.querySelector('.api-candidate-confirm').click();
    taken = ['price'];
    document.querySelector('.api-candidate-confirm').click();
    expect(confirmed.map(c => c.name)).toEqual(['price', 'price_2']);
  });

  test('picked sibling chips count as taken', () => {
    setup([candidate('price', { siblings: [{ name: 'price_2', value: 1 }] })]);
    document.querySelector('.api-sibling-chip').click();
    taken = ['price'];
    document.querySelector('.api-candidate-confirm').click();
    expect(confirmed[0]).toEqual({ name: 'price_3', siblings: ['price_2'] });
  });
});
