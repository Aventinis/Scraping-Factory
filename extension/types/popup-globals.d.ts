// Ambient declarations for the `self.SFXxx` globals every popup module
// reads/writes (Issue #238) — see CLAUDE.md's "IIFE assigned to one
// self.SFXxx global, dual-exported via module.exports for Jest" convention,
// documented on every one of these files' own top-of-file comment (e.g.
// container-tree.js, api-config.js). Under Jest, the exact same module is
// reached via `require(...)` instead (typed `any` by @types/node, like any
// CommonJS require) — this file only has to cover the `self.SFXxx` browser
// branch, which `lib.dom`'s own `Window` type knows nothing about.
//
// Deliberately typed as `any` rather than re-describing each module's own
// public API a second time here: the real shape is already the `return {...}`
// object at the bottom of each module's own IIFE, and every one of the five
// `// @ts-check`-annotated files in this pass (Issue #238) imports its
// *same-origin* sibling modules this way (e.g. scraping-config-builder.js
// reading `self.SFContainerTree`/`self.SFApiConfig`/`self.SFOutputBlueprints`)
// — duplicating those modules' full return shapes into ambient globals here
// would be a second, easily-drifting copy of the exact same information
// `@ts-check`-annotating *those* modules directly already gives for free,
// the same "don't maintain two copies of one shape" reasoning this project
// applies elsewhere (e.g. avoiding two independent casing conventions for
// HardeningCheck.Severity, see CLAUDE.md). Modules not yet annotated with
// `// @ts-check` of their own are untyped either way, so `any` costs nothing
// extra for those, and loses nothing for the annotated ones either — a
// *caller* reading `self.SFOutputBlueprints.buildOutputBlueprintMapping(...)`
// still only benefits from checking its own call-site arguments against
// whatever that function's own JSDoc says, same as it would across a plain
// `require(...)` call already typed `any` by @types/node.
declare global {
  interface Window {
    SFI18n: any;
    SFLogger: any;
    SFCompanionConfig: any;
    SFTheme: any;
    SFGlobalSettings: any;
    SFApiConfig: any;
    SFApiBootstrap: any;
    SFTransformPresets: any;
    SFContainerTree: any;
    SFFieldTransforms: any;
    SFConfigImport: any;
    SFScrapingConfigBuilder: any;
    SFOutputBlueprints: any;
    SFCombineSplitFields: any;
    SFBlocksConfig: any;
    SFCombinedConfig: any;
  }
}

export {};
