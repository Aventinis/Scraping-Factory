// Issue #239: pure, DOM-free helpers for Combined mode's ordered component
// list — mirrors field-transforms.js's own add/remove/move shape exactly
// (see moveTransform's doc comment for the swap-with-adjacent-sibling
// convention this reuses verbatim). A component in _state.combinedComponents
// only ever stores { savedConfigId, name } — its full underlying
// ScrapingConfig is always resolved live at generate/save/export time (see
// companion-client.js's resolveCombinedComponents), never cached here, so
// editing/re-saving the source saved configuration elsewhere is picked up
// automatically the next time this combined configuration is used.
const SFCombinedConfig = (function () {
  function addComponent(components, savedConfigSummary) {
    return [...components, { savedConfigId: savedConfigSummary.id, name: savedConfigSummary.name }];
  }

  function removeComponent(components, index) {
    return components.filter((_, i) => i !== index);
  }

  function updateComponentName(components, index, name) {
    return components.map((c, i) => (i === index ? { ...c, name } : c));
  }

  // direction: -1 (up) or +1 (down). Out-of-range moves are a no-op rather
  // than clamped/wrapped — the UI already disables the button at either end
  // (see combined-config-ui.js), this is just the data-layer safety net.
  function moveComponent(components, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= components.length) return components;
    const copy = [...components];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  }

  return { addComponent, removeComponent, updateComponentName, moveComponent };
})();

if (typeof module !== 'undefined') module.exports = SFCombinedConfig;
if (typeof self !== 'undefined') self.SFCombinedConfig = SFCombinedConfig;
