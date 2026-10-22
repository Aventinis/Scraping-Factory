// Shared ring-buffer logger, loaded in all three extension contexts
// (content script, service worker, side panel) so their recent activity can
// be combined into a bug report. Each context's bundle contains its own
// copy of this module, hence one buffer per JS context.
const MAX_LOG_ENTRIES = 300;
const buffer = [];

function createLogger(prefix) {
  return function log(event, data) {
    const ts = new Date().toISOString();
    buffer.push({ ts, event, data: data !== undefined ? data : null });
    if (buffer.length > MAX_LOG_ENTRIES) buffer.shift();

    const shortTs = ts.slice(11, 23);
    data !== undefined
      ? console.log(`[${prefix} ${shortTs}]`, event, data)
      : console.log(`[${prefix} ${shortTs}]`, event);
  };
}

function getLogBuffer() {
  return buffer.slice();
}

function clearLogBuffer() {
  buffer.length = 0;
}

module.exports = { createLogger, getLogBuffer, clearLogBuffer };

