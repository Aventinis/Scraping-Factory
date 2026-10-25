const { byId, byIdOrNull, qs, qsOrNull, qsa, escapeHtml, parseDataPath } = require('./dom');

beforeEach(() => {
  document.body.innerHTML = '<input id="name" value="x"><ul id="list"><li class="row">a</li><li class="row">b</li></ul>';
});

describe('byId / byIdOrNull', () => {
  test('return the element, typed by the caller', () => {
    expect(byId('name').value).toBe('x');
    expect(byIdOrNull('name')).toBe(document.getElementById('name'));
  });

  test('a missing id is null for the optional lookup and a clear error for the required one', () => {
    expect(byIdOrNull('nope')).toBeNull();
    expect(() => byId('nope')).toThrow('Element #nope is missing from the popup markup');
  });
});

describe('qs / qsOrNull / qsa', () => {
  test('qs and qsOrNull find the first match, optionally inside a root', () => {
    expect(qs('.row').textContent).toBe('a');
    expect(qsOrNull('.nope')).toBeNull();
    expect(() => qs('.nope')).toThrow('No element matches ".nope"');
    expect(qs('.row', byId('list')).textContent).toBe('a');
  });

  test('qsa returns a real array', () => {
    const rows = qsa('.row');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map(r => r.textContent)).toEqual(['a', 'b']);
  });
});

describe('parseDataPath', () => {
  test('reads the JSON path a tree row carries', () => {
    document.body.innerHTML = '<li data-path="[0,2,1]"></li>';
    expect(parseDataPath(document.querySelector('li'))).toEqual([0, 2, 1]);
  });
});

describe('escapeHtml', () => {
  test('escapes the five characters that matter in text and attributes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  test('null and undefined are empty, other values are stringified', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});
