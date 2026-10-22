// Issue #400: real-browser check of the helpers in the transform editor — the regex
// "Pattern helper" (recipes) behind "Regex extract" and the date-format guess behind
// "Convert to date" — on the transform-helpers fixture, where every value carries text
// around the part you want ("Preis: 12,99 € netto", "Art.-Nr. 4711", "28.08.2026").
//   - a price field: recipe "Text after …" (Preis:) then a second "Regex extract" with
//     "Text before …" (€) — the helper's own result and the editor's live preview show
//     "12,99 € netto" and then "12,99";
//   - an article number: "Text after …" with "Art.-Nr." (the dot is taken literally);
//   - a date field: choosing "Convert to date" pre-selects {dd}.{mm}.{yyyy} from the
//     picked value and the preview shows 2026-08-28;
//   - Generate really runs the script: the data preview holds 12,99 / 2026-08-28 / 4711
//     for every product — the generated patterns passed the companion's validation and
//     Python's `re`;
//   - the popovers, German/Spanish labels and the panel at 280/320/400 px.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-400-transform-helpers-check.js
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

    const openFieldModal = async (selector, name) => {
      await popup.click('#btn-add-field');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click(`li.product >> nth=0 >> ${selector}`);
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', name);
    };
    const confirmField = async () => {
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);
    };
    const rows = () => popup.locator('#field-transform-list .transform-row');
    const addRow = async (kind) => {
      await popup.click('#btn-field-transform-add');
      const row = rows().last();
      await row.locator('.transform-kind-select').selectOption(kind);
      return rows().last();
    };
    const pick = async (row, recipe, ...texts) => {
      await row.locator('.btn-transform-helper-toggle').click();
      const panel = popup.locator('.transform-helper-panel');
      await panel.locator('.transform-recipe-select').selectOption(recipe);
      for (let i = 0; i < texts.length; i++) await panel.locator('.transform-recipe-arg').nth(i).fill(texts[i]);
      return panel;
    };
    const overallPreview = () => popup.locator('#field-transform-preview').textContent();

    // 1) Price: two recipes in a chain.
    await openFieldModal('.price', 'Preis');
    let row = await addRow('regexExtract');
    let panel = await pick(row, 'textAfter', 'Preis:');
    assert(/Result on your value: 12,99 € netto/.test(await panel.locator('.transform-recipe-preview').textContent()), 'the helper should preview "12,99 € netto" before it is used');
    assert(await popup.locator('.transform-pattern-input').first().inputValue() === '', 'typing in the panel must not touch the pattern yet');
    await panel.locator('.btn-transform-recipe-use').click();
    row = rows().first();
    assert(await row.locator('.transform-pattern-input').inputValue() === 'Preis:\\s*(.+)', `unexpected pattern: ${await row.locator('.transform-pattern-input').inputValue()}`);
    assert(await row.locator('.transform-group-input').inputValue() === '1', 'the group should be 1');
    assert(/12,99 € netto/.test(await overallPreview()), `the live preview should follow: ${await overallPreview()}`);
    row = await addRow('regexExtract');
    panel = await pick(row, 'textBefore', '€');
    await panel.locator('.btn-transform-recipe-use').click();
    assert(/Preview: 12,99$/.test((await overallPreview()).trim()), `the chain should end at 12,99: ${await overallPreview()}`);
    await popup.screenshot({ path: path.join(__dirname, 'issue-400-price-chain.png') });
    await confirmField();
    console.log('price: "Text after …" then "Text before …" → 12,99');

    // 2) Article number: the dot in "Art.-Nr." is literal.
    await openFieldModal('.sku', 'Artikelnummer');
    row = await addRow('regexExtract');
    panel = await pick(row, 'textAfter', 'Art.-Nr.');
    assert(/Result on your value: 4711/.test(await panel.locator('.transform-recipe-preview').textContent()), 'the article number should be 4711');
    await panel.locator('.transform-recipe-arg').first().fill('ArtX-Nr.');
    assert(/No match on your value/.test(await panel.locator('.transform-recipe-preview').textContent()), 'a changed text must not match (the dot is literal)');
    await panel.locator('.transform-recipe-arg').first().fill('Art.-Nr.');
    await panel.locator('.btn-transform-recipe-use').click();
    assert(/Preview: 4711/.test(await overallPreview()), `unexpected preview: ${await overallPreview()}`);
    await confirmField();
    console.log('article number: literal text with a dot');

    // 3) Date: the format is guessed.
    await openFieldModal('.date', 'Datum');
    row = await addRow('toDate');
    assert(await row.locator('.transform-source-format-input').inputValue() === '{dd}.{mm}.{yyyy}', `the format should be guessed, got "${await row.locator('.transform-source-format-input').inputValue()}"`);
    assert(/Format detected from your value: \{dd\}\.\{mm\}\.\{yyyy\}/.test(await row.locator('.transform-date-hint').textContent()), 'the hint should say what was detected');
    assert(/Preview: 2026-08-28/.test(await overallPreview()), `the date should convert: ${await overallPreview()}`);
    await popup.screenshot({ path: path.join(__dirname, 'issue-400-date-guess.png') });
    await confirmField();
    console.log('date: format guessed, preview 2026-08-28');

    // 4) The popovers.
    await openFieldModal('.price', 'Nur zur Ansicht');
    row = await addRow('regexExtract');
    await row.locator('.help-btn').click();
    const helpPanel = popup.locator(`#${await row.locator('.help-btn').getAttribute('aria-controls')}`);
    assert(/pattern is written for you/.test(await helpPanel.locator('.help-popover-text').textContent()), 'the regex popover text');
    assert(/Text after … Price:/.test(await helpPanel.locator('.help-popover-example').textContent()), 'the regex popover example');
    await popup.keyboard.press('Escape');
    row = await addRow('toDate');
    await row.locator('.help-btn').click();
    const dateHelp = popup.locator(`#${await row.locator('.help-btn').getAttribute('aria-controls')}`);
    assert(/\{dd\} is the day/.test(await dateHelp.locator('.help-popover-text').textContent()) && /28\.08\.2026 → \{dd\}/.test(await dateHelp.locator('.help-popover-example').textContent()), 'the date popover text and example');
    await popup.keyboard.press('Escape');

    // 5) Panel width at side-panel sizes (and German / Spanish labels).
    await rows().first().locator('.transform-kind-select').selectOption('regexExtract');
    await rows().first().locator('.btn-transform-helper-toggle').click();
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 1000 });
      const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`width ${width}px: horizontal overflow ${overflow}px`);
      assert(overflow <= (width === 280 ? 44 : width === 320 ? 4 : 0), `the helper panel adds horizontal scrolling at ${width}px (${overflow}px)`);
      await popup.locator('#modal-field-name .modal-inner').screenshot({ path: path.join(__dirname, `issue-400-panel-${width}.png`) });
    }
    await popup.setViewportSize({ width: 420, height: 1000 });
    await popup.click('#btn-field-cancel');
    await waitForIdleScreen(popup);

    // 6) Generate for real.
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    const table = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
    assert(table.length === 3, `expected 3 rows, got ${table.length}: ${JSON.stringify(table)}`);
    assert(JSON.stringify(table[0]) === JSON.stringify(['12,99', '4711', '2026-08-28']), `unexpected first row: ${JSON.stringify(table[0])}`);
    assert(JSON.stringify(table.map((r) => r[0])) === JSON.stringify(['12,99', '8,50', '6,20']), `unexpected prices: ${JSON.stringify(table.map((r) => r[0]))}`);
    assert(JSON.stringify(table.map((r) => r[2])) === JSON.stringify(['2026-08-28', '2026-09-05', '2026-10-19']), 'unexpected dates');
    await popup.screenshot({ path: path.join(__dirname, 'issue-400-done.png') });
    console.log('generate: the generated patterns and the guessed date format ran for real →', JSON.stringify(table[0]));

    // 7) Labels in German and Spanish.
    for (const [language, helperButton, recipeLabel] of [['de', 'Muster-Assistent', 'Text nach …'], ['es', 'Asistente de patrón', 'Texto después de …']]) {
      await popup.evaluate((l) => chrome.storage.local.set({ language: l }), language);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
      await popup.click('#btn-add-field');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('li.product >> nth=0 >> .price');
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.click('#btn-field-transform-add');
      await rows().last().locator('.transform-kind-select').selectOption('regexExtract');
      assert((await rows().last().locator('.btn-transform-helper-toggle').textContent()) === helperButton, `${language}: helper button label`);
      await rows().last().locator('.btn-transform-helper-toggle').click();
      const options = await popup.$$eval('.transform-recipe-select option', (os) => os.map((o) => o.textContent));
      assert(options.includes(recipeLabel), `${language}: recipe label "${recipeLabel}" missing in ${JSON.stringify(options)}`);
      await popup.click('#btn-field-cancel');
      await waitForIdleScreen(popup);
    }
    console.log('german and spanish labels');

    console.log('OK — regex recipes and the date-format guess get a non-programmer to working values.');
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
