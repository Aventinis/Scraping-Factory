// Screenshot for docs/user/output.md — the default output file name in Settings.
module.exports = [
  {
    id: 'output-default-name',
    fixture: 'speisekarte',
    async run(s) {
      await s.waitForIdle();
      await s.popupPage.click('#btn-open-settings');
      await s.popupPage.waitForSelector('#screen-settings:not(.hidden)');
      await s.popupPage.click('#btn-output-name-mode-script');
      await s.shot('output-default-name', '#output-name-setting');
    },
  },
];
