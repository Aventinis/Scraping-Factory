// Issue #233: real-browser check of the single-row hover highlight — seeds a
// container-mode configuration (repeating category > repeating dish > price)
// for the speisekarte fixture, hovers tree rows in the popup, and verifies
// the green boxes the content script draws on the real page: one per
// category for the category row, one price per dish (23) for the nested
// price row, cleared again when the pointer leaves the tree.
//
// The hover itself is dispatched as a synthetic mouseover/mouseleave inside
// the popup page (the fixture tab has to stay the active tab, see
// focusFixture) — everything after that is the real path: popup →
// service worker FORWARD_TO_TAB → content script → overlay.
//
// Usage: node e2e/examples/issue-233-hover-highlight-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const GROUPS = [{
  kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true, framePath: null,
  children: [
    { kind: 'field', name: 'Titel', selector: 'h2.category-title', mode: 'text', attribute: null, framePath: null, transforms: [] },
    {
      kind: 'group', name: 'Gericht', selector: 'li.menu-item', repeating: true, framePath: null,
      children: [{ kind: 'field', name: 'Preis', selector: '.item-price', mode: 'text', attribute: null, framePath: null, transforms: [] }],
    },
  ],
}];

(async () => {
  const companion = await startCompanion();
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(groups => chrome.storage.session.set({ mode: 'container', groups }), GROUPS);
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    const greenBoxes = () => fixturePage.evaluate(() => Array.from(document.querySelectorAll('.sf-preview-box'))
      .filter(b => b.style.border.includes('22, 163, 74'))
      .map(b => b.textContent));
    const hoverRow = treePath => popupPage.evaluate((p) => {
      document.querySelector(`[data-path='${p}'] > .group-tree-row .group-tree-label`)
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }, treePath);
    const waitForBoxes = async (count) => {
      for (let i = 0; i < 40; i++) {
        const boxes = await greenBoxes();
        if (boxes.length === count) return boxes;
        await fixturePage.waitForTimeout(100);
      }
      throw new Error(`Expected ${count} green boxes, got ${(await greenBoxes()).length}`);
    };

    await hoverRow('[0]');
    const categoryBoxes = await waitForBoxes(6);
    if (categoryBoxes[0] !== 'Kategorie ×6') throw new Error(`Unexpected label "${categoryBoxes[0]}"`);
    console.log('Category row → 6 boxes, label:', categoryBoxes[0]);

    await hoverRow('[0,1,0]');
    const priceBoxes = await waitForBoxes(23);
    console.log('Nested price row → 23 boxes, label:', priceBoxes[0]);
    await fixturePage.screenshot({ path: path.join(__dirname, 'issue-233-hover-highlight.png') });

    await popupPage.evaluate(() => document.getElementById('group-tree-root').dispatchEvent(new MouseEvent('mouseleave')));
    await waitForBoxes(0);
    console.log('OK — hover highlights the hovered row in every enclosing instance and clears on mouseleave.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
