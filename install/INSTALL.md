# Installing Scraping Factory

This bundle contains the **companion** (a small local program that checks and
generates your scripts) and the **browser extension**. You need **Python 3.9 or
newer** on your computer — the companion runs your generated script once as a
trial before handing it to you. Nothing else has to be installed by hand.

## 1. Install the companion

**Linux / macOS**

```bash
./install.sh --autostart
```

**Windows** (PowerShell, in this folder)

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Autostart
```

What it does: copies the companion into your user folder, creates its own
Python environment with the packages your scripts need, remembers that Python
for the companion, starts the companion, and (with `--autostart` /
`-Autostart`) starts it automatically whenever you log in.

Options: `--browser-engine` / `-BrowserEngine` additionally installs Playwright
and Chromium (needed only for pages that must be rendered in a real browser,
~150 MB); `--no-excel` / `-NoExcel` skips the Excel support; `--port N` /
`-Port N` uses another port than 5000 (then enter `http://localhost:N` once in
the extension's error screen); `--no-start` / `-NoStart` doesn't start the
companion now. Running the installer again updates an existing installation.

## 2. Load the extension

The browser does not allow an installer to add an extension silently, so this
step is manual (once):

1. Open the extensions page: `chrome://extensions` (Chrome), `edge://extensions`
   (Edge) or `opera://extensions` (Opera).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder the installer
   printed at the end (inside your user folder, e.g.
   `~/.config/ScrapingFactory/app/extension` on Linux).

Then click the Scraping Factory icon — the side panel opens and reports that it
is connected to the companion.

## Notes

* The programs in this bundle are not code-signed. macOS (Gatekeeper) and Windows
  (SmartScreen) may ask for confirmation on the first start; the installers
  already clear the "downloaded from the internet" mark on the copied files.
* Your saved data (configurations, outputs, blueprints, presets) lives in the
  same user folder as the installation and survives updates and `uninstall`
  (use `--purge` / `-Purge` to delete it as well).
* Uninstall: `./uninstall.sh` or `powershell -ExecutionPolicy Bypass -File .\uninstall.ps1`,
  then remove the extension from the browser's extensions page.
