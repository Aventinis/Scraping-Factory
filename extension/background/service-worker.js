// Pure message relay between the side panel UI and content script.
// The side panel cannot send messages directly to a content script — it
// must go through the service worker, which has access to chrome.tabs.

function log(event, data) {
  const ts = new Date().toISOString().slice(11, 23);
  data !== undefined
    ? console.log(`[SF:SW ${ts}]`, event, data)
    : console.log(`[SF:SW ${ts}]`, event);
}

// Open the side panel on action-icon click instead of a classic popup, so
// the UI stays open while the user clicks elements on the page to select
// them (a popup closes on the first outside click, interrupting selection).
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  ?.catch(err => log('SIDE_PANEL_BEHAVIOR ERR', err.message));

chrome.runtime.onMessage.addListener((message, sender) => {
  log('MSG_IN', { type: message.type, fromTab: sender.tab?.id ?? 'sidepanel' });

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
    // Store selector in session storage as a fallback for cases where the
    // side panel isn't open to receive the real-time message below (e.g.
    // the user closed it manually, or it hasn't finished loading yet).
    log('STORE pendingSelector', message.selector);
    chrome.storage.session
      .set({ pendingSelector: message.selector })
      .then(() => log('STORE OK'))
      .catch(err => log('STORE ERR', err.message));

    // Also attempt a real-time forward in case the side panel is open —
    // unlike a classic popup, the side panel stays open across page
    // interactions, so this is the common case.
    chrome.runtime.sendMessage(message)
      .then(() => log('FWD → sidepanel OK'))
      .catch(() => log('FWD → sidepanel MISS (not open — selector saved in session storage)'));
  }
});
