let capturedListener;

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
  },
  storage: {
    session: {
      set:    jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
};

require('./service-worker');

beforeEach(() => {
  jest.clearAllMocks();
  chrome.runtime.sendMessage.mockResolvedValue(undefined);
  chrome.tabs.sendMessage.mockResolvedValue(undefined);
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

test('unknown message type is ignored', () => {
  capturedListener({ type: 'UNKNOWN' }, {});

  expect(chrome.tabs.query).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
