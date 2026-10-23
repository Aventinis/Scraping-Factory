// Ambient types for the companion's wire-format IR (companion/ScrapingFactory.Compiler/IR/*.cs), referenced from
// JSDoc as SFWire.ScrapingConfig etc. Hand-kept, because the custom polymorphic converters defeat schema
// generation; IrTypeDeclarationTests.cs compares every interface and string union with the C# types and
// test-vectors/wire/ checks the requests the extension builds (Issue #388). Only the wire shape is modeled; the
// popup's own draft shapes are in popup-drafts.d.ts. No top-level import/export, so these are plain global ambient
// types, grouped in one namespace to avoid clashes with module-local typedefs.
declare namespace SFWire {
  // ── Top-level request body (ScrapingConfig.cs) ──────────────────────────

  /** The exact wire shape `/generate` expects and `buildConfigExport`'s own `config` field produces. */
  interface ScrapingConfig {
    version?: string;
    url: string;
    additionalUrls?: string[];
    fields?: ScrapingField[];
    groups?: ContainerNode[];
    api?: ApiConfig;
    outputFormat?: OutputFormat;
    engine?: ScrapingEngine;
    browserActions?: BrowserAction[];
    verificationValues?: Record<string, string>;
    scriptFileName?: string | null;
    outputFileName?: string | null;
    includePreview?: boolean;
    includeOutputFile?: boolean;
    skipVerification?: boolean;
    changeDetection?: ChangeDetectionConfig;
    proxy?: ProxyConfig;
    requestDelay?: RequestDelayConfig;
    retry?: RetryConfig;
    deduplication?: DeduplicationConfig;
    headers?: ApiHeader[];
    hardening?: HardeningCheck[];
    pagination?: PaginationConfig;
    discoveredUrls?: DiscoveredUrlsConfig;
    persistentSession?: boolean;
    preflight?: boolean;
    respectRobotsDelay?: boolean;
    robotsDisallow?: RobotsDisallowConfig;
    appendOutput?: boolean;
    externalConfig?: boolean;
    combined?: CombinedComponentConfig[];
    blocks?: ExtractionBlockConfig[];
    outputBlueprint?: OutputBlueprintMapping;
  }

  type OutputFormat = 'Csv' | 'Xml' | 'Json' | 'Sqlite' | 'Xlsx';
  type ScrapingEngine = 'Static' | 'Browser' | 'Api';

  /** Flat mode's leaf (ScrapingConfig.cs's `ScrapingField`). */
  interface ScrapingField {
    name: string;
    /** May be blank only when `transforms` starts with combineFields/splitField (a derived field). */
    selector: string | null;
    attribute?: string | null;
    framePath?: string[] | null;
    transforms?: FieldTransform[] | null;
    download?: boolean;
    maxDownloadSizeBytes?: number | null;
    allowedContentTypes?: string[];
    hiddenFromOutput?: boolean;
  }

  // ── Container mode (ContainerNode.cs) ────────────────────────────────────

  type ContainerNode = GroupNode | DataFieldNode;
  type ExtractMode = 'Text' | 'Attribute' | 'Exists' | 'OwnText';

  interface GroupNode {
    name: string;
    selector: string;
    repeating: boolean;
    children: ContainerNode[];
    framePath?: string[] | null;
  }

  interface DataFieldNode {
    name: string;
    selector: string | null;
    mode: ExtractMode;
    attribute?: string | null;
    framePath?: string[] | null;
    transforms?: FieldTransform[] | null;
    download?: boolean;
    maxDownloadSizeBytes?: number | null;
    allowedContentTypes?: string[];
    hiddenFromOutput?: boolean;
  }

  // ── Field transforms (FieldTransform.cs) ─────────────────────────────────

  type FieldTransform =
    | TrimTransform
    | RegexExtractTransform
    | ReplaceTransform
    | ToNumberTransform
    | ToIntegerTransform
    | ToBooleanTransform
    | ToDateTransform
    | ToCurrencyTransform
    | CombineFieldsTransform
    | SplitFieldTransform;

  type TransformErrorMode = 'KeepOriginal' | 'UseDefault';

  interface TrimTransform { kind: 'trim'; }
  interface RegexExtractTransform { kind: 'regexExtract'; pattern: string; group?: number; }
  interface ReplaceTransform { kind: 'replace'; find: string; replacement: string; }
  interface ToNumberTransform { kind: 'toNumber'; }
  interface ToIntegerTransform { kind: 'toInteger'; onError?: TransformErrorMode; defaultValue?: string | null; }
  interface ToBooleanTransform { kind: 'toBoolean'; onError?: TransformErrorMode; defaultValue?: string | null; }
  interface ToDateTransform { kind: 'toDate'; sourceFormat?: string | null; onError?: TransformErrorMode; defaultValue?: string | null; }
  interface ToCurrencyTransform { kind: 'toCurrency'; format?: "1.234,56" | "1,234.56" | "1 234,56" | "1'234.56"; onError?: TransformErrorMode; defaultValue?: string | null; }
  interface CombineFieldsTransform { kind: 'combineFields'; sourceFieldNames: string[]; separator?: string; }
  interface SplitFieldTransform { kind: 'splitField'; sourceFieldName: string; separator?: string; index?: number; }

  // ── Browser actions (BrowserAction.cs) ───────────────────────────────────

  type BrowserAction = WaitForAction | FillAction | ClickAction | ScrollAction;

  interface WaitForAction { kind: 'waitFor'; selector: string; timeoutMs?: number; framePath?: string[] | null; }
  interface FillAction { kind: 'fill'; selector: string; environmentVariableName: string; framePath?: string[] | null; }
  interface ClickAction { kind: 'click'; selector: string; target?: 'First' | 'Last' | 'All'; waitAfterMs?: number; framePath?: string[] | null; }
  interface ScrollAction {
    kind: 'scroll';
    containerSelector?: string | null;
    loadMoreButtonSelector?: string | null;
    maxIterations?: number;
    waitAfterMs?: number;
    /** null/unset = jump to the bottom each round. */
    scrollStepPx?: number | null;
    framePath?: string[] | null;
  }

  // ── Change detection (ChangeDetectionConfig.cs) ──────────────────────────

  interface ChangeDetectionConfig {
    notify: 'Email' | 'Webhook';
    email?: EmailNotificationConfig;
    webhook?: WebhookNotificationConfig;
  }

  interface EmailNotificationConfig {
    smtpHostEnvVar: string;
    smtpPortEnvVar?: string;
    smtpUsernameEnvVar?: string;
    smtpPasswordEnvVar?: string;
    fromEnvVar: string;
    toEnvVar: string;
  }

  interface WebhookNotificationConfig {
    urlEnvVar: string;
  }

  // ── Proxy (ProxyConfig.cs) ────────────────────────────────────────────────

  interface ProxyConfig {
    environmentVariableName: string;
  }

  // See IR/RetryConfig.cs.
  interface RetryConfig {
    maxAttempts?: number;
    delayMs?: number;
    exponential?: boolean;
    retryOnStatusCodes?: number[] | null;
  }

  // See IR/DeduplicationConfig.cs.
  interface DeduplicationConfig {
    keyFields: string[];
    incremental?: boolean;
    incrementalOutput?: 'Delta' | 'Append';
    retention?: { kind: 'MaxCount' | 'MaxAge'; value: number };
  }

  // See IR/RobotsDisallowConfig.cs.
  interface RobotsDisallowConfig {
    action?: 'Warn' | 'Skip' | 'Abort';
  }

  // See IR/RequestDelayConfig.cs.
  interface RequestDelayConfig {
    minMs: number;
    maxMs: number;
  }

  // ── Pagination (PaginationConfig.cs) ─────────────────────────────────────

  type PaginationConfig = NextLinkPagination | PageNumberPagination;

  interface NextLinkPagination { kind: 'nextLink'; nextLinkSelector: string; maxPages?: number; }
  interface PageNumberPagination { kind: 'pageNumber'; urlTemplate: string; maxPages?: number; }

  // ── Discovered start URLs (DiscoveredUrlsConfig.cs, Issue #218) ──────────

  interface DiscoveredUrlsConfig { pageUrl: string; linkSelector: string; maxUrls?: number; }

  // ── Hardening (HardeningCheck.cs) ────────────────────────────────────────

  type HardeningCheck = NoResultCheck | NullRateCheck | BaselineCheck | BlockingCheck | RequiredFieldsCheck;
  type HardeningSeverity = 'Warning' | 'Error';

  interface NoResultCheck { kind: 'noResult'; severity: HardeningSeverity; }
  interface NullRateCheck { kind: 'nullRate'; severity: HardeningSeverity; fieldName: string; threshold: number; }
  interface BaselineCheck { kind: 'baseline'; severity: HardeningSeverity; dropThreshold: number; }
  interface BlockingCheck { kind: 'blocking'; severity: HardeningSeverity; minBodyLength: number | null; blockPhrases: string[]; }
  interface RequiredFieldsCheck { kind: 'requiredFields'; severity: HardeningSeverity; fieldNames: string[]; }

  // ── Output Blueprints (OutputBlueprintMapping.cs) ────────────────────────

  type OutputBlueprintSchemaKind = 'Flat' | 'Tree';

  interface OutputBlueprintMapping {
    blueprintId?: number | null;
    schemaKind: OutputBlueprintSchemaKind;
    fields?: OutputBlueprintFieldMapping[] | null;
    tree?: OutputBlueprintTreeMappingNode[] | null;
  }

  interface OutputBlueprintFieldMapping {
    targetField: string;
    sourceField: string;
  }

  type OutputBlueprintTreeMappingNode = OutputBlueprintTreeMappingGroup | OutputBlueprintTreeMappingField;

  interface OutputBlueprintTreeMappingGroup {
    name: string;
    children: OutputBlueprintTreeMappingNode[];
  }

  interface OutputBlueprintTreeMappingField {
    name: string;
    sourceField: string;
  }

  // ── API mode (ApiConfig.cs) ───────────────────────────────────────────────

  interface ApiConfig {
    method?: 'GET' | 'POST';
    urlTemplate: string;
    headers?: ApiHeader[];
    parameters: ApiParameter[];
    itemsPath?: string | null;
    fields?: ApiField[] | null;
    groups?: ApiGroup[] | null;
    body?: ApiBodyNode;
    embeddedJsonSource?: EmbeddedJsonSource;
    bootstrap?: ApiBootstrap;
    cursorPagination?: ApiCursorPagination;
    linkHeaderPagination?: ApiLinkHeaderPagination;
  }

  // See ApiConfig.LinkHeaderPagination in IR/ApiConfig.cs.
  interface ApiLinkHeaderPagination {
    maxPages: number;
  }

  // See ApiConfig.CursorPagination in IR/ApiConfig.cs.
  interface ApiCursorPagination {
    nextCursorPath: string;
    hasNextPagePath?: string;
    target: 'Query' | 'Body';
    queryParameterName?: string;
    bodyPath?: string;
    maxPages: number;
  }

  // See ApiConfig.Bootstrap in IR/ApiConfig.cs.
  interface ApiBootstrap {
    name: string;
    method?: 'GET' | 'POST';
    url: string;
    headers?: ApiHeader[];
    bodyFields?: ApiBootstrapBodyField[];
    bodyEncoding?: 'Json' | 'Form';
    valuePath: string;
  }

  interface ApiBootstrapBodyField {
    name: string;
    value?: string | null;
    environmentVariableName?: string | null;
  }

  interface EmbeddedJsonSource {
    scriptSelector: string;
  }

  interface ApiHeader {
    name: string;
    value?: string | null;
    environmentVariableName?: string | null;
    template?: string | null;
  }

  interface ApiParameter {
    name: string;
    source: ApiParameterSource;
  }

  type ApiParameterSource = StaticListSource | DiscoverySource | RangeSource | BrowserDiscoverySource;

  interface StaticListSource { kind: 'staticList'; values: string[]; }
  interface DiscoverySource { kind: 'discovery'; method?: 'GET'; urlTemplate: string; itemsPath: string; valuePath: string; }
  interface RangeSource { kind: 'range'; type: RangeType; from: string; to: string; format?: string; }
  /** No URL pattern of its own: matched against the enclosing ApiConfig.urlTemplate at run time. */
  interface BrowserDiscoverySource { kind: 'browserDiscovery'; discoveryUrl: string; actions?: BrowserAction[]; }

  type RangeType = 'IsoWeek' | 'Number' | 'Date';

  // ── API mode: nested response tree (Issue #54) ───────────────────────────

  type ApiNode = ApiGroup | ApiField;

  interface ApiGroup {
    name: string;
    path: string;
    children: ApiNode[];
  }

  interface ApiField {
    name: string;
    path?: string | null;
    transforms?: FieldTransform[] | null;
    hiddenFromOutput?: boolean;
  }

  // ── API mode: request body tree (Issue #55) ──────────────────────────────

  type ApiBodyNode = ApiBodyObject | ApiBodyArray | ApiBodyLiteral | ApiBodyVariable;
  type ApiBodyLiteralKind = 'String' | 'Number' | 'Boolean' | 'Null';

  interface ApiBodyObject { properties: Record<string, ApiBodyNode>; }
  interface ApiBodyArray { items: ApiBodyNode[]; }
  interface ApiBodyLiteral {
    kind: ApiBodyLiteralKind;
    stringValue?: string | null;
    numberValue?: number | null;
    boolValue?: boolean | null;
  }
  interface ApiBodyVariable {
    parameterName: string;
    coerceTo?: ApiBodyLiteralKind | null;
  }

  // ── Combined mode (CombinedComponentConfig.cs) ───────────────────────────

  interface CombinedComponentConfig {
    name?: string | null;
    config: ScrapingConfig;
    verificationValues?: Record<string, string>;
    savedConfigId?: number | null;
  }

  // ── Blocks mode (ExtractionBlockConfig.cs) ───────────────────────────────

  interface ExtractionBlockConfig {
    name?: string | null;
    fields?: ScrapingField[] | null;
    groups?: ContainerNode[] | null;
    outputFileName?: string | null;
    outputFormat?: OutputFormat | null;
    changeDetection?: ChangeDetectionConfig;
    hardening?: HardeningCheck[];
  }
}
