// Types of the companion's wire-format IR (companion/ScrapingFactory.Compiler/IR/*.cs). Hand-kept, because the custom polymorphic
// converters defeat schema generation (evaluated and rejected, docs/ARCHITECTURE.md "Wire-format mirrors"); IrTypeDeclarationTests.cs
// compares every interface and string union with the C# types and test-vectors/wire/ checks the requests the extension builds.
// Only the wire shape is modeled; the popup's own draft shapes are in drafts.ts. Import as a namespace:
//   import type * as SFWire from '../types/wire';   // TypeScript
//   /** @import * as SFWire from '../types/wire' */   // checked JavaScript
// and refer to SFWire.ScrapingConfig etc.

// ── Top-level request body (ScrapingConfig.cs) ──────────────────────────

/** The exact wire shape `/generate` expects and `buildConfigExport`'s own `config` field produces. */
export interface ScrapingConfig {
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

export type OutputFormat = 'Csv' | 'Xml' | 'Json' | 'Sqlite' | 'Xlsx';
export type ScrapingEngine = 'Static' | 'Browser' | 'Api';

/** Flat mode's leaf (ScrapingConfig.cs's `ScrapingField`). */
export interface ScrapingField {
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

export type ContainerNode = GroupNode | DataFieldNode;
export type ExtractMode = 'Text' | 'Attribute' | 'Exists' | 'OwnText';

export interface GroupNode {
  name: string;
  selector: string;
  repeating: boolean;
  children: ContainerNode[];
  framePath?: string[] | null;
}

export interface DataFieldNode {
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

export type FieldTransform =
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

export type TransformErrorMode = 'KeepOriginal' | 'UseDefault';

export interface TrimTransform { kind: 'trim'; }
export interface RegexExtractTransform { kind: 'regexExtract'; pattern: string; group?: number; }
export interface ReplaceTransform { kind: 'replace'; find: string; replacement: string; }
export interface ToNumberTransform { kind: 'toNumber'; }
export interface ToIntegerTransform { kind: 'toInteger'; onError?: TransformErrorMode; defaultValue?: string | null; }
export interface ToBooleanTransform { kind: 'toBoolean'; onError?: TransformErrorMode; defaultValue?: string | null; }
export interface ToDateTransform { kind: 'toDate'; sourceFormat?: string | null; onError?: TransformErrorMode; defaultValue?: string | null; }
export interface ToCurrencyTransform { kind: 'toCurrency'; format?: "1.234,56" | "1,234.56" | "1 234,56" | "1'234.56"; onError?: TransformErrorMode; defaultValue?: string | null; }
export interface CombineFieldsTransform { kind: 'combineFields'; sourceFieldNames: string[]; separator?: string; }
export interface SplitFieldTransform { kind: 'splitField'; sourceFieldName: string; separator?: string; index?: number; }

// ── Browser actions (BrowserAction.cs) ───────────────────────────────────

export type BrowserAction = WaitForAction | FillAction | ClickAction | ScrollAction;

export interface WaitForAction { kind: 'waitFor'; selector: string; timeoutMs?: number; framePath?: string[] | null; }
export interface FillAction { kind: 'fill'; selector: string; environmentVariableName: string; framePath?: string[] | null; }
export interface ClickAction { kind: 'click'; selector: string; target?: 'First' | 'Last' | 'All'; waitAfterMs?: number; framePath?: string[] | null; }
export interface ScrollAction {
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

export interface ChangeDetectionConfig {
  notify: 'Email' | 'Webhook';
  email?: EmailNotificationConfig;
  webhook?: WebhookNotificationConfig;
}

export interface EmailNotificationConfig {
  smtpHostEnvVar: string;
  smtpPortEnvVar?: string;
  smtpUsernameEnvVar?: string;
  smtpPasswordEnvVar?: string;
  fromEnvVar: string;
  toEnvVar: string;
}

export interface WebhookNotificationConfig {
  urlEnvVar: string;
}

// ── Proxy (ProxyConfig.cs) ────────────────────────────────────────────────

export interface ProxyConfig {
  environmentVariableName: string;
}

// See IR/RetryConfig.cs.
export interface RetryConfig {
  maxAttempts?: number;
  delayMs?: number;
  exponential?: boolean;
  retryOnStatusCodes?: number[] | null;
}

// See IR/DeduplicationConfig.cs.
export interface DeduplicationConfig {
  keyFields: string[];
  incremental?: boolean;
  incrementalOutput?: 'Delta' | 'Append';
  retention?: { kind: 'MaxCount' | 'MaxAge'; value: number };
}

// See IR/RobotsDisallowConfig.cs.
export interface RobotsDisallowConfig {
  action?: 'Warn' | 'Skip' | 'Abort';
}

// See IR/RequestDelayConfig.cs.
export interface RequestDelayConfig {
  minMs: number;
  maxMs: number;
}

// ── Pagination (PaginationConfig.cs) ─────────────────────────────────────

export type PaginationConfig = NextLinkPagination | PageNumberPagination;

export interface NextLinkPagination { kind: 'nextLink'; nextLinkSelector: string; maxPages?: number; }
export interface PageNumberPagination { kind: 'pageNumber'; urlTemplate: string; maxPages?: number; }

// ── Discovered start URLs (DiscoveredUrlsConfig.cs, Issue #218) ──────────

export interface DiscoveredUrlsConfig { pageUrl: string; linkSelector: string; maxUrls?: number; }

// ── Hardening (HardeningCheck.cs) ────────────────────────────────────────

export type HardeningCheck = NoResultCheck | NullRateCheck | BaselineCheck | BlockingCheck | RequiredFieldsCheck;
export type HardeningSeverity = 'Warning' | 'Error';

export interface NoResultCheck { kind: 'noResult'; severity: HardeningSeverity; }
export interface NullRateCheck { kind: 'nullRate'; severity: HardeningSeverity; fieldName: string; threshold: number; }
export interface BaselineCheck { kind: 'baseline'; severity: HardeningSeverity; dropThreshold: number; }
export interface BlockingCheck { kind: 'blocking'; severity: HardeningSeverity; minBodyLength: number | null; blockPhrases: string[]; }
export interface RequiredFieldsCheck { kind: 'requiredFields'; severity: HardeningSeverity; fieldNames: string[]; }

// ── Output Blueprints (OutputBlueprintMapping.cs) ────────────────────────

export type OutputBlueprintSchemaKind = 'Flat' | 'Tree';

export interface OutputBlueprintMapping {
  blueprintId?: number | null;
  schemaKind: OutputBlueprintSchemaKind;
  fields?: OutputBlueprintFieldMapping[] | null;
  tree?: OutputBlueprintTreeMappingNode[] | null;
}

export interface OutputBlueprintFieldMapping {
  targetField: string;
  sourceField: string;
}

export type OutputBlueprintTreeMappingNode = OutputBlueprintTreeMappingGroup | OutputBlueprintTreeMappingField;

export interface OutputBlueprintTreeMappingGroup {
  name: string;
  children: OutputBlueprintTreeMappingNode[];
}

export interface OutputBlueprintTreeMappingField {
  name: string;
  sourceField: string;
}

// ── API mode (ApiConfig.cs) ───────────────────────────────────────────────

export interface ApiConfig {
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
export interface ApiLinkHeaderPagination {
  maxPages: number;
}

// See ApiConfig.CursorPagination in IR/ApiConfig.cs.
export interface ApiCursorPagination {
  nextCursorPath: string;
  hasNextPagePath?: string;
  target: 'Query' | 'Body';
  queryParameterName?: string;
  bodyPath?: string;
  maxPages: number;
}

// See ApiConfig.Bootstrap in IR/ApiConfig.cs.
export interface ApiBootstrap {
  name: string;
  method?: 'GET' | 'POST';
  url: string;
  headers?: ApiHeader[];
  bodyFields?: ApiBootstrapBodyField[];
  bodyEncoding?: 'Json' | 'Form';
  valuePath: string;
}

export interface ApiBootstrapBodyField {
  name: string;
  value?: string | null;
  environmentVariableName?: string | null;
}

export interface EmbeddedJsonSource {
  scriptSelector: string;
}

export interface ApiHeader {
  name: string;
  value?: string | null;
  environmentVariableName?: string | null;
  template?: string | null;
}

export interface ApiParameter {
  name: string;
  source: ApiParameterSource;
}

export type ApiParameterSource = StaticListSource | DiscoverySource | RangeSource | BrowserDiscoverySource;

export interface StaticListSource { kind: 'staticList'; values: string[]; }
export interface DiscoverySource { kind: 'discovery'; method?: 'GET'; urlTemplate: string; itemsPath: string; valuePath: string; }
export interface RangeSource { kind: 'range'; type: RangeType; from: string; to: string; format?: string; }
/** No URL pattern of its own: matched against the enclosing ApiConfig.urlTemplate at run time. */
export interface BrowserDiscoverySource { kind: 'browserDiscovery'; discoveryUrl: string; actions?: BrowserAction[]; }

export type RangeType = 'IsoWeek' | 'Number' | 'Date';

// ── API mode: nested response tree (Issue #54) ───────────────────────────

export type ApiNode = ApiGroup | ApiField;

export interface ApiGroup {
  name: string;
  path: string;
  children: ApiNode[];
}

export interface ApiField {
  name: string;
  path?: string | null;
  transforms?: FieldTransform[] | null;
  hiddenFromOutput?: boolean;
}

// ── API mode: request body tree (Issue #55) ──────────────────────────────

export type ApiBodyNode = ApiBodyObject | ApiBodyArray | ApiBodyLiteral | ApiBodyVariable;
export type ApiBodyLiteralKind = 'String' | 'Number' | 'Boolean' | 'Null';

export interface ApiBodyObject { properties: Record<string, ApiBodyNode>; }
export interface ApiBodyArray { items: ApiBodyNode[]; }
export interface ApiBodyLiteral {
  kind: ApiBodyLiteralKind;
  stringValue?: string | null;
  numberValue?: number | null;
  boolValue?: boolean | null;
}
export interface ApiBodyVariable {
  parameterName: string;
  coerceTo?: ApiBodyLiteralKind | null;
}

// ── Combined mode (CombinedComponentConfig.cs) ───────────────────────────

export interface CombinedComponentConfig {
  name?: string | null;
  config: ScrapingConfig;
  verificationValues?: Record<string, string>;
  savedConfigId?: number | null;
}

// ── Blocks mode (ExtractionBlockConfig.cs) ───────────────────────────────

export interface ExtractionBlockConfig {
  name?: string | null;
  fields?: ScrapingField[] | null;
  groups?: ContainerNode[] | null;
  outputFileName?: string | null;
  outputFormat?: OutputFormat | null;
  changeDetection?: ChangeDetectionConfig;
  hardening?: HardeningCheck[];
}
