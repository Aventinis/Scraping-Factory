// Jest transform for the extension's TypeScript sources: compiles .ts with the esbuild the bundle already uses (Issue #394).
// JavaScript keeps babel-jest, which hoists jest.mock calls.
const esbuild = require('esbuild');

module.exports = {
  /**
   * @param {string} source
   * @param {string} filename
   */
  process(source, filename) {
    const { code, map } = esbuild.transformSync(source, {
      loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: filename, sourcemap: 'external',
    });
    return { code, map };
  },
};
