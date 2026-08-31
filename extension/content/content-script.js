// Exported for testing (Jest/jsdom). In the extension build the chrome API
// calls are guarded by the message listener below.

const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Content');

// Surfaces otherwise-silent script errors in the bug report (see GET_LOGS
// below) instead of only showing up in the page's own devtools console.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));
}

// scopeRoot (optional): stops the upward walk there instead of document.body,
// so the selector is valid relative to a container instance rather than the
// whole page — used when adding a nested container/field in Container-Mode
// (see startSelection's scopeSelector).
//
// avoidId (optional): skips the ID short-circuit below. An id is unique
// page-wide, so a selector built from one can only ever match a single
// element — fine for a one-off flat field or an "Einzelnes Element"
// container, but self-defeating for anything that has to match N times: a
// "Wiederholend" container's own selector, or any container/field nested
// inside one (its selector gets re-evaluated once per repeating instance —
// see popup.js's hasRepeatingAncestor).
function buildSelector(element, scopeRoot, avoidId) {
  const boundary = scopeRoot || document.body;
  const segments = [];

  let current = element;
  while (current && current !== boundary) {
    if (current.id && !avoidId) {
      segments.unshift(`#${current.id}`);
      break;
    }

    const classes = Array.from(current.classList).filter(c => c.trim() !== '');
    if (classes.length > 0) {
      segments.unshift(`${current.tagName.toLowerCase()}.${classes.join('.')}`);
    } else {
      segments.unshift(current.tagName.toLowerCase());
    }

    if (segments.length >= 4) break;
    current = current.parentElement;
  }

  return segments.join(' > ');
}

// Identifies an element by its position within the DOM tree, relative to
// document.body (same boundary buildSelector stops at). Used to correlate
// page-side hover/click events with nodes in the side panel's tree view.
function elementPath(element) {
  const path = [];
  let current = element;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
}

// Serializes the DOM (rooted at document.body) into a plain-object tree the
// side panel can render. Capped at MAX_TREE_NODES so a huge page can't hang
// the side panel or blow up the message payload.
const MAX_TREE_NODES = 500;

function serializeDomTree() {
  let count = 0;
  let truncated = false;

  function walk(element, path) {
    count++;
    const classes = Array.from(element.classList).filter(c => c.trim() !== '');
    const children = [];
    for (let i = 0; i < element.children.length; i++) {
      if (count >= MAX_TREE_NODES) { truncated = true; break; }
      children.push(walk(element.children[i], [...path, i]));
    }
    return { tag: element.tagName.toLowerCase(), id: element.id || null, classes, path, children };
  }

  const tree = walk(document.body, []);
  return { tree, truncated };
}

// ── Preview-mode matching ────────────────────────────────────────────────────
// Mirrors the backend codegen exactly so the preview never shows something
// the real generated script wouldn't extract:
// - Flat mode (scraper.py.j2): `soup.select(selector)` per field — every
//   match, index-aligned into rows. Equivalent here: querySelectorAll.
// - Container mode (scraper_grouped.py.j2's extract_group): a group node
//   resolves its selector once (select_one) or repeatedly (select, when
//   `repeating`) against the current scope and recurses into each match; a
//   field leaf is always a single match (select_one). The wire format from
//   serializeGroupTree (popup.js) already distinguishes group vs. field by
//   whether `children` is present, exactly like extract_group's `"children"
//   in node` check — so the same tree can be walked here unmodified.
//
// Each querySelector(All) call is wrapped individually: an invalid/
// incompatible selector is treated as zero matches instead of aborting the
// whole preview (same selector-compatibility limitation documented for the
// real backend — see CLAUDE.md point 3).

function safeQueryAll(scope, selector) {
  try {
    return Array.from(scope.querySelectorAll(selector));
  } catch (err) {
    log('PREVIEW invalid selector', selector, err.message);
    return [];
  }
}

function safeQueryOne(scope, selector) {
  try {
    return scope.querySelector(selector);
  } catch (err) {
    log('PREVIEW invalid selector', selector, err.message);
    return null;
  }
}

function matchFlatFields(fields) {
  const matches = [];
  const empty = [];
  fields.forEach(({ name, selector }) => {
    const found = safeQueryAll(document, selector);
    if (found.length === 0) empty.push(name);
    found.forEach(element => matches.push({ element, name }));
  });
  return { matches, empty };
}

function matchGroupTree(scope, nodes, matches, empty) {
  nodes.forEach(node => {
    if (node.children) {
      const instances = node.repeating
        ? safeQueryAll(scope, node.selector)
        : [safeQueryOne(scope, node.selector)].filter(Boolean);
      if (instances.length === 0) empty.push(node.name);
      instances.forEach(instance => {
        matches.push({ element: instance, name: node.name });
        matchGroupTree(instance, node.children, matches, empty);
      });
    } else {
      const found = safeQueryOne(scope, node.selector);
      if (found) matches.push({ element: found, name: node.name });
      else empty.push(node.name);
    }
  });
}

function computePreviewMatches(mode, fields, groups) {
  if (mode === 'container') {
    const matches = [];
    const empty = [];
    matchGroupTree(document, groups || [], matches, empty);
    return { matches, empty };
  }
  return matchFlatFields(fields || []);
}

// ── API-Mode candidate correlation (Issue #53 Phase 4) ──────────────────────
// Given the text of a clicked element, searches the JSON bodies buffered by
// Phase 3's recording (see the API-Mode capture bridge below) for a scalar
// value matching that text, and reports each hit as a JSON path — using the
// same minimal dot/"[n]" path notation the companion backend's ApiConfig
// already expects (see scraper_api.py.j2's _resolve_json_path), so a path
// found here stays directly usable once later phases build an ApiConfig
// from it. Deliberately emits concrete "[n]" indices, never "[*]" — that
// token means "every element" in the backend's DSL and only makes sense for
// a path someone authors by hand, not a single found match.

const JSON_PATH_TOKEN_RE = /[^.[\]]+|\[\d+\]/g;

function pathTokens(path) {
  return path.match(JSON_PATH_TOKEN_RE) || [];
}

function tokensToPath(tokens) {
  return tokens.reduce((acc, token) => (token.startsWith('[') ? acc + token : (acc ? `${acc}.${token}` : token)), '');
}

// Walks `tokens` against `data` the same way the Python runtime resolves a
// path at scrape time — used here to re-locate a match's parent container
// for siblingFields below.
function resolveTokens(data, tokens) {
  let value = data;
  for (const token of tokens) {
    if (value === null || value === undefined) return undefined;
    if (token.startsWith('[')) {
      value = Array.isArray(value) ? value[parseInt(token.slice(1, -1), 10)] : undefined;
    } else {
      value = (typeof value === 'object' && !Array.isArray(value)) ? value[token] : undefined;
    }
  }
  return value;
}

// Recursive walk, accumulator-style like matchGroupTree above. Only scalar
// leaves (string/number/boolean) are candidate matches — an object/array
// itself never equals a clicked element's text.
function walkJson(data, path, target, matches) {
  if (Array.isArray(data)) {
    data.forEach((item, i) => walkJson(item, `${path}[${i}]`, target, matches));
  } else if (data && typeof data === 'object') {
    Object.keys(data).forEach((key) => walkJson(data[key], path ? `${path}.${key}` : key, target, matches));
  } else if (data !== null && data !== undefined && String(data).trim() === target) {
    matches.push({ path, value: data });
  }
}

function findValueInJson(data, targetText, matches) {
  const target = String(targetText ?? '').trim();
  if (target) walkJson(data, '', target, matches);
  return matches;
}

// Sibling scalar keys of the object that directly contains the match at
// `matchPath` — e.g. for a match at "items[2].price", the siblings are the
// other flat fields of items[2] ("name", "id", …), offered as one-click
// suggestions for additional fields of the same record. A match that's
// itself a bare array element (path ends in "[n]", e.g. "tags[0]") has no
// named siblings — a scalar array has no keys.
function siblingFields(data, matchPath) {
  const tokens = pathTokens(matchPath);
  if (tokens.length === 0) return [];
  const matchedKey = tokens[tokens.length - 1];
  if (matchedKey.startsWith('[')) return [];

  const parent = resolveTokens(data, tokens.slice(0, -1));
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return [];

  const parentPath = tokensToPath(tokens.slice(0, -1));
  return Object.keys(parent)
    .filter((key) => key !== matchedKey && parent[key] !== null && typeof parent[key] !== 'object')
    .map((key) => ({ name: key, path: parentPath ? `${parentPath}.${key}` : key, value: parent[key] }));
}

const MAX_API_CANDIDATES = 20; // caps the UI list on a heavily-recorded session, same spirit as PREVIEW_MAX_BOXES

// Searches every buffered entry's (parsed) response body for `targetText`,
// ranking hits by plausibility — a declared JSON content-type first, then a
// body where the value occurs fewer times (more likely to be the *specific*
// value the user meant, not a generic recurring one like a currency symbol
// or status string), then a shorter path as a final tiebreaker.
function findApiCandidates(entries, targetText) {
  const target = String(targetText ?? '').trim();
  if (!target) return [];

  const ranked = [];
  entries.forEach((entry) => {
    if (!entry.body || entry.bodySkipped) return;
    let parsed;
    try {
      parsed = JSON.parse(entry.body);
    } catch {
      return; // not JSON, or a truncated body cut off mid-structure — can't search it
    }
    const matches = findValueInJson(parsed, target, []);
    if (matches.length === 0) return;
    const isJsonContentType = !!(entry.contentType && entry.contentType.includes('json'));
    matches.forEach(({ path, value }) => {
      // itemsPath/valuePath (Issue #53 Phase 5): derived once here so the
      // popup — which only ever sees this message's plain data, never
      // content-script.js's own functions — doesn't need its own copy of
      // deriveItemsAndValuePath to know whether/how a candidate can become
      // an API-mode source. null when the match isn't inside a repeating
      // array at all; valuePath is "" (not null) for the bare-array-element
      // case — see deriveItemsAndValuePath's own doc comment.
      const derived = deriveItemsAndValuePath(path);
      ranked.push({
        entryId: entry.id,
        url: entry.url,
        method: entry.method,
        path,
        value,
        siblings: siblingFields(parsed, path),
        itemsPath: derived ? derived.itemsPath : null,
        valuePath: derived ? derived.valuePath : null,
        requestHeaders: entry.requestHeaders || [],
        isJsonContentType,
        matchCountInBody: matches.length,
      });
    });
  });

  ranked.sort((a, b) => {
    if (a.isJsonContentType !== b.isJsonContentType) return a.isJsonContentType ? -1 : 1;
    if (a.matchCountInBody !== b.matchCountInBody) return a.matchCountInBody - b.matchCountInBody;
    return a.path.length - b.path.length;
  });

  return ranked.slice(0, MAX_API_CANDIDATES).map(({ isJsonContentType, matchCountInBody, ...candidate }) => candidate);
}

// Splits a match path into the "repeating records" part and the "one
// field within a record" part — e.g. "data.items[2].price" becomes
// itemsPath "data.items" (the array itself) and valuePath "price" (the
// matched field, relative to one record). Backend shape: ApiConfig.ItemsPath
// is exactly this itemsPath for whichever candidate the user confirms as
// the API-mode source, and a DiscoverySource built from a *different*
// confirmed candidate uses the same split for its own ItemsPath/ValuePath
// (see companion/.../IR/ApiConfig.cs) — Phase 5 reuses this one function
// for both.
//
// Returns null when the path never enters an array at all (a bare
// top-level scalar match) — there is no repeating-records structure to
// derive an ItemsPath from, so such a candidate can't become an API-mode
// source. Also null-ish in effect when the match *is* the array element
// itself (e.g. "tags[0]", a plain array of scalars, no record object to
// pull other fields out of) — valuePath comes back as "", which the
// backend's validator rejects as a field path (Fields[].Path must be
// non-empty), so callers should treat an empty valuePath the same as null.
function deriveItemsAndValuePath(matchPath) {
  const tokens = pathTokens(matchPath);
  let lastBracketIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].startsWith('[')) { lastBracketIndex = i; break; }
  }
  if (lastBracketIndex === -1) return null;

  return {
    itemsPath: tokensToPath(tokens.slice(0, lastBracketIndex)),
    valuePath: tokensToPath(tokens.slice(lastBracketIndex + 1)),
  };
}

// ── robots.txt check ─────────────────────────────────────────────────────────
// Groups consecutive "User-agent:" lines followed by their Allow/Disallow
// lines into records, per the general robots.txt grouping rule: a new
// User-agent line right after another one joins the same group (several
// names sharing one rule set), but one that follows a rule line starts a
// fresh group.
function parseRobotsTxt(text) {
  const groups = [];
  let current = null;
  let sawRuleInCurrent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sepIndex = line.indexOf(':');
    if (sepIndex === -1) continue;
    const field = line.slice(0, sepIndex).trim().toLowerCase();
    const value = line.slice(sepIndex + 1).trim();

    if (field === 'user-agent') {
      if (!current || sawRuleInCurrent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRuleInCurrent = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current) {
      sawRuleInCurrent = true;
      // An empty "Disallow:" traditionally means "nothing is disallowed" —
      // equivalent to no rule at all, so it's simply not recorded.
      if (value !== '') current.rules.push({ type: field, pattern: value });
    }
  }

  return groups;
}

// Translates a robots.txt path pattern into a RegExp, supporting the
// de-facto "*" (any sequence) and trailing "$" (end-of-string) extensions
// most crawlers — including the ones this project cares about — honor,
// even though they're not in the original robots.txt draft.
function robotsPatternToRegex(pattern) {
  const hasEndAnchor = pattern.endsWith('$');
  const body = hasEndAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${hasEndAnchor ? '$' : ''}`);
}

// Decides whether `path` is allowed, per the standard "longest matching
// pattern wins, ties go to Allow" rule. Always checked against the
// catch-all "User-agent: *" group — the scripts this tool generates
// (`requests`' default UA, a plain Playwright/Chromium UA) don't carry a
// dedicated product token most robots.txt files would recognize by name,
// so the generic group is the only one that's meaningfully applicable.
function evaluateRobotsTxt(text, path) {
  const groups = parseRobotsTxt(text);
  const group = groups.find(g => g.agents.includes('*'));
  if (!group) return { allowed: true, matchedRule: null };

  let best = null;
  for (const rule of group.rules) {
    if (!robotsPatternToRegex(rule.pattern).test(path)) continue;
    const isLonger = !best || rule.pattern.length > best.pattern.length;
    const isTieBrokenByAllow = best && rule.pattern.length === best.pattern.length
      && rule.type === 'allow' && best.type === 'disallow';
    if (isLonger || isTieBrokenByAllow) best = rule;
  }
  return { allowed: !best || best.type === 'allow', matchedRule: best };
}

// Fetched from here rather than the side panel so it's a same-origin
// request relative to the inspected page (like the page's own JS could
// make) — no extra host_permissions needed for a cross-origin fetch from
// an extension page.
async function checkRobotsTxt() {
  const robotsUrl = `${location.origin}/robots.txt`;
  const path = location.pathname + location.search;
  log('ROBOTS_TXT_CHECK start', robotsUrl);
  try {
    const res = await fetch(robotsUrl, { cache: 'no-store' });
    if (res.status === 404) {
      // No robots.txt at all is the standard "everything is allowed" case.
      return { ok: true, robotsUrl, path, notFound: true, allowed: true, matchedRule: null };
    }
    if (!res.ok) {
      return { ok: false, robotsUrl, path, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const { allowed, matchedRule } = evaluateRobotsTxt(text, path);
    return { ok: true, robotsUrl, path, notFound: false, allowed, matchedRule };
  } catch (err) {
    log('ROBOTS_TXT_CHECK fail', err.message);
    return { ok: false, robotsUrl, path, error: err.message };
  }
}

// ── Cross-frame path resolution (Issue #42) ─────────────────────────────────
// With all_frames:true (see manifest.json), this script runs once per frame
// on the page, including every iframe (same-origin or not — cross-origin
// injection was verified to work via a real loaded extension, see
// PLAN-issues-41-42.md's Spike A). A click inside a nested frame needs a
// "frame path" — an ordered list of CSS selectors identifying each iframe
// from the top document down to the frame that was clicked in — so the
// companion can later reach the same element via
// page.frame_locator(sel1).frame_locator(sel2)....
//
// window.frameElement (which would give a frame its own containing <iframe>
// element directly) only works for same-origin frames — cross-origin access
// to it is blocked by the standard same-origin policy, same as any other
// cross-origin DOM read, regardless of the content script's elevated
// injection privileges. So this instead asks the parent frame (which always
// has full access to its own DOM, including the <iframe> element embedding
// this frame, since window.parent.postMessage/whichever <iframe> element's
// .contentWindow matches this frame's window is not restricted by
// same-origin) via postMessage, recursively up to the top document.

const FRAME_PATH_SOURCE = 'sf-frame-path';
const FRAME_PATH_TIMEOUT_MS = 2000;
let framePathRequestId = 0;
const pendingFramePathRequests = new Map();

// Finds the <iframe> element in this frame's own document whose
// contentWindow is `childWindow`, and returns a selector for it (reusing
// buildSelector — an <iframe> is just another element in `document`) — or
// null if no matching iframe is found (e.g. a request racing the frame's
// removal from the DOM).
function findIframeSelectorForWindow(childWindow) {
  const iframes = document.getElementsByTagName('iframe');
  for (const iframe of iframes) {
    if (iframe.contentWindow === childWindow) return buildSelector(iframe, null, false);
  }
  return null;
}

// Resolves to the ordered list of iframe selectors from the top document
// down to (but not including) the current frame — [] if this frame *is* the
// top document (today's only case, unchanged default behavior), or null if
// this frame is nested but a parent's reply never arrived in time
// (practically only possible if a parent's own content script somehow isn't
// running — Spike A showed the request/reply round trip itself is otherwise
// effectively instant, even across cross-origin frames).
function resolveFramePath() {
  if (window === window.top) return Promise.resolve([]);

  const requestId = ++framePathRequestId;
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingFramePathRequests.delete(requestId);
      log('FRAME_PATH request timed out', requestId);
      resolve(null);
    }, FRAME_PATH_TIMEOUT_MS);
    pendingFramePathRequests.set(requestId, { resolve, timeoutId });
    window.parent.postMessage({ source: FRAME_PATH_SOURCE, type: 'REQUEST', requestId }, '*');
  });
}

// Registered in every frame — a frame only ever acts as the "parent" side
// (REQUEST handling) when it actually has a nested child asking it, and only
// ever acts as the "child" side (REQUEST sending / REPLY handling) when it
// itself is nested — both roles can apply to the same frame at once for a
// frame nested more than one level deep, so this listener always runs
// regardless of this frame's own position in the tree.
function handleFramePathMessage(event) {
  const data = event.data;
  if (!data || data.source !== FRAME_PATH_SOURCE) return;

  if (data.type === 'REQUEST') {
    const mySelectorForChild = findIframeSelectorForWindow(event.source);
    if (mySelectorForChild === null) {
      event.source.postMessage({ source: FRAME_PATH_SOURCE, type: 'REPLY', requestId: data.requestId, path: null }, '*');
      return;
    }
    resolveFramePath().then((ownPath) => {
      const path = ownPath === null ? null : [...ownPath, mySelectorForChild];
      event.source.postMessage({ source: FRAME_PATH_SOURCE, type: 'REPLY', requestId: data.requestId, path }, '*');
    });
    return;
  }

  if (data.type === 'REPLY') {
    const pending = pendingFramePathRequests.get(data.requestId);
    if (!pending) return; // already timed out, or addressed to a different request
    clearTimeout(pending.timeoutId);
    pendingFramePathRequests.delete(data.requestId);
    pending.resolve(data.path);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', handleFramePathMessage);
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildSelector, elementPath, serializeDomTree,
    matchFlatFields, matchGroupTree, computePreviewMatches,
    findValueInJson, siblingFields, findApiCandidates, deriveItemsAndValuePath,
    parseRobotsTxt, evaluateRobotsTxt, checkRobotsTxt,
    findIframeSelectorForWindow, resolveFramePath, frameDepth,
  };
}

// ── Overlay ──────────────────────────────────────────────────────────────────

// How many <iframe> boundaries separate this frame from the top document —
// 0 for the top document itself (today's only case before Issue #42). Walks
// window.parent references without reading any property off them, so this
// stays cross-origin-safe (see the cross-frame path resolution section
// above for the same concern) — no postMessage round trip needed, unlike
// resolveFramePath's actual selector chain, so this is cheap enough to call
// synchronously from createOverlay() on every selection round.
function frameDepth() {
  let depth = 0;
  let w = window;
  while (w !== window.top) {
    depth++;
    w = w.parent;
  }
  return depth;
}

let overlay = null;

// Highlights an element inside a nested frame with a distinct (amber, badged
// with the nesting depth) style from a top-level one (blue, Issue #41's
// original color) — the depth is available synchronously (see frameDepth
// above), while the actual resolved frame path (the chain of iframe
// selectors) is only known once resolveFramePath's async postMessage round
// trip completes in onClick below, so it can't be shown live during hover.
// The depth badge is icon+number only, deliberately not routed through the
// popup's i18n system — this renders into the inspected page itself, not
// the extension's own UI, and a resolved frame path is shown as proper
// translated text in the side panel once a click actually confirms one.
function createOverlay() {
  if (overlay) return;
  const depth = frameDepth();
  overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:      'fixed',
    pointerEvents: 'none',
    zIndex:        '2147483647',
    border:        `2px solid ${depth > 0 ? '#f59e0b' : '#3b82f6'}`,
    background:    depth > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.1)',
    boxSizing:     'border-box',
    transition:    'all 0.05s ease',
  });

  if (depth > 0) {
    const badge = document.createElement('div');
    badge.className = 'sf-frame-depth-badge';
    badge.textContent = `\u{1F5BC} ${depth}`;
    Object.assign(badge.style, {
      position:      'absolute',
      top:           '-18px',
      left:          '0',
      background:    '#f59e0b',
      color:         '#fff',
      font:          '11px sans-serif',
      padding:       '1px 4px',
      borderRadius:  '3px',
      whiteSpace:    'nowrap',
      pointerEvents: 'none',
    });
    overlay.appendChild(badge);
  }

  document.body.appendChild(overlay);
}

function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function moveOverlayTo(element) {
  if (!overlay) return;
  const r = element.getBoundingClientRect();
  Object.assign(overlay.style, {
    top:    `${r.top}px`,
    left:   `${r.left}px`,
    width:  `${r.width}px`,
    height: `${r.height}px`,
  });
}

// ── Preview overlay ──────────────────────────────────────────────────────────
// Draws one highlight box + name label per match from computePreviewMatches.
// Uses position:absolute (document-relative, via getBoundingClientRect() +
// window.scrollX/Y) instead of the hover overlay's position:fixed, so boxes
// stay aligned with their elements while the page scrolls without needing a
// scroll listener. No MutationObserver/ResizeObserver — boxes are a
// point-in-time snapshot, same simplicity level as the hover overlay.

const PREVIEW_MAX_BOXES = 300; // caps drawn boxes on pathological pages; the real match count is still reported

let previewBoxes = [];

function createPreviewBox(element, name) {
  const rect = element.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'sf-preview-box';
  Object.assign(box.style, {
    position:      'absolute',
    top:           `${rect.top + window.scrollY}px`,
    left:          `${rect.left + window.scrollX}px`,
    width:         `${rect.width}px`,
    height:        `${rect.height}px`,
    border:        '2px solid #3b82f6',
    background:    'rgba(59,130,246,0.15)',
    boxSizing:     'border-box',
    pointerEvents: 'none',
    zIndex:        '2147483646',
  });

  const label = document.createElement('div');
  label.textContent = name;
  Object.assign(label.style, {
    position:      'absolute',
    top:           '-18px',
    left:          '0',
    background:    '#3b82f6',
    color:         '#fff',
    font:          '11px sans-serif',
    padding:       '1px 4px',
    borderRadius:  '3px',
    whiteSpace:    'nowrap',
    pointerEvents: 'none',
  });
  box.appendChild(label);

  document.body.appendChild(box);
  previewBoxes.push(box);
}

function clearPreviewBoxes() {
  previewBoxes.forEach(box => box.remove());
  previewBoxes = [];
}

function startPreview(mode, fields, groups) {
  clearPreviewBoxes();
  const { matches, empty } = computePreviewMatches(mode, fields, groups);
  matches.slice(0, PREVIEW_MAX_BOXES).forEach(({ element, name }) => createPreviewBox(element, name));
  const truncated = matches.length > PREVIEW_MAX_BOXES;

  log('PREVIEW result', { total: matches.length, empty, truncated });
  chrome.runtime.sendMessage({ type: 'PREVIEW_RESULT', total: matches.length, empty, truncated });
}

function stopPreview() {
  log('PREVIEW stop');
  clearPreviewBoxes();
}

// ── Selection mode ────────────────────────────────────────────────────────────

// Set by ENABLE_DOM_VIEW / DISABLE_DOM_VIEW; gates the HOVER_ELEMENT
// forwarding so it only runs while the side panel's optional DOM tree view
// is actually visible.
let domViewEnabled = false;

// mouseover fires once per element-boundary crossing, which on a dense real
// page can be dozens of times a second — sending one runtime message per
// crossing flooded the extension's message channel badly enough to delay
// unrelated messages (including plain selection). Coalesce to at most one
// HOVER_ELEMENT send per ~16ms (one frame), always reflecting the latest target.
const HOVER_THROTTLE_MS = 16;
let hoverTimeoutId = null;
let pendingHoverTarget = null;

// Set while a Container-Mode selection is scoped to a container instance
// (see startSelection's scopeSelector) — null means the whole page is fair
// game, same as today's flat-mode selection.
let scopeRootEl = null;

// Set for the duration of a selection round that must produce a selector
// capable of matching more than once — see buildSelector's avoidId.
let avoidIdInSelector = false;

// Set for the duration of a Phase-4 "find in recording" selection round —
// see startSelection's apiSearch param. Orthogonal to scopeRootEl/
// avoidIdInSelector: API-mode search doesn't restrict which elements are
// clickable, it changes what a click produces (see onClick below).
let apiSearchActive = false;

function isInScope(element) {
  return !scopeRootEl || scopeRootEl.contains(element);
}

function flushHover() {
  hoverTimeoutId = null;
  if (!domViewEnabled || !pendingHoverTarget) return;
  try {
    chrome.runtime.sendMessage({ type: 'HOVER_ELEMENT', path: elementPath(pendingHoverTarget) });
  } catch (err) {
    log('HOVER_ELEMENT send failed', err.message);
  }
}

// A click/mouseover on an element inside a shadow root gets its `target`
// retargeted to the shadow *host* by the browser for any listener outside
// that shadow tree (standard event-retargeting, applies to open and closed
// roots alike, not something specific to this extension) — so e.target alone
// would build a selector for the host, not the actual element the user
// hovered/clicked. composedPath()[0] is the true, un-retargeted originating
// element, including inside shadow trees; found via manual testing against
// a real shadow-DOM element, not assumed (see PLAN-issues-41-42.md).
function eventTargetElement(e) {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  return path.length > 0 ? path[0] : e.target;
}

function onMouseOver(e) {
  if (e.target === overlay) return;
  const target = eventTargetElement(e);

  if (!isInScope(target)) {
    // Out of scope — hide the highlight instead of pointing at an element
    // that couldn't be selected anyway.
    if (overlay) overlay.style.opacity = '0';
    return;
  }
  if (overlay) overlay.style.opacity = '1';
  moveOverlayTo(target);

  if (!domViewEnabled) return;
  pendingHoverTarget = target;
  if (hoverTimeoutId === null) {
    hoverTimeoutId = setTimeout(flushHover, HOVER_THROTTLE_MS);
  }
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const target = eventTargetElement(e);

  if (!isInScope(target)) {
    // Stay in selection mode — the user just clicked outside the container
    // instance they're supposed to be picking a descendant of.
    log('CLICK outside scope, ignored');
    return;
  }

  const selector = buildSelector(target, scopeRootEl, avoidIdInSelector);
  const wasApiSearch = apiSearchActive; // read before stopSelection() clears it
  const clickedText = (target.textContent || '').trim();
  log('CLICK → selector', selector);
  stopSelection();

  // Path is a nice-to-have for the optional tree-view highlight — never let
  // a failure here block the actual field selection.
  let path;
  try {
    path = elementPath(target);
  } catch (err) {
    log('elementPath failed', err.message);
  }

  // null (not []) when this click happened in the top-level document — same
  // "null = today's default, unchanged behavior" convention the companion's
  // ExtractStep.FramePath uses.
  resolveFramePath().then((framePath) => {
    log('MSG_OUT ELEMENT_SELECTED', selector, framePath);
    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTED', selector, path,
      framePath: framePath && framePath.length > 0 ? framePath : null,
    });

    // API-mode search: additionally correlate the clicked element's text
    // against Phase 3's recorded responses (see capturedApiEntries below)
    // and report candidate JSON matches — on top of, not instead of, the CSS
    // selector above.
    if (wasApiSearch) {
      const candidates = findApiCandidates(capturedApiEntries, clickedText);
      log('MSG_OUT API_CANDIDATES', { target: clickedText, count: candidates.length });
      chrome.runtime.sendMessage({ type: 'API_CANDIDATES', target: clickedText, candidates });
    }
  });
}

// scopeSelector (optional): Container-Mode passes the immediate parent
// group's selector when adding a nested container/field, so only
// descendants of that group's first matching instance can be picked (the
// same "first instance is the template" assumption point-and-click already
// relies on for a repeating group). No match on the current page → the
// selection can't proceed, same SELECTION_UNAVAILABLE path as a missing
// content script.
function startSelection(scopeSelector, avoidId, apiSearch) {
  log('SELECTION start', { scopeSelector, avoidId, apiSearch });
  avoidIdInSelector = !!avoidId;
  apiSearchActive = !!apiSearch;
  if (scopeSelector) {
    scopeRootEl = document.querySelector(scopeSelector);
    if (!scopeRootEl) {
      log('SELECTION scope not found', scopeSelector);
      chrome.runtime.sendMessage({
        type: 'SELECTION_UNAVAILABLE',
        reason: `Container-Selektor '${scopeSelector}' findet kein Element auf dieser Seite.`,
      });
      return;
    }
  } else {
    scopeRootEl = null;
  }
  createOverlay();
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('click', onClick, true);
}

function stopSelection() {
  log('SELECTION stop');
  document.removeEventListener('mouseover', onMouseOver);
  document.removeEventListener('click', onClick, true);
  removeOverlay();
  scopeRootEl = null;
  avoidIdInSelector = false;
  apiSearchActive = false;
  if (hoverTimeoutId !== null) {
    clearTimeout(hoverTimeoutId);
    hoverTimeoutId = null;
  }
  pendingHoverTarget = null;
}

function enableDomView() {
  domViewEnabled = true;
  log('DOM_VIEW enable → sending tree');
  try {
    chrome.runtime.sendMessage({ type: 'DOM_TREE', ...serializeDomTree() });
  } catch (err) {
    log('DOM_TREE send failed', err.message);
    chrome.runtime.sendMessage({ type: 'DOM_TREE', tree: null, truncated: false, error: err.message });
  }
}

function disableDomView() {
  log('DOM_VIEW disable');
  domViewEnabled = false;
  if (hoverTimeoutId !== null) {
    clearTimeout(hoverTimeoutId);
    hoverTimeoutId = null;
  }
}

// ── API-Mode capture bridge ──────────────────────────────────────────────────
// api-capture.js runs in the MAIN world (real fetch/XHR access, no
// chrome.runtime) — this isolated-world script is the relay between it and
// the rest of the extension: START/STOP commands go out via postMessage,
// captured entries come back the same way and get forwarded to the side
// panel via chrome.runtime.sendMessage, same as HOVER_ELEMENT/DOM_TREE/
// PREVIEW_RESULT above.
//
// Also keeps its own capped copy of every entry that passes through
// (capturedApiEntries) — Phase 4's onClick/findApiCandidates search this
// copy directly rather than reaching back into the MAIN world for it, since
// the click-driven correlation step runs here in the isolated world anyway.
// Cleared on API_CAPTURE_START (see the message listener below), mirroring
// api-capture.js's own buffer reset — deliberately *not* cleared on STOP,
// since Phase 4's search runs after recording has stopped.
const MAX_LOCAL_API_ENTRIES = 200; // mirrors api-capture.js's MAX_CAPTURED_ENTRIES; independent cap, same value
let capturedApiEntries = [];

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'sf-api-capture' || data.type !== 'API_CAPTURE_ENTRY') return;
    log('API_CAPTURE_ENTRY received', { url: data.entry?.url });
    if (capturedApiEntries.length < MAX_LOCAL_API_ENTRIES) capturedApiEntries.push(data.entry);
    chrome.runtime.sendMessage({ type: 'API_CAPTURE_ENTRY', entry: data.entry });
  });
}

// ── Message listener ──────────────────────────────────────────────────────────

// With all_frames:true, every one of these messages arrives once per frame
// on the page (chrome.tabs.sendMessage without a frameId broadcasts to all
// of them). START_SELECTION/STOP_SELECTION genuinely need to run in every
// frame — the frame the user actually hovers/clicks in is whichever one
// reacts, and that can't be predicted in advance. Everything else here
// operates on "the whole page" as a single concept (one DOM tree view, one
// preview run, one log export, one robots.txt check) and must only ever run
// once — without this guard, every frame would independently respond,
// causing duplicate/garbled results (e.g. multiple frames racing to
// sendResponse() for the same GET_LOGS request, only one of which wins
// unpredictably).
function isTopFrame() {
  return window === window.top;
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('MSG_IN', message.type);
    if (message.type === 'START_SELECTION') startSelection(message.scopeSelector, message.avoidId, message.apiSearch);
    if (message.type === 'STOP_SELECTION')  stopSelection();
    if (message.type === 'ENABLE_DOM_VIEW' && isTopFrame()) enableDomView();
    if (message.type === 'DISABLE_DOM_VIEW' && isTopFrame()) disableDomView();
    if (message.type === 'PREVIEW_START' && isTopFrame()) startPreview(message.mode, message.fields, message.groups);
    if (message.type === 'PREVIEW_STOP' && isTopFrame()) stopPreview();
    if (message.type === 'API_CAPTURE_START' || message.type === 'API_CAPTURE_STOP') {
      log('API_CAPTURE forward to MAIN world', message.type);
      if (message.type === 'API_CAPTURE_START') capturedApiEntries = [];
      window.postMessage({ source: 'sf-api-capture-control', type: message.type }, '*');
    }
    if (message.type === 'GET_LOGS') {
      if (!isTopFrame()) return;
      sendResponse(getLogBuffer());
    }
    if (message.type === 'CHECK_ROBOTS_TXT') {
      if (!isTopFrame()) return;
      checkRobotsTxt().then(sendResponse);
      return true; // keep the message channel open for the async sendResponse above
    }
  });
}
