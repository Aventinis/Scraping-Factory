// The side panel's own state (popup.ts's `_state`) and the `bridge` every feature module receives. Shapes that belong to a module that
// is not converted yet are deliberately loose (`unknown`, an index signature) and are tightened by that module's part of the migration.
import type * as SFWire from './wire';
import type * as SFDraft from './drafts';
import type { ApiConfigDraft } from '../popup/api-config';
import type { CombinedComponentRef } from '../popup/combined-config';
import type { ApiCandidate, DomTreeNode, RecordedStep, RobotsTxtResult } from './messages';
import type { showToast } from '../popup/toast';
import type { CaptureEntryLike, PathTreeResult } from '../popup/json-path-picker';
import type { SavedPreset } from '../popup/transform-presets';
import type { SchemaTreeWireNode } from '../popup/output-blueprints';

export type Screen =
  | 'CHECKING_COMPANION' | 'COMPANION_ERROR' | 'IDLE' | 'SELECTING' | 'API_CONFIG' | 'GENERATING' | 'DONE' | 'SETTINGS';

export type Mode = 'flat' | 'container' | 'api' | 'combined' | 'blocks';

export type SelectionKind = 'field' | 'container' | 'browserAction' | 'pagination' | 'paginationPageLink' | 'apiDiscoveryAction' | 'discoveredUrls';

// Which property of a browser action the picked selector is written into.
export type BrowserActionField = 'selector' | 'containerSelector' | 'loadMoreButtonSelector';

// The path inputs that offer a "Pick from the recording" panel (popup/json-path-picker-ui.ts).
export type PathPickerField = 'group' | 'cursor.nextCursorPath' | 'cursor.hasNextPagePath' | 'cursor.bodyPath' | 'bootstrap.valuePath';

// What the one open picker shows: loading, a list of recorded responses to choose from, a message (an i18n key suffix), or the tree.
export type PathPickerOutcome =
  | { status: 'loading' }
  | { status: 'chooser'; choices: CaptureEntryLike[] }
  | { status: 'message'; message: string }
  | { status: 'tree'; tree: PathTreeResult };

export type ApiPathPickerState = {
  field: PathPickerField;
  /** Identifies this opening, so a slow load cannot overwrite a newer picker. */
  token: number;
  sourceLabel?: string;
  /** The other recorded responses the user can switch to. */
  choices?: CaptureEntryLike[];
} & PathPickerOutcome;

export type OutputFileContent = { fileName: string; content: string };

export interface ApiCandidatesResult {
  target: string;
  candidates: ApiCandidate[];
}

// 'field' = searching for the primary field; {parameter} = a Discovery source's example value; {treeParentPath} = adding a root
// group (null) or a sub-field under an existing ApiGroup.
export type ApiSearchTarget = 'field' | { parameter: string } | { treeParentPath: number[] | null };

export type FieldEditTarget = { mode: 'flat'; index: number } | { mode: 'container'; path: number[] };

export type DerivedFieldScope =
  | { mode: 'flat' }
  | { mode: 'container'; parentPath: number[] | null }
  | { mode: 'api'; groupPath: number[] | null };

export interface SavedConfigSummary {
  id: number;
  url: string;
  name: string;
  savedAt: string;
  blueprintId?: number | null;
}

// GET /configs/{id}: the summary plus the stored configuration, verbatim as it was sent to /generate.
export interface SavedConfigRecord extends SavedConfigSummary {
  config: SFWire.ScrapingConfig;
}

// GET /blueprints: one Output Blueprint (a reusable target schema) as listed; `fieldCount` counts the leaves of a tree.
export interface OutputBlueprintSummary {
  id: number;
  name: string;
  savedAt: string;
  fieldCount: number;
  schemaKind: SFWire.OutputBlueprintSchemaKind;
}

// GET /blueprints/{id}: `fieldNames` is meaningful for a Flat schema, `tree` for a Tree schema.
export interface OutputBlueprintRecord {
  id: number;
  name: string;
  savedAt: string;
  fieldNames: string[];
  schemaKind: SFWire.OutputBlueprintSchemaKind;
  tree: SchemaTreeWireNode[] | null;
}

// The create/edit modal's draft: both schema shapes are always present, so toggling Flat/Tree never loses either.
export interface BlueprintEditDraft {
  name: string;
  schemaKind: SFWire.OutputBlueprintSchemaKind;
  fieldNames: string[];
  tree: SFDraft.BlueprintSchemaNode[];
}

export interface SavedOutputSummary {
  id: number;
  savedConfigId: number;
  name: string;
  fileName: string;
  savedAt: string;
}

// GET /configs/{id}/outputs/{outputId}: the summary plus the stored output (base64 for the binary table formats).
export interface SavedOutputRecord extends SavedOutputSummary {
  content: string;
}

// One line of a "Test hardening" replay (HardeningReplayOutcome in the companion).
export interface HardeningReplayResult {
  kind: string;
  severity: SFWire.HardeningSeverity;
  outcome: 'Passed' | 'Triggered' | 'Inconclusive' | 'NotEvaluable';
  message: string;
}

// "Test hardening" for one saved output: the live checks replayed against it, from the compare-basis choice to the results.
export interface HardeningReplayState {
  configId: number;
  outputId: number;
  checks: SFWire.HardeningCheck[];
  compareBasis: 'config' | 'blueprint';
  needsCompareBasisChoice: boolean;
  loading: boolean;
  results: HardeningReplayResult[] | null;
  error: string | null;
}

// The companion's ScriptPreviewData (a sample of what the trial run scraped).
export interface DataPreview {
  outputFormat?: string;
  totalCount: number;
  truncated?: boolean;
  /** Table samples (Csv, and a flat Json array). */
  columns?: string[];
  rows?: Array<Record<string, string | null>>;
  /** Text samples of a tree (Xml, Json). */
  xmlSample?: string | null;
  jsonSample?: string | null;
  [key: string]: unknown;
}

export interface BlockOutput {
  name: string;
  preview?: DataPreview | null;
  outputFile?: OutputFileContent | null;
}

export interface State {
  current: Screen;
  url: string;
  mode: Mode;
  fields: SFDraft.Field[];
  groups: SFDraft.ContainerNode[];
  engine: SFWire.ScrapingEngine;
  browserActions: SFDraft.BrowserAction[];
  additionalStartUrls: string[];
  changeDetection: SFDraft.ChangeDetectionState;
  proxy: SFDraft.ProxyState;
  requestDelay: SFDraft.RequestDelayState;
  retry: SFDraft.RetryState;
  deduplication: SFDraft.DeduplicationState;
  requestHeaders: SFDraft.RequestHeadersState;
  /** One-time test values for env-var backed headers: memory only, never persisted. */
  requestHeaderTestValues: Record<string, string>;
  pagination: SFDraft.PaginationState;
  discoveredUrls: SFDraft.DiscoveredUrlsState;
  persistentSession: boolean;
  preflight: boolean;
  respectRobotsDelay: boolean;
  robotsDisallow: SFDraft.RobotsDisallowState;
  appendOutput: boolean;
  hardening: SFDraft.HardeningState;
  /** One-time Fill test values keyed by environment-variable name: memory only, never persisted. */
  fillTestValues: Record<string, string>;
  scriptFileName: string;
  outputFileName: string;
  scriptText: string;

  pendingSelector: string | null;
  pendingFramePath: string[] | null;
  pendingMatchCount: number | null;
  pendingRawText: string | null;
  pendingElementAttributes: Record<string, string> | null;
  pendingOwnText: string | null;
  pendingTransforms: SFWire.FieldTransform[];
  /** The existing field whose name and transforms the field dialog is editing, or null while it creates one. */
  editingField: FieldEditTarget | null;
  selectionKind: SelectionKind | null;
  pendingParentPath: number[] | null;
  pendingNewContainer: { name: string; repeating: boolean } | null;
  /** "Record my steps" (Issue #508): in memory only, never persisted. */
  stepRecordingActive: boolean;
  recordedSteps: RecordedStep[];
  /** The recorded actions waiting for the append / replace choice. */
  recordedActionsPending: SFDraft.BrowserAction[] | null;
  stepRecordingNote: string | null;
  pendingBrowserActionIndex: number | null;
  pendingBrowserActionField: BrowserActionField;
  pendingApiDiscoveryPartId: string | null;
  pendingApiDiscoveryActionIndex: number | null;
  pendingApiDiscoveryActionField: BrowserActionField;

  containerModalOpen: boolean;
  domViewEnabled: boolean;
  domTree: DomTreeNode | null;
  domTreeTruncated: boolean;
  domTreeError: string | null;
  previewActive: boolean;
  /** `empty` lists the names of the configured fields / groups that matched nothing. */
  previewSummary: { total: number; empty: string[]; truncated: boolean } | null;
  apiCaptureActive: boolean;
  apiCaptureCount: number;
  apiEntriesPanelOpen: boolean;
  apiEntries: SFDraft.ApiCaptureEntry[] | null;
  monitoringSectionOpen: boolean;
  settingsSectionOpen: boolean;

  apiSearchTarget: ApiSearchTarget | null;
  apiCandidates: ApiCandidatesResult | null;
  /** The "Take from recording" picker's rows (null = closed); `likely` = the response holds a value the main request sends. */
  apiBootstrapRecordingEntries: Array<{ entry: SFDraft.ApiCaptureEntry; likely: boolean }> | null;
  apiBootstrapTestValues: Record<string, string>;
  apiDiscoveryCandidates: (ApiCandidatesResult & { parameter: string }) | null;
  /** Which discovery source's URL template is open for editing; absent from the initial state. */
  discoveryTemplateEditingPartId?: string | null;
  apiTreeSearchResult: (ApiCandidatesResult & { treeParentPath: number[] | null }) | null;
  apiPathPicker: ApiPathPickerState | null;
  apiGroupModalOpen: boolean;
  pendingApiTreeParentPath: number[] | null;
  bodyParameterModalOpen: boolean;
  pendingBodyVariablePath: Array<string | number> | null;
  apiFieldTransformModalOpen: boolean;
  pendingApiFieldTransformPath: number[] | null;
  combineFieldModalOpen: boolean;
  splitFieldModalOpen: boolean;
  pendingDerivedFieldScope: DerivedFieldScope | null;
  /** The existing combine / split field the open dialog edits (Issue #505), or null while it creates one. */
  pendingDerivedFieldEdit: FieldEditTarget | null;
  apiConfigDraft: ApiConfigDraft | null;
  /** The draft the confirmed `apiConfig` was built from, kept so Edit can reopen it (Issue #506); see api-config-reopen.ts. */
  apiConfigApplied: ApiConfigDraft | null;
  apiConfig: SFWire.ApiConfig | null;

  robotsTxtChecking: boolean;
  robotsTxtResult: RobotsTxtResult | null;
  dataPreview: DataPreview | null;
  outputFile: OutputFileContent | null;

  savedConfigs: SavedConfigSummary[] | null;
  savedConfigsLoading: boolean;
  combinedComponents: CombinedComponentRef[];
  allSavedConfigs: SavedConfigSummary[] | null;
  allSavedConfigsLoading: boolean;
  blocks: SFDraft.Block[];
  blocksDraftShape: SFDraft.Block['shape'];
  blocksDraftName: string;
  blocksDraftOutputFileName: string;
  blocksEditingIndex: number | null;
  blocksOutput: BlockOutput[] | null;
  savedConfigsPendingDeleteId: number | null;
  /** The Settings tab's own list; absent from the initial state. */
  allSavedConfigsPendingDeleteId?: number | null;
  saveConfigModalOpen: boolean;
  saveOutputModalOpen: boolean;
  savedConfigsExpandedId: number | null;
  savedOutputs: SavedOutputSummary[] | null;
  savedOutputsLoading: boolean;
  savedOutputsPendingDeleteId: number | null;
  hardeningReplay: HardeningReplayState | null;

  selectedOutputBlueprintId: string;
  selectedOutputBlueprintFieldNames: string[];
  /** target field -> chosen source field, null while unset */
  outputBlueprintMapping: Record<string, string | null>;
  // Absent from the initial state: only a Tree-schema blueprint sets them (the builder defaults them).
  selectedOutputBlueprintSchemaKind?: SFWire.OutputBlueprintSchemaKind;
  selectedOutputBlueprintTree?: SFDraft.OutputBlueprintTreeNode[];
  outputBlueprintTreeMapping?: Record<string, string | null>;
  outputBlueprints: OutputBlueprintSummary[] | null;
  transformPresets: SavedPreset[] | null;
  transformPresetsAvailable: boolean;
  transformPresetSaveOpen: boolean;
  transformPresetRenameId: number | null;
  transformPresetDeletePendingId: number | null;
  outputBlueprintsLoading: boolean;
  blueprintEditModalOpen: boolean;
  blueprintEditingId: number | null;
  // popup.ts's initial value only has name and fieldNames; the modal opens through openBlueprintCreate/EditModal, which set the rest.
  blueprintEditDraft: BlueprintEditDraft;
  blueprintDeletePendingId: number | null;
}

export type StatePatch = Partial<State>;

export interface PopupBridge {
  getState(): State;
  setState(screen: Screen, patch?: StatePatch): void;
  patchState(patch: StatePatch): void;
  stopPreviewIfActive(): void;
  requestDomTree(): void;
  showToast: typeof showToast;
  fetchSavedConfigs(url: string): void | Promise<void>;
  fetchAllSavedConfigs(): void | Promise<void>;
  fetchOutputBlueprints(): void | Promise<void>;
  fetchTransformPresets?(): void | Promise<void>;
}
