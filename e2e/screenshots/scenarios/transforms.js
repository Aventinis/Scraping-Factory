// Screenshot for docs/user/transforms.md — a price field with a transform
// chain and the live preview below it.
module.exports = [
  {
    id: 'transforms-chain',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-add-field');
      await fixturePage.click('li.menu-item >> nth=0 >> .item-price');
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', 'Price');

      await popupPage.click('#btn-field-transform-add');
      await popupPage.click('#btn-field-transform-add');
      await popupPage.locator('.transform-kind-select').nth(1).selectOption('toCurrency');
      await popupPage.waitForSelector('#field-transform-preview:not(.hidden)');
      await s.shot('transforms-chain');
    },
  },
];
