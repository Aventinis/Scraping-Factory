const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');

test('manifest.json is valid JSON', () => {
  expect(() => JSON.parse(raw)).not.toThrow();
});

describe('cross-browser keys', () => {
  const manifest = JSON.parse(raw);

  test('declares both Chrome/Edge and Firefox side panel entry points', () => {
    expect(manifest.side_panel.default_path).toBe('popup/popup.html');
    expect(manifest.sidebar_action.default_panel).toBe('popup/popup.html');
  });

  test('declares both Chrome/Edge and Firefox background entry points', () => {
    expect(manifest.background.service_worker).toBe('background/service-worker.js');
    expect(manifest.background.scripts).toEqual(['background/service-worker.js']);
  });

  test('declares a fixed Firefox extension id', () => {
    expect(manifest.browser_specific_settings.gecko.id).toBe('scraping-factory@aventinis.github.io');
  });
});
