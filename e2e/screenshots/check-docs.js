// Issue #354 / #436: sanity check for docs/user/ (English) and docs/user/de/ (German) —
// every relative link and image must point at a file that exists, every #anchor at a
// heading that exists, and every image in an images/ folder should be used by some page of
// that tree (an unused image usually means a page was changed without its scenario).
// It also reports how the German pages stand against the English ones:
//   structure   a different heading structure — breaks the anchor mapping, always an error
//   missing     an English page without a German page
//   unstamped   a German page without its `<!-- source: … -->` stamp
//   stale       the English source changed since the German page was stamped
// The last three are listed but do not fail the run, unless --strict is given.
//
// Usage: node e2e/screenshots/check-docs.js [--strict]   (exit code 1 on any problem)
const fs = require('fs');
const path = require('path');
const { slugify: slug, translationStatus } = require('../../extension/docs-build');

const DOCS_DIR = path.resolve(__dirname, '../../docs/user');
const strict = process.argv.includes('--strict');

function headingsOf(file) {
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const problems = [];
const notes = [];
const anchorCache = new Map();
const anchorsFor = (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, headingsOf(file));
  return anchorCache.get(file);
};

// One tree = one language: its own pages, its own images/.
function checkTree(dir, label) {
  if (!fs.existsSync(dir)) return { pages: 0, images: 0 };
  const imagesDir = path.join(dir, 'images');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const usedImages = new Set();

  for (const page of pages) {
    const file = path.join(dir, page);
    let inFence = false;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (line.startsWith('```')) inFence = !inFence;
      if (inFence) return;
      for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^[a-z]+:/i.test(target)) continue; // http(s):, mailto:
        const [rel, anchor] = target.split('#');
        const where = `${label}${page}:${i + 1}`;
        const resolved = rel ? path.resolve(dir, rel) : file;
        if (!fs.existsSync(resolved)) {
          problems.push(`${where}: "${target}" does not exist`);
          continue;
        }
        if (resolved.startsWith(imagesDir + path.sep)) usedImages.add(path.basename(resolved));
        if (anchor && resolved.endsWith('.md') && !anchorsFor(resolved).has(anchor)) {
          problems.push(`${where}: "${target}" — no heading with that anchor`);
        }
      }
    });
  }

  if (fs.existsSync(imagesDir)) {
    for (const img of fs.readdirSync(imagesDir)) {
      if (!usedImages.has(img)) problems.push(`${label}images/${img}: not referenced by any page`);
    }
  }
  return { pages: pages.length, images: usedImages.size };
}

const en = checkTree(DOCS_DIR, '');
const de = checkTree(path.join(DOCS_DIR, 'de'), 'de/');

const status = translationStatus(DOCS_DIR);
for (const name of status.structure) problems.push(`de/${name}.md: the heading structure differs from ${name}.md (the anchors cannot be mapped)`);
const soft = [
  ['missing', 'no German page for', status.missing],
  ['unstamped', 'no source stamp in', status.unstamped],
  ['stale', 'the English source changed since the German page was stamped:', status.stale],
];
for (const [, text, names] of soft) {
  if (names.length) notes.push(`${text} ${names.join(', ')}`);
}

if (notes.length) {
  (strict ? problems : []).push(...(strict ? notes.map((n) => `translation: ${n}`) : []));
  if (!strict) notes.forEach((n) => console.warn(`note — ${n}`));
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in docs/user/.`);
  process.exit(1);
}
console.log(`OK — English: ${en.pages} pages, ${en.images} images; German: ${de.pages} pages, ${de.images} images; all links resolve.`);
