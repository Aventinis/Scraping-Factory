const { createDraftBlock, addOrUpdateBlock, removeBlock, moveBlock, draftIsAddable } = require('./blocks-config');

describe('blocks-config (Issue #182): pure block-list helpers', () => {
  test('createDraftBlock returns a blank flat-shape draft', () => {
    expect(createDraftBlock()).toEqual({ shape: 'flat', name: '', outputFileName: '' });
  });

  test('addOrUpdateBlock appends a flat-shape block snapshotting the draft plus current fields', () => {
    const draft = { name: 'Deals', shape: 'flat', outputFileName: 'deals' };
    const fields = [{ name: 'Preis', selector: '.deal' }];
    const result = addOrUpdateBlock([], draft, fields, [], null);
    expect(result).toEqual([{ name: 'Deals', outputFileName: 'deals', shape: 'flat', fields, groups: [] }]);
  });

  test('addOrUpdateBlock appends a group-shape block snapshotting the draft plus current groups', () => {
    const draft = { name: 'Menu', shape: 'group', outputFileName: '' };
    const groups = [{ kind: 'group', name: 'Item', selector: '.item', repeating: true, children: [] }];
    const result = addOrUpdateBlock([], draft, [], groups, undefined);
    expect(result).toEqual([{ name: 'Menu', outputFileName: '', shape: 'group', fields: [], groups }]);
  });

  test('addOrUpdateBlock trims the draft name and output filename', () => {
    const draft = { name: '  Deals  ', shape: 'flat', outputFileName: '  deals  ' };
    const result = addOrUpdateBlock([], draft, [{ name: 'A', selector: 'a' }], [], null);
    expect(result[0].name).toBe('Deals');
    expect(result[0].outputFileName).toBe('deals');
  });

  test('addOrUpdateBlock does not mutate the original array', () => {
    const original = [{ name: 'A', outputFileName: 'a', shape: 'flat', fields: [], groups: [] }];
    addOrUpdateBlock(original, { name: 'B', shape: 'flat', outputFileName: 'b' }, [], [], null);
    expect(original).toHaveLength(1);
  });

  test('addOrUpdateBlock overwrites the block at editingIndex instead of appending', () => {
    const blocks = [
      { name: 'A', outputFileName: 'a', shape: 'flat', fields: [], groups: [] },
      { name: 'B', outputFileName: 'b', shape: 'flat', fields: [], groups: [] },
    ];
    const draft = { name: 'A2', shape: 'flat', outputFileName: 'a2' };
    const fields = [{ name: 'X', selector: 'x' }];
    const result = addOrUpdateBlock(blocks, draft, fields, [], 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'A2', outputFileName: 'a2', shape: 'flat', fields, groups: [] });
    expect(result[1]).toEqual(blocks[1]);
  });

  test('removeBlock drops the entry at the given index', () => {
    const blocks = [{ name: 'A' }, { name: 'B' }];
    expect(removeBlock(blocks, 0)).toEqual([{ name: 'B' }]);
  });

  test('moveBlock swaps with the adjacent sibling', () => {
    const blocks = [{ name: 'A' }, { name: 'B' }];
    expect(moveBlock(blocks, 0, 1)).toEqual([{ name: 'B' }, { name: 'A' }]);
  });

  test('moveBlock is a no-op past either boundary', () => {
    const blocks = [{ name: 'A' }, { name: 'B' }];
    expect(moveBlock(blocks, 0, -1)).toBe(blocks);
    expect(moveBlock(blocks, 1, 1)).toBe(blocks);
  });

  describe('draftIsAddable', () => {
    test('false when the name is blank', () => {
      expect(draftIsAddable({ name: '', shape: 'flat' }, [{ name: 'A', selector: 'a' }], [])).toBe(false);
      expect(draftIsAddable({ name: '   ', shape: 'flat' }, [{ name: 'A', selector: 'a' }], [])).toBe(false);
    });

    test('false for a flat draft with no fields yet', () => {
      expect(draftIsAddable({ name: 'Deals', shape: 'flat' }, [], [])).toBe(false);
    });

    test('false for a group draft with no groups yet', () => {
      expect(draftIsAddable({ name: 'Menu', shape: 'group' }, [], [])).toBe(false);
    });

    test('true for a flat draft with at least one field', () => {
      expect(draftIsAddable({ name: 'Deals', shape: 'flat' }, [{ name: 'A', selector: 'a' }], [])).toBe(true);
    });

    test('true for a group draft with at least one group', () => {
      const groups = [{ kind: 'group', name: 'Item', selector: '.item', repeating: true, children: [] }];
      expect(draftIsAddable({ name: 'Menu', shape: 'group' }, [], groups)).toBe(true);
    });
  });
});
