// Screenshots for docs/user/getting-started.md — the first flat-mode scraper
// on the speisekarte fixture.
module.exports = [
  {
    id: 'getting-started-first-scraper',
    fixture: 'speisekarte',
    async run(s) {
      await s.waitForIdle();
      await s.shot('getting-started-idle');

      await s.popupPage.click('#btn-add-field');
      await s.fixturePage.click('li.menu-item >> nth=0 >> .item-name');
      await s.popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await s.popupPage.fill('#input-field-name', 'Dish');
      await s.shot('getting-started-name-field');
      await s.popupPage.click('#btn-field-confirm');
      await s.waitForIdle();

      await s.addFlatField('Price', 'li.menu-item >> nth=0 >> .item-price');
      await s.shot('getting-started-fields');

      // Generate runs the script once against the live fixture; the data
      // preview (a Global Settings preference) shows what it scraped.
      await s.popupPage.evaluate(async () => {
        await chrome.storage.local.set({ globalSettings: { includeDataPreview: true } });
      });
      await s.popupPage.reload();
      await s.fixturePage.bringToFront();
      await s.waitForIdle();
      await s.popupPage.click('#btn-generate');
      await s.popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
      await s.shot('getting-started-done');
    },
  },
];
