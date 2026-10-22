// Issue #400: the regex "Pattern helper" panel and the date-format hint in the
// transform editor (transform-helpers-ui.js, wired through field-transforms-ui.js).
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

let renderTransformList;
let wireTransformList;
let state;
let raw;

async function mount(transforms, rawValue = 'Preis: 12,99 € netto') {
  jest.resetModules();
  document.body.innerHTML = '<ul id="list"></ul>';
  global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
  await require('../i18n/i18n').setLanguage('en');
  ({ renderTransformList, wireTransformList } = require('./field-transforms-ui'));
  state = { transforms };
  raw = rawValue;
  const rerender = () => renderTransformList('list', state.transforms, () => raw);
  const setTransforms = jest.fn((next) => { state.transforms = next; rerender(); });
  wireTransformList('list', () => state.transforms, setTransforms, () => raw);
  rerender();
  return { setTransforms, rerender };
}

afterEach(() => { delete global.chrome; document.body.innerHTML = ''; });

const REGEX_ROW = { kind: 'regexExtract', pattern: '', group: 0 };
const $ = (selector) => document.querySelector(selector);
const panel = () => $('.transform-helper-panel');
const preview = () => $('.transform-recipe-preview');

function pickRecipe(id) {
  const select = $('.transform-recipe-select');
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
function typeArg(index, text) {
  const input = document.querySelectorAll('.transform-recipe-arg')[index];
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('regex rows', () => {
  test('a Regex extract row gets a "Pattern helper" button and the "?" popover; other kinds do not', async () => {
    await mount([REGEX_ROW, { kind: 'trim' }]);
    const rows = document.querySelectorAll('.transform-row');
    expect(rows[0].querySelector('.btn-transform-helper-toggle').textContent).toBe('Pattern helper');
    expect(rows[0].querySelector('.help-host').dataset.help).toBe('help.transforms.regex');
    expect(rows[1].querySelector('.btn-transform-helper-toggle')).toBeNull();
    expect($('.transform-pattern-input').placeholder).toBe('Pattern (advanced)');
    expect($('.transform-group-input').placeholder).toBe('Part to keep (0 = whole match)');
  });

  test('the button opens the panel right under its row, and closes it again', async () => {
    await mount([REGEX_ROW, { kind: 'trim' }]);
    $('.btn-transform-helper-toggle').click();
    expect(panel()).not.toBeNull();
    expect(panel().previousElementSibling).toBe(document.querySelector('.transform-row'));
    expect(panel().querySelectorAll('.transform-recipe-select option')).toHaveLength(7); // placeholder + 6 recipes
    $('.btn-transform-helper-toggle').click();
    expect(panel()).toBeNull();
  });

  test('"Text after …": asks for one text, shows the result on the real value as you type, and only then writes the pattern', async () => {
    const { setTransforms } = await mount([REGEX_ROW]);
    $('.btn-transform-helper-toggle').click();
    expect($('.btn-transform-recipe-use').disabled).toBe(true);
    expect(preview().classList.contains('hidden')).toBe(true);

    pickRecipe('textAfter');
    expect(document.querySelectorAll('.transform-recipe-arg')).toHaveLength(1);
    expect(preview().textContent).toBe('Enter the text first.');
    expect($('.btn-transform-recipe-use').disabled).toBe(true);

    typeArg(0, 'Preis:');
    expect(preview().textContent).toBe('Result on your value: 12,99 € netto');
    expect($('.btn-transform-recipe-use').disabled).toBe(false);
    expect(setTransforms).not.toHaveBeenCalled(); // typing in the panel never touches the transform (or re-renders the list)

    $('.btn-transform-recipe-use').click();
    expect(setTransforms).toHaveBeenCalledTimes(1);
    expect(state.transforms[0]).toEqual({ kind: 'regexExtract', pattern: 'Preis:\\s*(.+)', group: 1 });
    expect($('.transform-pattern-input').value).toBe('Preis:\\s*(.+)');   // the pattern stays editable in the normal input
    expect($('.transform-group-input').value).toBe('1');
    expect(panel()).toBeNull();                                          // the panel closes with the re-render
  });

  test('text with regex metacharacters is taken literally', async () => {
    await mount([REGEX_ROW], 'Art.-Nr. 4711 (A+B)');
    $('.btn-transform-helper-toggle').click();
    pickRecipe('textAfter');
    typeArg(0, 'Art.-Nr.');
    expect(preview().textContent).toBe('Result on your value: 4711 (A+B)');
    typeArg(0, 'ArtX-Nr.');
    expect(preview().textContent).toBe('No match on your value — adjust the text.');
    expect(preview().classList.contains('warn')).toBe(true);
  });

  test('"Text between … and …" asks for two texts', async () => {
    await mount([REGEX_ROW], 'Müller (Berlin) GmbH');
    $('.btn-transform-helper-toggle').click();
    pickRecipe('textBetween');
    expect(document.querySelectorAll('.transform-recipe-arg')).toHaveLength(2);
    typeArg(0, '(');
    expect($('.btn-transform-recipe-use').disabled).toBe(true);   // the second text is still missing
    typeArg(1, ')');
    expect(preview().textContent).toBe('Result on your value: Berlin');
    $('.btn-transform-recipe-use').click();
    expect(state.transforms[0].group).toBe(1);
  });

  test('"First number" and "Text inside brackets" need no typing; brackets offers the four kinds', async () => {
    await mount([REGEX_ROW], 'Tag [gelb] ab 12.5 EUR');
    $('.btn-transform-helper-toggle').click();
    pickRecipe('firstNumber');
    expect(document.querySelectorAll('.transform-recipe-arg')).toHaveLength(0);
    expect(preview().textContent).toBe('Result on your value: 12.5');
    expect($('.btn-transform-recipe-use').disabled).toBe(false);

    pickRecipe('brackets');
    const kind = $('.transform-recipe-arg');
    expect(kind.tagName).toBe('SELECT');
    expect(Array.from(kind.options).map((o) => o.value)).toEqual(['(', '[', '{', '<']);
    expect(preview().classList.contains('warn')).toBe(true);        // no round brackets in this value
    kind.value = '[';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    expect(preview().textContent).toBe('Result on your value: gelb');
  });

  test('without a picked value there is nothing to preview, but the recipe can still be used', async () => {
    await mount([REGEX_ROW], null);
    $('.btn-transform-helper-toggle').click();
    pickRecipe('digits');
    expect(preview().textContent).toBe('Pick an element with a value first to see the result.');
    expect($('.btn-transform-recipe-use').disabled).toBe(false);
  });

  test('the value is read when the panel updates (a changed attribute is followed)', async () => {
    await mount([REGEX_ROW], 'erst 1');
    $('.btn-transform-helper-toggle').click();
    pickRecipe('digits');
    expect(preview().textContent).toBe('Result on your value: 1');
    raw = 'dann 22';
    pickRecipe('digits'); // any panel edit refreshes the preview from the current value
    expect(preview().textContent).toBe('Result on your value: 22');
  });

  test('Cancel closes the panel without touching the transform', async () => {
    const { setTransforms } = await mount([REGEX_ROW]);
    $('.btn-transform-helper-toggle').click();
    pickRecipe('digits');
    $('.btn-transform-recipe-cancel').click();
    expect(panel()).toBeNull();
    expect(setTransforms).not.toHaveBeenCalled();
    expect(state.transforms[0]).toEqual(REGEX_ROW);
  });

  test('the recipe lands on the right row when several rows exist', async () => {
    await mount([{ kind: 'trim' }, REGEX_ROW, { kind: 'regexExtract', pattern: 'x', group: 0 }]);
    document.querySelectorAll('.btn-transform-helper-toggle')[1].click(); // the third row's helper
    pickRecipe('digits');
    $('.btn-transform-recipe-use').click();
    expect(state.transforms.map((t) => t.pattern)).toEqual([undefined, '', '\\d+']);
  });

  test("the existing row events still work (a hand-typed pattern, the kind select)", async () => {
    await mount([REGEX_ROW]);
    const input = $('.transform-pattern-input');
    input.value = '\\d+';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.transforms[0].pattern).toBe('\\d+');
  });
});

describe('date rows', () => {
  const DATE_ROW = { kind: 'toDate', sourceFormat: '{yyyy}-{mm}-{dd}', onError: 'KeepOriginal', defaultValue: '' };
  const hint = () => $('.transform-date-hint');

  test('selecting "Convert to date" pre-selects the format guessed from the picked value', async () => {
    await mount([{ kind: 'trim' }], '28.08.2026');
    const select = $('.transform-kind-select');
    select.value = 'toDate';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.transforms[0].kind).toBe('toDate');
    expect(state.transforms[0].sourceFormat).toBe('{dd}.{mm}.{yyyy}');
    expect($('.transform-source-format-input').value).toBe('{dd}.{mm}.{yyyy}');
    expect(hint().textContent).toBe('Format detected from your value: {dd}.{mm}.{yyyy}');
  });

  test('a value that cannot be guessed keeps the default format', async () => {
    await mount([{ kind: 'trim' }], '28 Aug 2026');
    const select = $('.transform-kind-select');
    select.value = 'toDate';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.transforms[0].sourceFormat).toBe('{yyyy}-{mm}-{dd}');
    expect(hint().textContent).toContain("Couldn't guess the format");
  });

  test('an ambiguous day/month order names the other reading', async () => {
    await mount([{ kind: 'trim' }], '03/04/2026');
    const select = $('.transform-kind-select');
    select.value = 'toDate';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.transforms[0].sourceFormat).toBe('{dd}/{mm}/{yyyy}');
    expect(hint().textContent).toBe('Format detected from your value: {dd}/{mm}/{yyyy} (could also be {mm}/{dd}/{yyyy})');
  });

  test('when the user has chosen another format the hint says what the value looks like', async () => {
    await mount([{ ...DATE_ROW, sourceFormat: '{mm}.{dd}.{yyyy}' }], '28.08.2026');
    expect(hint().textContent).toBe('Your value looks like {dd}.{mm}.{yyyy}.');
  });

  test('no picked value: no hint; the "?" popover is always there', async () => {
    await mount([DATE_ROW], null);
    expect(hint()).toBeNull();
    expect($('.transform-row .help-host').dataset.help).toBe('help.transforms.dateFormat');
  });

  test('other kinds get neither helper', async () => {
    await mount([{ kind: 'trim' }, { kind: 'toNumber' }]);
    expect(document.querySelectorAll('.transform-row .help-host')).toHaveLength(0);
    expect($('.transform-date-hint')).toBeNull();
  });
});
