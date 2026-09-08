// API mode's own DOM rendering and event-handling logic (Issue #53/#54/#55):
// the response/body tree editors, the candidate-search result lists, the
// full API_CONFIG screen, and every handler that mutates apiConfigDraft or
// starts/stops network recording and click-based searches. Split out of
// popup.js (which had grown past 3800 lines) purely for readability — no
// behavior change. Same IIFE-wrapped-single-global pattern as
// shared/logger.js/shared/companion-config.js/i18n/i18n.js (see their own
// doc comments): popup.html loads this as a classic <script> before
// popup.js, which pulls the functions it needs off `self.SFApiConfigUI`.
//
// Unlike api-config.js's pure builder/validator functions, most of the
// event-handler functions here (anything that reads or mutates popup state)
// take a `bridge` object as their first parameter — `{ getState, setState,
// patchState, stopPreviewIfActive, requestDomTree, showToast }` — built once
// by popup.js's wireEvents() and passed through on every call, instead of
// closing over popup.js's own `_state`/`setState`/etc. the way these
// functions did before the split. This isn't just style: popup.js loads
// *after* this file (see popup.html), so a plain closure over popup.js's
// module-level state wouldn't exist yet when this file's own top-level code
// runs, and — more importantly — would silently fail to resolve at all
// under Jest, where each file is a separate, isolated `require()`d module
// with no shared global scope. Passing `bridge` explicitly works identically
// in both environments. Purely presentational functions (the render/build*El
// functions below) need none of this — they already took explicit arguments
// before the split and still do.
const SFApiConfigUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:ApiConfigUI');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const {
    STATES, escapeHtml,
    parseUrlTemplateParts, findUrlTemplateMatches, mergeValueListValues,
    buildStaticListSource, buildDiscoverySource, buildRangeSource, RANGE_FORMAT_PRESETS,
    detectRangeFormat, findUrlPartValue, rangeFormatExample,
    buildApiConfig, buildApiGroupDraft, insertApiTreeNode, updateApiTreeNode, resolveApiTreeNode,
    jsonValueToBodyDraft, resolveBodyTreeNode, updateBodyTreeNode, bodyTreeReferencesParameterId,
    buildApiSubtreeFromCandidate, resolveApiGroupScopePath, allParameterParts, apiConfigDraftHasAllSourcesChosen,
  } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { transformsAreValid } = typeof require !== 'undefined' ? require('./field-transforms') : self.SFFieldTransforms;

  // Same visual pattern as the Container-Mode tree editor below (indentation,
  // toggle arrow, add/remove buttons, nodes start expanded) — see
  // buildGroupTreeNodeEl. Row content differs: an editable name input (Phase
  // A5 — every node's name stays editable, same precedent the flat API-Mode
  // field list already established) plus a read-only path display instead of
  // a single selector label, and there's no repeating/attribute/mode label
  // (see Container-Mode) or frame badge (JSON has no iframes) to add.
  function buildApiTreeNodeEl(node, path, depth) {
    const li = document.createElement('li');
    li.className = 'api-tree-node';
    li.dataset.path = JSON.stringify(path);

    const row = document.createElement('div');
    row.className = 'api-tree-row';
    row.style.paddingLeft = `${depth * 12}px`;

    const hasChildren = node.kind === 'group' && node.children.length > 0;
    const toggle = document.createElement('span');
    toggle.className = 'api-tree-toggle';
    toggle.textContent = hasChildren ? '▾' : '';
    row.appendChild(toggle);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'api-tree-name';
    nameInput.dataset.path = JSON.stringify(path);
    nameInput.value = node.name;
    row.appendChild(nameInput);

    const pathLabel = document.createElement('span');
    pathLabel.className = 'api-tree-path';
    pathLabel.textContent = node.path || '—';
    pathLabel.title = node.path;
    row.appendChild(pathLabel);

    if (node.kind === 'group') {
      const addSubgroupBtn = document.createElement('button');
      addSubgroupBtn.className = 'btn-secondary btn-tiny btn-add-api-subgroup';
      addSubgroupBtn.textContent = t('apiTree.addSubgroupBtn');
      row.appendChild(addSubgroupBtn);

      const addFieldBtn = document.createElement('button');
      addFieldBtn.className = 'btn-secondary btn-tiny btn-add-api-subfield';
      addFieldBtn.textContent = t('apiTree.addSubfieldBtn');
      row.appendChild(addFieldBtn);
    }

    // Issue #84 follow-up: only a leaf actually extracts a value (ApiGroup
    // has no Transforms property on the companion side, see IR/ApiConfig.cs)
    // — same reasoning Container-Mode's own transforms section already
    // follows for "Vorhanden?" mode.
    if (node.kind === 'field') {
      const transformsBtn = document.createElement('button');
      transformsBtn.className = 'btn-secondary btn-tiny btn-api-field-transforms';
      transformsBtn.textContent = node.transforms && node.transforms.length > 0
        ? t('apiTree.transformsBtnCount', { count: node.transforms.length })
        : t('apiTree.transformsBtn');
      row.appendChild(transformsBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-danger btn-remove-api-node';
    removeBtn.textContent = t('common.remove');
    row.appendChild(removeBtn);

    li.appendChild(row);

    if (node.kind === 'group') {
      const childUl = document.createElement('ul');
      childUl.className = 'api-tree-children';
      node.children.forEach((child, i) => childUl.appendChild(buildApiTreeNodeEl(child, [...path, i], depth + 1)));
      li.appendChild(childUl);

      if (hasChildren) {
        toggle.addEventListener('click', () => {
          const collapsed = childUl.classList.toggle('hidden');
          toggle.textContent = collapsed ? '▸' : '▾';
        });
      }
    }

    return li;
  }

  function renderApiTree(groups) {
    const root = document.getElementById('api-tree-root');
    if (!root) return;
    root.innerHTML = '';
    groups.forEach((node, i) => root.appendChild(buildApiTreeNodeEl(node, [i], 0)));
  }
  // ── API-mode candidate search results (Issue #53 Phase 4) ──────────────────
  // Renders content-script.js's findApiCandidates output: one row per
  // candidate (request + JSON path + matched value), with the same object's
  // sibling scalar keys offered as click-to-toggle suggestions for additional
  // fields — purely a visual "picked" toggle for now, since there's no
  // ApiConfig to feed them into yet (that's Phase 5+).

  // ids (Phase A5): the primary-field search panel (#api-candidates-target/
  // -list, the default) and the "add root group"/"add sub-field" search panel
  // (#api-tree-search-target/-list) render the exact same candidate shape —
  // only the confirm action differs (confirmApiFieldCandidate vs.
  // confirmApiTreeFieldCandidate, see wireApiCandidateListEvents), so this one
  // function serves both rather than duplicating the whole render.
  function renderApiCandidates({ target, candidates }, ids = { targetEl: 'api-candidates-target', listEl: 'api-candidates-list' }) {
    const targetEl = document.getElementById(ids.targetEl);
    if (targetEl) targetEl.textContent = t('apiCandidates.searchedFor', { target });

    const listEl = document.getElementById(ids.listEl);
    if (!listEl) return;
    listEl.innerHTML = '';

    if (candidates.length === 0) {
      const li = document.createElement('li');
      li.className = 'api-candidates-empty';
      li.textContent = t('common.noMatches');
      listEl.appendChild(li);
      return;
    }

    candidates.forEach((candidate, i) => {
      const li = document.createElement('li');
      li.className = 'api-candidate';
      li.innerHTML =
        `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.method)} ${escapeHtml(candidate.url)}</div>` +
        `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
        `<div class="api-candidate-value">${escapeHtml(t('apiCandidates.matchLabel', { value: String(candidate.value) }))}</div>`;

      if (candidate.siblings.length > 0) {
        const siblingsEl = document.createElement('div');
        siblingsEl.className = 'api-candidate-siblings';

        // Picking one-by-one is fine for a handful of siblings, but a record
        // with many keys is exactly the "I want most of these" case a user
        // asked to no longer have to click through individually — one button
        // to pick all of them, toggling back to none on a second click
        // (mirrors this file's other state-reflecting toggle buttons, e.g.
        // preview show/hide). Picked state itself stays DOM-only (see the
        // click handler in wireEvents), so this button's own label is updated
        // directly on click rather than through a render() pass.
        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button';
        selectAllBtn.className = 'api-sibling-select-all';
        selectAllBtn.textContent = t('apiCandidates.selectAllChips');
        selectAllBtn.dataset.candidateIndex = String(i);
        siblingsEl.appendChild(selectAllBtn);

        candidate.siblings.forEach((sibling) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'api-sibling-chip';
          chip.textContent = t('apiCandidates.siblingChip', { name: sibling.name });
          chip.title = String(sibling.value);
          chip.dataset.candidateIndex = String(i);
          chip.dataset.siblingName = sibling.name;
          siblingsEl.appendChild(chip);
        });
        li.appendChild(siblingsEl);
      }

      // "Use" (Issue #53 Phase 5): only offered when the match sits
      // inside an actual repeating record (candidate.itemsPath truthy,
      // valuePath non-empty — see deriveItemsAndValuePath's doc comment for
      // why an empty-but-non-null valuePath also isn't usable) — Api-Mode's
      // whole model is "records extracted from a repeating array".
      if (candidate.itemsPath && candidate.valuePath) {
        const useRow = document.createElement('div');
        useRow.className = 'api-candidate-use';
        useRow.innerHTML =
          `<input type="text" class="api-candidate-field-name" placeholder="${escapeHtml(t('apiCandidates.useFieldNamePlaceholder'))}" data-candidate-index="${i}" />` +
          `<button type="button" class="btn-secondary btn-tiny api-candidate-confirm" data-candidate-index="${i}" disabled>${escapeHtml(t('common.use'))}</button>`;
        li.appendChild(useRow);
      } else {
        const note = document.createElement('div');
        note.className = 'api-candidate-unusable';
        note.textContent = t('common.noRecordArray');
        li.appendChild(note);
      }

      listEl.appendChild(li);
    });
  }

  // API-mode follow-up: the raw recorded pool, for whoever wants to see it
  // directly instead of only going through a value-correlation search — e.g.
  // to sanity-check that a variable part's other values were actually
  // recorded before relying on the pool-derived autofill below. Reuses the
  // same .api-candidate/.api-candidate-url/.api-candidate-path row styling
  // renderApiCandidates already uses, just without the value/siblings/use
  // parts that only apply to a JSON-body match.
  function renderApiEntriesList(entries) {
    const listEl = document.getElementById('api-entries-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!entries || entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'api-candidates-empty';
      li.textContent = t('idle.apiEntriesEmpty');
      listEl.appendChild(li);
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'api-candidate';
      // Request-body display (Issue #55 prep): a GET/HEAD entry never has one
      // (requestBody stays '' and requestBodySkipped stays false, see
      // api-capture.js's buildEntry), so this naturally shows nothing for them
      // without needing an explicit method check here.
      let bodyHtml = '';
      if (entry.requestBodySkipped) {
        bodyHtml = `<div class="api-candidate-body api-candidate-body-skipped">${escapeHtml(t('idle.apiEntriesBodyNotCaptured'))}</div>`;
      } else if (entry.requestBody) {
        bodyHtml = `<div class="api-candidate-body">${escapeHtml(entry.requestBody)}</div>`;
      }
      li.innerHTML =
        `<div class="api-candidate-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.method)} ${escapeHtml(String(entry.status))} ${escapeHtml(entry.url)}</div>` +
        (entry.contentType ? `<div class="api-candidate-path">${escapeHtml(entry.contentType)}</div>` : '') +
        bodyHtml;
      listEl.appendChild(li);
    });
  }
  // ── API-Mode config screen (Issue #53 Phase 5) ──────────────────────────────
  // Renders the in-progress apiConfigDraft: confirmed fields (read-only),
  // URL path segments/query params with a fest/variabel toggle per part, one
  // source-configuration card per variable part, and the header-adoption
  // table. Structural choices (variable toggle, source kind, header
  // include/mode) are reactive — patched into apiConfigDraft and immediately
  // re-rendered — but committed via the `change` event, not `input`, so
  // typing in a text field doesn't trigger a re-render (and thus lose focus)
  // on every keystroke; only leaving the field (or picking a different
  // control) does. A rerender triggered by one control can still visually
  // reset another field's *not yet committed* typing elsewhere on the same
  // screen — an accepted rough edge given how many independent inputs this
  // screen has, not a bug in the reactive fields themselves.
  //
  // partId identifies a variable-part-in-progress independently of its
  // (user-editable, only committed on blur) name — "path:<index>" or
  // "query:<key>" — so apiConfigDraft.parameterSources can be keyed by
  // something stable while the display name is still being typed.

  // Issue #54, Phase A5: the tree UI subsumes the flat field list entirely —
  // a single top-level match renders as a one-node-deep tree, visually almost
  // identical to the old flat list but wrapped in the same tree-editor chrome
  // every level beyond that reuses unchanged. renderApiConfigFieldsList is
  // gone; renderApiTree (Phase A4) is the only rendering left for this part
  // of the screen.
  function renderApiConfigScreen(draft, discoveryCandidates) {
    renderApiTree(draft.groups);
    renderApiConfigUrlParts(draft.urlParts);
    renderApiConfigParameters(draft, discoveryCandidates);
    renderApiConfigHeaders(draft.capturedHeaders, draft.headerDecisions);
    renderBodyTree(draft);

    // The body section only exists for a POST candidate whose captured
    // request body could actually be turned into a draft (see
    // loadInitialBodyTreeForCandidate) — hidden entirely rather than shown
    // empty for a GET config or an unparsable/bodyless POST.
    const bodySection = document.getElementById('api-config-body-section');
    if (bodySection) bodySection.classList.toggle('hidden', !draft.bodyTree);

    const confirmBtn = document.getElementById('btn-api-config-confirm');
    if (confirmBtn) confirmBtn.disabled = !apiConfigDraftHasAllSourcesChosen(draft);
  }

  // `id` ("path:<index>" or "query:<key>") embeds the query param's own key
  // for the query-param case — which, like every other piece of a recorded
  // URL, came from the page being recorded and so must be treated as
  // untrusted the same way candidate.url/value already are elsewhere in this
  // file (escapeHtml, not raw interpolation into an innerHTML string).
  function urlPartRowHtml(id, valueLabel, variable, name) {
    const safeId = escapeHtml(id);
    return (
      `<span class="api-config-part-value" title="${escapeHtml(valueLabel)}">${escapeHtml(valueLabel)}</span>` +
      `<label><input type="checkbox" class="api-config-part-toggle" data-part-id="${safeId}" ${variable ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.variableLabel'))}</label>` +
      (variable ? `<input type="text" class="api-config-part-name" data-part-id="${safeId}" placeholder="${escapeHtml(t('common.namePlaceholder'))}" value="${escapeHtml(name || '')}" />` : '')
    );
  }

  function renderApiConfigUrlParts(urlParts) {
    const segEl = document.getElementById('api-config-segments');
    if (segEl) {
      segEl.innerHTML = '';
      urlParts.pathSegments.forEach((seg, i) => {
        const li = document.createElement('li');
        li.className = 'api-config-part-row';
        li.innerHTML = urlPartRowHtml(`path:${i}`, `/${seg.value}`, seg.variable, seg.name);
        segEl.appendChild(li);
      });
    }

    const queryEl = document.getElementById('api-config-query-params');
    if (queryEl) {
      queryEl.innerHTML = '';
      urlParts.queryParams.forEach((p) => {
        const li = document.createElement('li');
        li.className = 'api-config-part-row';
        li.innerHTML = urlPartRowHtml(`query:${p.key}`, `${p.key}=${p.value}`, p.variable, p.name);
        queryEl.appendChild(li);
      });
    }
  }


  function renderApiConfigParameters(draft, discoveryCandidates) {
    const container = document.getElementById('api-config-parameters');
    if (!container) return;
    container.innerHTML = '';

    allParameterParts(draft).forEach((part) => {
      const source = draft.parameterSources[part.id];
      const safePartId = escapeHtml(part.id); // see urlPartRowHtml's doc comment — part.id can embed an untrusted query key
      const card = document.createElement('div');
      card.className = 'api-config-param-card';
      card.dataset.partId = part.id; // DOM property assignment, not HTML parsing — safe regardless

      const title = document.createElement('div');
      title.className = 'row-label';
      title.textContent = part.name ? part.name : t('apiConfig.unnamedPart');
      card.appendChild(title);

      const kindRow = document.createElement('div');
      kindRow.className = 'api-config-source-kind';
      const sourceKindLabels = {
        staticList: t('apiConfig.sourceKindStaticList'),
        discovery: t('apiConfig.sourceKindDiscovery'),
        range: t('apiConfig.sourceKindRange'),
      };
      kindRow.innerHTML = ['staticList', 'discovery', 'range'].map(kind => `
        <label>
          <input type="radio" name="source-kind-${safePartId}" class="api-config-source-kind-radio"
            data-part-id="${safePartId}" value="${kind}" ${source?.kind === kind ? 'checked' : ''} />
          ${escapeHtml(sourceKindLabels[kind])}
        </label>
      `).join('');
      card.appendChild(kindRow);

      const fieldsEl = document.createElement('div');
      fieldsEl.className = 'api-config-source-fields';
      if (source?.kind === 'staticList') {
        fieldsEl.innerHTML =
          `<textarea class="api-config-static-list" data-part-id="${safePartId}" rows="2" placeholder="${escapeHtml(t('apiConfig.valueListPlaceholder'))}">${escapeHtml(source.valuesText || '')}</textarea>` +
          `<button type="button" class="btn-secondary btn-tiny api-config-autofill-pool" data-part-id="${safePartId}" title="${escapeHtml(t('apiConfig.autoFillFromPoolTitle'))}">${escapeHtml(t('apiConfig.autoFillFromPoolBtn'))}</button>`;
      } else if (source?.kind === 'discovery') {
        fieldsEl.appendChild(renderDiscoverySourceFields(part, source, discoveryCandidates));
      } else if (source?.kind === 'range') {
        fieldsEl.innerHTML = `
          <div class="api-config-range-row">
            <select class="api-config-range-type" data-part-id="${safePartId}">
              ${['IsoWeek', 'Number', 'Date'].map(rangeType => `<option value="${rangeType}" ${source.type === rangeType ? 'selected' : ''}>${rangeType}</option>`).join('')}
            </select>
            <input type="text" class="api-config-range-from" data-part-id="${safePartId}" placeholder="${escapeHtml(t('apiConfig.rangeFromPlaceholder'))}" value="${escapeHtml(source.from || '')}" />
            <input type="text" class="api-config-range-to" data-part-id="${safePartId}" placeholder="${escapeHtml(t('apiConfig.rangeToPlaceholder'))}" value="${escapeHtml(source.to || '')}" />
          </div>
          ${renderRangeFormatFields(source, safePartId)}
        `;
      }
      card.appendChild(fieldsEl);

      container.appendChild(card);
    });
  }

  // The preset dropdown + revealed custom-format input + live "Example: …"
  // text below From/To, for IsoWeek/Date only (Number has no format concept).
  // `source.format` is always already set by the time this renders — either
  // auto-detected (setApiConfigSourceKind/the Type-change handler both call
  // detectRangeFormat) or explicitly chosen by the user — so "custom" here
  // just means "not one of this Type's presets", not "unset".
  function renderRangeFormatFields(source, safePartId) {
    if (source.type === 'Number') return '';

    const presets = RANGE_FORMAT_PRESETS[source.type];
    const isCustom = !presets.some(preset => preset.format === source.format);
    const options = presets
      .map(preset => `<option value="${escapeHtml(preset.format)}" ${preset.format === source.format ? 'selected' : ''}>${escapeHtml(t(preset.labelKey))}</option>`)
      .join('') + `<option value="custom" ${isCustom ? 'selected' : ''}>${escapeHtml(t('apiConfig.customFormatOption'))}</option>`;
    const example = rangeFormatExample(source.format, source.from) ?? t('apiConfig.formatEnterPrompt');

    return `
      <div class="api-config-range-format-row">
        <select class="api-config-range-format-preset" data-part-id="${safePartId}">${options}</select>
        ${isCustom ? `<input type="text" class="api-config-range-format-custom" data-part-id="${safePartId}" placeholder="{yyyy}-{ww}" value="${escapeHtml(source.format || '')}" />` : ''}
        <p class="api-config-range-format-example">${escapeHtml(t('apiConfig.formatExample', { example }))}</p>
      </div>
    `;
  }

  function renderDiscoverySourceFields(part, source, discoveryCandidates) {
    const wrap = document.createElement('div');

    if (source.urlTemplate) {
      const summary = document.createElement('p');
      summary.className = 'api-candidates-target';
      summary.textContent = t('apiConfig.discoverySource', { urlTemplate: source.urlTemplate, itemsPath: source.itemsPath, valuePath: source.valuePath });
      wrap.appendChild(summary);
    }

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'btn-secondary btn-tiny api-config-discovery-search';
    searchBtn.dataset.partId = part.id;
    searchBtn.textContent = t(source.urlTemplate ? 'apiConfig.discoverySearchAgainBtn' : 'apiConfig.discoverySearchBtn');
    wrap.appendChild(searchBtn);

    if (discoveryCandidates && discoveryCandidates.parameter === part.id) {
      const list = document.createElement('ul');
      list.className = 'api-candidates-list';
      if (discoveryCandidates.candidates.length === 0) {
        list.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('common.noMatches'))}</li>`;
      } else {
        discoveryCandidates.candidates.forEach((candidate, i) => {
          const li = document.createElement('li');
          li.className = 'api-candidate';
          const usable = candidate.itemsPath && candidate.valuePath;
          li.innerHTML =
            `<div class="api-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(candidate.method)} ${escapeHtml(candidate.url)}</div>` +
            `<div class="api-candidate-path">${escapeHtml(candidate.path)}</div>` +
            (usable
              ? `<button type="button" class="btn-secondary btn-tiny api-config-discovery-confirm" data-part-id="${escapeHtml(part.id)}" data-candidate-index="${i}">${escapeHtml(t('common.use'))}</button>`
              : `<div class="api-candidate-unusable">${escapeHtml(t('common.noRecordArray'))}</div>`);
          list.appendChild(li);
        });
      }
      wrap.appendChild(list);
    }

    return wrap;
  }

  function renderApiConfigHeaders(capturedHeaders, headerDecisions) {
    const listEl = document.getElementById('api-config-headers');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (capturedHeaders.length === 0) {
      listEl.innerHTML = `<li class="api-candidates-empty">${escapeHtml(t('apiConfig.noHeadersRecorded'))}</li>`;
      return;
    }

    capturedHeaders.forEach((header) => {
      const decision = headerDecisions[header.name] || { include: false, mode: 'literal', envName: '' };
      const li = document.createElement('li');
      li.className = 'api-config-header-row';
      li.innerHTML =
        `<label><input type="checkbox" class="api-config-header-include" data-header-name="${escapeHtml(header.name)}" ${decision.include ? 'checked' : ''} /></label>` +
        `<span class="api-config-header-name" title="${escapeHtml(header.name)}: ${escapeHtml(header.value)}">${escapeHtml(header.name)}</span>` +
        (decision.include
          ? `<span class="api-config-header-mode">
               <label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="literal" ${decision.mode === 'literal' ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.headerModeValue'))}</label>
               <label><input type="radio" name="header-mode-${escapeHtml(header.name)}" class="api-config-header-mode-radio" data-header-name="${escapeHtml(header.name)}" value="env" ${decision.mode === 'env' ? 'checked' : ''} /> ${escapeHtml(t('apiConfig.headerModeEnv'))}</label>
             </span>` +
            (decision.mode === 'env'
              ? `<input type="text" class="api-config-env-name" data-header-name="${escapeHtml(header.name)}" placeholder="${escapeHtml(t('apiConfig.envNamePlaceholder'))}" value="${escapeHtml(decision.envName || '')}" />`
              : '')
          : '');
      listEl.appendChild(li);
    });
  }
  // ── API-Mode request-body tree editor (Issue #55, Phase B4) ─────────────────
  // Visually mirrors the response tree above (buildApiTreeNodeEl/renderApiTree)
  // but simpler: a node's own JSON key/array index is a read-only label (the
  // body's shape itself is never edited, see this section's own doc comment
  // on jsonValueToBodyDraft), and only a 'literal'/'variable' leaf gets any
  // controls at all — object/array nodes just recurse.

  function bodyNodeLabel(key, node) {
    if (node.kind === 'literal') return `${key}: ${node.literalKind === 'Null' ? 'null' : JSON.stringify(node.value)}`;
    return key;
  }

  function buildBodyTreeNodeEl(key, node, path, depth, availableParameters) {
    const li = document.createElement('li');
    li.className = 'body-tree-node';
    li.dataset.path = JSON.stringify(path);

    const row = document.createElement('div');
    row.className = 'body-tree-row';
    row.style.paddingLeft = `${depth * 12}px`;

    const label = document.createElement('span');
    label.className = 'body-tree-label';
    label.textContent = bodyNodeLabel(key, node);
    row.appendChild(label);

    if (node.kind === 'literal') {
      const toVariableBtn = document.createElement('button');
      toVariableBtn.type = 'button';
      toVariableBtn.className = 'btn-secondary btn-tiny btn-body-to-variable';
      toVariableBtn.textContent = t('apiConfig.bodyToVariableBtn');
      row.appendChild(toVariableBtn);
    } else if (node.kind === 'variable') {
      const picker = document.createElement('select');
      picker.className = 'body-tree-parameter-picker';
      picker.innerHTML =
        `<option value="">${escapeHtml(t('apiConfig.bodyPickParameterPlaceholder'))}</option>` +
        availableParameters.map(p =>
          `<option value="${escapeHtml(p.id)}" ${node.parameterId === p.id ? 'selected' : ''}>${escapeHtml(p.name?.trim() ? p.name : t('apiConfig.unnamedPart'))}</option>`
        ).join('') +
        `<option value="__new__">${escapeHtml(t('apiConfig.bodyNewParameterOption'))}</option>`;
      row.appendChild(picker);

      const coerceSelect = document.createElement('select');
      coerceSelect.className = 'body-tree-coerce-to';
      coerceSelect.title = t('apiConfig.bodyCoerceToTitle');
      coerceSelect.innerHTML = ['String', 'Number', 'Boolean']
        .map(kind => `<option value="${kind}" ${(node.coerceTo || 'String') === kind ? 'selected' : ''}>${kind}</option>`)
        .join('');
      row.appendChild(coerceSelect);

      const toFixedBtn = document.createElement('button');
      toFixedBtn.type = 'button';
      toFixedBtn.className = 'btn-secondary btn-tiny btn-body-to-fixed';
      toFixedBtn.textContent = t('apiConfig.bodyToFixedBtn');
      row.appendChild(toFixedBtn);
    }

    li.appendChild(row);

    if (node.kind === 'object' || node.kind === 'array') {
      const childUl = document.createElement('ul');
      childUl.className = 'body-tree-children';
      if (node.kind === 'object') {
        Object.entries(node.properties).forEach(([childKey, child]) =>
          childUl.appendChild(buildBodyTreeNodeEl(childKey, child, [...path, childKey], depth + 1, availableParameters)));
      } else {
        node.items.forEach((child, i) =>
          childUl.appendChild(buildBodyTreeNodeEl(`[${i}]`, child, [...path, i], depth + 1, availableParameters)));
      }
      li.appendChild(childUl);
    }

    return li;
  }

  // draft (not just draft.bodyTree) since a parameter picker needs the full
  // allParameterParts(draft) list to populate its options.
  function renderBodyTree(draft) {
    const root = document.getElementById('body-tree-root');
    if (!root) return;
    root.innerHTML = '';
    if (!draft.bodyTree) return;
    root.appendChild(buildBodyTreeNodeEl(t('apiConfig.bodyRootLabel'), draft.bodyTree, [], 0, allParameterParts(draft)));
  }
  // ── API-Mode network recording (Issue #53 Phase 3) ───────────────────────────
  // Unlike preview, this doesn't depend on Fields/Groups — it's a standalone
  // recording of the page's own fetch/XHR traffic, meant to feed the future
  // API-Mode's request-discovery flow (Phase 4+). See content-script.js's
  // API_CAPTURE bridge and api-capture.js (MAIN world) for where the actual
  // interception happens.

  function startApiCapture(bridge) {
    log('API_CAPTURE_START');
    chrome.runtime.sendMessage({ type: 'API_CAPTURE_START' });
    bridge.patchState({ apiCaptureActive: true, apiCaptureCount: 0 });
  }

  function stopApiCapture(bridge) {
    log('API_CAPTURE_STOP');
    chrome.runtime.sendMessage({ type: 'API_CAPTURE_STOP' });
    // Keep apiCaptureCount — Phase 4's search below runs on what was recorded
    // *after* stopping, so the user still needs to see it stayed non-zero.
    bridge.patchState({ apiCaptureActive: false });
  }

  function toggleApiCapture(bridge) {
    if (bridge.getState().apiCaptureActive) stopApiCapture(bridge); else startApiCapture(bridge);
  }

  // ── API-Mode candidate search (Issue #53 Phase 4) ───────────────────────────
  // Reuses the existing click-selection mechanism (START_SELECTION/
  // ELEMENT_SELECTED) with an extra apiSearch flag — content-script.js still
  // sends ELEMENT_SELECTED as always (see the guard in popup.js's message
  // listener), but additionally correlates the clicked element's text against
  // the entries buffered during the (now stopped) recording and reports
  // candidates via a separate API_CANDIDATES message.

  function startApiFieldSearch(bridge) {
    const state = bridge.getState();
    if (state.apiCaptureCount === 0) return;
    log('API_SEARCH start → START_SELECTION(apiSearch)');
    bridge.stopPreviewIfActive();
    chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true });
    bridge.setState(STATES.SELECTING, {
      apiSearchTarget: 'field', pendingSelector: null, apiCandidates: null,
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (state.domViewEnabled) bridge.requestDomTree();
  }

  // ── API-Mode parameter configuration (Issue #53 Phase 5) ────────────────────
  // Turns a confirmed primary-field candidate into an in-progress ApiConfig
  // draft and enters STATES.API_CONFIG — see buildApiConfig (the pure wire-
  // format assembly) for what this eventually becomes once the user finishes
  // configuring URL segments/params/headers there.

  // `siblingNames` are JSON keys the user picked as one-click extra fields —
  // each already IS a valid field name/path (a sibling's own key, always a
  // direct property of the same record, see content-script.js's
  // siblingFields) so no separate naming step is needed for those, unlike the
  // primary field which needs a user-chosen name.
  //
  // Issue #54, Phase A5: builds the full nested tree draft (buildApiSubtree
  // FromCandidate, using A3's deriveApiTreeSkeleton) instead of a flat fields
  // array — a single top-level match still ends up a one-node-deep tree, see
  // buildApiConfig's own doc comment on why the flat wire shape stays
  // available even though the popup only ever builds trees now.
  function confirmApiFieldCandidate(bridge, candidate, fieldName, siblingNames) {
    const groups = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames);

    log('API_FIELD_CONFIRM', { url: candidate.url, groups });
    bridge.stopPreviewIfActive();
    bridge.setState(STATES.API_CONFIG, {
      apiCandidates: null,
      apiConfigDraft: {
        sourceUrl: candidate.url,
        urlParts: parseUrlTemplateParts(candidate.url),
        groups,
        capturedHeaders: candidate.requestHeaders || [],
        parameterSources: {},
        headerDecisions: {},
        // Issue #55, Phase B4: candidate.method is already there for free
        // (content-script.js's findApiCandidates always carried it, just
        // unused until now) — bodyTree starts null and is filled in
        // asynchronously below since the captured body itself isn't attached
        // to the candidate (only entryId is).
        method: candidate.method || 'GET',
        bodyTree: null,
        bodyParameters: [],
        nextBodyParameterSeq: 0,
      },
    });
    loadInitialBodyTreeForCandidate(bridge, candidate);
  }

  // Fire-and-forget follow-up (Issue #55): a POST candidate's own captured
  // request body isn't attached to the click-correlated candidate object
  // itself (only entryId is — content-script.js's findApiCandidates never
  // needed the request body before this) — so once the primary field is
  // confirmed and the API_CONFIG screen is already showing, this looks the
  // matching entry up in the raw recorded pool (fetchApiCaptureEntries, the
  // same pool "Aufgezeichnete Anfragen" and the value-list autofill already
  // use) and, if it captured a JSON-string body, turns it into the initial
  // all-literal body draft (jsonValueToBodyDraft). Runs after the screen is
  // already up rather than blocking the transition on it — a bodyless POST is
  // still a fully valid config, so an extra async round trip just to maybe
  // populate the body tree isn't worth delaying the screen transition for.
  async function loadInitialBodyTreeForCandidate(bridge, candidate) {
    if (!candidate.method || candidate.method === 'GET' || candidate.method === 'HEAD') return;

    const entries = await fetchApiCaptureEntries();
    const entry = entries.find(e => e.id === candidate.entryId);
    if (!entry || entry.requestBodySkipped || !entry.requestBody) return;

    let parsed;
    try {
      parsed = JSON.parse(entry.requestBody);
    } catch {
      return; // not JSON — no structured draft to build, request stays bodyless
    }

    // The screen may have moved on while the round trip was in flight
    // (cancelled, or a different candidate confirmed) — only apply if we're
    // still looking at the same, still-bodyless draft.
    const state = bridge.getState();
    if (state.current !== STATES.API_CONFIG || !state.apiConfigDraft || state.apiConfigDraft.bodyTree) return;
    patchApiConfigDraft(bridge, { bodyTree: jsonValueToBodyDraft(parsed) });
  }

  function cancelApiConfig(bridge) {
    log('API_CONFIG cancel');
    bridge.setState(STATES.IDLE, { apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null });
  }

  // ── API-Mode tree wiring (Issue #54, Phase A5) ──────────────────────────────
  // Adding to an already-confirmed tree: a new independent root group
  // (treeParentPath null) or a sub-field under an existing ApiGroup
  // (treeParentPath its tree path) both start a click-based JSON search the
  // same way startApiFieldSearch does above — scoped via resolveApiGroupScopePath
  // for the nested case, unscoped for a new root (Groups is a list; a second,
  // unrelated top-level array in the *same* response body is exactly as valid
  // a root as the first, see ApiConfig.Groups's own doc comment) — and the
  // confirmed candidate is inserted via insertApiTreeNode rather than
  // replacing the draft outright.
  //
  // A *sub-group* is different: unlike a field/root search, there's no single
  // clicked value to derive it from that wouldn't also imply a field the user
  // never asked for — so modal-api-group-new collects name **and** path
  // directly (no click at all), mirroring Container-Mode's "name first" order
  // while side-stepping the "what would the click's own leaf field be called"
  // question entirely. See openApiGroupModal/confirmApiGroupModal below.

  function startApiTreeFieldSearch(bridge, parentPath) {
    const state = bridge.getState();
    const scopePath = parentPath ? resolveApiGroupScopePath(state.apiConfigDraft.groups, parentPath) : null;
    log('API_TREE_FIELD_SEARCH start', { parentPath, scopePath });
    chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true, apiScopePath: scopePath });
    bridge.setState(STATES.SELECTING, {
      apiSearchTarget: { treeParentPath: parentPath }, pendingSelector: null, apiTreeSearchResult: null,
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (state.domViewEnabled) bridge.requestDomTree();
  }

  // skipSegments = the target group's own tree depth: that many of the
  // candidate's derived skeleton segments are already represented by existing
  // ancestor groups (see resolveApiGroupScopePath) — 0 for a new root.
  function confirmApiTreeFieldCandidate(bridge, candidate, fieldName, siblingNames) {
    const state = bridge.getState();
    const { treeParentPath } = state.apiTreeSearchResult;
    const skipSegments = treeParentPath ? treeParentPath.length : 0;
    const newNodes = buildApiSubtreeFromCandidate(candidate, fieldName, siblingNames, skipSegments);
    log('API_TREE_FIELD_CONFIRM', { treeParentPath, fieldName, siblingNames });
    const groups = newNodes.reduce((acc, node) => insertApiTreeNode(acc, treeParentPath, node), state.apiConfigDraft.groups);
    bridge.setState(STATES.API_CONFIG, { apiTreeSearchResult: null, apiConfigDraft: { ...state.apiConfigDraft, groups } });
  }

  function openApiGroupModal(bridge, parentPath) {
    log('API_GROUP_MODAL open', { parentPath });
    bridge.patchState({ apiGroupModalOpen: true, pendingApiTreeParentPath: parentPath });
  }

  function confirmApiGroupModal(bridge) {
    const name = document.getElementById('input-api-group-name')?.value.trim();
    const path = document.getElementById('input-api-group-path')?.value.trim();
    // Unlike a CSS selector, a JSON path can legitimately be "" (see
    // ApiGroup.Path's array-of-arrays case) — but that's only ever reachable
    // through the automatic skeleton derivation above; requiring a non-empty
    // path here keeps this small, no-click modal unambiguous (was it really
    // meant to be empty, or just not filled in yet?).
    if (!name || !path) return;

    const node = buildApiGroupDraft(name, path);
    const state = bridge.getState();
    log('API_TREE_GROUP_ADD', { name, path, parentPath: state.pendingApiTreeParentPath });
    bridge.setState(STATES.API_CONFIG, {
      apiConfigDraft: { ...state.apiConfigDraft, groups: insertApiTreeNode(state.apiConfigDraft.groups, state.pendingApiTreeParentPath, node) },
      apiGroupModalOpen: false, pendingApiTreeParentPath: null,
    });
  }

  function cancelApiGroupModal(bridge) {
    log('API_GROUP_MODAL cancel');
    bridge.patchState({ apiGroupModalOpen: false, pendingApiTreeParentPath: null });
  }

  // Renames a tree node in place — Phase A5 generalization of
  // setApiConfigFieldName (the old flat-only version), see updateApiTreeNode.
  function setApiTreeNodeName(bridge, path, name) {
    patchApiConfigDraft(bridge, { groups: updateApiTreeNode(bridge.getState().apiConfigDraft.groups, path, node => ({ ...node, name })) });
  }

  // ── API-mode field transforms (Issue #84 follow-up) ─────────────────────────
  // Reuses the exact same field-transforms.js/field-transforms-ui.js editor
  // flat/container mode's own field modals already use, plus
  // _state.pendingTransforms as the in-progress chain — the API_CONFIG screen
  // and those two modals are never open at the same time, so there's no
  // conflict reusing that one slot instead of adding a second. No live
  // preview here yet (unlike Issue #143's flat/container modals): a tree
  // field node carries no sample raw value once inserted, only ever briefly
  // available at candidate-confirm time — tracked as a follow-up (Issue
  // #147) rather than silently included or silently skipped.
  function openApiFieldTransformsModal(bridge, path) {
    const node = resolveApiTreeNode(bridge.getState().apiConfigDraft.groups, path);
    log('API_FIELD_TRANSFORMS_MODAL open', { path });
    bridge.patchState({
      apiFieldTransformModalOpen: true, pendingApiFieldTransformPath: path,
      pendingTransforms: node.transforms || [],
    });
  }

  function confirmApiFieldTransformsModal(bridge) {
    const state = bridge.getState();
    if (!transformsAreValid(state.pendingTransforms)) return;
    const transforms = state.pendingTransforms.length > 0 ? state.pendingTransforms : null;
    const groups = updateApiTreeNode(state.apiConfigDraft.groups, state.pendingApiFieldTransformPath, node => ({ ...node, transforms }));

    log('API_FIELD_TRANSFORMS_CONFIRM', { path: state.pendingApiFieldTransformPath, transforms });
    bridge.setState(STATES.API_CONFIG, {
      apiConfigDraft: { ...state.apiConfigDraft, groups },
      apiFieldTransformModalOpen: false, pendingApiFieldTransformPath: null, pendingTransforms: [],
    });
  }

  function cancelApiFieldTransformsModal(bridge) {
    log('API_FIELD_TRANSFORMS_MODAL cancel');
    bridge.patchState({ apiFieldTransformModalOpen: false, pendingApiFieldTransformPath: null, pendingTransforms: [] });
  }

  // Starts a *second* search round, reusing the exact same click-selection
  // mechanism as startApiFieldSearch (content-script.js doesn't need to know
  // which purpose this one serves) — its result becomes a DiscoverySource for
  // one specific variable part of the config being drafted, instead of the
  // primary field. `partId` (not the user-editable display name — see the
  // API-Mode config screen's own doc comment) identifies which one.
  function startDiscoverySearch(bridge, partId) {
    log('API_DISCOVERY_SEARCH start', partId);
    chrome.runtime.sendMessage({ type: 'START_SELECTION', apiSearch: true });
    bridge.setState(STATES.SELECTING, {
      apiSearchTarget: { parameter: partId }, pendingSelector: null, apiDiscoveryCandidates: null,
      domTree: null, domTreeTruncated: false, domTreeError: null,
    });
    if (bridge.getState().domViewEnabled) bridge.requestDomTree();
  }

  function confirmDiscoveryCandidate(bridge, partId, candidate) {
    const source = buildDiscoverySource(candidate.url, candidate.itemsPath, candidate.valuePath);
    const state = bridge.getState();
    log('API_DISCOVERY_CONFIRM', { partId, source });
    bridge.setState(STATES.API_CONFIG, {
      apiDiscoveryCandidates: null,
      apiConfigDraft: {
        ...state.apiConfigDraft,
        parameterSources: { ...state.apiConfigDraft.parameterSources, [partId]: source },
      },
    });
  }

  // Persists every apiConfigDraft edit through setState (not patchState) so it
  // survives a popup close/reopen mid-configuration, same as fields/groups.
  function patchApiConfigDraft(bridge, patch) {
    const state = bridge.getState();
    bridge.setState(state.current, { apiConfigDraft: { ...state.apiConfigDraft, ...patch } });
  }

  function toggleApiConfigPartVariable(bridge, partId) {
    const draft = bridge.getState().apiConfigDraft;
    const [scope, key] = partId.split(':');
    const urlParts = scope === 'path'
      ? { ...draft.urlParts, pathSegments: draft.urlParts.pathSegments.map((seg, i) => (String(i) === key ? { ...seg, variable: !seg.variable } : seg)) }
      : { ...draft.urlParts, queryParams: draft.urlParts.queryParams.map(p => (p.key === key ? { ...p, variable: !p.variable } : p)) };

    // Toggling either way drops any source config for this part — avoids an
    // orphaned/stale parameterSources entry for a part that just became
    // "fest" again, or a half-configured one lingering under a name that no
    // longer means anything after a second toggle.
    const parameterSources = { ...draft.parameterSources };
    delete parameterSources[partId];

    patchApiConfigDraft(bridge, { urlParts, parameterSources });
  }

  function setApiConfigPartName(bridge, partId, name) {
    const draft = bridge.getState().apiConfigDraft;
    const [scope, key] = partId.split(':');
    const urlParts = scope === 'path'
      ? { ...draft.urlParts, pathSegments: draft.urlParts.pathSegments.map((seg, i) => (String(i) === key ? { ...seg, name } : seg)) }
      : { ...draft.urlParts, queryParams: draft.urlParts.queryParams.map(p => (p.key === key ? { ...p, name } : p)) };
    patchApiConfigDraft(bridge, { urlParts });
  }

  const API_CONFIG_SOURCE_DEFAULTS = {
    staticList: { kind: 'staticList', valuesText: '' },
    range: { kind: 'range', type: 'IsoWeek', from: '', to: '' },
    discovery: { kind: 'discovery' }, // incomplete until confirmDiscoveryCandidate fills in urlTemplate/itemsPath/valuePath
  };

  // Range sources get their format auto-detected from the part's own
  // captured example value the moment "Range" is picked — see
  // detectRangeFormat's doc comment.
  function setApiConfigSourceKind(bridge, partId, kind) {
    const draft = bridge.getState().apiConfigDraft;
    const defaults = API_CONFIG_SOURCE_DEFAULTS[kind];
    const source = kind === 'range'
      ? { ...defaults, format: detectRangeFormat(defaults.type, findUrlPartValue(draft.urlParts, partId)) }
      : defaults;
    patchApiConfigDraft(bridge, { parameterSources: { ...draft.parameterSources, [partId]: source } });
  }

  function patchApiConfigSource(bridge, partId, patch) {
    const draft = bridge.getState().apiConfigDraft;
    patchApiConfigDraft(bridge, { parameterSources: { ...draft.parameterSources, [partId]: { ...draft.parameterSources[partId], ...patch } } });
  }

  function setApiConfigHeaderDecision(bridge, headerName, patch) {
    const draft = bridge.getState().apiConfigDraft;
    const current = draft.headerDecisions[headerName] || { include: false, mode: 'literal', envName: '' };
    patchApiConfigDraft(bridge, { headerDecisions: { ...draft.headerDecisions, [headerName]: { ...current, ...patch } } });
  }

  // ── API-Mode request-body wiring (Issue #55, Phase B4) ──────────────────────
  // Toggling a leaf is the only structural edit the body tree ever gets (see
  // the section's own doc comment above jsonValueToBodyDraft) — everything
  // else here is either that toggle or routing a newly-variable leaf into the
  // exact same parameter-source configuration UI a URL variable part already
  // uses (allParameterParts/renderApiConfigParameters), rather than a second,
  // body-specific source picker.

  function toggleBodyLeafToVariable(bridge, path) {
    const bodyTree = updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({
      kind: 'variable', literalKind: node.literalKind, value: node.value, parameterId: null, coerceTo: null,
    }));
    patchApiConfigDraft(bridge, { bodyTree });
  }

  // A body-only parameter (unlike a URL part, which persists regardless of
  // whether the body still references it) only exists because some variable
  // leaf pointed at it — if this was the last one, drop it along with its
  // parameterSources entry rather than leaving an orphaned parameter card
  // that would still need a configured source just to satisfy
  // apiConfigDraftHasAllSourcesChosen (and the companion's own "declared but
  // unused parameter" rejection) for nothing. A leaf bound to a URL-derived
  // id is left alone either way — that part is still a real URL segment/query
  // param regardless of whether the body also referenced it.
  function toggleBodyLeafToFixed(bridge, path) {
    const draft = bridge.getState().apiConfigDraft;
    const node = resolveBodyTreeNode(draft.bodyTree, path);
    const boundId = node.parameterId;
    const bodyTree = updateBodyTreeNode(draft.bodyTree, path, n => ({ kind: 'literal', literalKind: n.literalKind, value: n.value }));

    const isOrphanedBodyParameter = boundId?.startsWith('body:') && !bodyTreeReferencesParameterId(bodyTree, boundId);
    const bodyParameters = isOrphanedBodyParameter
      ? (draft.bodyParameters || []).filter(p => p.id !== boundId)
      : draft.bodyParameters;
    const parameterSources = isOrphanedBodyParameter
      ? Object.fromEntries(Object.entries(draft.parameterSources).filter(([id]) => id !== boundId))
      : draft.parameterSources;

    patchApiConfigDraft(bridge, { bodyTree, bodyParameters, parameterSources });
  }

  function setBodyLeafParameter(bridge, path, parameterId) {
    patchApiConfigDraft(bridge, { bodyTree: updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({ ...node, parameterId: parameterId || null })) });
  }

  // null (not "String") is the wire-omitted default — mirrors CoerceTo's own
  // optional nullable shape on the companion side (ApiBodyVariable.CoerceTo).
  function setBodyLeafCoerceTo(bridge, path, coerceTo) {
    patchApiConfigDraft(bridge, { bodyTree: updateBodyTreeNode(bridge.getState().apiConfigDraft.bodyTree, path, node => ({ ...node, coerceTo: coerceTo === 'String' ? null : coerceTo })) });
  }

  function openBodyParameterModal(bridge, path) {
    log('API_BODY_PARAMETER_MODAL open', { path });
    bridge.patchState({ bodyParameterModalOpen: true, pendingBodyVariablePath: path });
  }

  // New body-only parameter ids are a monotonic sequence (draft.
  // nextBodyParameterSeq), not derived from the current array length —
  // toggleBodyLeafToFixed can remove entries again, and reusing a shrunk
  // array's length as the next id could otherwise collide with one still
  // referenced elsewhere in the tree.
  function confirmBodyParameterModal(bridge) {
    const name = document.getElementById('input-api-body-parameter-name')?.value.trim();
    if (!name) return;

    const state = bridge.getState();
    const draft = state.apiConfigDraft;
    const seq = draft.nextBodyParameterSeq || 0;
    const id = `body:${seq}`;
    const bodyParameters = [...(draft.bodyParameters || []), { id, name }];
    const bodyTree = updateBodyTreeNode(draft.bodyTree, state.pendingBodyVariablePath, node => ({ ...node, parameterId: id }));

    log('API_BODY_PARAMETER_ADD', { id, name });
    bridge.setState(STATES.API_CONFIG, {
      apiConfigDraft: { ...draft, bodyParameters, bodyTree, nextBodyParameterSeq: seq + 1 },
      bodyParameterModalOpen: false, pendingBodyVariablePath: null,
    });
  }

  function cancelBodyParameterModal(bridge) {
    log('API_BODY_PARAMETER_MODAL cancel');
    bridge.patchState({ bodyParameterModalOpen: false, pendingBodyVariablePath: null });
  }

  // Final assembly (Issue #53 Phase 5's "Apply"): staticList/range
  // sources are only ever kept as raw UI state (valuesText / type+from+to) in
  // apiConfigDraft, never as a built wire object — built here, once, from
  // whatever's currently in state. discovery sources are already complete
  // wire objects (built earlier by confirmDiscoveryCandidate) and passed
  // through as-is.
  //
  // Issue #55, Phase B4: iterates allParameterParts (URL + body-only) instead
  // of just variableUrlParts, so a body-only parameter's source is resolved
  // into the wire-ready parameterSources map exactly like a URL one already
  // was — idToName is then the one piece serializeBodyTree needs to turn a
  // variable leaf's draft-only parameterId into the actual declared name.
  function confirmApiConfig(bridge) {
    const draft = bridge.getState().apiConfigDraft;
    const parameterSources = {};
    const idToName = {};
    allParameterParts(draft).forEach((part) => {
      const source = draft.parameterSources[part.id];
      parameterSources[part.name] = source.kind === 'staticList'
        ? buildStaticListSource(source.valuesText)
        : source.kind === 'range'
          ? buildRangeSource(source.type, source.from, source.to, source.format)
          : source;
      idToName[part.id] = part.name;
    });

    const apiConfig = buildApiConfig({
      urlParts: draft.urlParts,
      groups: draft.groups,
      parameterSources,
      capturedHeaders: draft.capturedHeaders,
      headerDecisions: draft.headerDecisions,
      method: draft.method,
      bodyTree: draft.bodyTree,
      bodyParameterNames: (draft.bodyParameters || []).map(p => p.name),
      parameterIdToName: idToName,
    });

    log('API_CONFIG confirm', apiConfig);
    bridge.setState(STATES.IDLE, { apiConfig, apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null });
  }

  // Low-level GET_API_CAPTURE_ENTRIES round trip, shared by the "view
  // recorded endpoints" panel below and the value-list autofill further down
  // — same request/response shape as GET_LOGS/CHECK_ROBOTS_TXT, just no
  // dedicated loading/result state of its own since both callers keep their
  // own. Needs no bridge — it only ever talks to chrome.runtime, never state.
  async function fetchApiCaptureEntries() {
    try {
      return await chrome.runtime.sendMessage({ type: 'GET_API_CAPTURE_ENTRIES' }) || [];
    } catch (err) {
      log('GET_API_CAPTURE_ENTRIES failed', err.message);
      return [];
    }
  }

  // API-mode follow-up: toggles the inline "view recorded endpoints" panel —
  // fetches a fresh snapshot of the pool on every open (not just once) so a
  // user who recorded more requests, closed the panel, and reopens it sees
  // them without needing to stop/restart recording.
  async function toggleApiEntriesPanel(bridge) {
    if (bridge.getState().apiEntriesPanelOpen) {
      log('API_ENTRIES_PANEL close');
      bridge.patchState({ apiEntriesPanelOpen: false });
      return;
    }
    log('API_ENTRIES_PANEL open');
    const entries = await fetchApiCaptureEntries();
    bridge.patchState({ apiEntriesPanelOpen: true, apiEntries: entries });
  }

  // API-mode follow-up: derives sibling values for one variable URL part from
  // the recorded pool and merges them into that part's StaticListSource value
  // list — see findUrlTemplateMatches/mergeValueListValues above for the
  // actual matching/merging logic. Runs once automatically the moment
  // "Werteliste" is picked as the source kind, and again on demand via the
  // per-card "Aus Aufzeichnung übernehmen" button (e.g. after scrolling the
  // inspected page further to trigger more recorded requests).
  async function fillStaticListFromPool(bridge, partId) {
    log('API_AUTOFILL start', partId);
    const entries = await fetchApiCaptureEntries();

    // The round trip is async — re-read state instead of trusting a
    // closed-over draft, and bail if the screen/parameter moved on while it
    // was in flight (config screen left, part removed, or its source kind
    // switched away from staticList in the meantime).
    const draft = bridge.getState().apiConfigDraft;
    const source = draft?.parameterSources?.[partId];
    if (!draft || source?.kind !== 'staticList') return;

    const matches = findUrlTemplateMatches(draft.urlParts, partId, entries);
    const { text, addedCount } = mergeValueListValues(source.valuesText || '', matches);
    log('API_AUTOFILL result', { partId, found: matches.length, added: addedCount });

    // A successful fill is already visible in the textarea itself — no need
    // to also announce it via the (otherwise error-only, red) toast. Only the
    // no-op case gets one, since nothing else on screen would otherwise
    // confirm that the button/auto-run actually did something.
    if (addedCount > 0) {
      patchApiConfigSource(bridge, partId, { valuesText: text });
    } else {
      bridge.showToast(t('apiConfig.autoFillNoMatches'));
    }
  }

  return {
    buildApiTreeNodeEl, renderApiTree,
    renderApiCandidates, renderApiEntriesList,
    renderApiConfigScreen, renderApiConfigUrlParts, renderApiConfigParameters,
    renderRangeFormatFields, renderDiscoverySourceFields, renderApiConfigHeaders,
    bodyNodeLabel, buildBodyTreeNodeEl, renderBodyTree,
    startApiCapture, stopApiCapture, toggleApiCapture,
    startApiFieldSearch, confirmApiFieldCandidate, loadInitialBodyTreeForCandidate, cancelApiConfig,
    startApiTreeFieldSearch, confirmApiTreeFieldCandidate,
    openApiGroupModal, confirmApiGroupModal, cancelApiGroupModal, setApiTreeNodeName,
    openApiFieldTransformsModal, confirmApiFieldTransformsModal, cancelApiFieldTransformsModal,
    startDiscoverySearch, confirmDiscoveryCandidate,
    toggleApiConfigPartVariable, setApiConfigPartName, setApiConfigSourceKind,
    patchApiConfigSource, setApiConfigHeaderDecision,
    toggleBodyLeafToVariable, toggleBodyLeafToFixed, setBodyLeafParameter, setBodyLeafCoerceTo,
    openBodyParameterModal, confirmBodyParameterModal, cancelBodyParameterModal, confirmApiConfig,
    fetchApiCaptureEntries, toggleApiEntriesPanel, fillStaticListFromPool,
  };
})();

if (typeof module !== 'undefined') module.exports = SFApiConfigUI;
if (typeof self !== 'undefined') self.SFApiConfigUI = SFApiConfigUI;
