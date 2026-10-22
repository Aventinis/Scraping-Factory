// Screenshot for docs/user/network-settings.md — the custom request headers section
// with two headers picked from the list (a plain one and a secret that starts as an
// environment variable) and a custom header whose fixed value triggers the warning.
module.exports = [
  {
    id: 'network-request-headers',
    fixture: 'speisekarte',
    async run(s) {
      const { popupPage } = s;
      await s.waitForIdle();
      await popupPage.click('#settings-section-toggle');
      await popupPage.check('#toggle-request-headers');
      await popupPage.selectOption('#select-add-request-header', 'acceptLanguage');
      await popupPage.selectOption('#select-add-request-header', 'authorization');
      await popupPage.selectOption('#select-add-request-header', 'other');
      const custom = popupPage.locator('#request-headers-list .request-header-row').nth(2);
      await custom.locator('.request-header-name').fill('X-Auth-Token');
      await custom.locator('.request-header-name').blur();
      await custom.locator('.request-header-value').fill('my-token');
      await custom.locator('.request-header-value').blur();
      await s.shot('network-request-headers', '#request-headers-config');
    },
  },
];
