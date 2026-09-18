const { addComponent, removeComponent, updateComponentName, moveComponent } = require('./combined-config');

describe('combined-config (Issue #239): pure component-list helpers', () => {
  test('addComponent appends a component referencing the saved config id and its own name', () => {
    const result = addComponent([], { id: 5, name: 'Products', url: 'https://example.com' });
    expect(result).toEqual([{ savedConfigId: 5, name: 'Products' }]);
  });

  test('addComponent does not mutate the original array', () => {
    const original = [{ savedConfigId: 1, name: 'A' }];
    addComponent(original, { id: 2, name: 'B' });
    expect(original).toEqual([{ savedConfigId: 1, name: 'A' }]);
  });

  test('removeComponent drops the entry at the given index', () => {
    const components = [{ savedConfigId: 1, name: 'A' }, { savedConfigId: 2, name: 'B' }];
    expect(removeComponent(components, 0)).toEqual([{ savedConfigId: 2, name: 'B' }]);
  });

  test('updateComponentName replaces only the targeted entry\'s name', () => {
    const components = [{ savedConfigId: 1, name: 'A' }, { savedConfigId: 2, name: 'B' }];
    expect(updateComponentName(components, 1, 'Renamed')).toEqual([
      { savedConfigId: 1, name: 'A' },
      { savedConfigId: 2, name: 'Renamed' },
    ]);
  });

  test('moveComponent swaps with the adjacent sibling', () => {
    const components = [{ savedConfigId: 1, name: 'A' }, { savedConfigId: 2, name: 'B' }];
    expect(moveComponent(components, 0, 1)).toEqual([
      { savedConfigId: 2, name: 'B' },
      { savedConfigId: 1, name: 'A' },
    ]);
  });

  test('moveComponent is a no-op past either boundary', () => {
    const components = [{ savedConfigId: 1, name: 'A' }, { savedConfigId: 2, name: 'B' }];
    expect(moveComponent(components, 0, -1)).toBe(components);
    expect(moveComponent(components, 1, 1)).toBe(components);
  });
});
