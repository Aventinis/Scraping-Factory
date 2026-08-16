// Pure message relay between popup and content script.
// The popup cannot send messages directly to a content script — it must go
// through the service worker, which has access to chrome.tabs.

function log(event, data) {
  const ts = new Date().toISOString().slice(11, 23);
  data !== undefined
    ? console.log(`[SF:SW ${ts}]`, event, data)
    : console.log(`[SF:SW ${ts}]`, event);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  log('MSG_IN', { type: message.type, fromTab: sender.tab?.id ?? 'popup' });

  if (message.type === 'START_SELECTION' || message.type === 'STOP_SELECTION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        log('FWD_SKIP — no active tab');
        return;
      }
      log('FWD → tab', { tabId: tabs[0].id, type: message.type });
      chrome.tabs.sendMessage(tabs[0].id, message);
    });
  }

  if (message.type === 'ELEMENT_SELECTED') {
    // Store selector in session storage so the popup can read it when it
    // reopens — clicking an element always closes the popup first.
    log('STORE pendingSelector', message.selector);
    chrome.storage.session
      .set({ pendingSelector: message.selector })
      .then(() => log('STORE OK'))
      .catch(err => log('STORE ERR', err.message));

    // Also attempt a real-time forward in case the popup is still open.
    chrome.runtime.sendMessage(message)
      .then(() => log('FWD → popup OK'))
      .catch(() => log('FWD → popup MISS (popup closed — selector saved in session storage)'));
  }
});
