const { applyStoredSessionState, restorePendingSelection } = require('./session-restore');
const { STATES } = require('./api-config');

describe('applyStoredSessionState', () => {
  const baseState = { current: STATES.CHECKING_COMPANION, fields: [], groups: [], mode: 'flat', changeDetection: { enabled: false }, hardening: { noResult: { enabled: false }, nullRate: [], baseline: { enabled: false }, blocking: { enabled: false }, requiredFields: { enabled: false } } };

  test('leaves state untouched when nothing was stored', () => {
    expect(applyStoredSessionState(baseState, {})).toEqual(baseState);
  });

  test('restores fields/groups/url/mode when present', () => {
    const stored = { fields: [{ name: 'Titel', selector: 'h1' }], groups: [{ kind: 'group' }], url: 'https://example.com', mode: 'container' };
    const result = applyStoredSessionState(baseState, stored);
    expect(result.fields).toEqual(stored.fields);
    expect(result.groups).toEqual(stored.groups);
    expect(result.url).toBe('https://example.com');
    expect(result.mode).toBe('container');
  });

  test('does not overwrite fields/groups with a non-array stored value', () => {
    const result = applyStoredSessionState(baseState, { fields: 'not-an-array' });
    expect(result.fields).toEqual([]);
  });

  test('restores boolean flags even when false, via the !== undefined check', () => {
    const result = applyStoredSessionState(baseState, { persistentSession: false, externalConfig: false });
    expect(result.persistentSession).toBe(false);
    expect(result.externalConfig).toBe(false);
  });

  test('restores pendingParentPath even when null (root level), via the !== undefined check', () => {
    const result = applyStoredSessionState({ ...baseState, pendingParentPath: 'unset' }, { pendingParentPath: null });
    expect(result.pendingParentPath).toBeNull();
  });

  // Issue #183
  test('auto-expands monitoringSectionOpen once when change detection is already configured', () => {
    const stored = { changeDetection: { enabled: true, notify: 'Email', email: { smtpHostEnvVar: 'H', fromEnvVar: 'F', toEnvVar: 'T' } } };
    const result = applyStoredSessionState(baseState, stored);
    expect(result.monitoringSectionOpen).toBe(true);
  });

  test('leaves monitoringSectionOpen alone when nothing is configured', () => {
    const result = applyStoredSessionState(baseState, {});
    expect(result.monitoringSectionOpen).toBeUndefined();
  });
});

describe('restorePendingSelection', () => {
  let state;
  let bridge;

  beforeEach(() => {
    state = { current: STATES.IDLE, groups: [], browserActions: [], pagination: { enabled: false } };
    bridge = {
      getState: () => state,
      setState: jest.fn((current, patch = {}) => { state = { ...state, current, ...patch }; }),
    };
    global.chrome = {
      storage: {
        session: {
          remove: jest.fn().mockResolvedValue(undefined),
          set: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  test('returns false and does nothing when nothing is pending', async () => {
    const handled = await restorePendingSelection(bridge, {});
    expect(handled).toBe(false);
    expect(bridge.setState).not.toHaveBeenCalled();
  });

  test('discards a leftover API-search selector instead of misinterpreting it', async () => {
    const handled = await restorePendingSelection(bridge, { pendingSelector: '#x', apiSearchTarget: 'field' });
    expect(handled).toBe(true);
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('pendingSelector');
    expect(bridge.setState).toHaveBeenCalledWith(STATES.IDLE, {});
  });

  test('routes a pending container selector straight into an inserted group node', async () => {
    const stored = {
      pendingSelector: '.item', mode: 'container', selectionKind: 'container',
      pendingNewContainer: { name: 'Kategorie', repeating: true }, pendingMatchCount: 3,
    };
    const handled = await restorePendingSelection(bridge, stored);
    expect(handled).toBe(true);
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ groups: expect.any(Array) });
    const [, patch] = bridge.setState.mock.calls[0];
    expect(patch.groups).toHaveLength(1);
    expect(patch.groups[0]).toMatchObject({ name: 'Kategorie', selector: '.item' });
    expect(patch.selectionKind).toBeNull();
  });

  test('routes a pending browser-action selector straight into that action, no modal', async () => {
    state.browserActions = [{ kind: 'click', selector: '' }];
    const stored = {
      pendingSelector: '#submit', selectionKind: 'browserAction', pendingBrowserActionIndex: 0, pendingBrowserActionField: 'selector',
    };
    const handled = await restorePendingSelection(bridge, stored);
    expect(handled).toBe(true);
    const [, patch] = bridge.setState.mock.calls[0];
    expect(patch.browserActions[0].selector).toBe('#submit');
    expect(patch.pendingBrowserActionIndex).toBeNull();
  });

  test('routes a pending pagination selector straight into nextLinkSelector', async () => {
    const handled = await restorePendingSelection(bridge, { pendingSelector: '.next', selectionKind: 'pagination' });
    expect(handled).toBe(true);
    const [, patch] = bridge.setState.mock.calls[0];
    expect(patch.pagination.nextLinkSelector).toBe('.next');
  });

  test('falls back to showing the field-name modal for a plain flat/container field pick', async () => {
    const handled = await restorePendingSelection(bridge, { pendingSelector: '.price', pendingRawText: '12,99 €' });
    expect(handled).toBe(true);
    expect(bridge.setState).toHaveBeenCalledWith(STATES.SELECTING, expect.objectContaining({
      pendingSelector: '.price', pendingRawText: '12,99 €', pendingTransforms: [],
    }));
  });
});
