// Types of the popup's internal draft state (SFDraft): richer, popup-only shapes that the feature modules' build*/serialize*/apply*
// functions convert to and from the wire format (types/wire.ts). Import as a namespace, like the wire types:
//   import type * as SFDraft from '../types/drafts';

import type * as SFWire from './wire';

// ── Container mode (container-tree.ts) ───────────────────────────────────

export type FieldMode = 'text' | 'attribute' | 'exists' | 'ownText';

export type ContainerNode = GroupNode | FieldNode;

export interface GroupNode {
  kind: 'group';
  name: string;
  selector: string;
  repeating: boolean;
  children: ContainerNode[];
  framePath: string[] | null;
}

export interface FieldNode {
  kind: 'field';
  name: string;
  selector: string | null;
  mode: FieldMode;
  attribute: string | null;
  framePath: string[] | null;
  transforms: SFWire.FieldTransform[] | null;
  download: boolean;
  maxDownloadSizeBytes: number | null;
  allowedContentTypes: string[];
  hiddenFromOutput: boolean;
}

// ── Flat mode (scraping-config-builder.ts) ───────────────────────────────

/**
 * Built by addField — distinct from SFWire.ScrapingField only in that every
 * optional wire field is always present (never omitted) in the draft.
 */
export interface Field {
  name: string;
  selector: string | null;
  attribute: string | null;
  framePath: string[] | null;
  transforms: SFWire.FieldTransform[] | null;
  download: boolean;
  maxDownloadSizeBytes: number | null;
  allowedContentTypes: string[];
  hiddenFromOutput: boolean;
}

// ── Browser actions (scraping-config-builder.ts) ─────────────────────────

/** UI-only purpose of a "Login form" starter action; never sent to the companion. */
export type BrowserActionRole = 'user' | 'password' | 'submit' | 'loggedIn';

export interface BrowserAction {
  kind: 'waitFor' | 'fill' | 'click' | 'scroll';
  role?: BrowserActionRole;
  selector?: string;
  timeoutMs?: number;
  environmentVariableName?: string;
  containerSelector?: string;
  loadMoreButtonSelector?: string;
  maxIterations?: number;
  waitAfterMs?: number;
  /** null/unset = jump to the bottom each round. */
  scrollStepPx?: number | null;
  /** Which match a click action clicks; waitAfterMs (above) is the pause after each click for 'all'. */
  target?: 'first' | 'last' | 'all';
  framePath?: string[] | null;
}

// ── Monitoring/settings sections (scraping-config-builder.ts) ────────────

export interface ChangeDetectionState {
  enabled: boolean;
  notify: 'Email' | 'Webhook';
  email: {
    smtpHostEnvVar: string;
    smtpPortEnvVar: string;
    smtpUsernameEnvVar: string;
    smtpPasswordEnvVar: string;
    fromEnvVar: string;
    toEnvVar: string;
  };
  webhook: { urlEnvVar: string };
}

export interface ProxyState {
  enabled: boolean;
  envVar: string;
}

// Inputs as typed — see buildRetryConfig.
export interface RetryState {
  enabled: boolean;
  maxAttemptsText: string;
  delaySecondsText: string;
  exponential: boolean;
  statusCodesText: string;
}

// See dedup-config.ts. retentionValueText is kept as typed.
export interface DeduplicationState {
  enabled: boolean;
  keyFields: string[];
  incremental: boolean;
  appendOutput: boolean;
  retentionKind: 'MaxCount' | 'MaxAge';
  retentionValueText: string;
}

// See request-headers.ts. `value` is the literal for kind
// 'value', the environment variable's *name* for kind 'env'.
export interface RequestHeaderRow {
  name: string;
  kind: 'value' | 'env';
  value: string;
}

export interface RequestHeadersState {
  enabled: boolean;
  rows: RequestHeaderRow[];
}

// Seconds as typed (decimal comma or point); blank max = fixed.
export interface RequestDelayState {
  enabled: boolean;
  minSecondsText: string;
  maxSecondsText: string;
}

// The robots.txt Disallow check — action as sent on the wire.
export interface RobotsDisallowState {
  enabled: boolean;
  action: 'Warn' | 'Skip' | 'Abort';
}

export interface PaginationState {
  enabled: boolean;
  kind: 'nextLink' | 'pageNumber';
  nextLinkSelector: string;
  urlTemplate: string;
  maxPages: number;
  /** UI-only: absolute href of the last "next" / "page 2" link the user clicked; never sent. */
  linkHref?: string;
}

export interface DiscoveredUrlsState {
  enabled: boolean;
  pageUrl: string;
  linkSelector: string;
  maxUrls: number;
}

export interface NullRateRow {
  fieldName: string;
  threshold: number;
  severity: SFWire.HardeningSeverity;
}

export interface HardeningState {
  noResult: { enabled: boolean; severity: SFWire.HardeningSeverity };
  nullRate: NullRateRow[];
  baseline: { enabled: boolean; severity: SFWire.HardeningSeverity; dropThresholdPercent: number };
  blocking: { enabled: boolean; severity: SFWire.HardeningSeverity; minBodyLengthText: string; phrasesText: string };
  requiredFields: { enabled: boolean; severity: SFWire.HardeningSeverity; fields: string[] };
}

// ── Global (cross-session) settings (shared/global-settings.ts) ─────────

export interface GlobalSettings {
  scriptNameMode: 'fixed' | 'hostname';
  scriptNameFixed: string;
}

// ── Combined / Blocks mode (scraping-config-builder.ts) ──────────────────

export interface CombinedComponent {
  name: string;
  config: SFWire.ScrapingConfig;
  savedConfigId?: number | null;
}

export interface Block {
  name?: string;
  outputFileName?: string;
  shape: 'flat' | 'group';
  fields?: Field[];
  groups?: ContainerNode[];
}

// ── Output Blueprints: tree-schema draft (config-import.ts, scraping-config-builder.ts) ──

export interface OutputBlueprintTreeNode {
  name: string;
  /** Absent or null for a leaf (the companion serializes a leaf's children as null). */
  children?: OutputBlueprintTreeNode[] | null;
}

// The blueprint editor's own tree (output-blueprints.ts): a group has children, a field is a leaf; no selector / mode / repeating.
export interface BlueprintSchemaGroup {
  kind: 'group';
  name: string;
  children: BlueprintSchemaNode[];
}

export interface BlueprintSchemaField {
  kind: 'field';
  name: string;
}

export type BlueprintSchemaNode = BlueprintSchemaGroup | BlueprintSchemaField;

// ── API mode: token/auth bootstrap (api-bootstrap.ts, Issue #220) ─────────

export interface ApiBootstrapPair {
  name: string;
  mode: 'literal' | 'env';
  value: string;
  envName: string;
}

export interface ApiBootstrap {
  name: string;
  method: 'GET' | 'POST';
  url: string;
  valuePath: string;
  bodyEncoding: 'Json' | 'Form';
  headers: ApiBootstrapPair[];
  bodyFields: ApiBootstrapPair[];
}

// ── API mode: cursor/token pagination (api-cursor-pagination.ts, Issue #224) ─

export interface ApiCursorPagination {
  nextCursorPath: string;
  hasNextPagePath: string;
  target: 'Query' | 'Body';
  queryParameterName: string;
  bodyPath: string;
  maxPages: number;
}

// ── API mode: Link-header pagination (api-link-pagination.ts, Issue #321) ──

export interface ApiLinkHeaderPagination {
  maxPages: number;
}

// One GET_API_CAPTURE_ENTRIES entry (content/api-capture.js's buildEntry).
export interface ApiCaptureEntry {
  id: number;
  url: string;
  method: string;
  status: number;
  contentType: string | null;
  body: string;
  requestHeaders?: Array<{ name: string; value: string }>;
  requestBody?: string;
  hasNextLink?: boolean;
  requestBodySkipped?: boolean;
}
