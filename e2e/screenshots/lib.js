// Issue #354: shared plumbing for the user-documentation screenshot
// generator. A scenario gets a freshly opened popup in a fixed language,
// theme and viewport (so every regeneration produces comparable images) and
// a `shot()` helper that writes into docs/user/images/.
const path = require('path');
const fs = require('fs');
const { openPopup, focusFixture, waitForIdleScreen } = require('../harness');

const IMAGES_DIR = path.resolve(__dirname, '../../docs/user/images');

// Roughly a side panel: narrow enough to look like one, tall enough to show a
// whole screen without scrolling.
const VIEWPORT = { width: 420, height: 900 };

// Opens a fixture page plus a clean popup. Everything the previous scenario
// stored (session recovery state, persisted settings) is wiped first, so
// scenarios never depend on each other or on their order.
async function openScenario(ctx, { fixture, companionUrl, language = 'en', theme = 'light' }) {
  const fixturePage = await ctx.browser.context.newPage();
  const fixtureServer = await ctx.fixture(fixture);
  await fixturePage.goto(fixtureServer.url);

  const popupPage = await openPopup(ctx.browser.context, ctx.browser.extensionId);
  await popupPage.evaluate(async ({ language, theme, companionUrl }) => {
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ language, theme, companionUrlOverride: companionUrl });
  }, { language, theme, companionUrl: companionUrl || `http://localhost:${ctx.companionPort}` });
  await popupPage.setViewportSize(VIEWPORT);
  await popupPage.reload();
  await focusFixture(fixturePage);

  return {
    fixturePage,
    popupPage,
    // Writes docs/user/images/<name>.png. `target` is an optional locator /
    // selector string to crop to instead of the whole popup.
    async shot(name, target) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
      const file = path.join(IMAGES_DIR, `${name}.png`);
      // Let transitions (sliding mode-toggle thumb, modal fade) finish.
      await popupPage.waitForTimeout(400);
      const locator = target ? popupPage.locator(target).first() : null;
      if (locator) await locator.screenshot({ path: file });
      else await popupPage.screenshot({ path: file });
      ctx.written.push(path.relative(path.resolve(__dirname, '../..'), file));
    },
    async close() {
      await popupPage.close();
      await fixturePage.close();
    },
    async waitForIdle() {
      await waitForIdleScreen(popupPage);
    },
    // The flat-mode "+ Field" round trip: click the button, click the element
    // on the page, name the field, confirm.
    async addFlatField(name, pageSelector) {
      await popupPage.click('#btn-add-field');
      await fixturePage.click(pageSelector);
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', name);
      await popupPage.click('#btn-field-confirm');
      await waitForIdleScreen(popupPage);
    },
  };
}

module.exports = { openScenario, IMAGES_DIR, VIEWPORT, focusFixture };
