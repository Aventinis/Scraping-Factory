// Issue #354: sanity check for docs/user/ — every relative link and image
// must point at a file that exists, every #anchor at a heading that exists,
// and every image in docs/user/images/ should be used by some page (an unused
// image usually means a page was changed without its scenario).
//
// Usage: node e2e/screenshots/check-docs.js     (exit code 1 on any problem)
const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.resolve(__dirname, '../../docs/user');
const IMAGES_DIR = path.join(DOCS_DIR, 'images');

// The one heading-to-anchor rule (GitHub's) shared with the extension's docs build.
const { slugify: slug } = require('../../extension/docs-build');

function headingsOf(file) {
  const anchors = new Set();
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (m) anchors.add(slug(m[1]));
  }
  return anchors;
}

const pages = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
const problems = [];
const usedImages = new Set();
const anchorCache = new Map();
const anchorsFor = (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, headingsOf(file));
  return anchorCache.get(file);
};

for (const page of pages) {
  const file = path.join(DOCS_DIR, page);
  let inFence = false;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) return;
    for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target)) continue; // http(s):, mailto:
      const [rel, anchor] = target.split('#');
      const where = `${page}:${i + 1}`;
      const resolved = rel ? path.resolve(DOCS_DIR, rel) : file;
      if (!fs.existsSync(resolved)) {
        problems.push(`${where}: "${target}" does not exist`);
        continue;
      }
      if (resolved.startsWith(IMAGES_DIR)) usedImages.add(path.basename(resolved));
      if (anchor && resolved.endsWith('.md') && !anchorsFor(resolved).has(anchor)) {
        problems.push(`${where}: "${target}" — no heading with that anchor`);
      }
    }
  });
}

if (fs.existsSync(IMAGES_DIR)) {
  for (const img of fs.readdirSync(IMAGES_DIR)) {
    if (!usedImages.has(img)) problems.push(`images/${img}: not referenced by any page`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in docs/user/.`);
  process.exit(1);
}
console.log(`OK — ${pages.length} pages, ${usedImages.size} images, all links resolve.`);
