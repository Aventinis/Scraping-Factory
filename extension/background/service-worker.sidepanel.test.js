// Separate file because the panel-behavior call happens once at module load
// time (top-level side effect), so it needs its own fresh `require`.

test('sets the side panel to open on action-icon click', () => {
  const setPanelBehavior = jest.fn().mockResolvedValue(undefined);

  global.chrome = {
    runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
    tabs: { query: jest.fn(), sendMessage: jest.fn() },
    storage: { session: { set: jest.fn(), remove: jest.fn() } },
    sidePanel: { setPanelBehavior },
  };

  require('./service-worker');

  expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
});

test('does not throw when chrome.sidePanel is unavailable (older Chrome)', () => {
  jest.resetModules();

  global.chrome = {
    runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
    tabs: { query: jest.fn(), sendMessage: jest.fn() },
    storage: { session: { set: jest.fn(), remove: jest.fn() } },
  };

  expect(() => require('./service-worker')).not.toThrow();
});
