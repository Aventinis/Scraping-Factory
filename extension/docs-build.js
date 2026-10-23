// Issue #354 Part B: turns docs/user/*.md into HTML pages that ship inside the
// extension (dist/docs/), so "Learn more" in the side panel works offline —
// the extension stays free of external services.
//
//   buildDocs({ docsDir, outdir })   writes <outdir>/docs/*.html, docs.css and images/
//   slugify(heading)                 GitHub's heading-to-anchor rule (the one the
//                                    markdown links and popup/docs-links.js use)
//
// Languages: English (docs/user/*.md) is the source; docs/user/de/*.md is the German
// translation with the same file names and the same heading structure. Both are built
// (docs/<page>.html and docs/de/<page>.html) and each page links to its other-language
// twin. docs/anchors.json maps every English heading anchor to the German one by heading
// POSITION, which is how the panel's "Learn more" finds the right German heading while
// its key table (popup/docs-links.js) stays English.
//
// Plain files only: the pages carry no script (an MV3 extension page may not
// run inline script), just a linked stylesheet. A link in a page that points
// at a missing page, anchor or image fails the build instead of shipping a dead
// "Learn more". A link that leaves docs/user/ (the developer docs the README
// mentions) is rendered as plain text — those files are not part of the bundle.
const crypto = require('crypto');
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

/** Every heading anchor of a markdown source, in order, with GitHub's "-1" suffix for repeats. */
function anchorListOf(markdown) {
  const seen = new Map();
  const anchors = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    anchors.push(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/** Every heading anchor of a markdown source (a Set; see anchorListOf for the order). */
function anchorsOf(markdown) {
  return new Set(anchorListOf(markdown));
}

/** The heading levels in order, e.g. [1, 2, 2, 3]: what an English page and its translation must share. */
function headingStructureOf(markdown) {
  const levels = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+/);
    if (m) levels.push(m[1].length);
  }
  return levels;
}

const SOURCE_MARKER = /^<!--\s*source:\s*([0-9a-f]{12})\s*-->\s*\n?/;

/** A short hash of an English page, stamped into its German translation to see when it went stale. */
function sourceHash(englishMarkdown) {
  return crypto.createHash('sha256').update(englishMarkdown.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

/** The hash stamped at the top of a German page, or null. */
function stampedHash(germanMarkdown) {
  const m = germanMarkdown.match(SOURCE_MARKER);
  return m ? m[1] : null;
}

/** Writes (or replaces) the source marker of a German page for its current English source. */
function stampTranslation(docsDir, name) {
  const en = fs.readFileSync(path.join(docsDir, `${name}.md`), 'utf8');
  const dePath = path.join(docsDir, 'de', `${name}.md`);
  const de = fs.readFileSync(dePath, 'utf8').replace(SOURCE_MARKER, '');
  fs.writeFileSync(dePath, `<!-- source: ${sourceHash(en)} -->\n${de}`);
}

/**
 * Problems between the English pages and their German translations: a page with no
 * translation (`missing`), a translation whose source changed since it was stamped
 * (`stale`) or that carries no stamp (`unstamped`), and one whose heading structure
 * differs (`structure`, which breaks the anchor mapping).
 * @returns {{ missing: string[], stale: string[], unstamped: string[], structure: string[] }}
 */
function translationStatus(docsDir) {
  const result = { missing: [], stale: [], unstamped: [], structure: [] };
  for (const { name, file } of listDocPages(docsDir)) {
    const dePath = path.join(docsDir, 'de', `${name}.md`);
    if (!fs.existsSync(dePath)) { result.missing.push(name); continue; }
    const en = fs.readFileSync(file, 'utf8');
    const de = fs.readFileSync(dePath, 'utf8');
    const stamp = stampedHash(de);
    if (!stamp) result.unstamped.push(name);
    else if (stamp !== sourceHash(en)) result.stale.push(name);
    if (JSON.stringify(headingStructureOf(en)) !== JSON.stringify(headingStructureOf(de))) result.structure.push(name);
  }
  return result;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function titleOf(markdown, fallback) {
  const m = markdown.replace(SOURCE_MARKER, '').match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/[`*_]/g, '') : fallback;
}

const UI = {
  en: { lang: 'en', nav: 'Documentation', switchLabel: 'Deutsch', switchTitle: 'Diese Seite auf Deutsch' },
  de: { lang: 'de', nav: 'Dokumentation', switchLabel: 'English', switchTitle: 'This page in English' },
};

function pageHtml({ title, body, pages, current, lang, otherLanguageHref }) {
  const ui = UI[lang];
  const nav = pages.map((p) =>
    `<li><a href="${p.name}.html"${p.name === current ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a></li>`).join('\n');
  const switcher = otherLanguageHref
    ? `<p class="docs-lang"><a href="${otherLanguageHref}" hreflang="${lang === 'en' ? 'de' : 'en'}" title="${ui.switchTitle}">${ui.switchLabel}</a></p>\n`
    : '';
  const css = lang === 'en' ? 'docs.css' : '../docs.css';
  return `<!doctype html>
<html lang="${ui.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Scraping Factory</title>
<link rel="stylesheet" href="${css}">
</head>
<body>
<nav class="docs-nav" aria-label="${ui.nav}">
<p class="docs-nav-title">Scraping Factory</p>
${switcher}<ul>
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

// Parses every page of one language tree and returns it with the problems found
// (a link to a missing page/anchor/image). `langDir` holds the .md files, its `images/` the pictures.
function parseTree(Marked, langDir, problems, label) {
  const pages = listDocPages(langDir).map((p) => {
    const markdown = fs.readFileSync(p.file, 'utf8');
    return { ...p, markdown, title: titleOf(markdown, p.name), anchors: anchorsOf(markdown) };
  });
  const byName = new Map(pages.map((p) => [p.name, p]));
  const imagesDir = path.join(langDir, 'images');

  for (const page of pages) {
    const seen = new Map();
    const where = `${label}${page.name}.md`;
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
            if (anchor && !page.anchors.has(anchor)) problems.push(`${where}: "#${anchor}" — no heading with that anchor`);
            return `<a href="#${escapeHtml(anchor || '')}">${inner}</a>`;
          }
          const resolved = path.resolve(langDir, rel);
          if (path.dirname(resolved) !== langDir || !resolved.endsWith('.md')) {
            // Outside the docs tree (CLAUDE.md, ARCHITECTURE.md): not shipped, show the text only.
            return inner;
          }
          const target = byName.get(path.basename(resolved, '.md'));
          if (!target) { problems.push(`${where}: "${href}" does not exist`); return inner; }
          if (anchor && !target.anchors.has(anchor)) problems.push(`${where}: "${href}" — no heading with that anchor`);
          return `<a href="${target.name}.html${anchor ? `#${escapeHtml(anchor)}` : ''}">${inner}</a>`;
        },
        image({ href, title, text }) {
          const resolved = path.resolve(langDir, href);
          if (!resolved.startsWith(imagesDir + path.sep) || !fs.existsSync(resolved)) {
            problems.push(`${where}: image "${href}" does not exist under ${label}images/`);
          }
          return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
        },
      },
    });
    page.body = marked.parse(page.markdown, { async: false });
  }
  return { pages, imagesDir };
}

// marked ships as an ES module only, hence the dynamic import (works on every Node
// the build supports, and from this CommonJS file).
async function buildDocs({ docsDir: docsDirArg, outdir }) {
  let Marked;
  try {
    ({ Marked } = await import('marked'));
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('The documentation build needs the "marked" package, which is not installed. Run `npm install` in extension/ and build again.');
    }
    throw err;
  }
  const docsDir = path.resolve(docsDirArg);
  const deDir = path.join(docsDir, 'de');
  const problems = [];

  const en = parseTree(Marked, docsDir, problems, 'docs/user/');
  const de = fs.existsSync(deDir) ? parseTree(Marked, deDir, problems, 'docs/user/de/') : { pages: [], imagesDir: null };
  if (problems.length) throw new Error(`docs/user/ has broken links:\n${problems.join('\n')}`);

  const out = path.join(outdir, 'docs');
  fs.mkdirSync(out, { recursive: true });
  const dePageNames = new Set(de.pages.map((p) => p.name));
  for (const page of en.pages) {
    fs.writeFileSync(path.join(out, `${page.name}.html`), pageHtml({
      title: page.title, body: page.body, pages: en.pages, current: page.name, lang: 'en',
      otherLanguageHref: dePageNames.has(page.name) ? `de/${page.name}.html` : null,
    }));
  }
  if (de.pages.length) fs.mkdirSync(path.join(out, 'de'), { recursive: true });
  const enByName = new Map(en.pages.map((p) => [p.name, p]));
  for (const page of de.pages) {
    fs.writeFileSync(path.join(out, 'de', `${page.name}.html`), pageHtml({
      title: page.title, body: page.body, pages: de.pages, current: page.name, lang: 'de',
      otherLanguageHref: enByName.has(page.name) ? `../${page.name}.html` : null,
    }));
  }
  fs.copyFileSync(path.join(__dirname, 'docs-template/docs.css'), path.join(out, 'docs.css'));
  if (fs.existsSync(en.imagesDir)) fs.cpSync(en.imagesDir, path.join(out, 'images'), { recursive: true });
  if (de.imagesDir && fs.existsSync(de.imagesDir)) fs.cpSync(de.imagesDir, path.join(out, 'de', 'images'), { recursive: true });

  // English anchor → German anchor, by heading position, for every page whose structure matches.
  const anchors = { de: {} };
  for (const page of de.pages) {
    const source = enByName.get(page.name);
    if (!source) continue;
    const same = JSON.stringify(headingStructureOf(source.markdown)) === JSON.stringify(headingStructureOf(page.markdown));
    if (!same) {
      console.warn(`docs/user/de/${page.name}.md: the heading structure differs from the English page — its headings are not mapped, "Learn more" opens the page without an anchor.`);
      anchors.de[page.name] = {};
      continue;
    }
    const englishAnchors = anchorListOf(source.markdown);
    const germanAnchors = anchorListOf(page.markdown);
    anchors.de[page.name] = Object.fromEntries(englishAnchors.map((a, i) => [a, germanAnchors[i]]));
  }
  fs.writeFileSync(path.join(out, 'anchors.json'), JSON.stringify(anchors, null, 2));
  return en.pages.map((p) => ({ name: p.name, title: p.title, german: dePageNames.has(p.name) }));
}

module.exports = {
  buildDocs, slugify, anchorsOf, anchorListOf, headingStructureOf, listDocPages, PAGE_ORDER,
  sourceHash, stampedHash, stampTranslation, translationStatus,
};

// node docs-build.js <docsDir> <outdir>         what the tests (Jest cannot load an ES module
//                                               from node_modules) and ad-hoc runs use
// node docs-build.js --stamp <page> [<docsDir>] stamps docs/user/de/<page>.md with the hash of
//                                               its current English source (after translating)
if (require.main === module) {
  if (process.argv[2] === '--stamp') {
    const docsDir = path.resolve(process.argv[4] || path.join(__dirname, '..', 'docs', 'user'));
    stampTranslation(docsDir, process.argv[3]);
    console.log(`Stamped docs/user/de/${process.argv[3]}.md`);
  } else {
    buildDocs({ docsDir: process.argv[2], outdir: process.argv[3] })
      .then((pages) => console.log(pages.map((p) => p.name).join(',')))
      .catch((err) => { console.error(err.message); process.exit(1); });
  }
}
