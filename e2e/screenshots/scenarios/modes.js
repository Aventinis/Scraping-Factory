// Screenshots for docs/user/modes.md — the mode toggle and a container tree.
module.exports = [
  {
    id: 'modes-help',
    fixture: 'speisekarte',
    async run(s) {
      await s.waitForIdle();
      await s.popupPage.locator('.row-label:has(.help-host[data-help="help.mode.choice"]) .help-btn').click();
      await s.shot('modes-help');
    },
  },
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
      await popupPage.fill('#input-container-name', s.word('Dish'));
      await popupPage.check('#radio-container-repeating');
      await s.shot('modes-container-new');
      await popupPage.click('#btn-container-confirm');
      await popupPage.waitForSelector('#screen-selecting:not(.hidden)');
      await fixturePage.waitForTimeout(500);
      // Click the entry's own padding, not one of its children, so the group is the <li> itself.
      await fixturePage.click('li.menu-item >> nth=0', { position: { x: 2, y: 2 } });
      await s.waitForIdle();

      // Two fields inside it, picked relative to the first instance.
      for (const [name, selector] of [[s.word('Name'), '.item-name'], [s.word('Price'), '.item-price']]) {
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
  {
    // Issue #404: the "add group" modal's path picked from the recorded response.
    id: 'modes-api-path-picker',
    fixture: 'api-nested-and-post',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-mode-api');
      await popupPage.click('#btn-api-capture');
      await fixturePage.click('#btn-reload-search');
      await fixturePage.waitForSelector('#result-search .product-title');
      await popupPage.click('#btn-api-capture');
      await fixturePage.bringToFront();
      await fixturePage.waitForTimeout(150);
      await popupPage.click('#btn-api-search');
      await fixturePage.click('#result-search .product-title >> nth=0');
      await popupPage.waitForSelector('.api-candidate-field-name', { state: 'visible' });
      await popupPage.fill('.api-candidate-field-name', s.word('Title'));
      await popupPage.click('.api-candidate-confirm');
      await popupPage.waitForSelector('#screen-api-config:not(.hidden)');
      await popupPage.locator('#api-tree-root .btn-add-api-subgroup').first().click();
      await popupPage.waitForSelector('#modal-api-group-new:not(.hidden)');
      await popupPage.fill('#input-api-group-name', s.word('Subcategory'));
      await popupPage.click('#modal-api-group-new .json-path-open');
      await popupPage.waitForSelector('#api-group-path-picker .json-path-pick');
      await s.shot('modes-api-path-picker', '#modal-api-group-new .modal-inner');
    },
  },
  {
    // Issue #504: a candidate card whose "Use" works without a typed name (the placeholder shows the name taken from the path).
    id: 'modes-api-use-name',
    fixture: 'api-nested-and-post',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-mode-api');
      await popupPage.click('#btn-api-capture');
      await fixturePage.click('#btn-reload-search');
      await fixturePage.waitForSelector('#result-search .product-title');
      await popupPage.click('#btn-api-capture');
      await fixturePage.bringToFront();
      await fixturePage.waitForTimeout(150);
      await popupPage.click('#btn-api-search');
      await fixturePage.click('#result-search .product-title >> nth=0');
      await popupPage.waitForSelector('.api-candidate-field-name', { state: 'visible' });
      await s.shot('modes-api-use-name', '#api-candidates-list .api-candidate >> nth=0');
    },
  },
  {
    // Issue #506: the API panel after Apply, with Edit next to Discard.
    id: 'modes-api-edit',
    fixture: 'api-nested-and-post',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-mode-api');
      await popupPage.click('#btn-api-capture');
      await fixturePage.click('#btn-reload-search');
      await fixturePage.waitForSelector('#result-search .product-title');
      await popupPage.click('#btn-api-capture');
      await fixturePage.bringToFront();
      await fixturePage.waitForTimeout(150);
      await popupPage.click('#btn-api-search');
      await fixturePage.click('#result-search .product-title >> nth=0');
      await popupPage.waitForSelector('.api-candidate-confirm', { state: 'visible' });
      await popupPage.click('.api-candidate-confirm');
      await popupPage.waitForSelector('#screen-api-config:not(.hidden)');
      await popupPage.click('#btn-api-config-confirm');
      await s.waitForIdle();
      await s.shot('modes-api-edit', '#api-config-panel');
    },
  },
  {
    // Issue #507: one search for recorded requests and the page's own JSON — here a page that only embeds its data.
    id: 'modes-api-find-data-point',
    fixture: 'embedded-json-menu',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-mode-api');
      await popupPage.click('#btn-api-search');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('.menu-item >> nth=0 >> .item-name');
      await popupPage.waitForSelector('.api-candidate-confirm', { state: 'visible' });
      await s.shot('modes-api-find-data-point', '#api-candidates-panel');
    },
  },
];
