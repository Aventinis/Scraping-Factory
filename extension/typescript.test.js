/** @jest-environment node */
// The JavaScript -> TypeScript migration (Issue #394) is finished: every extension source is TypeScript under `strict`. What stays
// JavaScript is decided here: the Node-side scripts (they run without a build step) and the *.test.js files.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;

function tsSources(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'dist.building'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsSources(full);
    return /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [full] : [];
  });
}

// Plain Node runs these without a build step, so they cannot be .ts; the project type-checks them from JSDoc instead.
const NODE_SCRIPTS = ['build.js', 'docs-build.js', 'jest-transform.js'];

function jsSources(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    // test-support/ holds the shared setup of the (JavaScript) tests.
    if (['node_modules', 'dist', 'dist.building', 'test-support'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsSources(full);
    return /\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [path.relative(ROOT, full)] : [];
  });
}

describe('TypeScript setup', () => {
  test('tsconfig checks .ts files under strict', () => {
    const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"strict":\s*true/);
    expect(tsconfig).toMatch(/"include":[^\]]*"\*\*\/\*\.ts"/);
  });

  test('the only JavaScript sources left are the Node-side scripts, and tsconfig type-checks exactly those', () => {
    expect(jsSources().sort()).toEqual(NODE_SCRIPTS);
    const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"checkJs":\s*true/);
    const include = tsconfig.match(/"include":\s*\[([^\]]*)\]/)[1];
    for (const script of NODE_SCRIPTS) expect(include).toContain(`"${script}"`);
    expect(include).not.toMatch(/\*\.js/);
  });

  test('a converted module loads through Jest from a CommonJS consumer', () => {
    const { validateEnvVarName } = require('./popup/env-var');
    expect(validateEnvVarName('API_KEY')).toEqual({ ok: true });
    expect(validateEnvVarName('1KEY')).toEqual({ ok: false, reason: 'startsWithDigit' });
  });

  test('the popup bundle contains converted modules, and still-JavaScript code can require them', async () => {
    const result = await esbuild.build({
      entryPoints: [path.join(ROOT, 'popup/popup.ts')], bundle: true, format: 'iife', platform: 'browser', write: false,
      define: { 'process.env.NODE_ENV': '"production"', 'process.env.SF_CHANNEL': '"development"' }, logLevel: 'silent',
    });
    const code = result.outputFiles[0].text;
    expect(code).toContain('findInvalidEnvVarNames');
    expect(code).toContain('applyRecommendedHardening');
  });

  test('the wire and draft types are modules, not ambient namespaces', () => {
    for (const file of ['types/wire.ts', 'types/drafts.ts']) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect([file, /declare\s+namespace/.test(text)]).toEqual([file, false]);
      expect([file, /^export (interface|type) /m.test(text)]).toEqual([file, true]);
    }
    expect(fs.readdirSync(path.join(ROOT, 'types')).filter((f) => f.endsWith('.d.ts'))).toEqual([]);
  });

  test('a converted file is TypeScript through and through: no leftover CommonJS exports or @ts-check pragma', () => {
    const files = tsSources();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const name = path.relative(ROOT, file);
      expect([name, /module\.exports/.test(text)]).toEqual([name, false]);
      expect([name, /\brequire\(/.test(text)]).toEqual([name, false]);
      expect([name, /@ts-check/.test(text)]).toEqual([name, false]);
    }
  });
});
