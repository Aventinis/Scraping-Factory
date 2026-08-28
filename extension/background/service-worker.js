// Pure message relay between the side panel UI and content script.
// The side panel cannot send messages directly to a content script — it
// must go through the service worker, which has access to chrome.tabs.

if (typeof require === 'undefined' && typeof importScripts === 'function') {
  importScripts('../shared/logger.js');
}
const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:SW');

// Surfaces otherwise-silent script errors in the bug report (see GET_LOGS
// below) instead of only showing up in chrome://extensions' error console.
self.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
self.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));

// Open the side panel on action-icon click instead of a classic popup, so
// the UI stays open while the user clicks elements on the page to select
// them (a popup closes on the first outside click, interrupting selection).
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  ?.catch(err => log('SIDE_PANEL_BEHAVIOR ERR', err.message));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('MSG_IN', { type: message.type, fromTab: sender.tab?.id ?? 'sidepanel' });

  if (message.type === 'GET_LOGS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const background = getLogBuffer();
      if (tabs.length === 0) {
        sendResponse({ background, content: null, contentError: 'no active tab' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_LOGS' })
        .then((content) => sendResponse({ background, content, contentError: null }))
        .catch((err) => sendResponse({ background, content: null, contentError: err.message }));
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  if (message.type === 'CHECK_ROBOTS_TXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse({ ok: false, error: 'Keine aktive Seite gefunden.' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'CHECK_ROBOTS_TXT' })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  const FORWARD_TO_TAB = ['START_SELECTION', 'STOP_SELECTION', 'ENABLE_DOM_VIEW', 'DISABLE_DOM_VIEW', 'PREVIEW_START', 'PREVIEW_STOP', 'API_CAPTURE_START', 'API_CAPTURE_STOP'];
  if (FORWARD_TO_TAB.includes(message.type)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        log('FWD_SKIP — no active tab');
        return;
      }
      log('FWD → tab', { tabId: tabs[0].id, type: message.type });
      chrome.tabs.sendMessage(tabs[0].id, message)
        .then(() => log('FWD → tab OK', message.type))
        .catch((err) => {
          // No content script on this tab — e.g. chrome://, the Chrome Web
          // Store, a PDF viewer, or a page that was already open before the
          // extension was installed/reloaded. Without this .catch(), the
          // rejected promise surfaces as an uncaught error in the service
          // worker's error console.
          log('FWD → tab MISS', { type: message.type, error: err.message });
          if (message.type === 'START_SELECTION') {
            chrome.runtime.sendMessage({ type: 'SELECTION_UNAVAILABLE', reason: err.message }).catch(() => {});
          }
          if (message.type === 'PREVIEW_START') {
            chrome.runtime.sendMessage({ type: 'PREVIEW_UNAVAILABLE', reason: err.message }).catch(() => {});
          }
          if (message.type === 'API_CAPTURE_START') {
            chrome.runtime.sendMessage({ type: 'API_CAPTURE_UNAVAILABLE', reason: err.message }).catch(() => {});
          }
        });
    });
  }

  if (message.type === 'HOVER_ELEMENT' || message.type === 'DOM_TREE' || message.type === 'PREVIEW_RESULT' || message.type === 'API_CAPTURE_ENTRY' || message.type === 'API_CANDIDATES') {
    // Transient, side-panel-only messages — no session storage fallback,
    // since missing one while the panel is closed is harmless.
    chrome.runtime.sendMessage(message)
      .then(() => log('FWD → sidepanel OK', message.type))
      .catch(() => log('FWD → sidepanel MISS', message.type));
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
