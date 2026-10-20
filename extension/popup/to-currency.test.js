// Issue #234: the extension side of "Convert price/currency to number" —
// toCurrencyPreview (the client-side mirror of the templates' _to_currency,
// which must reach the same result for the same input: the cases below are
// the same ones CurrencyTransformTests.cs runs through the real generated
// script), the chain integration, and the transform-editor row.
const {
  createDefaultTransform, changeTransformKind, transformsAreValid, applyTransformsPreview, toCurrencyPreview, CURRENCY_FORMAT_IDS,
} = require('./field-transforms');
const { renderTransformList, wireTransformList, renderTransformPreview } = require('./field-transforms-ui');

describe('toCurrencyPreview', () => {
  test.each([
    ['1.234,56', 'Preis: 1.234,56 €', '1234.56'],
    ['1.234,56', '€ 1.234', '1234'],
    ['1.234,56', '12,90 €', '12.90'],
    ['1.234,56', '-12,99 €', '-12.99'],
    ['1.234,56', '1.234.567,00 EUR', '1234567.00'],
    ['1.234,56', 'Preis: 12,99.', '12.99'],
    ['1,234.56', '£51.77', '51.77'],
    ['1,234.56', '$1,234,567.8', '1234567.8'],
    ['1,234.56', '+0005', '5'],
    ['1 234,56', '1 234,56 kr', '1234.56'],
    ['1 234,56', '1 234,56 €', '1234.56'],
    ['1 234,56', '1 234,56 €', '1234.56'],
    ["1'234.56", "CHF 1'234.50", '1234.50'],
    ["1'234.56", 'CHF 1’234.50', '1234.50'],
    ['1,234.56', '123456789012345678901234,5', null], // "," isn't a valid decimal separator here
    ['1.234,56', '123456789012345678901234,5', '123456789012345678901234.5'], // no float precision loss
  ])('%s: %j → %j', (format, raw, expected) => {
    expect(toCurrencyPreview(raw, format)).toBe(expected);
  });

  test.each([
    ['1.234,56', '12.99'], // "." groups thousands here, "99" isn't a 3-digit group
    ['1,234.56', '1,23,456'],
    ['1.234,56', 'kein Preis'],
    ['1.234,56', '1,2,3'],
  ])('%s: %j is a strict mismatch', (format, raw) => {
    expect(toCurrencyPreview(raw, format)).toBeNull();
  });

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
