// Issue #429: a pick must never come back as a stale field dialog after a reload.
//
// The service worker stores every pick as `pendingSelector` (a fallback for a closed panel)
// while the open panel handles it live and cleans up; the write could land after the cleanup
// and the next load replayed it. Every pick now carries a `pickId`, the panel records the ones
// it handled (`handledPickId`), and the restore discards a stored selector that belongs to one.
//
//   - 16 real picks (a field each time, real clicks on the page), each followed by a short wait
//     for any late write: afterwards session storage holds either no pendingSelector or one
//     whose pickId is the handled one, and a reload ends on the idle screen every time;
//   - the late write forced on purpose (written after the panel handled the pick, the exact
//     interleaving of the bug): the reload still ends on the idle screen and clears it;
//   - a pick made while the panel was NOT listening is still replayed (the fallback works).
//
// Runs its own companion on port 5055, so a companion a human already has running on the
// default port is never used or touched.
//
// Usage: node e2e/examples/issue-429-pending-selector-race-check.js
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('transform-helpers');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    const session = () => popup.evaluate(() => chrome.storage.session.get(['pendingSelector', 'pendingPickId', 'handledPickId']));
    const reload = async () => {
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
    };

    // 1) Many real picks; nothing stale is replayed.
    const selectors = ['.name', '.price', '.date', '.sku'];
    for (let i = 0; i < 16; i++) {
      await popup.click('#btn-add-field');
      await fixturePage.waitForTimeout(400);
      await fixturePage.click(`li.product >> nth=${i % 3} >> ${selectors[i % 4]}`);
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', `Feld${i}`);
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);
      await popup.waitForTimeout(300); // let a late service-worker write land
      const s = await session();
      assert(!s.pendingSelector || (s.pendingPickId && s.pendingPickId === s.handledPickId),
        `pick ${i}: a pending selector is left that the panel did not handle: ${JSON.stringify(s)}`);
      if (i % 3 === 2) {
        await reload();
        const left = await session();
        assert(!left.pendingSelector, `pick ${i}: reload left a pending selector behind`);
      }
    }
    const fields = await popup.locator('#fields-list .field-row').count();
    assert(fields === 16, `expected 16 fields, got ${fields}`);
    console.log('16 picks: no stale pending selector, every reload ended on the idle screen');

    // 2) The late write forced: exactly the interleaving of the bug.
    await popup.evaluate(() => chrome.storage.session.set({ handledPickId: 'forced-1' }));
    await popup.evaluate(() => chrome.storage.session.set({ pendingSelector: 'span.name', pendingPickId: 'forced-1' })); // arrives after the cleanup
    await reload();
    const after = await session();
    assert(!after.pendingSelector, 'the forced leftover should have been discarded');
    assert((await popup.locator('#modal-field-name').isVisible()) === false, 'the leftover must not open a field dialog');
    console.log('forced late write: discarded, no stale dialog');

    // 3) A pick that the panel did not handle (nobody was listening) is still replayed.
    await popup.evaluate(() => chrome.storage.session.set({ pendingSelector: 'li.product .name', pendingPickId: 'never-handled', pendingFramePath: null, pendingMatchCount: 3, handledPickId: 'forced-1' }));
    await popup.reload();
    await popup.waitForSelector('#modal-field-name:not(.hidden)', { timeout: 15000 });
    console.log('a pick made while the panel was closed is still replayed as a field dialog');

    console.log('OK — a handled pick never comes back after a reload; the closed-panel fallback still works.');
  } catch (err) {
    const t = await browser.context.pages().at(-1).locator('#error-toast').textContent().catch(() => null);
    if (t) console.error('Toast:', t.replace(/\s+/g, ' ').slice(0, 300));
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await fixture.stop?.();
    await companion.stop?.();
  }
})().catch((err) => { console.error(err); process.exit(1); });
