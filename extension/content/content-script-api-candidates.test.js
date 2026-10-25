const {
  findValueInJson,
  siblingFields,
  siblingFieldsAt,
  findApiCandidates,
  deriveItemsAndValuePath,
  deriveApiTreeSkeleton,
  scriptTagSelector,
  findEmbeddedJsonCandidates,
} = require('./content-script');

// ── API-Mode candidate correlation (Issue #53 Phase 4) ──────────────────────

describe('findValueInJson', () => {
  test('finds a scalar string match nested inside objects and arrays, with a dot/[n] path', () => {
    const data = { data: { items: [{ name: 'Suppe', price: 3.5 }, { name: 'Salat', price: 4 }] } };
    const matches = findValueInJson(data, 'Salat', []);
    expect(matches).toEqual([{ path: 'data.items[1].name', value: 'Salat' }]);
  });

  test('matches numbers/booleans via their string representation', () => {
    const data = { items: [{ price: 3.5 }, { inStock: true }] };
    expect(findValueInJson(data, '3.5', [])).toEqual([{ path: 'items[0].price', value: 3.5 }]);
    expect(findValueInJson(data, 'true', [])).toEqual([{ path: 'items[1].inStock', value: true }]);
  });

  test('trims whitespace on both the target and the search (a clicked element\'s textContent often has stray whitespace)', () => {
    const data = { name: 'Suppe' };
    expect(findValueInJson(data, '  Suppe  ', [])).toEqual([{ path: 'name', value: 'Suppe' }]);
  });

  test('returns every occurrence when the value appears more than once', () => {
    const data = { a: { x: 'Suppe' }, b: [{ x: 'Suppe' }] };
    const matches = findValueInJson(data, 'Suppe', []);
    expect(matches.map(m => m.path).sort()).toEqual(['a.x', 'b[0].x']);
  });

  test('never matches an object/array itself, only scalar leaves', () => {
    const data = { items: [{ name: 'x' }] };
    expect(findValueInJson(data, '[object Object]', [])).toEqual([]);
  });

  test('returns nothing for an empty/whitespace-only target', () => {
    expect(findValueInJson({ a: 'x' }, '   ', [])).toEqual([]);
  });
});

describe('siblingFields', () => {
  const data = { items: [{ name: 'Suppe', price: 3.5, tags: ['vegan'], meta: null }] };

  test('returns the other scalar keys of the object containing the match', () => {
    const siblings = siblingFields(data, 'items[0].name');
    expect(siblings).toEqual(expect.arrayContaining([
      { name: 'price', path: 'items[0].price', value: 3.5 },
    ]));
    expect(siblings.find(s => s.name === 'name')).toBeUndefined(); // excludes the matched key itself
  });

  test('excludes object/array-valued siblings (only flat fields are supported)', () => {
    const siblings = siblingFields(data, 'items[0].name');
    expect(siblings.find(s => s.name === 'tags')).toBeUndefined();
    expect(siblings.find(s => s.name === 'meta')).toBeUndefined(); // null is typeof 'object' too
  });

  test('a match that is itself a bare array element has no named siblings', () => {
    expect(siblingFields({ tags: ['vegan', 'scharf'] }, 'tags[0]')).toEqual([]);
  });

  test('a top-level match (no path) has no siblings', () => {
    expect(siblingFields({ a: 'x' }, '')).toEqual([]);
  });

  test('a match on a top-level key gets bare-path siblings (no leading dot)', () => {
    expect(siblingFields({ name: 'Suppe', price: 3.5 }, 'name')).toEqual([{ name: 'price', path: 'price', value: 3.5 }]);
  });
});

describe('siblingFieldsAt (Phase A3, ancestor-chain-aware)', () => {
  // Mirrors Phase 0's catalog fixture shape: categories[*] → subcategories[*]
  // → products[*], three independent repeating levels.
  const data = {
    categories: [
      { name: 'Elektronik', subcategories: [{ name: 'Telefone', products: [{ sku: 'P-100', title: 'Smartphone X' }] }] },
    ],
  };

  test('returns every scalar key of the object at a non-root scope, unlike siblingFields it does not exclude any key', () => {
    const siblings = siblingFieldsAt(data, ['categories', '[0]', 'subcategories', '[0]', 'products', '[0]']);
    expect(siblings).toEqual(expect.arrayContaining([
      { name: 'sku', path: 'categories[0].subcategories[0].products[0].sku', value: 'P-100' },
      { name: 'title', path: 'categories[0].subcategories[0].products[0].title', value: 'Smartphone X' },
    ]));
  });

  test('an intermediate group scope (not just a leaf record) also works', () => {
    const siblings = siblingFieldsAt(data, ['categories', '[0]']);
    expect(siblings).toEqual([{ name: 'name', path: 'categories[0].name', value: 'Elektronik' }]);
  });

  test('the root scope (empty tokens) returns bare-path siblings, no leading dot', () => {
    expect(siblingFieldsAt({ a: 'x', b: 1 }, [])).toEqual(expect.arrayContaining([
      { name: 'a', path: 'a', value: 'x' },
      { name: 'b', path: 'b', value: 1 },
    ]));
  });

  test('a scope that does not resolve to an object returns no siblings', () => {
    expect(siblingFieldsAt(data, ['categories', '[0]', 'subcategories', '[0]', 'products'])).toEqual([]);
  });
});

describe('findApiCandidates', () => {
  function entry(overrides) {
    return { id: 1, url: 'https://example.com/api', method: 'GET', status: 200, contentType: 'application/json', body: '{}', bodyTruncated: false, bodySkipped: false, ...overrides };
  }

  test('finds a candidate in a recorded JSON body, including sibling suggestions', () => {
    const entries = [entry({ body: JSON.stringify({ data: { items: [{ name: 'Suppe', price: 3.5 }] } }) })];
    const candidates = findApiCandidates(entries, 'Suppe');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ entryId: 1, url: 'https://example.com/api', method: 'GET', path: 'data.items[0].name', value: 'Suppe' });
    expect(candidates[0].siblings).toEqual([{ name: 'price', path: 'data.items[0].price', value: 3.5 }]);
  });

  test('attaches the derived itemsPath/valuePath (Issue #53 Phase 5) so the popup does not need to re-derive them', () => {
    const entries = [entry({ body: JSON.stringify({ data: { items: [{ name: 'Suppe', price: 3.5 }] } }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.itemsPath).toBe('data.items');
    expect(candidate.valuePath).toBe('name');
  });

  // Issue #54, Phase A5: popup.ts runs in a different execution context and
  // has no access to content-script.ts's own functions (deriveApiTreeSkeleton
  // included) — so, like itemsPath/valuePath above, the full tree skeleton is
  // pre-derived here and attached to the candidate message.
  test('attaches the derived treeSkeleton (Issue #54 Phase A5) so the popup does not need its own deriveApiTreeSkeleton', () => {
    const entries = [entry({ body: JSON.stringify({ categories: [{ subcategories: [{ products: [{ title: 'Suppe' }] }] }] }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.treeSkeleton).toEqual([
      { kind: 'group', path: 'categories' },
      { kind: 'group', path: 'subcategories' },
      { kind: 'group', path: 'products' },
      { kind: 'field', path: 'title' },
    ]);
  });

  test('treeSkeleton is null when the match is not inside any array, same as itemsPath/valuePath', () => {
    const entries = [entry({ body: JSON.stringify({ meta: { name: 'Suppe' } }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.treeSkeleton).toBeNull();
  });

  test('itemsPath/valuePath are null when the match is not inside any array', () => {
    const entries = [entry({ body: JSON.stringify({ meta: { name: 'Suppe' } }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.itemsPath).toBeNull();
    expect(candidate.valuePath).toBeNull();
  });

  test('carries the source entry\'s requestHeaders through', () => {
    const entries = [entry({ body: JSON.stringify({ name: 'Suppe' }), requestHeaders: [{ name: 'Authorization', value: 'Bearer x' }] })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.requestHeaders).toEqual([{ name: 'Authorization', value: 'Bearer x' }]);
  });

  test('defaults requestHeaders to an empty array when the entry has none', () => {
    const entries = [entry({ body: JSON.stringify({ name: 'Suppe' }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.requestHeaders).toEqual([]);
  });

  test('skips entries with a non-JSON, skipped, or empty body instead of throwing', () => {
    const entries = [
      entry({ id: 1, body: 'not json' }),
      entry({ id: 2, bodySkipped: true, body: '' }),
      entry({ id: 3, body: '' }),
      entry({ id: 4, body: JSON.stringify({ name: 'Suppe' }) }),
    ];
    const candidates = findApiCandidates(entries, 'Suppe');
    expect(candidates.map(c => c.entryId)).toEqual([4]);
  });

  test('returns nothing when no entry contains the target text', () => {
    const entries = [entry({ body: JSON.stringify({ name: 'Salat' }) })];
    expect(findApiCandidates(entries, 'Suppe')).toEqual([]);
  });

  test('ranks a declared application/json body above a same-value match in a non-JSON-declared body', () => {
    const entries = [
      entry({ id: 1, contentType: 'text/plain', body: JSON.stringify({ name: 'Suppe' }) }),
      entry({ id: 2, contentType: 'application/json', body: JSON.stringify({ name: 'Suppe' }) }),
    ];
    const candidates = findApiCandidates(entries, 'Suppe');
    expect(candidates[0].entryId).toBe(2);
  });

  test('ranks a body where the value is unique above one where it recurs many times', () => {
    const entries = [
      entry({ id: 1, body: JSON.stringify({ items: [{ x: 'Suppe' }, { x: 'Suppe' }, { x: 'Suppe' }] }) }),
      entry({ id: 2, body: JSON.stringify({ name: 'Suppe' }) }),
    ];
    const candidates = findApiCandidates(entries, 'Suppe');
    expect(candidates[0].entryId).toBe(2);
  });

  test('caps the number of returned candidates at MAX_API_CANDIDATES (20)', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: 'Suppe', id: i }));
    const entries = [entry({ body: JSON.stringify({ items }) })];
    expect(findApiCandidates(entries, 'Suppe')).toHaveLength(20);
  });

  test('returns nothing for an empty target', () => {
    const entries = [entry({ body: JSON.stringify({ name: '' }) })];
    expect(findApiCandidates(entries, '   ')).toEqual([]);
  });

  // Phase A3: scopePath is the JSON-side analogue of Container-Mode's
  // scopeSelector, used (Phase A5) when adding a nested group/field to an
  // already-confirmed ApiGroup — the search must stay confined to that
  // group's own scope so a same-named field under a *different* instance
  // isn't offered as a false match.
  describe('scopePath (Phase A3)', () => {
    const catalog = {
      categories: [
        { name: 'Elektronik', subcategories: [{ name: 'Telefone', products: [{ title: 'Smartphone X' }] }] },
        { name: 'Bücher', subcategories: [{ name: 'Romane', products: [{ title: 'Smartphone X' }] }] },
      ],
    };

    test('excludes a match outside the given scope, keeping one inside it', () => {
      const entries = [entry({ body: JSON.stringify(catalog) })];
      const candidates = findApiCandidates(entries, 'Smartphone X', 'categories[0]');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].path).toBe('categories[0].subcategories[0].products[0].title');
    });

    test('a scope matching no category excludes every candidate', () => {
      const entries = [entry({ body: JSON.stringify(catalog) })];
      expect(findApiCandidates(entries, 'Smartphone X', 'categories[5]')).toEqual([]);
    });

    test('null/undefined scopePath reproduces the unscoped whole-pool search', () => {
      const entries = [entry({ body: JSON.stringify(catalog) })];
      expect(findApiCandidates(entries, 'Smartphone X', null)).toHaveLength(2);
      expect(findApiCandidates(entries, 'Smartphone X')).toHaveLength(2);
    });
  });
});

describe('scriptTagSelector (Issue #136)', () => {
  test('a script tag with an id returns #id', () => {
    document.body.innerHTML = '<script id="__NEXT_DATA__" type="application/json">{}</script>';
    const tag = document.getElementById('__NEXT_DATA__');
    expect(scriptTagSelector(tag)).toBe('#__NEXT_DATA__');
  });

  test('a script tag with a type unique on the page returns script[type="..."]', () => {
    document.body.innerHTML = '<script type="application/json">{}</script><script>var x = 1;</script>';
    const tag = document.querySelector('script[type="application/json"]');
    expect(scriptTagSelector(tag)).toBe('script[type="application/json"]');
  });

  test('falls back to a positional nth-child path when neither id nor a unique type is available', () => {
    document.body.innerHTML = '<div><script type="application/json">{"a":1}</script><script type="application/json">{"b":2}</script></div>';
    const [first, second] = document.querySelectorAll('script[type="application/json"]');
    expect(scriptTagSelector(first)).not.toBe(scriptTagSelector(second));
    // Resolvable back to the same element via querySelector.
    expect(document.querySelector(scriptTagSelector(first))).toBe(first);
    expect(document.querySelector(scriptTagSelector(second))).toBe(second);
  });
});

describe('findEmbeddedJsonCandidates (Issue #136)', () => {
  function setScripts(...blobs) {
    document.body.innerHTML = blobs
      .map(({ id, type, json } = {}) => {
        const idAttr = id ? ` id="${id}"` : '';
        const typeAttr = type ? ` type="${type}"` : '';
        return `<script${idAttr}${typeAttr}>${json}</script>`;
      })
      .join('');
  }

  test('finds a candidate embedded in a __NEXT_DATA__-style script tag, including sibling suggestions', () => {
    setScripts({ id: '__NEXT_DATA__', type: 'application/json', json: JSON.stringify({ props: { items: [{ name: 'Suppe', price: 3.5 }] } }) });
    const candidates = findEmbeddedJsonCandidates('Suppe');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ scriptSelector: '#__NEXT_DATA__', path: 'props.items[0].name', value: 'Suppe' });
    expect(candidates[0].siblings).toEqual([{ name: 'price', path: 'props.items[0].price', value: 3.5 }]);
  });

  test('attaches the derived itemsPath/valuePath and treeSkeleton, same as findApiCandidates', () => {
    setScripts({ type: 'application/json', json: JSON.stringify({ categories: [{ subcategories: [{ products: [{ title: 'Suppe' }] }] }] }) });
    const [candidate] = findEmbeddedJsonCandidates('Suppe');
    expect(candidate.itemsPath).toBe('categories[0].subcategories[0].products');
    expect(candidate.valuePath).toBe('title');
    expect(candidate.treeSkeleton).toEqual([
      { kind: 'group', path: 'categories' },
      { kind: 'group', path: 'subcategories' },
      { kind: 'group', path: 'products' },
      { kind: 'field', path: 'title' },
    ]);
  });

  test('skips a <script> tag whose content is not valid JSON (ordinary inline JS)', () => {
    setScripts({ json: 'var x = "Suppe";' }, { type: 'application/json', json: JSON.stringify({ name: 'Suppe' }) });
    const candidates = findEmbeddedJsonCandidates('Suppe');
    expect(candidates).toHaveLength(1);
  });

  test('skips a <script> tag whose content is a bare JSON scalar (no repeating structure)', () => {
    setScripts({ json: '"Suppe"' });
    expect(findEmbeddedJsonCandidates('Suppe')).toEqual([]);
  });

  test('returns nothing when no script tag contains the target text', () => {
    setScripts({ type: 'application/json', json: JSON.stringify({ name: 'Salat' }) });
    expect(findEmbeddedJsonCandidates('Suppe')).toEqual([]);
  });

  test('returns nothing for an empty target', () => {
    setScripts({ type: 'application/json', json: JSON.stringify({ name: 'Suppe' }) });
    expect(findEmbeddedJsonCandidates('   ')).toEqual([]);
  });

  test('ranks a __NEXT_DATA__ id match above a same-value match in a script tag with no known convention', () => {
    setScripts(
      { json: JSON.stringify({ items: [{ x: 'Suppe' }] }) },
      { id: '__NEXT_DATA__', json: JSON.stringify({ name: 'Suppe' }) },
    );
    const candidates = findEmbeddedJsonCandidates('Suppe');
    expect(candidates[0].scriptSelector).toBe('#__NEXT_DATA__');
  });

  test('caps the number of returned candidates at MAX_API_CANDIDATES (20)', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: 'Suppe', id: i }));
    setScripts({ type: 'application/json', json: JSON.stringify({ items }) });
    expect(findEmbeddedJsonCandidates('Suppe')).toHaveLength(20);
  });

  // scopePath (mirrors findApiCandidates' own Phase A3 scoping, used when
  // extending an already-confirmed embedded-JSON tree with a nested group/
  // field — see startEmbeddedJsonSearch/resolveApiGroupScopePath).
  describe('scopePath', () => {
    const catalog = {
      categories: [
        { name: 'Elektronik', subcategories: [{ name: 'Telefone', products: [{ title: 'Smartphone X' }] }] },
        { name: 'Bücher', subcategories: [{ name: 'Romane', products: [{ title: 'Smartphone X' }] }] },
      ],
    };

    test('excludes a match outside the given scope, keeping one inside it', () => {
      setScripts({ type: 'application/json', json: JSON.stringify(catalog) });
      const candidates = findEmbeddedJsonCandidates('Smartphone X', 'categories[0]');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].path).toBe('categories[0].subcategories[0].products[0].title');
    });

    test('null/undefined scopePath reproduces the unscoped whole-page search', () => {
      setScripts({ type: 'application/json', json: JSON.stringify(catalog) });
      expect(findEmbeddedJsonCandidates('Smartphone X', null)).toHaveLength(2);
      expect(findEmbeddedJsonCandidates('Smartphone X')).toHaveLength(2);
    });
  });

  // scriptSelector (Issue #136): restricts the scan to the one <script> tag
  // an already-confirmed tree's EmbeddedJsonSource commits to, instead of
  // re-scanning every <script> tag on the page — unlike a network entryId
  // (findApiCandidates has no equivalent restriction), there is exactly one
  // valid source once EmbeddedJsonSource.ScriptSelector is fixed.
  describe('scriptSelector', () => {
    test('restricts the scan to the given script tag, ignoring a same-value match elsewhere', () => {
      setScripts(
        { id: 'other', type: 'application/json', json: JSON.stringify({ name: 'Suppe' }) },
        { id: '__NEXT_DATA__', type: 'application/json', json: JSON.stringify({ name: 'Salat' }) },
      );
      expect(findEmbeddedJsonCandidates('Suppe', null, '#__NEXT_DATA__')).toEqual([]);
      expect(findEmbeddedJsonCandidates('Salat', null, '#__NEXT_DATA__')).toHaveLength(1);
    });
  });
});

describe('deriveItemsAndValuePath (Issue #53 Phase 5)', () => {
  test('splits at the last array index into itemsPath (the array) and valuePath (relative to one record)', () => {
    expect(deriveItemsAndValuePath('data.items[2].price')).toEqual({ itemsPath: 'data.items', valuePath: 'price' });
  });

  test('supports a nested valuePath', () => {
    expect(deriveItemsAndValuePath('items[0].meta.price')).toEqual({ itemsPath: 'items', valuePath: 'meta.price' });
  });

  test('uses the *last* array index when a match sits inside nested arrays', () => {
    expect(deriveItemsAndValuePath('categories[0].items[3].name')).toEqual({ itemsPath: 'categories[0].items', valuePath: 'name' });
  });

  test('returns null when the path never enters an array (no repeating-records structure)', () => {
    expect(deriveItemsAndValuePath('meta.name')).toBeNull();
  });

  test('returns an empty valuePath when the match is itself the bare array element (no record object)', () => {
    expect(deriveItemsAndValuePath('tags[0]')).toEqual({ itemsPath: 'tags', valuePath: '' });
  });
});

describe('deriveApiTreeSkeleton (Phase A3, Issue #54)', () => {
  test('a 3-level match (Phase 0\'s catalog shape) produces a 4-segment skeleton', () => {
    const skeleton = deriveApiTreeSkeleton('data.categories[2].subcategories[0].products[5].title');
    expect(skeleton).toEqual([
      { kind: 'group', path: 'data.categories' },
      { kind: 'group', path: 'subcategories' },
      { kind: 'group', path: 'products' },
      { kind: 'field', path: 'title' },
    ]);
  });

  test('a 1-level match still produces the old 2-segment form', () => {
    expect(deriveApiTreeSkeleton('data.items[2].price')).toEqual([
      { kind: 'group', path: 'data.items' },
      { kind: 'field', path: 'price' },
    ]);
  });

  test('a nested field path (no array after the last group) stays on one field segment', () => {
    expect(deriveApiTreeSkeleton('items[0].meta.price')).toEqual([
      { kind: 'group', path: 'items' },
      { kind: 'field', path: 'meta.price' },
    ]);
  });

  test('two directly-nested repeating levels with no key between them produce a group with an empty path', () => {
    expect(deriveApiTreeSkeleton('rows[0][0].title')).toEqual([
      { kind: 'group', path: 'rows' },
      { kind: 'group', path: '' },
      { kind: 'field', path: 'title' },
    ]);
  });

  test('a bare array element (no record object) yields an empty final field path', () => {
    expect(deriveApiTreeSkeleton('tags[0]')).toEqual([
      { kind: 'group', path: 'tags' },
      { kind: 'field', path: '' },
    ]);
  });

  test('returns null when the path never enters an array at all, same as deriveItemsAndValuePath', () => {
    expect(deriveApiTreeSkeleton('meta.name')).toBeNull();
  });
});
