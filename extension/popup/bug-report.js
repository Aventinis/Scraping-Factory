// ── Bug reporting ───────────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision). Combines this side panel's own log buffer with the
// service worker's and (best-effort, via the service worker) the active
// tab's content script's, so a user hitting an error can attach real
// diagnostic context to a GitHub issue in one click instead of having to
// copy devtools console output by hand.
const SFBugReport = (function() {
const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { getLastError } =
  typeof require !== 'undefined' ? require('./toast') : self.SFToast;

const GITHUB_REPO_URL = 'https://github.com/Aventinis/Scraping-Factory';
const BUG_REPORT_LOG_EXCERPT_LIMIT = 5000; // chars embedded directly in the GitHub issue body

async function collectLogs() {
  const popup = getLogBuffer();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    return { popup, background: response?.background ?? [], content: response?.content ?? null, contentError: response?.contentError ?? null };
  } catch (err) {
    log('GET_LOGS failed', err.message);
    return { popup, background: [], content: null, contentError: err.message };
  }
}

// This log/bug-report format is always English, independent of the popup's
// selected UI language — it's a diagnostic artifact for maintainers on the
// public, English-language GitHub repo, not conversational UI a
// multilingual end user reads day-to-day (see CLAUDE.md's Language policy).
function formatLogSection(title, entries) {
  if (!entries || entries.length === 0) return `## ${title}\n(no entries)\n`;
  const lines = entries.map(e => `${e.ts} ${e.event}${e.data !== null ? ' ' + JSON.stringify(e.data) : ''}`);
  return `## ${title}\n${lines.join('\n')}\n`;
}

// `pageUrl` is the popup's own _state.url at call time — passed in rather
// than read from shared state directly, so this module has no dependency on
// popup.js's state shape.
async function buildBugReport(pageUrl) {
  const { popup, background, content, contentError } = await collectLogs();
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};
  const lastReportedError = getLastError();

  const header = [
    '# Scraping Factory — Bug Report',
    `Timestamp: ${new Date().toISOString()}`,
    `Extension version: ${manifest.version || '?'}`,
    `Page: ${pageUrl || '—'}`,
    lastReportedError ? `Last error: ${lastReportedError.message} (${lastReportedError.context})` : null,
  ].filter(Boolean).join('\n');

  const sections = [
    formatLogSection('Side Panel', popup),
    formatLogSection('Service Worker', background),
    contentError ? `## Content Script\n(unavailable: ${contentError})\n` : formatLogSection('Content Script', content),
  ].join('\n');

  return `${header}\n\n${sections}`;
}

function downloadBugReport(text) {
  log('DOWNLOAD bug-report.log');
  const blob = new Blob([text], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `bug-report-${Date.now()}.log`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// GitHub (and browsers) reject a new-issue URL past a certain length outright
// ("the URI you submitted is too long") instead of silently truncating it —
// so unlike BUG_REPORT_LOG_EXCERPT_LIMIT (a raw-character budget for the log
// excerpt), this is checked against the *actual* encoded URL, since percent-
// encoding (quotes/braces/newlines in JSON log data, in particular) can
// inflate length well past what the raw excerpt accounts for.
const GITHUB_ISSUE_URL_LIMIT = 8000;

function buildIssueTitle() {
  const lastReportedError = getLastError();
  return lastReportedError ? `Error: ${lastReportedError.message}` : 'Bug report';
}

function buildIssueUrl(title, body) {
  return `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

// Prefills a new GitHub issue. Short reports are embedded in full so the
// issue is ready to submit as-is; longer ones are trailed off with a note
// pointing at the downloaded bug-report.log. If the resulting URL would
// still exceed GitHub's practical length limit (e.g. the error message
// itself is a huge traceback), we degrade further rather than hand back a
// broken link — down to an entirely unfilled issue as the last resort. An
// issue is always opened either way; the full log is already on disk via
// downloadBugReport() for the user to attach manually.
function buildGithubIssueUrl(reportText) {
  const title = buildIssueTitle();
  const truncated = reportText.length > BUG_REPORT_LOG_EXCERPT_LIMIT;
  const excerpt = truncated ? reportText.slice(-BUG_REPORT_LOG_EXCERPT_LIMIT) : reportText;

  const body = [
    'Please briefly describe what you were doing when the error occurred.',
    '',
    '<details><summary>Log</summary>',
    '',
    '```',
    excerpt,
    '```',
    '</details>',
    truncated ? '\n_(Log truncated — please also attach the downloaded bug-report.log file to this issue.)_' : '',
  ].filter(Boolean).join('\n');

  const prefilledUrl = buildIssueUrl(title, body);
  if (prefilledUrl.length <= GITHUB_ISSUE_URL_LIMIT) return prefilledUrl;

  const fallbackBody = [
    'Please briefly describe what you were doing when the error occurred.',
    '',
    '_(The automatically collected log was too long to prefill here — please attach the downloaded bug-report.log file to this issue instead.)_',
  ].join('\n');
  const fallbackUrl = buildIssueUrl(title, fallbackBody);
  if (fallbackUrl.length <= GITHUB_ISSUE_URL_LIMIT) return fallbackUrl;

  // Even the title alone (e.g. a huge error message used as-is) pushes past
  // the limit — open a fully blank issue.
  return `${GITHUB_REPO_URL}/issues/new`;
}

async function reportBug(pageUrl) {
  log('BTN report-bug');
  const reportText = await buildBugReport(pageUrl);
  downloadBugReport(reportText);
  chrome.tabs.create({ url: buildGithubIssueUrl(reportText) });
}

  return {collectLogs, formatLogSection, buildBugReport, downloadBugReport,
    buildIssueTitle, buildIssueUrl, buildGithubIssueUrl, reportBug,};
})();

if (typeof module !== 'undefined') module.exports = SFBugReport;
if (typeof self !== 'undefined') self.SFBugReport = SFBugReport;
