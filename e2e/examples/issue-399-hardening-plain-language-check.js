// Issue #399: real-browser check of the Monitoring section in plain language, on the
// speisekarte fixture:
//   - a one-sentence intro, a "Checks after every run" heading whose "?" explains
//     "Warn me" vs. "Stop the run" (exit codes live in the popover, no hover tooltips);
//   - one "?" per check with a purpose and an example;
//   - thresholds as sentences, the rare blocking options inside an "Advanced" disclosure
//     (collapsed by default);
//   - "Recommended checks": one click switches on "empty result" and the first field as
//     required, both as "Warn me", and the REAL /generate request carries exactly
//     those two checks (captured from the network);
//   - German and Spanish wording, and no horizontal overflow added at 280/320/400 px.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-399-hardening-plain-language-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    for (const [name, selector] of [['Gericht', '.item-name'], ['Preis', '.item-price']]) {
      await popup.click('#btn-add-field');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click(`li.menu-item >> nth=0 >> ${selector}`);
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', name);
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);
    }
    await popup.click('#monitoring-section-toggle');

    const popoverText = async (hostSelector) => {
      const btn = popup.locator(`${hostSelector} .help-btn`).first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const panel = popup.locator(`#${await btn.getAttribute('aria-controls')}`);
      assert(await panel.isVisible(), `popover for ${hostSelector} should open`);
      const text = await panel.locator('.help-popover-text').textContent();
      const example = await panel.locator('.help-popover-example').textContent().catch(() => '');
      await popup.keyboard.press('Escape');
      return { text, example };
    };

    // 1) Intro, heading, severity in plain words.
    assert(/run the script again and again, e\.g\. every night/.test(await popup.locator('.monitoring-intro').textContent()), 'the section intro is missing');
    assert((await popup.locator('.hardening-heading span').first().textContent()) === 'Checks after every run', 'the checks heading');
    const severity = await popoverText('.hardening-heading');
    assert(/“Warn me”.*finishes normally/.test(severity.text) && /“Stop the run”.*marked as failed/.test(severity.text) && /exit code 2/.test(severity.text), `unexpected severity help: ${severity.text}`);
    for (const id of ['no-result']) {
      assert((await popup.locator(`#btn-hardening-${id}-warning`).textContent()) === 'Warn me', 'severity label "Warn me"');
      assert((await popup.locator(`#btn-hardening-${id}-error`).textContent()) === 'Stop the run', 'severity label "Stop the run"');
      assert((await popup.locator(`#btn-hardening-${id}-warning`).getAttribute('title')) === null, 'no hover-only tooltip any more');
    }
    console.log('intro, heading and "Warn me" / "Stop the run" (exit codes in the popover)');

    // 2) One popover per check, with an example.
    const checks = [
      ['help.hardening.noResult', /found nothing at all/, /Price/],
      ['help.hardening.nullRate', /too many rows have no value/, /50 %/],
      ['help.hardening.baseline', /much less than the last run/, /20 % fewer rows/],
      ['help.hardening.blocking', /starts blocking the script/, /Access Denied/],
      ['help.hardening.requiredFields', /Leaves out every row/, /database import/],
    ];
    for (const [key, textRe, exampleRe] of checks) {
      const { text, example } = await popoverText(`[data-help="${key}"]`);
      assert(textRe.test(text), `${key}: unexpected text "${text}"`);
      assert(exampleRe.test(example), `${key}: unexpected example "${example}"`);
    }
    console.log('every check has a popover with a purpose and an example');

    // 3) Recommended checks: one click, then the REAL request.
    assert(!(await popup.locator('#toggle-hardening-no-result').isChecked()), 'nothing should be on yet');
    await popup.click('#btn-hardening-recommended');
    assert(await popup.locator('#toggle-hardening-no-result').isChecked(), '"empty result" should be on');
    assert(await popup.locator('#toggle-hardening-required-fields').isChecked(), 'required fields should be on');
    assert(/Gericht/.test(await popup.locator('#hardening-required-fields-list').textContent()), 'the first field should be the required one');
    const note = await popup.locator('#hardening-recommended-note').textContent();
    assert(/Switched on: empty result \(warn me\), required field “Gericht” \(warn me\)\./.test(note), `unexpected note: ${note}`);
    assert(/active/.test((await popup.locator('#btn-hardening-no-result-warning').getAttribute('class')) || ''), '"Warn me" should be the active severity');
    await popup.locator('#hardening-config').screenshot({ path: path.join(__dirname, 'issue-399-recommended.png') });

    await focusFixture(fixturePage);
    const [request] = await Promise.all([
      popup.waitForRequest((r) => r.url().endsWith('/generate') && r.method() === 'POST', { timeout: 30000 }),
      popup.click('#btn-generate'),
    ]);
    const hardening = request.postDataJSON().hardening;
    assert(JSON.stringify(hardening) === JSON.stringify([
      { kind: 'noResult', severity: 'Warning' },
      { kind: 'requiredFields', severity: 'Warning', fieldNames: ['Gericht'] },
    ]), `the /generate request should carry exactly the two recommended checks, got ${JSON.stringify(hardening)}`);
    await popup.waitForSelector('#screen-done:not(.hidden), #error-toast:not(.hidden)', { timeout: 120000 });
    assert(await popup.locator('#screen-done').isVisible(), 'Generate should succeed with the recommended checks');
    console.log('recommended checks → the generate request carries', JSON.stringify(hardening));
    await popup.click('#btn-back-to-config');
    await waitForIdleScreen(popup);
    await popup.click('#monitoring-section-toggle').catch(() => {});

    // 4) Sentences and the Advanced disclosure.
    if (!(await popup.locator('#hardening-config').isVisible())) await popup.click('#monitoring-section-toggle');
    await popup.check('#toggle-hardening-baseline');
    const baselineSentence = (await popup.locator('#hardening-baseline-config .hardening-sentence').textContent()).replace(/\s+/g, ' ').trim();
    assert(baselineSentence === 'Trigger if there are % fewer rows than in the last run', `unexpected baseline sentence: ${baselineSentence}`);
    assert(await popup.locator('#input-hardening-baseline-threshold').inputValue() === '20', 'the default threshold should stay 20');
    await popup.click('#btn-add-null-rate-check');
    const nullRow = (await popup.locator('.hardening-null-rate-row').first().textContent()).replace(/\s+/g, ' ');
    assert(/is empty in more than/.test(nullRow) && /% of the rows/.test(nullRow), `unexpected null-rate row: ${nullRow}`);
    await popup.check('#toggle-hardening-blocking');
    const advanced = popup.locator('#hardening-blocking-config details[data-advanced="hardening-blocking"]');
    assert(!(await advanced.evaluate((d) => d.open)), 'the blocking options should start collapsed');
    assert(!(await popup.locator('#input-hardening-blocking-phrases').isVisible()), 'the phrases input should be hidden while collapsed');
    await advanced.locator('summary').click();
    assert(await popup.locator('#input-hardening-blocking-phrases').isVisible(), 'opening the disclosure should show the phrases input');
    assert(/Page shorter than/.test(await popup.locator('#hardening-blocking-config .hardening-sentence').textContent()), 'the min-length sentence');
    const adv = await popoverText('[data-help="help.hardening.blockingAdvanced"]');
    assert(/1000 bytes is about one paragraph/.test(adv.text) && /Access Denied/.test(adv.example), 'the advanced popover');
    console.log('thresholds as sentences, blocking options in a collapsed Advanced disclosure');

    // 5) Widths.
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 1200 });
      const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`width ${width}px: horizontal overflow ${overflow}px`);
      assert(overflow <= (width === 280 ? 44 : width === 320 ? 4 : 0), `the Monitoring markup adds horizontal scrolling at ${width}px (${overflow}px)`);
      await popup.locator('#hardening-config').screenshot({ path: path.join(__dirname, `issue-399-hardening-${width}.png`) });
    }
    await popup.setViewportSize({ width: 420, height: 1200 });

    // 6) German and Spanish.
    for (const [language, intro, warn, stop, recommended] of [
      ['de', /immer wieder ausführst/, 'Mich warnen', 'Lauf stoppen', 'Empfohlene Prüfungen'],
      ['es', /una y otra vez/, 'Avisarme', 'Detener la ejecución', 'Comprobaciones recomendadas'],
    ]) {
      await popup.evaluate((l) => chrome.storage.local.set({ language: l }), language);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
      await popup.click('#monitoring-section-toggle').catch(() => {});
      if (!(await popup.locator('#hardening-config').isVisible())) await popup.click('#monitoring-section-toggle');
      assert(intro.test(await popup.locator('.monitoring-intro').textContent()), `${language}: intro`);
      assert((await popup.locator('#btn-hardening-no-result-warning').textContent()) === warn, `${language}: "${warn}"`);
      assert((await popup.locator('#btn-hardening-no-result-error').textContent()) === stop, `${language}: "${stop}"`);
      assert((await popup.locator('#btn-hardening-recommended').textContent()) === recommended, `${language}: "${recommended}"`);
    }
    console.log('german and spanish wording');

    console.log('OK — Monitoring explained in plain language; the recommended checks reach the real generate request.');
  } catch (err) {
    const t = await browser.context.pages().at(-1).locator('#error-toast').textContent().catch(() => null);
    if (t) console.error('Toast:', t.replace(/\s+/g, ' ').slice(0, 300));
    throw err;
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
