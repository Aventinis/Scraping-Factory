// Screenshots for docs/user/modes.md — the mode toggle and a container tree.
module.exports = [
  {
    id: 'modes-toggle',
    fixture: 'speisekarte',
    async run(s) {
      await s.waitForIdle();
      await s.shot('modes-toggle', '.mode-toggle');
    },
  },
  {
    id: 'modes-container-tree',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-mode-container');

      // Root container: one repeating group per menu entry.
      await popupPage.click('#btn-add-root-container');
      await popupPage.fill('#input-container-name', 'Dish');
      await popupPage.check('#radio-container-repeating');
      await s.shot('modes-container-new');
      await popupPage.click('#btn-container-confirm');
      await popupPage.waitForSelector('#screen-selecting:not(.hidden)');
      await fixturePage.waitForTimeout(500);
      // Click the entry's own padding, not one of its children, so the group is the <li> itself.
      await fixturePage.click('li.menu-item >> nth=0', { position: { x: 2, y: 2 } });
      await s.waitForIdle();

      // Two fields inside it, picked relative to the first instance.
      for (const [name, selector] of [['Name', '.item-name'], ['Price', '.item-price']]) {
        await popupPage.locator('.btn-add-subfield').first().click();
        await popupPage.waitForSelector('#screen-selecting:not(.hidden)');
        await fixturePage.waitForTimeout(500); // content script arms its click handler
        await fixturePage.click(`li.menu-item >> nth=0 >> ${selector}`);
        await popupPage.waitForSelector('#modal-field-extended:not(.hidden)');
        await popupPage.fill('#input-field-extended-name', name);
        await popupPage.click('#btn-field-extended-confirm');
        await s.waitForIdle();
      }
      await s.shot('modes-container-tree');
    },
  },
];
