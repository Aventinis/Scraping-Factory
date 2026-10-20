// Issue #229: real-browser check of the SQLite / Excel output formats.
//   1) flat mode on the dedup-listing fixture: choose "SQLite database" and
//      "Excel" on the Settings screen — the data preview shows the rows, the
//      filename extension hint follows, and the downloaded file really is a
//      SQLite database / an .xlsx (zip) file, not text;
//   2) container mode on the speisekarte fixture (categories → dishes, set up
//      through the restored session state): the nested result is flattened
//      into one table — one row per dish with its category repeated — and the
//      flatten hint is shown.
//
// Needs `pip install openpyxl` on this machine for the Excel part. Runs its
// own companion on port 5058, so a companion a human already has running on
// the default port is never used or touched.
//
// Usage: node e2e/examples/issue-229-tabular-output-check.js
const fs = require('fs');
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const previewRows = (popupPage) =>
  popupPage.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map(tr => Array.from(tr.cells).map(c => c.textContent)));
const previewColumns = (popupPage) =>
  popupPage.$$eval('#data-preview-table-wrap thead th', (ths) => ths.map(th => th.textContent));

const assertEqual = (label, actual, expected) => {
  console.log(`${label} →`, JSON.stringify(actual));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}`);
};

(async () => {
  const companion = await startCompanion({ port: 5058 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5058 — stop it first.');
  const listing = await startFixture('dedup-listing');
  const menu = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const listingPage = await browser.context.newPage();
    await listingPage.goto(listing.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({
      globalSettings: { includeDataPreview: true, includeOutputFile: true }, companionUrlOverride: 'http://localhost:5058',
    }));
    await popupPage.reload();
    await focusFixture(listingPage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await listingPage.click('li.job >> nth=0 >> .title');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Titel');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    const chooseFormat = async (value) => {
      await popupPage.click('#btn-open-settings');
      await popupPage.selectOption('#select-output-format', value);
      await popupPage.click('#btn-close-settings');
      await waitForIdleScreen(popupPage);
    };

    const generateAndDownload = async (fixturePage) => {
      await focusFixture(fixturePage);
      await popupPage.click('#btn-generate');
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
      const rows = await previewRows(popupPage);
      const columns = await previewColumns(popupPage);
      const [download] = await Promise.all([popupPage.waitForEvent('download'), popupPage.click('#btn-download-output')]);
      const target = path.join(__dirname, `issue-229-${download.suggestedFilename()}`);
      await download.saveAs(target);
      const bytes = fs.readFileSync(target);
      fs.unlinkSync(target);
      await popupPage.click('#btn-back-to-config');
      await waitForIdleScreen(popupPage);
      return { rows, columns, fileName: download.suggestedFilename(), bytes };
    };

    // 1) Flat mode.
    await chooseFormat('sqlite');
    assertEqual('extension hint (SQLite)', await popupPage.textContent('#output-filename-ext'), '.sqlite');
    let run = await generateAndDownload(listingPage);
    assertEqual('SQLite columns', run.columns, ['Titel']);
    assertEqual('SQLite first rows', run.rows.slice(0, 2), [['Entwickler'], ['Tester']]);
    if (!run.fileName.endsWith('.sqlite') || run.bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') {
      throw new Error(`the SQLite download is not a SQLite database (${run.fileName})`);
    }

    await chooseFormat('xlsx');
    assertEqual('extension hint (Excel)', await popupPage.textContent('#output-filename-ext'), '.xlsx');
    run = await generateAndDownload(listingPage);
    assertEqual('Excel first rows', run.rows.slice(0, 2), [['Entwickler'], ['Tester']]);
    if (!run.fileName.endsWith('.xlsx') || run.bytes.subarray(0, 2).toString('latin1') !== 'PK') {
      throw new Error(`the Excel download is not an .xlsx file (${run.fileName})`);
    }

    // 2) Container mode — a nested result flattened into one table.
    const menuPage = await browser.context.newPage();
    await menuPage.goto(menu.url);
    const group = (name, selector, children) => ({ kind: 'group', name, selector, repeating: true, children });
    const field = (name, selector) => ({ kind: 'field', name, selector, mode: 'text', transforms: [] });
    await popupPage.evaluate(async (groups) => {
      await chrome.storage.session.set({ mode: 'container', groups, fields: [] });
    }, [group('Kategorie', '.menu-category', [
      field('Titel', '.category-title'),
      group('Gericht', '.menu-item', [field('Name', '.item-name'), field('Preis', '.item-price')]),
    ])]);
    await popupPage.reload();
    await focusFixture(menuPage);
    await waitForIdleScreen(popupPage);
    if (await popupPage.locator('#output-format-hint').evaluate(el => el.classList.contains('hidden'))) {
      throw new Error('the flatten hint should be shown for a nested configuration written as a table');
    }
    await popupPage.locator('#output-filename-row').screenshot({ path: path.join(__dirname, 'issue-229-tabular-output.png') });

    run = await generateAndDownload(menuPage);
    assertEqual('container columns', run.columns, ['Titel', 'Name', 'Preis']);
    assertEqual('container first row', run.rows[0], ['Vorspeisen', 'Hausgemachte Leberknödelsuppe', '6,90 €']);
    if (new Set(run.rows.map(r => r[0])).size < 2) throw new Error('expected rows from more than one category');

    console.log('OK — flat results written as SQLite/Excel (real binary files), nested results flattened into one table with the category repeated per row.');
  } finally {
    await browser.close();
    await menu.stop();
    await listing.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
