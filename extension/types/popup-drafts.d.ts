// Ambient JSDoc-only type declarations for the popup's internal "draft"
// state shapes (Issue #238) — richer, popup-only representations that get
// converted to/from the wire format (types/companion-ir.d.ts's `SFWire`
// namespace) by each feature module's own build*/serialize*/apply*
// functions (e.g. container-tree.js's `serializeGroupTree`, config-import.js's
// `applyHardeningConfig`). Unlike SFWire, these have no C# counterpart to
// mirror — they only need to agree across this popup's own `// @ts-check`-
// annotated files, which is exactly why they live in one shared ambient
// namespace here (`SFDraft`) rather than as a local `@typedef` duplicated
// per file: JSDoc `@typedef`s declared inside a plain script (no
// import/export, like every file in extension/popup/) are file-scoped to
// TypeScript's checker, not implicitly global the way a runtime
// `self.SFXxx` assignment is — so e.g. container-tree.js's own tree-node
// shape couldn't otherwise be referenced from scraping-config-builder.js's
// JSDoc without either this shared file or a real (unused-at-runtime)
// `import(...)` type query.
//
// No top-level import/export, so this is a plain global ambient namespace,
// same as types/companion-ir.d.ts's `SFWire`.
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

  interface BrowserAction {
    kind: 'waitFor' | 'fill' | 'click' | 'scroll';
    selector?: string;
    timeoutMs?: number;
    environmentVariableName?: string;
    containerSelector?: string;
    loadMoreButtonSelector?: string;
    maxIterations?: number;
    waitAfterMs?: number;
    /** Issue #289 — null/unset keeps the default "jump straight to the current bottom" behavior. */
    scrollStepPx?: number | null;
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

  // Issue #223: inputs as typed — see buildRetryConfig.
  interface RetryState {
    enabled: boolean;
    maxAttemptsText: string;
    delaySecondsText: string;
    exponential: boolean;
    statusCodesText: string;
  }

  // Issue #222: seconds as typed (decimal comma or point); blank max = fixed.
  interface RequestDelayState {
    enabled: boolean;
    minSecondsText: string;
    maxSecondsText: string;
  }

  interface PaginationState {
    enabled: boolean;
    kind: 'nextLink' | 'pageNumber';
    nextLinkSelector: string;
    urlTemplate: string;
    maxPages: number;
  }

  // Issue #218.
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
    requestBodySkipped?: boolean;
  }
}
