/**
 * @jest-environment node
 */
// Issue #389: the esbuild build (build.js). Runs the real build into a temp
// directory (it takes well under a second) and checks what a browser would
// need: every file the manifest and popup.html point at exists, popup.html has
// a single script tag, no bundle contains a leftover `process.env` reference
// (the browser has no `process`), and the release channel really is a
// compile-time constant. (`node` environment: esbuild's JS API does not work
// under jsdom.)
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { defineFor, verifyChannel, ENTRY_POINTS, STATIC_FILES } = require('./build');

const BUILD_JS = path.join(__dirname, 'build.js');

function runBuild(outdir, ...extraArgs) {
  return execFileSync(process.execPath, [BUILD_JS, '--outdir', outdir, ...extraArgs], { encoding: 'utf8', stdio: 'pipe' });
}

function evaluateBuildConfig(channel) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'shared/build-config.js')],
    bundle: true, format: 'iife', globalName: 'buildConfig', platform: 'browser', write: false,
    define: defineFor(channel), logLevel: 'silent',
  });
  return new Function(`${result.outputFiles[0].text}; return buildConfig;`)();
}

describe('compile-time constants', () => {
  test('both process.env constants are always defined (the browser has no `process`)', () => {
    expect(defineFor('release')).toEqual({ 'process.env.NODE_ENV': '"production"', 'process.env.SF_CHANNEL': '"release"' });
    expect(defineFor('development')['process.env.SF_CHANNEL']).toBe('"development"');
  });

  test.each(['development', 'release'])('a %s build evaluates shared/build-config.js to that channel', (channel) => {
    const config = evaluateBuildConfig(channel);
    expect(config.CHANNEL).toBe(channel);
    expect(config.isDevelopmentBuild()).toBe(channel === 'development');
    expect(() => verifyChannel(channel)).not.toThrow();
  });

  test('an unset channel (Jest, or any unbundled use) means development', () => {
    jest.resetModules();
    const unbundled = require('./shared/build-config');
    expect(unbundled.CHANNEL).toBe('development');
    expect(unbundled.isDevelopmentBuild()).toBe(true);
  });
});

describe('npm run build output', () => {
  let outdir;

  beforeAll(() => {
    outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-build-test-'));
    runBuild(outdir);
  });
  afterAll(() => fs.rmSync(outdir, { recursive: true, force: true }));

  const exists = (rel) => fs.existsSync(path.join(outdir, rel));

  test('contains the four bundles (with source maps) and every static file', () => {
    for (const entry of ENTRY_POINTS) {
      expect(exists(entry)).toBe(true);
      expect(exists(`${entry}.map`)).toBe(true);
    }
    for (const file of STATIC_FILES) expect(exists(file)).toBe(true);
  });

  test('every path the manifest points at exists in the build', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(outdir, 'manifest.json'), 'utf8'));
    const paths = [
      manifest.background.service_worker,
      manifest.side_panel.default_path,
      manifest.sidebar_action.default_panel,
      ...manifest.content_scripts.flatMap((cs) => cs.js),
    ];
    for (const p of paths) expect({ p, found: exists(p) }).toEqual({ p, found: true });
  });

  test('popup.html has exactly one script tag, and it is the bundle', () => {
    const html = fs.readFileSync(path.join(outdir, 'popup/popup.html'), 'utf8');
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toContain('<script src="popup.js"></script>');
  });

  test('no bundle depends on `process` at runtime (the Jest-only branches were folded away)', () => {
    for (const entry of ENTRY_POINTS) {
      const code = fs.readFileSync(path.join(outdir, entry), 'utf8');
      expect({ entry, usesProcess: /\bprocess\b/.test(code) }).toEqual({ entry, usesProcess: false });
    }
  });

  test('the i18n dictionaries are bundled into the popup instead of fetched', () => {
    const code = fs.readFileSync(path.join(outdir, 'popup/popup.js'), 'utf8');
    expect(code).toContain('Companion app unreachable');   // en.json
    expect(code).not.toMatch(/i18n\/\$\{lang\}\.json/);
    expect(exists('i18n/en.json')).toBe(false);
  });

  test('the content script bundle carries the logger itself (the manifest lists one file)', () => {
    const code = fs.readFileSync(path.join(outdir, 'content/content-script.js'), 'utf8');
    expect(code).toContain('MAX_LOG_ENTRIES');
  });

  test('the MAIN-world recorder installs its fetch/XHR patches (not skipped as under Jest)', () => {
    const code = fs.readFileSync(path.join(outdir, 'content/api-capture.js'), 'utf8');
    expect(code).toMatch(/window\.fetch = function/);
    expect(code).not.toMatch(/"test"/);
  });
});

describe('build.js arguments', () => {
  test('a release build succeeds, an unknown channel or argument fails', () => {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-build-test-'));
    try {
      expect(runBuild(outdir, '--channel', 'release')).toContain('release extension');
      expect(() => runBuild(outdir, '--channel', 'beta')).toThrow();
      expect(() => runBuild(outdir, '--nope')).toThrow();
    } finally {
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  });
});

// A failed build must never leave a half-written extension behind. It used to:
// without `npm install` the documentation step threw after dist/ had been wiped,
// the side panel found popup.html but no popup.js and kept loading forever.
describe('a failing build', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sf-build-fail-'));

  function failingBuild(outdir, docsDir) {
    try {
      runBuild(outdir, '--docs-dir', docsDir);
    } catch (err) {
      return err;
    }
    throw new Error('the build should have failed');
  }

  test('keeps the previous build untouched and leaves no staging folder', () => {
    const root = tmp();
    const outdir = path.join(root, 'dist');
    fs.mkdirSync(outdir);
    fs.writeFileSync(path.join(outdir, 'previous-build.txt'), 'still here');
    const brokenDocs = path.join(root, 'docs');
    fs.mkdirSync(brokenDocs);
    fs.writeFileSync(path.join(brokenDocs, 'README.md'), '# Home\n\n[gone](nope.md)\n');

    const err = failingBuild(outdir, brokenDocs);
    expect(String(err.stderr)).toContain('nope.md');
    expect(String(err.stderr)).toContain('previous build');
    expect(fs.readFileSync(path.join(outdir, 'previous-build.txt'), 'utf8')).toBe('still here');
    expect(fs.existsSync(path.join(outdir, 'popup/popup.js'))).toBe(false); // not half-replaced
    expect(fs.existsSync(`${outdir}.building`)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a failing first build writes nothing at all', () => {
    const root = tmp();
    const outdir = path.join(root, 'dist');
    const brokenDocs = path.join(root, 'docs');
    fs.mkdirSync(brokenDocs);
    fs.writeFileSync(path.join(brokenDocs, 'README.md'), '# Home\n\n![x](images/missing.png)\n');
    failingBuild(outdir, brokenDocs);
    expect(fs.existsSync(outdir)).toBe(false);
    expect(fs.existsSync(`${outdir}.building`)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a successful build leaves neither a staging nor a "previous" folder', () => {
    const root = tmp();
    const outdir = path.join(root, 'dist');
    runBuild(outdir);
    runBuild(outdir); // the second one replaces the first
    expect(fs.existsSync(path.join(outdir, 'popup/popup.js'))).toBe(true);
    expect(fs.existsSync(path.join(outdir, 'docs/README.html'))).toBe(true);
    expect(fs.existsSync(`${outdir}.building`)).toBe(false);
    expect(fs.existsSync(`${outdir}.previous`)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
