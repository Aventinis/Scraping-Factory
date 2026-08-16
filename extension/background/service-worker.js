// Pure message relay between popup and content script.
// The popup cannot send messages directly to a content script — it must go
// through the service worker, which has access to chrome.tabs.

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'START_SELECTION' || message.type === 'STOP_SELECTION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message);
      }
    });
  }

  if (message.type === 'ELEMENT_SELECTED') {
    // Content script → popup. Exclude the sending tab so the message doesn't
    // loop back to the content script.
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup may be closed; ignore the error.
    });
  }
});
