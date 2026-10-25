// Screenshot for docs/user/browser-engine.md — the "Login form" starter: four steps added
// with one click, two of them picked on the demo login page.
module.exports = [
  {
    id: 'browser-engine-login-starter',
    fixture: 'login-flow',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-engine-browser');
      await popupPage.click('#btn-add-login-flow');
      for (const [index, selector] of [[0, '#username'], [1, '#password']]) {
        await popupPage.locator('.btn-pick-action-selector').nth(index).click();
        await fixturePage.bringToFront();
        await fixturePage.waitForTimeout(150);
        await fixturePage.click(selector);
        await s.waitForIdle();
        await popupPage.waitForFunction((i) => !/No element|Kein Element/.test(document.querySelectorAll('#browser-actions-list .field-selector')[i].textContent), index);
      }
      await s.shot('browser-engine-login-starter', '#browser-actions-section');
    },
  },
  {
    // Issue #508: "Record my steps" — the live list while the user works on the page.
    id: 'browser-engine-record-steps',
    fixture: 'login-flow',
    async run(s) {
      const { popupPage, fixturePage } = s;
      await s.waitForIdle();
      await popupPage.click('#btn-engine-browser');
      await popupPage.click('#btn-record-steps');
      await fixturePage.waitForLoadState('load');
      await fixturePage.bringToFront();
      await fixturePage.waitForTimeout(1500);
      await fixturePage.click('#username');
      await fixturePage.keyboard.type('demo');
      await fixturePage.click('#password');
      await fixturePage.keyboard.type('demo');
      await fixturePage.click('#login-submit');
      await popupPage.waitForFunction(() => document.querySelectorAll('#record-steps-list li').length >= 3);
      await s.shot('browser-engine-record-steps', '#browser-actions-section');
    },
  },
];
