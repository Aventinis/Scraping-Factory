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

test('unknown message type is ignored', () => {
  capturedListener({ type: 'UNKNOWN' }, {});

  expect(chrome.tabs.query).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
