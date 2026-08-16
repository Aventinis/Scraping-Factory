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
};

require('./service-worker');

beforeEach(() => {
  jest.clearAllMocks();
  chrome.runtime.sendMessage.mockResolvedValue(undefined);
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

test('ELEMENT_SELECTED is forwarded to runtime (popup)', () => {
  capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.card > h2' }, {});

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'ELEMENT_SELECTED',
    selector: 'li.card > h2',
  });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test('ELEMENT_SELECTED swallows error when popup is closed', async () => {
  chrome.runtime.sendMessage.mockRejectedValue(new Error('No popup'));

  await expect(
    new Promise((resolve) => {
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'p' }, {});
      setTimeout(resolve, 0);
    }),
  ).resolves.toBeUndefined();
});

test('unknown message type is ignored', () => {
  capturedListener({ type: 'UNKNOWN' }, {});

  expect(chrome.tabs.query).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
