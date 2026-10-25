// Issue #234: the extension side of "Convert price/currency to number" —
// toCurrencyPreview (the client-side mirror of the templates' _to_currency; its
// input/output table is test-vectors/transforms.json, run by transform-vectors.test.js
// and TransformVectorTests.cs), the chain integration, and the transform-editor row.
const {
  createDefaultTransform, changeTransformKind, transformsAreValid, applyTransformsPreview, toCurrencyPreview, CURRENCY_FORMAT_IDS,
} = require('./field-transforms');
const { renderTransformList, wireTransformList, renderTransformPreview } = require('./field-transforms-ui');

describe('toCurrencyPreview', () => {
  // The amount/format table lives in test-vectors/transforms.json (toCurrency cases), shared with the Python side.
  test('an unknown format falls back to the comma-decimal preset, like the runtime', () => {
    expect(toCurrencyPreview('1.234,56', 'nope')).toBe('1234.56');
  });
});

describe('toCurrency in the transform chain', () => {
  test('the default transform uses the comma-decimal preset and keeps the original on failure', () => {
    expect(createDefaultTransform('toCurrency')).toEqual({ kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' });
    expect(CURRENCY_FORMAT_IDS).toEqual(['1.234,56', '1,234.56', '1 234,56', "1'234.56"]);
  });

  test('is always valid (the format is chosen from a fixed list)', () => {
    expect(transformsAreValid([createDefaultTransform('toCurrency')])).toBe(true);
  });

  test('applies after earlier steps and honours onError', () => {
    expect(applyTransformsPreview('  ab 1.299,00 €  ', [{ kind: 'trim' }, { kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' }])).toBe('1299.00');
    expect(applyTransformsPreview('auf Anfrage', [{ kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' }])).toBe('auf Anfrage');
    expect(applyTransformsPreview('auf Anfrage', [{ kind: 'toCurrency', format: '1.234,56', onError: 'UseDefault', defaultValue: '0' }])).toBe('0');
  });
});

describe('toCurrency transform row', () => {
  let transforms;

  beforeEach(() => {
    document.body.innerHTML = '<ul id="list"></ul><p id="preview"></p>';
    transforms = [createDefaultTransform('trim')];
    const rerender = () => renderTransformList('list', transforms);
    wireTransformList('list', () => transforms, (next) => { transforms = next; rerender(); });
    rerender();
  });

  const row = () => document.querySelector('#list .transform-row');
  const change = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };

  test('is offered in the kind dropdown and reveals a format select plus the error behaviour', () => {
    const kindSelect = row().querySelector('.transform-kind-select');
    expect(Array.from(kindSelect.options).map(o => o.value)).toContain('toCurrency');

    change(kindSelect, 'toCurrency');

    const formatSelect = row().querySelector('.transform-currency-format-select');
    expect(Array.from(formatSelect.options).map(o => o.value)).toEqual(CURRENCY_FORMAT_IDS);
    expect(formatSelect.value).toBe('1.234,56');
    expect(row().querySelector('.transform-onerror-select')).not.toBeNull();
  });

  test('picking another format updates the transform and the live preview', () => {
    change(row().querySelector('.transform-kind-select'), 'toCurrency');
    change(row().querySelector('.transform-currency-format-select'), '1,234.56');

    expect(transforms).toEqual([{ kind: 'toCurrency', format: '1,234.56', onError: 'KeepOriginal', defaultValue: '' }]);
    expect(applyTransformsPreview('£1,299.99', transforms)).toBe('1299.99');
    renderTransformPreview('preview', '£1,299.99', transforms);
    const preview = document.getElementById('preview');
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(preview.classList.contains('warn')).toBe(false); // a real result, not "preview unavailable"
  });

  test('switching away from toCurrency drops its format', () => {
    change(row().querySelector('.transform-kind-select'), 'toCurrency');
    expect(changeTransformKind(transforms, 0, 'toInteger')[0]).not.toHaveProperty('format');
  });
});
