// Issue #396: pure logic of the help popover (help-popover.js).
const {
  isValidHelpKey, getHelpEntry, collectHelpKeysFromHtml, collectHelpEntries,
  helpEntryProblems, helpEntryLengthWarnings, nextOpenHelpId, helpHostHtml,
  HELP_TEXT_MAX_CHARS, HELP_EXAMPLE_MAX_CHARS,
} = require('./help-popover');

describe('isValidHelpKey', () => {
  test('accepts help.<area>.<field> with camelCase segments', () => {
    expect(isValidHelpKey('help.requestHeaders.headers')).toBe(true);
    expect(isValidHelpKey('help.proxy.envVar')).toBe(true);
  });

  test.each([
    'help.proxy', 'help..x', 'help.Proxy.envVar', 'proxy.envVar.x', 'help.a.b.c', 'help.a-b.c', '', null, undefined, 3,
  ])('rejects %p', (key) => {
    expect(isValidHelpKey(key)).toBe(false);
  });
});

describe('getHelpEntry', () => {
  // i18n.js's t() resolves a missing key to the key itself.
  const dictionary = { 'help.a.b.text': 'Text', 'help.a.b.example': 'x: 1', 'help.a.c.text': 'Only text' };
  const t = (key) => dictionary[key] ?? key;

  test('reads text and example', () => {
    expect(getHelpEntry(t, 'help.a.b')).toEqual({ text: 'Text', example: 'x: 1' });
  });

  test('the example is optional', () => {
    expect(getHelpEntry(t, 'help.a.c')).toEqual({ text: 'Only text', example: null });
  });

  test('a missing text means no entry', () => {
    expect(getHelpEntry(t, 'help.a.missing')).toBeNull();
  });
});

describe('collectHelpKeysFromHtml', () => {
  test('lists every data-help key once, in order', () => {
    const html = '<span data-help="help.a.b"></span> <span class="help-host" data-help="help.c.d"></span><i data-help="help.a.b"></i><b data-i18n="x"></b>';
    expect(collectHelpKeysFromHtml(html)).toEqual(['help.a.b', 'help.c.d']);
  });

  test('no hosts, no keys', () => {
    expect(collectHelpKeysFromHtml('<p data-i18n="idle.x"></p>')).toEqual([]);
  });
});

describe('collectHelpEntries', () => {
  test('flattens help.<area>.<field>', () => {
    const dictionary = { help: { a: { b: { text: 'T' }, c: { text: 'U', example: 'e' } }, d: { e: { text: 'V' } } } };
    expect(Object.keys(collectHelpEntries(dictionary))).toEqual(['help.a.b', 'help.a.c', 'help.d.e']);
  });

  test('a dictionary without help yields nothing', () => {
    expect(collectHelpEntries({})).toEqual({});
    expect(collectHelpEntries(null)).toEqual({});
  });
});

describe('helpEntryProblems', () => {
  test('a text, optionally with an example, is fine', () => {
    expect(helpEntryProblems('help.a.b', { text: 'T' })).toEqual([]);
    expect(helpEntryProblems('help.a.b', { text: 'T', example: 'e' })).toEqual([]);
  });

  test('reports a missing/blank text, a bad example and unknown properties', () => {
    expect(helpEntryProblems('help.a.b', {})).toEqual(['help.a.b: missing "text"']);
    expect(helpEntryProblems('help.a.b', { text: ' ' })).toEqual(['help.a.b: missing "text"']);
    expect(helpEntryProblems('help.a.b', { text: 'T', example: '' })).toHaveLength(1);
    expect(helpEntryProblems('help.a.b', { text: 'T', hint: 'x' })).toEqual(['help.a.b: unexpected property "hint"']);
  });

  test('reports a malformed key and a non-object entry', () => {
    expect(helpEntryProblems('help.a', 'plain string')).toHaveLength(2);
    expect(helpEntryProblems('help.a.b', null)).toEqual(['help.a.b: must be an object with a "text" string']);
  });
});

describe('helpEntryLengthWarnings', () => {
  test('warns above the limits, not at them', () => {
    expect(helpEntryLengthWarnings('help.a.b', { text: 'x'.repeat(HELP_TEXT_MAX_CHARS) })).toEqual([]);
    expect(helpEntryLengthWarnings('help.a.b', { text: 'x'.repeat(HELP_TEXT_MAX_CHARS + 1) })).toHaveLength(1);
    expect(helpEntryLengthWarnings('help.a.b', { text: 't', example: 'x'.repeat(HELP_EXAMPLE_MAX_CHARS + 1) })).toHaveLength(1);
  });
});

describe('nextOpenHelpId', () => {
  test('asking for the open one closes it; asking for another switches', () => {
    expect(nextOpenHelpId('a', 'a')).toBeNull();
    expect(nextOpenHelpId('a', 'b')).toBe('b');
    expect(nextOpenHelpId(null, 'b')).toBe('b');
  });
});

test('helpHostHtml escapes the key', () => {
  expect(helpHostHtml('help.a.b')).toBe('<span class="help-host" data-help="help.a.b"></span>');
  expect(helpHostHtml('x"y')).toContain('&quot;');
});
