// Regression test for a real bug: extension/i18n/i18n.js used to declare
// SUPPORTED_LANGUAGES/t/initI18n/etc. as bare top-level names. popup.html
// loads shared/logger.js, i18n/i18n.js and popup.js as separate *classic*
// <script> tags, which all share one global scope in a real browser —
// unlike Jest's require(), which gives every module its own scope and so
// can never catch this class of bug. popup.js's own
// `const { t, initI18n, ... } = ...` collided with i18n.js's top-level
// declarations of the same names, throwing "Identifier 't' has already
// been declared" and silently breaking the entire popup (it never got past
// that script tag, so nothing in popup.js ever ran).
//
// This uses Node's vm module to execute the actual file contents in one
// shared context, in the same order the manifest/HTML load them in — the
// same "early error" a browser would hit shows up here too, since
// redeclaring a `let`/`const`/`class` name already bound in scope is a
// SyntaxError independent of `require`/CommonJS semantics.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function runClassicScripts(relativePaths) {
  const context = {};
  context.self = context;
  context.window = context;
  context.navigator = { language: 'en-US' };
  context.console = console;
  // Both popup.js and content-script.js install top-level error listeners
  // (`typeof window !== 'undefined'` is true here since window === context).
  context.addEventListener = () => {};
  vm.createContext(context);

  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    // Deliberately no `require`/`module` on the context — a classic
    // <script> tag has neither, which is exactly the branch
    // (`typeof require !== 'undefined' ? require(...) : self.X`) this test
    // needs to exercise the same way a real browser would.
    vm.runInContext(source, context, { filename: relativePath });
  }
  return context;
}

test('shared/logger.js + i18n/i18n.js + popup/popup.js load together without a redeclaration error (popup.html\'s <script> order)', () => {
  // popup.js's own top-level code additionally expects `document`
  // (guarded by `typeof document !== 'undefined'`) and reads
  // `navigator.language` — neither is set here, so popup.js's immediate
  // `init()` call is skipped, same as any classic script tag executed
  // outside of a document would behave. Only the *declarations* matter for
  // this test, not full runtime behavior (that's what popup.test.js covers).
  expect(() => runClassicScripts([
    'shared/logger.js',
    'shared/companion-config.js',
    'shared/theme.js',
    'i18n/i18n.js',
    'popup/api-config.js',
    'popup/container-tree.js',
    'popup/field-transforms.js',
    'popup/api-config-ui.js',
    'popup/container-tree-ui.js',
    'popup/field-transforms-ui.js',
    'popup/popup.js',
  ])).not.toThrow();
});

test('shared/logger.js + content/content-script.js load together without a redeclaration error (manifest.json\'s content_scripts order)', () => {
  expect(() => runClassicScripts([
    'shared/logger.js',
    'content/content-script.js',
  ])).not.toThrow();
});
