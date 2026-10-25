// Screenshot for docs/user/monitoring.md — the Monitoring section after one click on
// "Recommended checks".
module.exports = [
  {
    id: 'monitoring-recommended',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage } = s;
      await s.waitForIdle();
      await s.addFlatField(s.word('Dish'), 'li.menu-item >> nth=0 >> .item-name');
      await s.addFlatField(s.word('Price'), 'li.menu-item >> nth=0 >> .item-price');
      await popupPage.click('#monitoring-section-toggle');
      await popupPage.click('#btn-hardening-recommended');
      await s.shot('monitoring-recommended', '#hardening-config');
    },
  },
];
