// Screenshot for docs/user/pagination.md — the Pagination block in Settings.
module.exports = [
  {
    id: 'pagination-settings',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage } = s;
      await s.waitForIdle();
      await s.addFlatField('Dish', 'li.menu-item >> nth=0 >> .item-name');
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
