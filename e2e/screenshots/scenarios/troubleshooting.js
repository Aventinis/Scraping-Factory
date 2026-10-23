// Screenshots for docs/user/troubleshooting.md.
module.exports = [
  {
    id: 'troubleshooting-companion-unreachable',
    fixture: 'speisekarte',
    // Nothing listens here, so the popup lands on its companion-error screen.
    companionUrl: 'http://localhost:5999',
    async run(s) {
      await s.popupPage.waitForSelector('#screen-error:not(.hidden)', { timeout: 15000 });
      await s.shot('troubleshooting-companion-unreachable');
    },
  },
  {
    id: 'troubleshooting-settings',
    fixture: 'speisekarte',
    async run(s) {
      await s.waitForIdle();
      await s.popupPage.click('#btn-open-settings');
      await s.popupPage.waitForSelector('#screen-settings:not(.hidden)');
      await s.shot('troubleshooting-settings');
    },
  },
];
