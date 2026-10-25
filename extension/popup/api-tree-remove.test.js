// Regression test: the "Remove" button on an API response-tree row. The handler
// called removeApiTreeNode without it being imported into api-config-ui.ts (it
// only worked while every module shared one global scope; since the esbuild
// bundling of Issue #389 — and under Jest — it was a ReferenceError).
const { renderApiTree, wireApiConfigEvents } = require('./api-config-ui');

describe('removing a row from the API response tree', () => {
  let state;
  let bridge;

  beforeEach(() => {
    document.body.innerHTML = '<ul id="api-tree-root"></ul>';
    state = {
      current: 'API_CONFIG',
      apiConfigDraft: {
        groups: [{
          kind: 'group', name: 'Kategorie', path: 'categories',
          children: [
            { kind: 'field', name: 'Titel', path: 'name' },
            { kind: 'field', name: 'Preis', path: 'price' },
          ],
        }],
      },
    };
    bridge = {
      getState: () => state,
      setState: jest.fn((current, patch = {}) => { state = { ...state, current, ...patch }; }),
      patchState: jest.fn((patch = {}) => { state = { ...state, ...patch }; }),
    };
    renderApiTree(state.apiConfigDraft.groups);
    wireApiConfigEvents(bridge);
  });

  test('"Remove" on a field row removes just that field', () => {
    document.querySelector('[data-path="[0,0]"] .btn-remove-api-node').click();

    expect(bridge.setState).toHaveBeenCalledTimes(1);
    expect(state.apiConfigDraft.groups[0].children.map((c) => c.name)).toEqual(['Preis']);
  });

  test('"Remove" on a group row removes the whole group', () => {
    document.querySelector('[data-path="[0]"] > .api-tree-row .btn-remove-api-node').click();

    expect(state.apiConfigDraft.groups).toEqual([]);
  });
});
