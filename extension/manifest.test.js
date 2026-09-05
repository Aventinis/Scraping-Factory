const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');

test('manifest.json is valid JSON', () => {
  expect(() => JSON.parse(raw)).not.toThrow();
});

test('declares both Chrome/Edge and Opera sidebar entry points', () => {
  const manifest = JSON.parse(raw);

  expect(manifest.side_panel.default_path).toBe('popup/popup.html');
  expect(manifest.sidebar_action.default_panel).toBe('popup/popup.html');
});
