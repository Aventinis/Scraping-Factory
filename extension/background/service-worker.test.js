let capturedListener;
let tabUpdatedListener;
let tabRemovedListener;

global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn((fn) => { capturedListener = fn; }),
    },
    sendMessage: jest.fn(),
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    reload: jest.fn().mockResolvedValue(undefined),
    onUpdated: { addListener: jest.fn((fn) => { tabUpdatedListener = fn; }) },
    onRemoved: { addListener: jest.fn((fn) => { tabRemovedListener = fn; }) },
  },
  storage: {
    session: {
      set:    jest.fn().mockResolvedValue(undefined),
      get:    jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
};

require('./service-worker');

beforeEach(() => {
  jest.clearAllMocks();
  chrome.runtime.sendMessage.mockResolvedValue(undefined);
  chrome.tabs.sendMessage.mockResolvedValue(undefined);
  chrome.tabs.reload.mockResolvedValue(undefined);
  chrome.storage.session.set.mockResolvedValue(undefined);
  chrome.storage.session.get.mockResolvedValue({});
});

test('START_SELECTION is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'START_SELECTION' }, {});

  expect(chrome.tabs.query).toHaveBeenCalledWith(
    { active: true, currentWindow: true },
    expect.any(Function),
  );
  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'START_SELECTION' });
});

test('START_SELECTION forwards extra fields verbatim (e.g. Phase 4\'s apiSearch flag)', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'START_SELECTION', apiSearch: true }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'START_SELECTION', apiSearch: true });
});

test('STOP_SELECTION is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'STOP_SELECTION' }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'STOP_SELECTION' });
});

test('no tab message sent when no active tab exists', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([]));

  capturedListener({ type: 'START_SELECTION' }, {});

  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test('ELEMENT_SELECTED is forwarded to runtime (side panel)', () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.card > h2' }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'ELEMENT_SELECTED',
    selector: 'li.card > h2',
  });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test('ELEMENT_SELECTED stores selector in session storage', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.card > h2' }, {});

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    pendingSelector: 'li.card > h2',
    pendingFramePath: null,
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: null,
    pendingUrl: null,
    pendingPickId: null,
  });
});

// Issue #42, Phase 7: a click inside an iframe carries a resolved framePath
// alongside the selector — this must survive the same session-storage
// fallback path a plain top-level selector already does (see above), so a
// popup that was closed at click time can still recover it on reopen.
test('ELEMENT_SELECTED with a framePath stores it alongside the selector', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2', framePath: ['#price-widget'] }, {});

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    pendingSelector: 'h2',
    pendingFramePath: ['#price-widget'],
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: null,
    pendingUrl: null,
    pendingPickId: null,
  });
});

// Issue #85: same session-storage fallback path as pendingSelector/
// pendingFramePath above, so a popup closed at click time can still recover
// the match count on reopen.
test('ELEMENT_SELECTED with a matchCount stores it alongside the selector', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2', matchCount: 3 }, {});

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    pendingSelector: 'h2',
    pendingFramePath: null,
    pendingMatchCount: 3,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: null,
    pendingUrl: null,
    pendingPickId: null,
  });
});

// Issue #143: same session-storage fallback path as pendingSelector/
// pendingMatchCount above, so a popup closed at click time can still recover
// the raw text/attributes needed for the transform-chain live preview.
test('ELEMENT_SELECTED with rawText/attributes stores them alongside the selector', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2', rawText: 'Preis: 12,99 €', attributes: { 'data-id': '42' } }, {});

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    pendingSelector: 'h2',
    pendingFramePath: null,
    pendingMatchCount: null,
    pendingRawText: 'Preis: 12,99 €',
    pendingElementAttributes: { 'data-id': '42' },
    pendingOwnText: null,
    pendingUrl: null,
    pendingPickId: null,
  });
});

// Issue #169: same session-storage fallback path as pendingRawText/
// pendingElementAttributes above, for OwnText mode's own live preview.
test('ELEMENT_SELECTED with ownText stores it alongside the selector', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h3.item-name', ownText: 'Burrata mit Tomaten' }, {});

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    pendingSelector: 'h3.item-name',
    pendingFramePath: null,
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: 'Burrata mit Tomaten',
    pendingUrl: null,
    pendingPickId: null,
  });
});

// Issue: side panel's tracked _state.url only gets set once at panel-load/
// companion-connection time — no chrome.tabs.onUpdated listener exists
// anywhere in this extension, so it silently goes stale if the same tab
// navigates to a different page while the panel stays open. The selection's
// own page (message.url) is persisted alongside the rest of the pending
// state so session-restore.ts can self-correct on a popup reopen.
test('ELEMENT_SELECTED with url stores it alongside the selector', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.download', url: 'https://example.com/other-page' }, {});

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    pendingSelector: 'a.download',
    pendingFramePath: null,
    pendingMatchCount: null,
    pendingRawText: null,
    pendingElementAttributes: null,
    pendingOwnText: null,
    pendingUrl: 'https://example.com/other-page',
    pendingPickId: null,
  });
});

test('ELEMENT_SELECTED swallows error when side panel is closed', async () => {
  chrome.runtime.sendMessage.mockRejectedValue(new Error('No side panel'));

  await expect(
    new Promise((resolve) => {
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'p' }, {});
      setTimeout(resolve, 0);
    }),
  ).resolves.toBeUndefined();
});

test('ENABLE_DOM_VIEW is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'ENABLE_DOM_VIEW' }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'ENABLE_DOM_VIEW' });
});

test('DISABLE_DOM_VIEW is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'DISABLE_DOM_VIEW' }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'DISABLE_DOM_VIEW' });
});

test('DOM_TREE is forwarded to runtime (side panel) without touching tabs or storage', () => {
  const tree = { tag: 'body', id: null, classes: [], path: [], children: [] };
  capturedListener({ type: 'DOM_TREE', tree, truncated: false }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DOM_TREE', tree, truncated: false });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  expect(chrome.storage.session.set).not.toHaveBeenCalled();
});

test('DOM_TREE forward swallows error when side panel is closed', async () => {
  chrome.runtime.sendMessage.mockRejectedValue(new Error('No side panel'));

  await expect(
    new Promise((resolve) => {
      capturedListener({ type: 'DOM_TREE', tree: {}, truncated: false }, {});
      setTimeout(resolve, 0);
    }),
  ).resolves.toBeUndefined();
});

test('HOVER_ELEMENT is forwarded to runtime (side panel)', () => {
  capturedListener({ type: 'HOVER_ELEMENT', path: [0, 1] }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'HOVER_ELEMENT', path: [0, 1] });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test('a rejected chrome.tabs.sendMessage (no content script on the tab) does not throw', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  expect(() => capturedListener({ type: 'START_SELECTION' }, {})).not.toThrow();
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('START_SELECTION failure notifies the side panel via SELECTION_UNAVAILABLE', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  capturedListener({ type: 'START_SELECTION' }, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'SELECTION_UNAVAILABLE',
    reason: 'Could not establish connection. Receiving end does not exist.',
  });
});

test('STOP_SELECTION failure does not notify the side panel', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  capturedListener({ type: 'STOP_SELECTION' }, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

describe('GET_LOGS', () => {
  test('returns true to keep the message channel open for the async response', () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    const result = capturedListener({ type: 'GET_LOGS' }, {}, jest.fn());
    expect(result).toBe(true);
  });

  test('combines the background buffer with the content script response', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    const contentLogs = [{ ts: 'x', event: 'CONTENT_EVENT', data: null }];
    chrome.tabs.sendMessage.mockImplementation((tabId, msg) => {
      expect(msg).toEqual({ type: 'GET_LOGS' });
      return Promise.resolve(contentLogs);
    });
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_LOGS' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      content: contentLogs,
      contentError: null,
    }));
    const response = sendResponse.mock.calls[0][0];
    expect(Array.isArray(response.background)).toBe(true);
  });

  test('reports contentError when there is no active tab', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_LOGS' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      content: null,
      contentError: 'no active tab',
    }));
  });

  test('reports contentError when the content script is unreachable', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_LOGS' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      content: null,
      contentError: 'Could not establish connection.',
    }));
  });
});

test('PREVIEW_START is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [] }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'PREVIEW_START', mode: 'flat', fields: [] });
});

test('PREVIEW_STOP is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'PREVIEW_STOP' }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'PREVIEW_STOP' });
});

test('PREVIEW_START failure notifies the side panel via PREVIEW_UNAVAILABLE', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [] }, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'PREVIEW_UNAVAILABLE',
    reason: 'Could not establish connection. Receiving end does not exist.',
  });
});

test('PREVIEW_STOP failure does not notify the side panel', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  capturedListener({ type: 'PREVIEW_STOP' }, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

test('PREVIEW_RESULT is forwarded to runtime (side panel) without touching tabs or storage', () => {
  capturedListener({ type: 'PREVIEW_RESULT', total: 3, empty: [], truncated: false }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_RESULT', total: 3, empty: [], truncated: false });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  expect(chrome.storage.session.set).not.toHaveBeenCalled();
});

test('API_CAPTURE_START is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'API_CAPTURE_START' }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'API_CAPTURE_START' });
});

test('API_CAPTURE_STOP is forwarded to active tab content script', () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

  capturedListener({ type: 'API_CAPTURE_STOP' }, {});

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'API_CAPTURE_STOP' });
});

test('API_CAPTURE_START failure notifies the side panel via API_CAPTURE_UNAVAILABLE', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  capturedListener({ type: 'API_CAPTURE_START' }, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'API_CAPTURE_UNAVAILABLE',
    reason: 'Could not establish connection. Receiving end does not exist.',
  });
});

test('API_CAPTURE_STOP failure does not notify the side panel', async () => {
  chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
  chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

  capturedListener({ type: 'API_CAPTURE_STOP' }, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

test('API_CAPTURE_ENTRY is forwarded to runtime (side panel) without touching tabs or storage', () => {
  const entry = { id: 1, url: 'https://example.com/api/items', method: 'GET', status: 200, contentType: 'application/json', body: '{}', bodyTruncated: false };

  capturedListener({ type: 'API_CAPTURE_ENTRY', entry }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CAPTURE_ENTRY', entry });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  expect(chrome.storage.session.set).not.toHaveBeenCalled();
});

test('API_CANDIDATES (Issue #53 Phase 4) is forwarded to runtime (side panel) without touching tabs or storage', () => {
  const candidates = [{ entryId: 1, url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [] }];

  capturedListener({ type: 'API_CANDIDATES', target: 'Suppe', candidates }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CANDIDATES', target: 'Suppe', candidates });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  expect(chrome.storage.session.set).not.toHaveBeenCalled();
});

describe('CHECK_ROBOTS_TXT', () => {
  test('returns true to keep the message channel open for the async response', () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    const result = capturedListener({ type: 'CHECK_ROBOTS_TXT' }, {}, jest.fn());
    expect(result).toBe(true);
  });

  test('forwards to the active tab and relays its result', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    const checkResult = { ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/', allowed: true, matchedRule: null };
    chrome.tabs.sendMessage.mockImplementation((tabId, msg) => {
      expect(tabId).toBe(7);
      expect(msg).toEqual({ type: 'CHECK_ROBOTS_TXT' });
      return Promise.resolve(checkResult);
    });
    const sendResponse = jest.fn();

    capturedListener({ type: 'CHECK_ROBOTS_TXT' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(checkResult);
  });

  test('reports an error when there is no active tab', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    const sendResponse = jest.fn();

    capturedListener({ type: 'CHECK_ROBOTS_TXT' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Keine aktive Seite gefunden.' });
  });

  test('reports an error when the content script is unreachable', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    const sendResponse = jest.fn();

    capturedListener({ type: 'CHECK_ROBOTS_TXT' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Could not establish connection.' });
  });
});

describe('GET_API_CAPTURE_ENTRIES', () => {
  test('returns true to keep the message channel open for the async response', () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    const result = capturedListener({ type: 'GET_API_CAPTURE_ENTRIES' }, {}, jest.fn());
    expect(result).toBe(true);
  });

  test('forwards to the active tab and relays its result', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    const entries = [{ id: 1, url: 'https://example.com/api', method: 'GET', status: 200 }];
    chrome.tabs.sendMessage.mockImplementation((tabId, msg) => {
      expect(tabId).toBe(7);
      expect(msg).toEqual({ type: 'GET_API_CAPTURE_ENTRIES' });
      return Promise.resolve(entries);
    });
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_API_CAPTURE_ENTRIES' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(entries);
  });

  test('responds with an empty array when there is no active tab', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_API_CAPTURE_ENTRIES' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith([]);
  });

  test('responds with an empty array when the content script is unreachable', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_API_CAPTURE_ENTRIES' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith([]);
  });
});

test('unknown message type is ignored', () => {
  capturedListener({ type: 'UNKNOWN' }, {});

  expect(chrome.tabs.query).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

// Issue #404
describe('GET_EMBEDDED_JSON', () => {
  const EMPTY = { body: '', truncated: false, found: false };

  test('forwards the selector to the active tab and relays its result', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    const result = { body: '{"a":1}', truncated: false, found: true };
    chrome.tabs.sendMessage.mockImplementation((tabId, msg) => {
      expect(tabId).toBe(7);
      expect(msg).toEqual({ type: 'GET_EMBEDDED_JSON', scriptSelector: '#__NEXT_DATA__' });
      return Promise.resolve(result);
    });
    const sendResponse = jest.fn();

    const kept = capturedListener({ type: 'GET_EMBEDDED_JSON', scriptSelector: '#__NEXT_DATA__' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(kept).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(result);
  });

  test('answers "not found" without an active tab and when the content script is unreachable', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([]));
    let sendResponse = jest.fn();
    capturedListener({ type: 'GET_EMBEDDED_JSON', scriptSelector: 'script' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith(EMPTY);

    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));
    chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    sendResponse = jest.fn();
    capturedListener({ type: 'GET_EMBEDDED_JSON', scriptSelector: 'script' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith(EMPTY);
  });
});

// Issue #429: every pick carries an id so the side panel can recognise a leftover of a handled one.
test('ELEMENT_SELECTED stores the pick id alongside the selector (and null for an older sender)', async () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2', pickId: 'k3-abc' }, {});
  await Promise.resolve();
  expect(chrome.storage.session.set).toHaveBeenCalledWith(expect.objectContaining({ pendingPickId: 'k3-abc' }));
  chrome.storage.session.set.mockClear();
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2' }, {});
  await Promise.resolve();
  expect(chrome.storage.session.set).toHaveBeenCalledWith(expect.objectContaining({ pendingPickId: null }));
});

// ── "Record my steps" (Issue #508) ──────────────────────────────────────────

describe('step recording', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('STEP_RECORDING_START remembers the tab and reloads it, so the recording starts from the page\'s start state', async () => {
    chrome.tabs.query.mockImplementation((_, cb) => cb([{ id: 7 }]));

    capturedListener({ type: 'STEP_RECORDING_START' }, {});
    await flush();

    expect(chrome.storage.session.set).toHaveBeenCalledWith({ stepRecordingTabId: 7 });
    expect(chrome.tabs.reload).toHaveBeenCalledWith(7);
  });

  test('once the recorded tab has loaded, recording is armed — after every navigation, not only the first', async () => {
    chrome.storage.session.get.mockResolvedValue({ stepRecordingTabId: 7 });

    tabUpdatedListener(7, { status: 'complete' });
    await flush();
    tabUpdatedListener(7, { status: 'complete' });
    await flush();

    expect(chrome.tabs.sendMessage.mock.calls.filter(c => c[1].type === 'START_STEP_RECORDING')).toHaveLength(2);
  });

  test('a tab that is not the recorded one, or a load that is not complete, arms nothing', async () => {
    chrome.storage.session.get.mockResolvedValue({ stepRecordingTabId: 7 });

    tabUpdatedListener(8, { status: 'complete' });
    tabUpdatedListener(7, { status: 'loading' });
    await flush();

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('a page whose content script never answers ends the recording and tells the panel', async () => {
    jest.useFakeTimers();
    chrome.storage.session.get.mockResolvedValue({ stepRecordingTabId: 7 });
    chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection'));

    tabUpdatedListener(7, { status: 'complete' });
    for (let i = 0; i < 6; i++) { await Promise.resolve(); jest.advanceTimersByTime(400); await Promise.resolve(); }
    jest.useRealTimers();
    await flush();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'STEP_RECORDING_ENDED', reason: 'Could not establish connection' });
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('stepRecordingTabId');
  });

  test('STEP_RECORDING_STOP stops the recorder in the tab and forgets it', async () => {
    chrome.storage.session.get.mockResolvedValue({ stepRecordingTabId: 7 });

    capturedListener({ type: 'STEP_RECORDING_STOP' }, {});
    await flush();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'STOP_STEP_RECORDING' });
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('stepRecordingTabId');
  });

  test('closing the recorded tab ends the recording', async () => {
    chrome.storage.session.get.mockResolvedValue({ stepRecordingTabId: 7 });

    tabRemovedListener(7);
    await flush();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'STEP_RECORDING_ENDED' }));
  });
});

