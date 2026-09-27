// Issue #84: DOM rendering + event wiring for the transform-chain editor —
// shared between modal-field-name (flat mode) and modal-field-extended
// (container mode), each with its own list/add-button element ids but
// backed by the same _state.pendingTransforms in popup.js. Split out the
// same way container-tree-ui.js/api-config-ui.js are (see their own doc
// comments for why): a classic <script>, pulling pure data helpers off
// `self.SFFieldTransforms`, exposing `self.SFFieldTransformsUI`.
//
// Unlike container-tree-ui.js's handler functions (which take a `bridge`
// object because they need popup.js's stopPreviewIfActive/requestDomTree
// too), this module only ever needs to read/write one piece of state — so
// wireTransformList takes plain getter/setter closures instead, supplied by
// whichever call site in popup.js's wireEvents() actually owns _state.
const SFFieldTransformsUI = (function () {
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const {
    removeTransform, updateTransform, changeTransformKind, moveTransform, applyTransformsPreview,
  } = typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;

  // Long raw values (a whole paragraph clicked in Text mode) would otherwise
  // stretch the modal — same defensive-cap spirit as api-capture.js's own
  // MAX_BODY_CHARS, just a much smaller number since this is a one-line hint.
  const MAX_PREVIEW_CHARS = 200;

  function truncatePreviewValue(value) {
    return value.length > MAX_PREVIEW_CHARS ? `${value.slice(0, MAX_PREVIEW_CHARS)}…` : value;
  }

  const KIND_OPTIONS = [
    ['trim', 'transforms.trimOption'],
    ['regexExtract', 'transforms.regexExtractOption'],
    ['replace', 'transforms.replaceOption'],
    ['toNumber', 'transforms.toNumberOption'],
    ['toInteger', 'transforms.toIntegerOption'],
    ['toBoolean', 'transforms.toBooleanOption'],
    ['toDate', 'transforms.toDateOption'],
    ['combineFields', 'transforms.combineFieldsOption'],
    ['splitField', 'transforms.splitFieldOption'],
  ];

  // Issue #205: shared by all three type-conversion kinds — an onError
  // select plus, only when "useDefault" is actually picked, a default-value
  // text input. Appended after whichever kind-specific inputs (if any) a
  // given row already has.
  function appendTypeConversionInputs(li, transform) {
    const onErrorSelect = document.createElement('select');
    onErrorSelect.className = 'transform-onerror-select';
    [
      ['KeepOriginal', 'transforms.onErrorKeepOriginalOption'],
      ['UseDefault', 'transforms.onErrorUseDefaultOption'],
    ].forEach(([value, labelKey]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(labelKey);
      if (value === transform.onError) option.selected = true;
      onErrorSelect.appendChild(option);
    });
    li.appendChild(onErrorSelect);

    if (transform.onError === 'UseDefault') {
      const defaultValueInput = document.createElement('input');
      defaultValueInput.type = 'text';
      defaultValueInput.className = 'transform-default-value-input';
      defaultValueInput.placeholder = t('transforms.defaultValuePlaceholder');
      defaultValueInput.value = transform.defaultValue ?? '';
      li.appendChild(defaultValueInput);
    }
  }

  // Issue #206: shared separator text input for both combineFields and
  // splitField — same underlying property name/semantic for either kind.
  function appendSeparatorInput(li, transform) {
    const separatorInput = document.createElement('input');
    separatorInput.type = 'text';
    separatorInput.className = 'transform-separator-input';
    separatorInput.placeholder = t('transforms.separatorPlaceholder');
    separatorInput.value = transform.separator;
    li.appendChild(separatorInput);
  }

  // Issue #206: options come from availableFieldNames (already-declared
  // sibling field names in the same scope — see container-tree.js's
  // collectSiblingFieldNames/api-config.js's collectPrecedingApiFieldSiblingNames
  // for how each mode computes this) rather than a free-text input, so a
  // typo can't silently reference a field name that doesn't exist.
  function appendCombineFieldsInputs(li, transform, availableFieldNames) {
    const select = document.createElement('select');
    select.className = 'transform-combine-source-select';
    select.multiple = true;
    availableFieldNames.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = transform.sourceFieldNames.includes(name);
      select.appendChild(option);
    });
    li.appendChild(select);
    appendSeparatorInput(li, transform);
  }

  function appendSplitFieldInputs(li, transform, availableFieldNames) {
    const select = document.createElement('select');
    select.className = 'transform-split-source-select';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = t('transforms.splitSourcePlaceholderOption');
    placeholderOption.selected = !transform.sourceFieldName;
    select.appendChild(placeholderOption);
    availableFieldNames.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === transform.sourceFieldName;
      select.appendChild(option);
    });
    li.appendChild(select);
    appendSeparatorInput(li, transform);

    const indexInput = document.createElement('input');
    indexInput.type = 'number';
    indexInput.min = '0';
    indexInput.className = 'transform-split-index-input';
    indexInput.placeholder = t('transforms.splitIndexPlaceholder');
    indexInput.value = String(transform.index);
    li.appendChild(indexInput);
  }

  function buildTransformRowEl(transform, index, total, availableFieldNames = []) {
    const li = document.createElement('li');
    li.className = 'transform-row';
    li.dataset.index = String(index);

    const select = document.createElement('select');
    select.className = 'transform-kind-select';
    KIND_OPTIONS.forEach(([value, labelKey]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(labelKey);
      if (value === transform.kind) option.selected = true;
      select.appendChild(option);
    });
    li.appendChild(select);

    if (transform.kind === 'regexExtract') {
      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.className = 'transform-pattern-input';
      patternInput.placeholder = t('transforms.patternPlaceholder');
      patternInput.value = transform.pattern;
      li.appendChild(patternInput);

      const groupInput = document.createElement('input');
      groupInput.type = 'number';
      groupInput.min = '0';
      groupInput.className = 'transform-group-input';
      groupInput.placeholder = t('transforms.groupPlaceholder');
      groupInput.value = String(transform.group);
      li.appendChild(groupInput);
    } else if (transform.kind === 'replace') {
      const findInput = document.createElement('input');
      findInput.type = 'text';
      findInput.className = 'transform-find-input';
      findInput.placeholder = t('transforms.findPlaceholder');
      findInput.value = transform.find;
      li.appendChild(findInput);

      const replacementInput = document.createElement('input');
      replacementInput.type = 'text';
      replacementInput.className = 'transform-replacement-input';
      replacementInput.placeholder = t('transforms.replacementPlaceholder');
      replacementInput.value = transform.replacement;
      li.appendChild(replacementInput);
    } else if (transform.kind === 'toDate') {
      const sourceFormatInput = document.createElement('input');
      sourceFormatInput.type = 'text';
      sourceFormatInput.className = 'transform-source-format-input';
      sourceFormatInput.placeholder = t('transforms.sourceFormatPlaceholder');
      sourceFormatInput.value = transform.sourceFormat;
      li.appendChild(sourceFormatInput);
      appendTypeConversionInputs(li, transform);
    } else if (transform.kind === 'toInteger' || transform.kind === 'toBoolean') {
      appendTypeConversionInputs(li, transform);
    } else if (transform.kind === 'combineFields') {
      appendCombineFieldsInputs(li, transform, availableFieldNames);
    } else if (transform.kind === 'splitField') {
      appendSplitFieldInputs(li, transform, availableFieldNames);
    }

    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'btn-secondary btn-tiny btn-transform-move-up';
    moveUpBtn.textContent = '↑';
    moveUpBtn.disabled = index === 0;
    li.appendChild(moveUpBtn);

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'btn-secondary btn-tiny btn-transform-move-down';
    moveDownBtn.textContent = '↓';
    moveDownBtn.disabled = index === total - 1;
    li.appendChild(moveDownBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger btn-transform-remove';
    removeBtn.textContent = t('common.remove');
    li.appendChild(removeBtn);

    return li;
  }

  // availableFieldNames (Issue #206): the sibling field names combineFields/
  // splitField may reference in the current scope — see each call site in
  // popup.js/flat-mode-ui.js/container-tree-ui.js/api-config-ui.js for how
  // that scope is computed. Optional/defaults to none, so a caller with no
  // notion of "other fields" (or an existing test not exercising these two
  // kinds) doesn't need to pass anything new.
  function renderTransformList(listElId, transforms, availableFieldNames = []) {
    const root = document.getElementById(listElId);
    if (!root) return;
    root.innerHTML = '';
    transforms.forEach((transform, i) => root.appendChild(buildTransformRowEl(transform, i, transforms.length, availableFieldNames)));
  }

  // Issue #143: live "what would this chain actually produce" hint, run
  // against the raw value of the element the user just picked. rawValue is
  // null/undefined when there's nothing to preview yet — no pick at all, or
  // (container mode, attribute type) the attribute name input is still
  // blank — in which case the hint is hidden entirely rather than showing a
  // misleading empty result.
  function renderTransformPreview(elId, rawValue, transforms) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (rawValue === null || rawValue === undefined) {
      el.textContent = '';
      el.classList.add('hidden');
      el.classList.remove('warn');
      return;
    }
    el.classList.remove('hidden');
    const result = applyTransformsPreview(rawValue, transforms);
    if (result === null) {
      el.textContent = t('transforms.previewUnavailable');
      el.classList.add('warn');
    } else {
      el.classList.remove('warn');
      el.textContent = t('transforms.previewLabel', {
        value: result === '' ? t('transforms.previewEmptyValue') : truncatePreviewValue(result),
      });
    }
  }

  // Wired once (in popup.js's wireEvents()) per list root — event delegation
  // survives renderTransformList's innerHTML rebuild, same as the group
  // tree's own delegated click handler.
  function wireTransformList(listElId, getTransforms, setTransforms) {
    const root = document.getElementById(listElId);
    if (!root) return;

    root.addEventListener('change', (e) => {
      const row = e.target.closest('.transform-row');
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      const transforms = getTransforms();

      if (e.target.classList.contains('transform-kind-select')) {
        setTransforms(changeTransformKind(transforms, index, e.target.value));
      } else if (e.target.classList.contains('transform-pattern-input')) {
        setTransforms(updateTransform(transforms, index, { pattern: e.target.value }));
      } else if (e.target.classList.contains('transform-group-input')) {
        const group = parseInt(e.target.value, 10);
        setTransforms(updateTransform(transforms, index, { group: Number.isFinite(group) && group >= 0 ? group : 0 }));
      } else if (e.target.classList.contains('transform-find-input')) {
        setTransforms(updateTransform(transforms, index, { find: e.target.value }));
      } else if (e.target.classList.contains('transform-replacement-input')) {
        setTransforms(updateTransform(transforms, index, { replacement: e.target.value }));
      } else if (e.target.classList.contains('transform-source-format-input')) {
        setTransforms(updateTransform(transforms, index, { sourceFormat: e.target.value }));
      } else if (e.target.classList.contains('transform-onerror-select')) {
        setTransforms(updateTransform(transforms, index, { onError: e.target.value }));
      } else if (e.target.classList.contains('transform-default-value-input')) {
        setTransforms(updateTransform(transforms, index, { defaultValue: e.target.value }));
      } else if (e.target.classList.contains('transform-combine-source-select')) {
        const sourceFieldNames = Array.from(e.target.selectedOptions).map(o => o.value);
        setTransforms(updateTransform(transforms, index, { sourceFieldNames }));
      } else if (e.target.classList.contains('transform-split-source-select')) {
        setTransforms(updateTransform(transforms, index, { sourceFieldName: e.target.value }));
      } else if (e.target.classList.contains('transform-separator-input')) {
        setTransforms(updateTransform(transforms, index, { separator: e.target.value }));
      } else if (e.target.classList.contains('transform-split-index-input')) {
        const parsedIndex = parseInt(e.target.value, 10);
        setTransforms(updateTransform(transforms, index, { index: Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0 }));
      }
    });

    root.addEventListener('click', (e) => {
      const row = e.target.closest('.transform-row');
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      const transforms = getTransforms();

      if (e.target.closest('.btn-transform-move-up')) setTransforms(moveTransform(transforms, index, -1));
      else if (e.target.closest('.btn-transform-move-down')) setTransforms(moveTransform(transforms, index, 1));
      else if (e.target.closest('.btn-transform-remove')) setTransforms(removeTransform(transforms, index));
    });
  }

  return { renderTransformList, wireTransformList, renderTransformPreview };
})();

if (typeof module !== 'undefined') module.exports = SFFieldTransformsUI;
if (typeof self !== 'undefined') self.SFFieldTransformsUI = SFFieldTransformsUI;
