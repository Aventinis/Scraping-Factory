// Screenshots for docs/user/pagination.md — the Pagination block in Settings: the
// proposal learned from a clicked "Next »" link (paginated-listing fixture), and the
// page-number kind with its pattern filled in.
module.exports = [
  {
    id: 'pagination-suggestion',
    fixture: 'paginated-listing',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await s.addFlatField(s.word('Title'), 'li.item >> nth=0');
      await popupPage.click('#settings-section-toggle');
      await popupPage.check('#toggle-pagination');
      await popupPage.click('#btn-pick-pagination-next-link');
      await fixturePage.bringToFront();
      await fixturePage.waitForTimeout(150);
      await fixturePage.click('a.next');
      await s.waitForIdle();
      await popupPage.waitForSelector('#pagination-suggestion:not(.hidden)');
      await popupPage.locator('#pagination-toggle-row').scrollIntoViewIfNeeded();
      await s.shot('pagination-suggestion', '#pagination-config');
    },
  },
  {
    id: 'pagination-settings',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage } = s;
      await s.waitForIdle();
      await s.addFlatField(s.word('Dish'), 'li.menu-item >> nth=0 >> .item-name');
      await popupPage.click('#settings-section-toggle');
      await popupPage.check('#toggle-pagination');
      await popupPage.click('#btn-pagination-page-number');
      await popupPage.fill('#input-pagination-url-template', '{url}?page={page}');
      await popupPage.fill('#input-pagination-max-pages', '5');
      await popupPage.locator('#pagination-toggle-row').scrollIntoViewIfNeeded();
      await s.shot('pagination-settings', '#pagination-config');
    },
  },
];
