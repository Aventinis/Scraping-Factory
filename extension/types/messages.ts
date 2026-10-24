// The messages the content script and the service worker send to the side panel (popup/message-router.ts is the one listener), the
// requests the panel sends to the service worker, and the window.postMessage traffic between the MAIN-world network recorder
// (content/api-capture.ts) and the content script.
import type * as SFDraft from './drafts';
import type { ApiSubtreeCandidate } from '../popup/api-config';

// A recorded request or embedded-JSON value the user's click matched; the content script adds more fields than the popup reads.
export interface ApiCandidate extends ApiSubtreeCandidate {
  path: string;
  siblings: Array<{ name: string; value?: unknown }>;
  itemsPath?: string | null;
  valuePath?: string | null;
  /** Network candidates: the recorded request. */
  url?: string;
  method?: string;
  entryId?: number;
  requestHeaders?: Array<{ name: string; value: string }>;
  hasNextLink?: boolean;
  /** Embedded-JSON candidates: the <script> tag the value was found in. */
  scriptSelector?: string;
  [key: string]: unknown;
}

export interface ElementSelectedMessage {
  type: 'ELEMENT_SELECTED';
  selector: string;
  /** The picked element's child-index path from <body>, for the DOM tree view. */
  path?: number[];
  matchCount?: number | null;
  rawText?: string | null;
  attributes?: Record<string, string> | null;
  ownText?: string | null;
  framePath?: string[] | null;
  /** The page the pick happened on. */
  url?: string;
  pickId?: string;
}

export interface SelectionUnavailableMessage {
  type: 'SELECTION_UNAVAILABLE';
  reason: string;
  unavailableKind?: 'scopeSelectorNotFound';
}

// One element of the page's DOM as the content script serializes it for the inspector tree.
export interface DomTreeNode {
  tag: string;
  id: string | null;
  classes: string[];
  /** Child-index path from <body>. */
  path: number[];
  children: DomTreeNode[];
}

export interface DomTreeMessage {
  type: 'DOM_TREE';
  tree?: DomTreeNode | null;
  truncated?: boolean;
  error?: string;
}

export interface ApiCandidatesMessage {
  type: 'API_CANDIDATES' | 'EMBEDDED_JSON_CANDIDATES';
  target: string;
  candidates?: ApiCandidate[];
}

export type PopupInboundMessage =
  | ElementSelectedMessage
  | SelectionUnavailableMessage
  | { type: 'SELECTION_CLICK_OUT_OF_SCOPE' }
  | DomTreeMessage
  | { type: 'HOVER_ELEMENT'; path: number[] }
  | { type: 'PREVIEW_RESULT'; total: number; empty: string[]; truncated: boolean }
  | { type: 'PREVIEW_UNAVAILABLE'; reason: string }
  | { type: 'API_CAPTURE_ENTRY'; entry: SFDraft.ApiCaptureEntry }
  | { type: 'API_CAPTURE_UNAVAILABLE'; reason: string }
  | ApiCandidatesMessage;

export type RobotsTxtResult =
  | { ok: true; robotsUrl: string; path: string; notFound: boolean; allowed: boolean; matchedRule: { type: string; pattern: string } | null }
  | { ok: false; error: string };

// ── Service worker (background/service-worker.ts) ──

// Relayed unchanged to the active tab's content script; a failed relay tells the panel for the ones that have an *_UNAVAILABLE reply.
export type ForwardedToTabType =
  | 'START_SELECTION' | 'STOP_SELECTION' | 'ENABLE_DOM_VIEW' | 'DISABLE_DOM_VIEW' | 'PREVIEW_START' | 'PREVIEW_STOP'
  | 'HOVER_HIGHLIGHT' | 'HOVER_HIGHLIGHT_CLEAR' | 'API_CAPTURE_START' | 'API_CAPTURE_STOP';

// Content script → side panel, forwarded as they are.
export type ForwardedToPanelType = 'HOVER_ELEMENT' | 'DOM_TREE' | 'PREVIEW_RESULT' | 'API_CAPTURE_ENTRY' | 'API_CANDIDATES';

export type ServiceWorkerInboundMessage =
  | { type: 'GET_LOGS' }
  | { type: 'GET_API_CAPTURE_ENTRIES' }
  | { type: 'GET_EMBEDDED_JSON'; scriptSelector: string }
  | { type: 'COUNT_PICK_WITH_TEXT'; text: string }
  | { type: 'CHECK_ROBOTS_TXT' }
  | { type: ForwardedToTabType; [key: string]: unknown }
  | { type: ForwardedToPanelType; [key: string]: unknown }
  | ElementSelectedMessage;

export interface EmbeddedJsonResult {
  body: string;
  truncated: boolean;
  found: boolean;
}

// ── MAIN-world recorder ↔ content script (window.postMessage) ──

export interface ApiCaptureEntryWindowMessage {
  source: 'sf-api-capture';
  type: 'API_CAPTURE_ENTRY';
  entry: SFDraft.ApiCaptureEntry;
}

export interface ApiCaptureControlWindowMessage {
  source: 'sf-api-capture-control';
  type: 'API_CAPTURE_START' | 'API_CAPTURE_STOP';
}

export type ApiCaptureWindowMessage = ApiCaptureEntryWindowMessage | ApiCaptureControlWindowMessage;
