// Ambient JSDoc-only type declarations mirroring the companion's wire-format
// IR (companion/ScrapingFactory.Compiler/IR/*.cs) — Issue #238. These are
// hand-kept, read-only mirrors of the C# types (same "both sides must
// independently reach the same shape" relationship as
// sanitizeFileNameBase/FileNameSanitizer or any of the other hand-kept
// JS<->C# mirrors already documented in CLAUDE.md), not generated — there is
// no build step in this project (see CLAUDE.md's "no build step" principle
// for the extension itself) and no tool here parses C# to keep them in sync
// automatically. They only describe the JSON *wire* shape (the exact object
// `/generate` expects as its request body, and `buildConfigExport`'s own
// `config` field) — the popup's own internal, richer "draft" shapes (e.g.
// container-tree.js's `kind: 'group'|'field'` nodes, api-config.js's
// draft trees) are intentionally NOT modeled here; each file that needs them
// declares its own local `@typedef`s, since those shapes are popup-internal
// and never serialized as-is.
//
// This file has no top-level import/export, so every declaration below is a
// plain global ambient type (not an ES module) — consistent with every
// other file in this project being a classic `<script>`, not a module (see
// CLAUDE.md's "IIFE assigned to one self.SFXxx global" convention). Grouped
// under one `SFWire` namespace purely to keep ~25 type names from crowding
// the global namespace and to avoid colliding with any popup-internal
// `@typedef` of a similar name (e.g. a module's own internal `GroupNode`
// draft type) — reference as `SFWire.ScrapingConfig` etc. from JSDoc.
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
    changeDetection?: ChangeDetectionConfig;
    proxy?: ProxyConfig;
    hardening?: HardeningCheck[];
    pagination?: PaginationConfig;
    persistentSession?: boolean;
    externalConfig?: boolean;
    combined?: CombinedComponentConfig[];
    blocks?: ExtractionBlockConfig[];
    outputBlueprint?: OutputBlueprintMapping;
  }

  type OutputFormat = 'Csv' | 'Xml' | 'Json';
  type ScrapingEngine = 'Static' | 'Browser' | 'Api';

  /** Flat mode's leaf (ScrapingConfig.cs's `ScrapingField`). */
  interface ScrapingField {
    name: string;
    /** Required to be non-blank unless `transforms` starts with a combineFields/splitField transform (Issue #206 follow-up). */
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
  interface CombineFieldsTransform { kind: 'combineFields'; sourceFieldNames: string[]; separator?: string; }
  interface SplitFieldTransform { kind: 'splitField'; sourceFieldName: string; separator?: string; index?: number; }

  // ── Browser actions (BrowserAction.cs) ───────────────────────────────────

  type BrowserAction = WaitForAction | FillAction | ClickAction | ScrollAction;

  interface WaitForAction { kind: 'waitFor'; selector: string; timeoutMs?: number; framePath?: string[] | null; }
  interface FillAction { kind: 'fill'; selector: string; environmentVariableName: string; framePath?: string[] | null; }
  interface ClickAction { kind: 'click'; selector: string; framePath?: string[] | null; }
  interface ScrollAction {
    kind: 'scroll';
    containerSelector?: string | null;
    loadMoreButtonSelector?: string | null;
    maxIterations?: number;
    waitAfterMs?: number;
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

  // ── Pagination (PaginationConfig.cs) ─────────────────────────────────────

  type PaginationConfig = NextLinkPagination | PageNumberPagination;

  interface NextLinkPagination { kind: 'nextLink'; nextLinkSelector: string; maxPages?: number; }
  interface PageNumberPagination { kind: 'pageNumber'; urlTemplate: string; maxPages?: number; }

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
  }

  interface EmbeddedJsonSource {
    scriptSelector: string;
  }

  interface ApiHeader {
    name: string;
    value?: string | null;
    environmentVariableName?: string | null;
  }

  interface ApiParameter {
    name: string;
    source: ApiParameterSource;
  }

  type ApiParameterSource = StaticListSource | DiscoverySource | RangeSource;

  interface StaticListSource { kind: 'staticList'; values: string[]; }
  interface DiscoverySource { kind: 'discovery'; method?: 'GET'; urlTemplate: string; itemsPath: string; valuePath: string; }
  interface RangeSource { kind: 'range'; type: RangeType; from: string; to: string; format?: string; }

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
