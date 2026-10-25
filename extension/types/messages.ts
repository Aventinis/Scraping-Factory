// The messages the content script and the service worker send to the side panel (popup/message-router.ts is the one listener), the
// requests the panel sends to the service worker, and the window.postMessage traffic between the MAIN-world network recorder
// (content/api-capture.ts) and the content script.
import type * as SFDraft from './drafts';
import type { ApiSubtreeCandidate } from '../popup/api-config';
import type * as SFWire from './wire';
import type { HighlightStep } from '../popup/hover-highlight';

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

// One thing the user did while recording their steps (Issue #508). Never carries typed text: a fill only names the field.
export type RecordedStep =
  | { kind: 'click'; selector: string; framePath: string[] | null; late: boolean }
  | { kind: 'fill'; selector: string; framePath: string[] | null; late: boolean; inputType: string }
  | { kind: 'scroll'; containerSelector: string | null; framePath: string[] | null };

export type PopupInboundMessage =
  | ElementSelectedMessage
  | { type: 'STEP_RECORDED'; step: RecordedStep }
  | { type: 'STEP_RECORDING_ENDED'; reason: string }
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
  | { ok: false; error: string; robotsUrl?: string; path?: string };

// ── Service worker (background/service-worker.ts) ──

// Relayed unchanged to the active tab's content script; a failed relay tells the panel for the ones that have an *_UNAVAILABLE reply.
export type ForwardedToTabType =
  | 'START_SELECTION' | 'STOP_SELECTION' | 'ENABLE_DOM_VIEW' | 'DISABLE_DOM_VIEW' | 'PREVIEW_START' | 'PREVIEW_STOP'
  | 'HOVER_HIGHLIGHT' | 'HOVER_HIGHLIGHT_CLEAR' | 'API_CAPTURE_START' | 'API_CAPTURE_STOP';

// Content script → side panel, forwarded as they are.
export type ForwardedToPanelType = 'HOVER_ELEMENT' | 'DOM_TREE' | 'PREVIEW_RESULT' | 'API_CAPTURE_ENTRY' | 'API_CANDIDATES' | 'STEP_RECORDED';

export type ServiceWorkerInboundMessage =
  | { type: 'GET_LOGS' }
  | { type: 'GET_API_CAPTURE_ENTRIES' }
  | { type: 'GET_EMBEDDED_JSON'; scriptSelector: string }
  | { type: 'COUNT_PICK_WITH_TEXT'; text: string }
  | { type: 'CHECK_ROBOTS_TXT' }
  | { type: 'STEP_RECORDING_START' | 'STEP_RECORDING_STOP' }
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

// ── Content script (content/content-script.ts) ──

// Everything the content script's one onMessage listener answers; the service worker relays most of these from the side panel.
export type ContentScriptInboundMessage =
  | {
      type: 'START_SELECTION';
      scopeSelector?: string | null;
      avoidId?: boolean;
      apiSearch?: boolean;
      apiScopePath?: string | null;
      embeddedJsonSearch?: boolean;
      embeddedJsonScopePath?: string | null;
      embeddedJsonScriptSelector?: string | null;
    }
  | { type: 'STOP_SELECTION' | 'ENABLE_DOM_VIEW' | 'DISABLE_DOM_VIEW' | 'PREVIEW_STOP' | 'HOVER_HIGHLIGHT_CLEAR' }
  | { type: 'PREVIEW_START'; mode: string; fields?: Array<{ name: string; selector: string }>; groups?: SFWire.ContainerNode[] }
  | { type: 'HOVER_HIGHLIGHT'; name: string; steps: HighlightStep[]; framePath?: string[] | null }
  | { type: 'API_CAPTURE_START' | 'API_CAPTURE_STOP' }
  | { type: 'START_STEP_RECORDING' | 'STOP_STEP_RECORDING' }
  | { type: 'GET_LOGS' | 'GET_API_CAPTURE_ENTRIES' | 'CHECK_ROBOTS_TXT' }
  | { type: 'GET_EMBEDDED_JSON'; scriptSelector: string }
  | { type: 'COUNT_PICK_WITH_TEXT'; text: string };

// A frame asks its parent which <iframe> embeds it (window.postMessage, one hop at a time up to the top document).
export type FramePathMessage =
  | { source: 'sf-frame-path'; type: 'REQUEST'; requestId: number }
  | { source: 'sf-frame-path'; type: 'REPLY'; requestId: number; path: string[] | null };
