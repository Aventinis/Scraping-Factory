// Shared ring-buffer logger, loaded in all three extension contexts
// (content script, service worker, side panel) so their recent activity can
// be combined into a bug report. Loaded as a classic script in the browser
// (via manifest content_scripts / importScripts / <script> tag) and via
// require() in Jest — see the dual export at the bottom.
//
// Everything below is wrapped in an IIFE so only the single `SFLogger` name
// reaches the shared global scope. Content script, service worker and popup
// each load this file *and then* declare their own `const { createLogger }`
// pulled off SFLogger — if createLogger/getLogBuffer were bare top-level
// declarations here, that second declaration would collide with this file's
// (classic scripts loaded via importScripts/<script> tags all share one
// global scope), throwing "Identifier 'createLogger' has already been
// declared" and breaking the whole script.
const SFLogger = (function () {
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

  return { createLogger, getLogBuffer, clearLogBuffer };
})();

if (typeof module !== 'undefined') module.exports = SFLogger;
if (typeof self !== 'undefined') self.SFLogger = SFLogger;
