// Issue #388: loader for the shared test vectors. A vector file is JSON of the
// form { "description": "...", "cases": [ { "name": "...", ... } ] } and is read
// by BOTH Jest and xUnit (companion/ScrapingFactory.Tests/TestVectors.cs), so a
// behavior that is hand-mirrored across the extension and the companion/runtime
// is pinned by one table. See test-vectors/README.md.
const fs = require('fs');
const path = require('path');

/**
 * @param {string} file  e.g. 'file-name-sanitizer.json'
 * @returns {{description: string, cases: any[]}}
 */
function loadVectors(file) {
  const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) throw new Error(`${file}: "cases" must be a non-empty array`);
  const names = new Set();
  for (const testCase of parsed.cases) {
    if (!testCase.name || names.has(testCase.name)) throw new Error(`${file}: every case needs a unique "name" (${testCase.name})`);
    names.add(testCase.name);
  }
  return parsed;
}

module.exports = { loadVectors };
