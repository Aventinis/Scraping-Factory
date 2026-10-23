// Ambient types for the popup's internal draft state (SFDraft): richer, popup-only shapes that the feature modules'
// build*/serialize*/apply* functions convert to and from the wire format (SFWire in companion-ir.d.ts). They live in
// one shared ambient namespace because a JSDoc @typedef in a plain script is file-scoped for the type checker, so a
// shape like container-tree.js's tree node could not otherwise be referenced from other files. No top-level
// import/export.
declare namespace SFDraft {
  // ── Container mode (container-tree.js) ───────────────────────────────────

  type FieldMode = 'text' | 'attribute' | 'exists' | 'ownText';

  type ContainerNode = GroupNode | FieldNode;

  interface GroupNode {
    kind: 'group';
    name: string;
    selector: string;
    repeating: boolean;
    children: ContainerNode[];
    framePath: string[] | null;
  }

  interface FieldNode {
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

  // ── Flat mode (scraping-config-builder.js) ───────────────────────────────

  /**
   * Built by addField — distinct from SFWire.ScrapingField only in that every
   * optional wire field is always present (never omitted) in the draft.
   */
  interface Field {
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

  // ── Browser actions (scraping-config-builder.js) ─────────────────────────

  /** UI-only purpose of a "Login form" starter action; never sent to the companion. */
  type BrowserActionRole = 'user' | 'password' | 'submit' | 'loggedIn';

  interface BrowserAction {
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

  // ── Monitoring/settings sections (scraping-config-builder.js) ────────────

  interface ChangeDetectionState {
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

  interface ProxyState {
    enabled: boolean;
    envVar: string;
  }

  // Inputs as typed — see buildRetryConfig.
  interface RetryState {
    enabled: boolean;
    maxAttemptsText: string;
    delaySecondsText: string;
    exponential: boolean;
    statusCodesText: string;
  }

  // See dedup-config.js. retentionValueText is kept as typed.
  interface DeduplicationState {
    enabled: boolean;
    keyFields: string[];
    incremental: boolean;
    appendOutput: boolean;
    retentionKind: 'MaxCount' | 'MaxAge';
    retentionValueText: string;
  }

  // See request-headers.js. `value` is the literal for kind
  // 'value', the environment variable's *name* for kind 'env'.
  interface RequestHeaderRow {
    name: string;
    kind: 'value' | 'env';
    value: string;
  }

  interface RequestHeadersState {
    enabled: boolean;
    rows: RequestHeaderRow[];
  }

  // Seconds as typed (decimal comma or point); blank max = fixed.
  interface RequestDelayState {
    enabled: boolean;
    minSecondsText: string;
    maxSecondsText: string;
  }

  // The robots.txt Disallow check — action as sent on the wire.
  interface RobotsDisallowState {
    enabled: boolean;
    action: 'Warn' | 'Skip' | 'Abort';
  }

  interface PaginationState {
    enabled: boolean;
    kind: 'nextLink' | 'pageNumber';
    nextLinkSelector: string;
    urlTemplate: string;
    maxPages: number;
    /** UI-only: absolute href of the last "next" / "page 2" link the user clicked; never sent. */
    linkHref?: string;
  }

  interface DiscoveredUrlsState {
    enabled: boolean;
    pageUrl: string;
    linkSelector: string;
    maxUrls: number;
  }

  interface NullRateRow {
    fieldName: string;
    threshold: number;
    severity: SFWire.HardeningSeverity;
  }

  interface HardeningState {
    noResult: { enabled: boolean; severity: SFWire.HardeningSeverity };
    nullRate: NullRateRow[];
    baseline: { enabled: boolean; severity: SFWire.HardeningSeverity; dropThresholdPercent: number };
    blocking: { enabled: boolean; severity: SFWire.HardeningSeverity; minBodyLengthText: string; phrasesText: string };
    requiredFields: { enabled: boolean; severity: SFWire.HardeningSeverity; fields: string[] };
  }

  // ── Global (cross-session) settings (shared/global-settings.js) ─────────

  interface GlobalSettings {
    scriptNameMode: 'fixed' | 'hostname';
    scriptNameFixed: string;
  }

  // ── Combined / Blocks mode (scraping-config-builder.js) ──────────────────

  interface CombinedComponent {
    name: string;
    config: SFWire.ScrapingConfig;
    savedConfigId?: number | null;
  }

  interface Block {
    name?: string;
    outputFileName?: string;
    shape: 'flat' | 'group';
    fields?: Field[];
    groups?: ContainerNode[];
  }

  // ── Output Blueprints: tree-schema draft (config-import.js, scraping-config-builder.js) ──

  interface OutputBlueprintTreeNode {
    name: string;
    children?: OutputBlueprintTreeNode[];
  }

  // ── API mode: token/auth bootstrap (api-bootstrap.js, Issue #220) ─────────

  interface ApiBootstrapPair {
    name: string;
    mode: 'literal' | 'env';
    value: string;
    envName: string;
  }

  interface ApiBootstrap {
    name: string;
    method: 'GET' | 'POST';
    url: string;
    valuePath: string;
    bodyEncoding: 'Json' | 'Form';
    headers: ApiBootstrapPair[];
    bodyFields: ApiBootstrapPair[];
  }

  // ── API mode: cursor/token pagination (api-cursor-pagination.js, Issue #224) ─

  interface ApiCursorPagination {
    nextCursorPath: string;
    hasNextPagePath: string;
    target: 'Query' | 'Body';
    queryParameterName: string;
    bodyPath: string;
    maxPages: number;
  }

  // ── API mode: Link-header pagination (api-link-pagination.js, Issue #321) ──

  interface ApiLinkHeaderPagination {
    maxPages: number;
  }

  // One GET_API_CAPTURE_ENTRIES entry (content/api-capture.js's buildEntry).
  interface ApiCaptureEntry {
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
}
