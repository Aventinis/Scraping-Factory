// Pure message relay between the side panel UI and content script.
// The side panel cannot send messages directly to a content script — it
// must go through the service worker, which has access to chrome.tabs.

import { createLogger, getLogBuffer } from '../shared/logger';
import type { ForwardedToTabType, ServiceWorkerInboundMessage, EmbeddedJsonResult, RobotsTxtResult } from '../types/messages';

const log = createLogger('SF:SW');

// Surfaces otherwise-silent script errors in the bug report (see GET_LOGS
// below) instead of only showing up in chrome://extensions' error console.
self.addEventListener('error', (e: ErrorEvent) => log('UNCAUGHT_ERROR', e.message));
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => log('UNHANDLED_REJECTION', String(e.reason)));

// Open the side panel on action-icon click instead of a classic popup, so
// the UI stays open while the user clicks elements on the page to select
// them (a popup closes on the first outside click, interrupting selection).
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  ?.catch((err: Error) => log('SIDE_PANEL_BEHAVIOR ERR', err.message));

// The listener only ever asks for the active tab, which always has an id; chrome.tabs.Tab types it as optional.
const activeTabId = (tabs: chrome.tabs.Tab[]): number => tabs[0].id as number;

const FORWARD_TO_TAB: readonly ForwardedToTabType[] = ['START_SELECTION', 'STOP_SELECTION', 'ENABLE_DOM_VIEW', 'DISABLE_DOM_VIEW', 'PREVIEW_START', 'PREVIEW_STOP', 'HOVER_HIGHLIGHT', 'HOVER_HIGHLIGHT_CLEAR', 'API_CAPTURE_START', 'API_CAPTURE_STOP'];

const NO_EMBEDDED_JSON: EmbeddedJsonResult = { body: '', truncated: false, found: false };

chrome.runtime.onMessage.addListener((message: ServiceWorkerInboundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
  log('MSG_IN', { type: message.type, fromTab: sender.tab?.id ?? 'sidepanel' });

  if (message.type === 'GET_LOGS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const background = getLogBuffer();
      if (tabs.length === 0) {
        sendResponse({ background, content: null, contentError: 'no active tab' });
        return;
      }
      chrome.tabs.sendMessage(activeTabId(tabs), { type: 'GET_LOGS' })
        .then((content) => sendResponse({ background, content, contentError: null }))
        .catch((err: Error) => sendResponse({ background, content: null, contentError: err.message }));
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  if (message.type === 'GET_API_CAPTURE_ENTRIES') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse([]);
        return;
      }
      chrome.tabs.sendMessage(activeTabId(tabs), { type: 'GET_API_CAPTURE_ENTRIES' })
        .then((entries) => sendResponse(entries || []))
        .catch(() => sendResponse([])); // no content script on this tab — same as GET_LOGS' content half, but nothing else here needs a background half
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  // Issue #404: the JSON of an embedded <script> tag for the JSON-path picker —
  // same request/response relay as GET_API_CAPTURE_ENTRIES; the popup treats
  // { found: false } as "nothing to pick from".
  if (message.type === 'GET_EMBEDDED_JSON') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse(NO_EMBEDDED_JSON);
        return;
      }
      chrome.tabs.sendMessage(activeTabId(tabs), { type: 'GET_EMBEDDED_JSON', scriptSelector: message.scriptSelector })
        .then((result: EmbeddedJsonResult | undefined) => sendResponse(result || NO_EMBEDDED_JSON))
        .catch(() => sendResponse(NO_EMBEDDED_JSON));
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  // Issue #227: live match count for a text filter on the last picked element
  // — same request/response relay as GET_API_CAPTURE_ENTRIES. Whichever frame
  // made the pick answers; if none does (or the tab has no content script),
  // the popup simply gets { count: null } and shows no live count.
  if (message.type === 'COUNT_PICK_WITH_TEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse({ count: null });
        return;
      }
      chrome.tabs.sendMessage(activeTabId(tabs), { type: 'COUNT_PICK_WITH_TEXT', text: message.text })
        .then((result: { count: number | null } | undefined) => sendResponse(result || { count: null }))
        .catch(() => sendResponse({ count: null }));
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  if (message.type === 'CHECK_ROBOTS_TXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse({ ok: false, error: 'Keine aktive Seite gefunden.' });
        return;
      }
      chrome.tabs.sendMessage(activeTabId(tabs), { type: 'CHECK_ROBOTS_TXT' })
        .then((result: RobotsTxtResult) => sendResponse(result))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message } satisfies RobotsTxtResult));
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  if ((FORWARD_TO_TAB as readonly string[]).includes(message.type)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        log('FWD_SKIP — no active tab');
        return;
      }
      log('FWD → tab', { tabId: tabs[0].id, type: message.type });
      chrome.tabs.sendMessage(activeTabId(tabs), message)
        .then(() => log('FWD → tab OK', message.type))
        .catch((err: Error) => {
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
      .set({
        pendingSelector: message.selector,
        pendingFramePath: message.framePath ?? null,
        pendingMatchCount: typeof message.matchCount === 'number' ? message.matchCount : null,
        // Issue #143: underlying-selection state like pendingMatchCount
        // above (tied to the DOM pick, not user-typed form input), so it
        // survives a reopened popup the same way.
        pendingRawText: typeof message.rawText === 'string' ? message.rawText : null,
        pendingElementAttributes: message.attributes ?? null,
        // Issue #169: same treatment, for OwnText mode's own live preview.
        pendingOwnText: typeof message.ownText === 'string' ? message.ownText : null,
        // The page this selection actually happened on — same treatment,
        // for session-restore.ts's own stale-tracked-url self-correction.
        pendingUrl: typeof message.url === 'string' ? message.url : null,
        // Issue #429: lets session-restore.ts tell a leftover of an already handled pick apart.
        pendingPickId: typeof message.pickId === 'string' ? message.pickId : null,
      })
      .then(() => log('STORE OK'))
      .catch((err: Error) => log('STORE ERR', err.message));

    // Also attempt a real-time forward in case the side panel is open —
    // unlike a classic popup, the side panel stays open across page
    // interactions, so this is the common case.
    chrome.runtime.sendMessage(message)
      .then(() => log('FWD → sidepanel OK'))
      .catch(() => log('FWD → sidepanel MISS (not open — selector saved in session storage)'));
  }
});
