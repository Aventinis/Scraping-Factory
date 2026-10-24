// The messages the content script and the service worker send to the side panel (popup/message-router.ts is the one listener), and the
// one request the panel itself sends that has a typed answer. The service worker and content script adopt the same shapes when they
// are converted.
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

export interface DomTreeMessage {
  type: 'DOM_TREE';
  tree?: unknown;
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
  | { type: 'PREVIEW_RESULT'; total: number; empty: number; truncated: boolean }
  | { type: 'PREVIEW_UNAVAILABLE'; reason: string }
  | { type: 'API_CAPTURE_ENTRY'; entry: SFDraft.ApiCaptureEntry }
  | { type: 'API_CAPTURE_UNAVAILABLE'; reason: string }
  | ApiCandidatesMessage;

export type RobotsTxtResult =
  | { ok: true; robotsUrl: string; path: string; notFound: boolean; allowed: boolean | null; matchedRule: unknown }
  | { ok: false; error: string };
