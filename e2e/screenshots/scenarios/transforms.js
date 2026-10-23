// Screenshot for docs/user/transforms.md — a price field with a transform
// chain and the live preview below it.
module.exports = [
  {
    id: 'transforms-pattern-helper',
    fixture: 'transform-helpers',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-add-field');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('li.product >> nth=0 >> .price');
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', s.word('Price'));
      await popupPage.click('#btn-field-transform-add');
      await popupPage.locator('.transform-kind-select').last().selectOption('regexExtract');
      await popupPage.locator('.btn-transform-helper-toggle').click();
      await popupPage.locator('.transform-recipe-select').selectOption('textAfter');
      await popupPage.locator('.transform-recipe-arg').first().fill('Preis:');
      await s.shot('transforms-pattern-helper');
    },
  },
  {
    id: 'transforms-date-guess',
    fixture: 'transform-helpers',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-add-field');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('li.product >> nth=0 >> .date');
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', s.word('Date'));
      await popupPage.click('#btn-field-transform-add');
      await popupPage.locator('.transform-kind-select').last().selectOption('toDate');
      await s.shot('transforms-date-guess');
    },
  },
  {
    id: 'transforms-chain',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-add-field');
      await fixturePage.click('li.menu-item >> nth=0 >> .item-price');
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', s.word('Price'));

      await popupPage.click('#btn-field-transform-add');
      await popupPage.click('#btn-field-transform-add');
      await popupPage.locator('.transform-kind-select').nth(1).selectOption('toCurrency');
      await popupPage.waitForSelector('#field-transform-preview:not(.hidden)');
      await s.shot('transforms-chain');
    },
  },
];
