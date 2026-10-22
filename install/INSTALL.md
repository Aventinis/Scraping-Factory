# Installing Scraping Factory

This bundle contains the **companion** (a small local program that checks and
generates your scripts) and the **browser extension**. You need **Python 3.9 or
newer** on your computer — the companion runs your generated script once as a
trial before handing it to you. Nothing else has to be installed by hand.

The user documentation is in the `docs/` folder of this bundle (start with
`docs/README.md`) and also inside the extension: the **Learn more** links in the
side panel open it in a browser tab, no internet needed.

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

### Optional: store your data in MySQL/MariaDB

By default saved configurations, outputs, Output Blueprints and transform presets
live in local files next to the installation. To keep them in a MySQL or MariaDB
database instead (for example on a shared server several people use), pass the
connection string:

```bash
SF_MYSQL_CONNECTION_STRING="Server=db.example.com;Database=scrapingfactory;User ID=sf;Password=..." ./install.sh
```

(`--mysql "<connection string>"` / `-MySql "<connection string>"` do the same; the
environment variable keeps the password out of the process list.) The tables are
created automatically in the given, already existing database. It is stored in
the companion's settings file (readable only by you); `--sqlite` / `-Sqlite`
switches back. Existing local data is not copied over.

### Optional: personal access keys (several people on one companion)

By default the companion has no login — it is meant for one person on one
machine. When several people share a companion (typically together with the
MySQL option above), switch on authentication so everybody only ever sees their
own saved configurations, outputs, blueprints and presets:

```bash
./install.sh --enable-auth            # Windows: -EnableAuth
~/.config/ScrapingFactory/app/companion/ScrapingFactory.Companion user add alice
```

`user add` prints the user's access key **once**; they enter it in the
extension under **Settings → Access key**. Further commands: `user list`,
`user rotate <name>` (new key, the old one stops working), `user remove <name>`,
and `user adopt <name>` (hands everything saved before authentication was
switched on to that user). `--disable-auth` / `-DisableAuth` switches it off
again.

### Optional: self-service accounts and HTTPS

Instead of handing out keys, let people register themselves — the extension then
shows a **Settings → Account** section with Sign in / Register:

```bash
./install.sh --registration open      # Windows: -Registration open (implies authentication)
```

Passwords must travel encrypted, so a companion that is reachable from other
machines needs a real certificate (the companion refuses to start with plain HTTP
beyond `localhost`):

```bash
SF_TLS_CERT_PASSWORD=... ./install.sh --host 0.0.0.0 --tls-cert /path/cert.pfx
# PEM instead of .pfx:   --tls-cert fullchain.pem --tls-key privkey.pem
```

Users enter `https://your-host:5000` once in the extension's error screen (the
extension only accepts `https://` addresses or `localhost`). Operator commands:
`user set-password <name>` (reset a password), `user disable <name>` /
`user enable <name>`. `--no-tls` / `-NoTls` switches HTTPS off again.

### Optional: email addresses, verification and password reset

With an SMTP server the companion can mail one-time codes, so accounts can have a
verified email address and people can reset a forgotten password themselves:

```bash
SF_SMTP_PASSWORD=... ./install.sh --smtp-host smtp.example.com --smtp-from noreply@example.com \
    --smtp-user noreply@example.com        # Windows: -SmtpHost, -SmtpFrom, -SmtpUser
# optional rules (they need authentication, e.g. together with --registration open):
./install.sh --require-email --require-verified-email --email-domains example.com
```

The SMTP password is read from the environment and stored only in the companion's
settings file (readable only by you). The default is STARTTLS on port 587;
`--smtp-security SslOnConnect` uses implicit TLS (port 465). Unencrypted SMTP is
only accepted for `localhost`. With `--require-verified-email` an account can sign
in but only uses the companion after confirming its address; for accounts created
by the operator, `user set-email <name> <email> [--verified]` and `user verify <name>`
do it from the command line. `--no-email` / `-NoEmail` removes the settings again.

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
