// The environment every test that drives popup.ts needs, set up once per test file by requiring this module before ./popup.
//
// The popup's language detection falls back to German (none of the mocks below set up chrome.storage.local, the i18n module's
// stored-preference source), so the assertions written against the original German copy keep working now that the same text comes
// from i18n/de.json. Language switching itself is covered by output-and-language.test.js.
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

// chrome and fetch are mocked before popup.ts is required so that its async init() (wireEvents + storage read + checkCompanion)
// runs without real APIs.
global.chrome = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
  },
  tabs: { query: jest.fn() },
  storage: {
    session: {
      get:    jest.fn().mockResolvedValue({}),
      set:    jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
};
global.fetch = jest.fn().mockResolvedValue({ ok: false });

// jsdom's Blob doesn't implement .text() — read via FileReader instead.
function readBlobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

module.exports = { readBlobText };
