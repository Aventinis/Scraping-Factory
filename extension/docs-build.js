// Issue #354 Part B: turns docs/user/*.md into HTML pages that ship inside the
// extension (dist/docs/), so "Learn more" in the side panel works offline —
// the extension stays free of external services.
//
//   buildDocs({ docsDir, outdir })   writes <outdir>/docs/*.html, docs.css and images/
//   slugify(heading)                 GitHub's heading-to-anchor rule (the one the
//                                    markdown links and popup/docs-links.js use)
//
// Plain files only: the pages carry no script (an MV3 extension page may not
// run inline script), just a linked stylesheet. A link in a page that points
// at a missing page, anchor or image fails the build instead of shipping a dead
// "Learn more". A link that leaves docs/user/ (the developer docs the README
// mentions) is rendered as plain text — those files are not part of the bundle.
const fs = require('fs');
const path = require('path');

// Reading order of the navigation; pages missing here are appended
// alphabetically, so a new page is never lost, just unordered.
const PAGE_ORDER = [
  'README', 'getting-started', 'modes', 'browser-engine', 'pagination', 'transforms',
  'monitoring', 'saved-configurations', 'output', 'network-settings', 'authentication', 'troubleshooting',
];

// GitHub's heading-to-anchor rule: lower-case, drop punctuation except
// hyphens, spaces become hyphens.
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** The pages of `docsDir` in navigation order: [{ name, file }]. */
function listDocPages(docsDir) {
  const names = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  const rank = (n) => (PAGE_ORDER.includes(n) ? PAGE_ORDER.indexOf(n) : PAGE_ORDER.length);
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return names.map((name) => ({ name, file: path.join(docsDir, `${name}.md`) }));
}

/** Every heading anchor of a markdown source, with GitHub's "-1" suffix for repeats. */
function anchorsOf(markdown) {
  const seen = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function titleOf(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/[`*_]/g, '') : fallback;
}

function pageHtml({ title, body, pages, current }) {
  const nav = pages.map((p) =>
    `<li><a href="${p.name}.html"${p.name === current ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Scraping Factory</title>
<link rel="stylesheet" href="docs.css">
</head>
<body>
<nav class="docs-nav" aria-label="Documentation">
<p class="docs-nav-title">Scraping Factory</p>
<ul>
${nav}
</ul>
</nav>
<main class="docs-main">
${body}
</main>
</body>
</html>
`;
}

// marked ships as an ES module only, hence the dynamic import (works on every Node
// the build supports, and from this CommonJS file).
async function buildDocs({ docsDir: docsDirArg, outdir }) {
  const { Marked } = await import('marked');
  const docsDir = path.resolve(docsDirArg);
  const pages = listDocPages(docsDir).map((p) => {
    const markdown = fs.readFileSync(p.file, 'utf8');
    return { ...p, markdown, title: titleOf(markdown, p.name), anchors: anchorsOf(markdown) };
  });
  const byName = new Map(pages.map((p) => [p.name, p]));
  const imagesDir = path.join(docsDir, 'images');
  const problems = [];

  for (const page of pages) {
    const seen = new Map();
    const marked = new Marked();
    marked.use({
      renderer: {
        heading({ tokens, depth, text }) {
          const base = slugify(text);
          const n = seen.get(base) || 0;
          seen.set(base, n + 1);
          const id = n === 0 ? base : `${base}-${n}`;
          return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
        link({ href, title, tokens }) {
          const inner = this.parser.parseInline(tokens);
          if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            // http(s) — only the "try it yourself" localhost addresses and the like.
            return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''} rel="noopener">${inner}</a>`;
          }
          const [rel, anchor] = href.split('#');
          if (!rel) {
            if (anchor && !page.anchors.has(anchor)) problems.push(`${page.name}.md: "#${anchor}" — no heading with that anchor`);
            return `<a href="#${escapeHtml(anchor || '')}">${inner}</a>`;
          }
          const resolved = path.resolve(docsDir, rel);
          if (path.dirname(resolved) !== docsDir || !resolved.endsWith('.md')) {
            // Outside docs/user/ (CLAUDE.md, ARCHITECTURE.md): not shipped, show the text only.
            return inner;
          }
          const target = byName.get(path.basename(resolved, '.md'));
          if (!target) { problems.push(`${page.name}.md: "${href}" does not exist`); return inner; }
          if (anchor && !target.anchors.has(anchor)) problems.push(`${page.name}.md: "${href}" — no heading with that anchor`);
          return `<a href="${target.name}.html${anchor ? `#${escapeHtml(anchor)}` : ''}">${inner}</a>`;
        },
        image({ href, title, text }) {
          const resolved = path.resolve(docsDir, href);
          if (!resolved.startsWith(imagesDir + path.sep) || !fs.existsSync(resolved)) {
            problems.push(`${page.name}.md: image "${href}" does not exist under images/`);
          }
          return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
        },
      },
    });
    page.body = marked.parse(page.markdown, { async: false });
  }
  if (problems.length) throw new Error(`docs/user/ has broken links:\n${problems.join('\n')}`);

  const out = path.join(outdir, 'docs');
  fs.mkdirSync(out, { recursive: true });
  for (const page of pages) {
    fs.writeFileSync(path.join(out, `${page.name}.html`), pageHtml({ title: page.title, body: page.body, pages, current: page.name }));
  }
  fs.copyFileSync(path.join(__dirname, 'docs-template/docs.css'), path.join(out, 'docs.css'));
  if (fs.existsSync(imagesDir)) fs.cpSync(imagesDir, path.join(out, 'images'), { recursive: true });
  return pages.map((p) => ({ name: p.name, title: p.title }));
}

module.exports = { buildDocs, slugify, anchorsOf, listDocPages, PAGE_ORDER };

// node docs-build.js <docsDir> <outdir>  — what the tests (Jest cannot load an ES
// module from node_modules) and ad-hoc runs use.
if (require.main === module) {
  buildDocs({ docsDir: process.argv[2], outdir: process.argv[3] })
    .then((pages) => console.log(pages.map((p) => p.name).join(',')))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
