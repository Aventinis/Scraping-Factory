// Issue #407: real-browser check of the terminology pass, the "Advanced"
// groups and the 1-based split part, in the real unpacked extension.
//   - the renamed labels (output layout, alerts & safety checks, skip if the
//     page hasn't changed, remove duplicates) in en/de/es;
//   - "Retry on transient errors": the status-code list is hidden behind a
//     collapsed "Advanced", opening it is remembered across a reload, and a
//     changed list opens it on its own;
//   - the Settings screen's glossary lists the renamed terms;
//   - "Split field" says "Part (1 = first)", and a REAL Generate returns the
//     second word for part 2 and the first for part 1 (wire index stays 0-based).
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-407-terminology-advanced-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('transform-helpers');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({
      language: 'en', companionUrlOverride: 'http://localhost:5055', globalSettings: { includeDataPreview: true },
    }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // 1) Renamed labels, in all three languages.
    const labels = () => popup.evaluate(() => ({
      monitoring: document.querySelector('[data-i18n="idle.monitoringSectionToggle"]').textContent.trim(),
      layout: document.querySelector('[data-i18n="idle.outputBlueprintLabel"]').textContent.trim(),
      preflight: document.querySelector('[data-i18n="idle.preflightToggle"]').textContent.trim(),
      dedup: document.querySelector('[data-i18n="idle.dedupToggle"]').textContent.trim(),
    }));
    const expected = {
      en: { monitoring: 'Alerts & safety checks', layout: 'Output layout', preflight: "Skip if the page hasn't changed", dedup: 'Remove duplicates' },
      de: { monitoring: 'Benachrichtigungen & Prüfungen', layout: 'Ausgabe-Layout', preflight: 'Überspringen, wenn die Seite unverändert ist', dedup: 'Duplikate entfernen' },
      es: { monitoring: 'Avisos y comprobaciones', layout: 'Diseño de salida', preflight: 'Omitir si la página no ha cambiado', dedup: 'Eliminar duplicados' },
    };
    for (const language of ['en', 'de', 'es']) {
      await popup.evaluate((l) => chrome.storage.local.set({ language: l }), language);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
      const got = await labels();
      assert(JSON.stringify(got) === JSON.stringify(expected[language]), `${language}: labels differ: ${JSON.stringify(got)}`);
    }
    console.log('labels: en/de/es use the plainer names');
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // 2) "Advanced": retry status codes.
    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-retry');
    const codes = popup.locator('#input-retry-status-codes');
    assert(!(await codes.isVisible()), 'the status-code list should be hidden behind a collapsed "Advanced"');
    await popup.click('#retry-advanced > summary');
    assert(await codes.isVisible(), 'opening "Advanced" should show the status-code list');
    // Remembered: the open state survives a reload (the list is still the default one).
    // The toggle event and the storage write are asynchronous: wait until the section is really stored.
    for (let i = 0; i < 40; i++) {
      const stored = await popup.evaluate(() => chrome.storage.local.get('advancedSections'));
      if (stored.advancedSections && stored.advancedSections['retry-status-codes']) break;
      await popup.waitForTimeout(100);
    }
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await popup.waitForFunction(() => document.getElementById('retry-advanced').open, null, { timeout: 5000 })
      .catch(() => { throw new Error('an opened "Advanced" should be remembered across a reload'); });
    // A changed list opens it on its own, even when nothing is remembered.
    await popup.click('#settings-section-toggle');
    await popup.fill('#input-retry-status-codes', '429, 500');
    await popup.evaluate(() => chrome.storage.local.remove('advancedSections'));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    assert(await popup.evaluate(() => document.getElementById('retry-advanced').open), 'a changed status-code list should open "Advanced" by itself');
    console.log('advanced: collapsed by default, remembered, opens itself for a changed list');
    await popup.click('#settings-section-toggle');
    await popup.uncheck('#toggle-retry');

    // 3) Settings glossary.
    await popup.click('#btn-open-settings');
    await popup.waitForSelector('#settings-glossary-section');
    await popup.click('#settings-glossary-section > summary');
    const terms = await popup.$$eval('#settings-glossary-list dt', (els) => els.map((e) => e.textContent));
    for (const term of ['Output layout', 'Safety checks', "Skip if the page hasn't changed", 'Remove duplicates']) {
      assert(terms.includes(term), `glossary lacks "${term}": ${JSON.stringify(terms)}`);
    }
    await popup.screenshot({ path: path.join(__dirname, 'issue-407-glossary.png') });
    await popup.click('#btn-close-settings');
    await waitForIdleScreen(popup);
    console.log('glossary:', terms.length, 'terms');

    // 4) Split field counts from 1: a real Generate.
    await popup.click('#btn-add-field');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.product >> nth=0 >> .sku');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Artikel');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);

    const addSplit = async (name, part) => {
      await popup.click('#btn-add-split-field');
      await popup.waitForSelector('#modal-split-field:not(.hidden)');
      const label = await popup.locator('label[for="input-split-field-index"]').textContent();
      assert(label === 'Part (1 = first)', `unexpected label: ${label}`);
      assert((await popup.inputValue('#input-split-field-index')) === '1', 'the default part should be 1 (the first)');
      await popup.fill('#input-split-field-name', name);
      await popup.selectOption('#select-split-field-source', 'Artikel');
      await popup.fill('#input-split-field-separator', ' ');
      await popup.fill('#input-split-field-index', String(part));
      await popup.click('#btn-split-field-confirm');
      await waitForIdleScreen(popup);
    };
    await addSplit('Nummer', 2);
    await addSplit('Vorsatz', 1);

    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    const header = await popup.$$eval('#data-preview-table-wrap thead th', (ths) => ths.map((th) => th.textContent));
    const table = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
    assert(JSON.stringify(header) === JSON.stringify(['Artikel', 'Nummer', 'Vorsatz']), `unexpected columns: ${JSON.stringify(header)}`);
    assert(table.length === 3, `expected 3 rows, got ${table.length}`);
    assert(JSON.stringify(table[0]) === JSON.stringify(['Art.-Nr. 4711', '4711', 'Art.-Nr.']), `unexpected first row: ${JSON.stringify(table[0])}`);
    assert(JSON.stringify(table.map((r) => r[1])) === JSON.stringify(['4711', '4712', '4713']), 'part 2 should be the number in every row');
    await popup.screenshot({ path: path.join(__dirname, 'issue-407-done.png') });
    console.log('split: part 2 →', table[0][1], '| part 1 →', table[0][2]);

    console.log('OK — plainer names, Advanced groups that remember themselves, a glossary and a split part that counts from 1.');
  } catch (err) {
    const t = await browser.context.pages().at(-1).locator('#error-toast').textContent().catch(() => null);
    if (t) console.error('Toast:', t.replace(/\s+/g, ' ').slice(0, 300));
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await fixture.stop?.();
    await companion.stop?.();
  }
})().catch((err) => { console.error(err); process.exit(1); });
