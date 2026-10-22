// Issue #404: the JSON-path picker's loading, panel and click handling, driven
// through a fake bridge the way the cursor/bootstrap sections and the group
// modal use it.
const { initI18n } = require('../i18n/i18n');
const { openPathPicker, closePathPicker, pathPickerButtonHtml, pathPickerPanelHtml, wirePathPickerEvents, renderGroupPathPicker } = require('./json-path-picker-ui');

const RESPONSE = { pageInfo: { endCursor: 'abc', hasNextPage: true }, categories: [{ id: 'a', subcategories: [{ id: 'a1' }] }] };
const ENTRIES = [
  { id: 1, url: 'https://api.example/items', method: 'GET', status: 200, body: JSON.stringify(RESPONSE) },
  { id: 2, url: 'https://api.example/graphql', method: 'POST', status: 200, body: '{"data":1}', requestBody: JSON.stringify({ variables: { after: null, first: 10 } }) },
  { id: 3, url: 'https://api.example/auth/token', method: 'POST', status: 200, body: JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }) },
];

let state;
let bridge;
let host;

beforeAll(async () => {
  global.chrome = { storage: { local: { get: async () => ({}) } } };
  await initI18n('en-US');
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const render = (field) => { host.innerHTML = pathPickerButtonHtml(field) + pathPickerPanelHtml(state, field); };

function setup({ draft = {}, entries = ENTRIES, embedded = null, extra = {} } = {}) {
  state = {
    current: 'API_CONFIG',
    apiPathPicker: null,
    apiConfigDraft: { sourceEntryId: 1, sourceUrl: 'https://api.example/items', method: 'GET', groups: [], cursorPagination: { nextCursorPath: '', hasNextPagePath: '', bodyPath: '' }, bootstrap: { url: 'https://api.example/auth/token', method: 'POST', valuePath: '' }, ...draft },
    ...extra,
  };
  bridge = {
    getState: () => state,
    setState: jest.fn((current, patch = {}) => { state = { ...state, current, ...patch }; }),
    patchState: jest.fn((patch = {}) => { state = { ...state, ...patch }; }),
  };
  global.chrome = {
    runtime: {
      sendMessage: jest.fn(async (message) => {
        if (message.type === 'GET_API_CAPTURE_ENTRIES') return entries;
        if (message.type === 'GET_EMBEDDED_JSON') return embedded;
        return undefined;
      }),
    },
  };
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host');
  wirePathPickerEvents(bridge, host);
}

const click = (selector) => document.querySelector(selector).click();
const open = async (field) => { await openPathPicker(bridge, field); render(field); };

describe('opening a picker', () => {
  test('a response path: the source request becomes a clickable tree', async () => {
    setup();
    await open('cursor.nextCursorPath');

    expect(state.apiPathPicker.status).toBe('tree');
    expect(host.querySelector('.json-path-source').textContent).toContain('GET https://api.example/items');
    expect([...host.querySelectorAll('.json-path-pick')].map((b) => b.dataset.path)).toContain('pageInfo.endCursor');
    expect(host.querySelector('.json-path-pick[data-path="pageInfo.endCursor"] .json-path-preview').textContent).toBe('"abc"');
  });

  test('the button toggles: a second press closes it', async () => {
    setup();
    await open('cursor.nextCursorPath');
    await openPathPicker(bridge, 'cursor.nextCursorPath');
    expect(state.apiPathPicker).toBeNull();
  });

  test('shows "loading" while the recording is fetched, and ignores a result that arrives after closing', async () => {
    setup();
    const pending = openPathPicker(bridge, 'cursor.nextCursorPath');
    expect(state.apiPathPicker.status).toBe('loading');
    closePathPicker(bridge);
    await pending;
    expect(state.apiPathPicker).toBeNull();
  });
});

describe('picking', () => {
  test('a cursor path fills the draft and closes the picker', async () => {
    setup();
    await open('cursor.nextCursorPath');
    click('.json-path-pick[data-path="pageInfo.endCursor"]');

    expect(state.apiConfigDraft.cursorPagination.nextCursorPath).toBe('pageInfo.endCursor');
    expect(state.apiConfigDraft.cursorPagination.hasNextPagePath).toBe(''); // untouched
    expect(state.apiPathPicker).toBeNull();
  });

  test('the has-more flag picks into its own field', async () => {
    setup();
    await open('cursor.hasNextPagePath');
    click('.json-path-pick[data-path="pageInfo.hasNextPage"]');
    expect(state.apiConfigDraft.cursorPagination.hasNextPagePath).toBe('pageInfo.hasNextPage');
  });

  test('the body slot comes from the recorded request body, as a plain dot path', async () => {
    setup({ draft: { sourceEntryId: 2, sourceUrl: 'https://api.example/graphql', method: 'POST' } });
    await open('cursor.bodyPath');

    expect(state.apiPathPicker.status).toBe('tree');
    click('.json-path-pick[data-path="variables.after"]');
    expect(state.apiConfigDraft.cursorPagination.bodyPath).toBe('variables.after');
  });

  test('the token path is read from the recorded response of the token request itself', async () => {
    setup();
    await open('bootstrap.valuePath');

    expect(host.querySelector('.json-path-source').textContent).toContain('POST https://api.example/auth/token');
    click('.json-path-pick[data-path="access_token"]');
    expect(state.apiConfigDraft.bootstrap.valuePath).toBe('access_token');
    expect(state.apiConfigDraft.bootstrap.url).toBe('https://api.example/auth/token'); // the rest is kept
  });

  test('a group path fills the modal input (relative to the parent scope) and leaves the draft alone', async () => {
    setup({ draft: { groups: [{ kind: 'group', name: 'Kategorie', path: 'categories', children: [] }] }, extra: { pendingApiTreeParentPath: [0], apiGroupModalOpen: true } });
    document.body.innerHTML = '<div id="host"></div><input id="input-api-group-path" />';
    host = document.getElementById('host');
    wirePathPickerEvents(bridge, host);
    await open('group');

    // rooted at categories[0]: only its own children are offered, with relative paths
    expect([...host.querySelectorAll('.json-path-pick')].map((b) => b.dataset.path)).toEqual(['subcategories']);
    click('.json-path-pick[data-path="subcategories"]');
    expect(document.getElementById('input-api-group-path').value).toBe('subcategories');
    expect(state.apiPathPicker).toBeNull();
    expect(bridge.setState).not.toHaveBeenCalled();
  });

  test('a group path at the root level offers the lists and objects of the response', async () => {
    setup({ extra: { pendingApiTreeParentPath: null, apiGroupModalOpen: true } });
    await open('group');
    expect([...host.querySelectorAll('.json-path-pick')].map((b) => b.dataset.path)).toEqual(['pageInfo', 'categories']);
  });

  test('the group modal renders its own panel from state', async () => {
    setup({ extra: { pendingApiTreeParentPath: null, apiGroupModalOpen: true } });
    document.body.innerHTML = '<div id="api-group-path-picker"></div>';
    await openPathPicker(bridge, 'group');
    renderGroupPathPicker(bridge);
    expect(document.querySelectorAll('#api-group-path-picker .json-path-pick').length).toBeGreaterThan(0);
    state.apiGroupModalOpen = false;
    renderGroupPathPicker(bridge);
    expect(document.getElementById('api-group-path-picker').innerHTML).toBe('');
  });
});

describe('when there is nothing to pick from', () => {
  test('no recording at all: says so and keeps typing possible', async () => {
    setup({ entries: [] });
    await open('cursor.nextCursorPath');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message: 'noRecording' });
    expect(host.querySelector('.json-path-message')).not.toBeNull();
    expect(host.querySelector('.json-path-pick')).toBeNull();
  });

  test('a body path with no request body recorded', async () => {
    setup({ entries: [{ id: 1, url: 'https://api.example/items', method: 'GET', status: 200, body: '{}' }] });
    await open('cursor.bodyPath');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message: 'noBody' });

    setup({ entries: [] });
    await open('cursor.bodyPath');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message: 'noRecording' }); // nothing recorded at all
  });

  test('a truncated response is reported, not shown half', async () => {
    setup({ entries: [{ id: 1, url: 'https://api.example/items', method: 'GET', status: 200, body: '{"cut', bodyTruncated: true }] });
    await open('cursor.nextCursorPath');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message: 'truncated' });
  });

  test('a response with no matching value (group mode on a flat list of scalars)', async () => {
    setup({ entries: [{ id: 1, url: 'https://api.example/items', method: 'GET', status: 200, body: '{"a":1,"b":"x"}' }], extra: { pendingApiTreeParentPath: null, apiGroupModalOpen: true } });
    await open('group');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message: 'nothingToPick' });
  });

  test('a parent scope that is not in the recorded response', async () => {
    setup({ draft: { groups: [{ kind: 'group', name: 'X', path: 'missing', children: [] }] }, extra: { pendingApiTreeParentPath: [0], apiGroupModalOpen: true } });
    await open('group');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message: 'scopeMissing' });
  });
});

describe('choosing between recorded responses', () => {
  test('a token path typed by hand with no matching recording offers the recorded JSON responses', async () => {
    setup({ draft: { bootstrap: { url: 'https://api.example/other-token', method: 'POST', valuePath: '' } } });
    await open('bootstrap.valuePath');

    expect(state.apiPathPicker.status).toBe('chooser');
    expect(host.querySelectorAll('.json-path-chooser-entry')).toHaveLength(3);

    click('.json-path-chooser-entry[data-entry-id="3"]');
    render('bootstrap.valuePath');
    expect(state.apiPathPicker.status).toBe('tree');
    click('.json-path-pick[data-path="expires_in"]');
    expect(state.apiConfigDraft.bootstrap.valuePath).toBe('expires_in');
  });

  test('"pick from another recorded response" goes back to the list', async () => {
    setup();
    await open('cursor.nextCursorPath');
    click('.json-path-other');
    expect(state.apiPathPicker.status).toBe('chooser');
  });
});

describe('embedded JSON source', () => {
  const draft = { embeddedJsonSource: { scriptSelector: '#__NEXT_DATA__' }, sourceEntryId: undefined };

  test('reads the page\'s own JSON through GET_EMBEDDED_JSON', async () => {
    setup({ draft, embedded: { body: JSON.stringify({ props: { next: 'n1' } }), truncated: false, found: true } });
    await open('cursor.nextCursorPath');

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_EMBEDDED_JSON', scriptSelector: '#__NEXT_DATA__' });
    expect(host.querySelector('.json-path-source').textContent).toContain('#__NEXT_DATA__');
    click('.json-path-pick[data-path="props.next"]');
    expect(state.apiConfigDraft.cursorPagination.nextCursorPath).toBe('props.next');
  });

  test.each([
    ['a blob that is gone', { body: '', truncated: false, found: false }, 'embeddedMissing'],
    ['an oversized blob', { body: '', truncated: true, found: true }, 'truncated'],
    ['text that is not JSON', { body: 'nope', truncated: false, found: true }, 'notJson'],
  ])('%s', async (_name, embedded, message) => {
    setup({ draft, embedded });
    await open('cursor.nextCursorPath');
    expect(state.apiPathPicker).toMatchObject({ status: 'message', message });
  });
});

describe('the tree itself', () => {
  test('rows can be collapsed and expanded without touching state', async () => {
    setup();
    await open('cursor.nextCursorPath');
    const node = host.querySelector('.json-path-node');
    const toggle = node.querySelector(':scope > .json-path-row > .json-path-toggle');
    const wasCollapsed = node.classList.contains('collapsed');
    toggle.click();
    expect(node.classList.contains('collapsed')).toBe(!wasCollapsed);
    expect(toggle.getAttribute('aria-expanded')).toBe(wasCollapsed ? 'true' : 'false');
    toggle.click();
    expect(node.classList.contains('collapsed')).toBe(wasCollapsed);
  });

  test('values that are not selectable are shown but are not buttons', async () => {
    setup();
    await open('cursor.nextCursorPath');
    expect(host.querySelector('.json-path-static')).not.toBeNull(); // pageInfo / categories only expand
    expect(host.querySelector('.json-path-pick[data-path="pageInfo"]')).toBeNull();
  });

  test('closing from the panel', async () => {
    setup();
    await open('cursor.nextCursorPath');
    click('.json-path-close');
    expect(state.apiPathPicker).toBeNull();
  });
});
