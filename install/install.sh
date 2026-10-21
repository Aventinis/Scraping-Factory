#!/usr/bin/env bash
# Issue #346: installs Scraping Factory's companion for the current user
# (Linux and macOS) from an unpacked release bundle:
#   - copies the companion and the extension into the per-user data directory,
#   - creates a dedicated Python virtual environment with the packages the
#     generated scripts need (requests, beautifulsoup4, openpyxl; optionally
#     playwright + Chromium for the browser engine),
#   - records that interpreter in the companion's per-user settings file,
#   - optionally starts the companion at every login, and starts it now.
#
# Usage: ./install.sh [--browser-engine] [--no-excel] [--autostart] [--no-start] [--port N]
#                     [--mysql CONNECTION_STRING | --sqlite]
#                     [--enable-auth | --disable-auth] [--registration open|disabled]
#                     [--host HOST] [--tls-cert FILE [--tls-key FILE]] [--no-tls]
#                     [--smtp-host HOST [--smtp-port N] [--smtp-from ADDR] [--smtp-user NAME]
#                      [--smtp-security StartTls|SslOnConnect|None]] [--no-email]
#                     [--require-email] [--require-verified-email] [--email-domains a.com,b.org]
#   --browser-engine  also install Playwright and download Chromium (~150 MB)
#   --no-excel        skip openpyxl (only needed for the Excel output format)
#   --autostart       start the companion automatically at login
#   --no-start        don't start the companion now
#   --port N          listen on port N instead of 5000 (then enter the address
#                     http://localhost:N once in the extension's error screen)
#   --mysql STRING    keep saved configurations, outputs, blueprints and
#                     presets in a MySQL/MariaDB database instead of local
#                     SQLite files, e.g. "Server=db;Database=scrapingfactory;
#                     User ID=sf;Password=..." (the environment variable
#                     SF_MYSQL_CONNECTION_STRING works too and keeps the
#                     password out of the process list)
#   --sqlite          switch an existing installation back to local SQLite
#   --enable-auth     require a personal access key for every request (for a
#                     companion several people share); create the users
#                     afterwards with:  <installed companion> user add <name>
#   --disable-auth    switch authentication off again (the default)
#   --registration open|disabled
#                     let people create their own account from the extension
#                     (open — implies --enable-auth) or not (disabled, the default)
#   --host HOST       listen on HOST instead of localhost (e.g. 0.0.0.0). The
#                     companion refuses to listen beyond this computer without
#                     HTTPS, because passwords and keys would travel in clear text
#   --tls-cert FILE   serve HTTPS with this certificate (a .pfx, with the
#                     password in SF_TLS_CERT_PASSWORD; or a PEM file plus
#                     --tls-key FILE). Users then enter https://HOST:PORT in the
#                     extension's error screen
#   --no-tls          switch HTTPS off again (the default)
#   --smtp-host HOST  send mail through this SMTP server, so accounts can have an email
#                     address that is verified with a mailed code and a forgotten
#                     password can be reset by email. Needs --smtp-from (the sender
#                     address); the SMTP password goes in SF_SMTP_PASSWORD, never on
#                     the command line. Default security StartTls on port 587.
#   --require-email   people must give an email address when they register
#   --require-verified-email
#                     an account can only use the companion once its address is confirmed
#   --email-domains   accept only addresses of these domains (comma-separated)
#   --no-email        remove the SMTP settings and the email rules again
# Safe to run again: it updates an existing installation in place.
set -euo pipefail

BROWSER_ENGINE=0; EXCEL=1; AUTOSTART=0; START=1; PORT=5000; MYSQL="${SF_MYSQL_CONNECTION_STRING:-}"; SQLITE=0; AUTH=""; REGISTRATION=""; HOST=""; TLS_CERT=""; TLS_KEY=""; NO_TLS=0; SMTP_HOST=""; SMTP_PORT=""; SMTP_FROM=""; SMTP_USER=""; SMTP_SECURITY=""; REQUIRE_EMAIL=0; REQUIRE_VERIFIED=0; EMAIL_DOMAINS=""; NO_EMAIL=0
while [ $# -gt 0 ]; do
  arg="$1"; shift
  case "$arg" in
    --port) PORT="${1:?--port needs a number}"; shift ;;
    --mysql) MYSQL="${1:?--mysql needs a connection string}"; shift ;;
    --sqlite) SQLITE=1 ;;
    --enable-auth) AUTH=on ;;
    --disable-auth) AUTH=off ;;
    --registration) REGISTRATION="${1:?--registration needs open or disabled}"; shift ;;
    --host) HOST="${1:?--host needs an address}"; shift ;;
    --tls-cert) TLS_CERT="${1:?--tls-cert needs a file}"; shift ;;
    --tls-key) TLS_KEY="${1:?--tls-key needs a file}"; shift ;;
    --no-tls) NO_TLS=1 ;;
    --smtp-host) SMTP_HOST="${1:?--smtp-host needs a host}"; shift ;;
    --smtp-port) SMTP_PORT="${1:?--smtp-port needs a number}"; shift ;;
    --smtp-from) SMTP_FROM="${1:?--smtp-from needs an address}"; shift ;;
    --smtp-user) SMTP_USER="${1:?--smtp-user needs a name}"; shift ;;
    --smtp-security) SMTP_SECURITY="${1:?--smtp-security needs StartTls, SslOnConnect or None}"; shift ;;
    --require-email) REQUIRE_EMAIL=1 ;;
    --require-verified-email) REQUIRE_VERIFIED=1 ;;
    --email-domains) EMAIL_DOMAINS="${1:?--email-domains needs a comma-separated list}"; shift ;;
    --no-email) NO_EMAIL=1 ;;
    --browser-engine) BROWSER_ENGINE=1 ;;
    --no-excel) EXCEL=0 ;;
    --autostart) AUTOSTART=1 ;;
    --no-start) START=0 ;;
    -h|--help) sed -n 2,64p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -x "$SRC/companion/ScrapingFactory.Companion" ] || { echo "Run this script from the unpacked bundle (companion/ not found next to it)." >&2; exit 1; }

# The same per-user directory the companion's own SQLite stores and settings
# file live in (.NET's ApplicationData folder).
case "$(uname -s)" in
  Darwin) DATA_DIR="$HOME/Library/Application Support/ScrapingFactory"; OS=mac ;;
  *)      DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ScrapingFactory"; OS=linux ;;
esac
APP_DIR="$DATA_DIR/app"
VENV_DIR="$DATA_DIR/venv"
SETTINGS="$DATA_DIR/companion.settings.json"
LOG="$DATA_DIR/companion.log"
BIN="$APP_DIR/companion/ScrapingFactory.Companion"

say() { printf '\n==> %s\n' "$*"; }

# ── Python ────────────────────────────────────────────────────────────────
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PYTHON="$(command -v "$candidate")"; break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "Python 3.9 or newer is required (the companion runs your generated script once as a trial)." >&2
  [ "$OS" = mac ] && echo "Install it from https://www.python.org/downloads/ or with: brew install python" >&2 \
                  || echo "Install it with your package manager, e.g.: sudo apt install python3 python3-venv" >&2
  exit 1
fi

# ── Stop a running companion so its files can be replaced ─────────────────
say "Stopping a running companion, if any"
if [ "$OS" = linux ] && command -v systemctl >/dev/null 2>&1; then systemctl --user stop scraping-factory-companion.service 2>/dev/null || true; fi
if [ "$OS" = mac ]; then launchctl unload "$HOME/Library/LaunchAgents/com.scrapingfactory.companion.plist" 2>/dev/null || true; fi
[ -f "$DATA_DIR/companion.pid" ] && kill "$(cat "$DATA_DIR/companion.pid")" 2>/dev/null || true
rm -f "$DATA_DIR/companion.pid"

# ── Files ─────────────────────────────────────────────────────────────────
say "Installing into $APP_DIR"
mkdir -p "$DATA_DIR"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp -R "$SRC/companion" "$SRC/extension" "$APP_DIR/"
[ -f "$SRC/VERSION" ] && cp "$SRC/VERSION" "$APP_DIR/"
chmod +x "$BIN"
# macOS marks downloaded, unsigned programs as quarantined — without this the
# first start is blocked by Gatekeeper.
[ "$OS" = mac ] && xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true

# ── Python environment ────────────────────────────────────────────────────
say "Creating the Python environment ($VENV_DIR)"
if ! "$PYTHON" -m venv "$VENV_DIR" 2>/dev/null; then
  echo "Could not create a virtual environment." >&2
  [ "$OS" = linux ] && echo "On Debian/Ubuntu: sudo apt install python3-venv" >&2
  exit 1
fi
VENV_PYTHON="$VENV_DIR/bin/python"
"$VENV_PYTHON" -m pip install --quiet --upgrade pip
PACKAGES="requests beautifulsoup4"
[ "$EXCEL" = 1 ] && PACKAGES="$PACKAGES openpyxl"
[ "$BROWSER_ENGINE" = 1 ] && PACKAGES="$PACKAGES playwright"
say "Installing Python packages: $PACKAGES"
# shellcheck disable=SC2086
"$VENV_PYTHON" -m pip install --quiet $PACKAGES
if [ "$BROWSER_ENGINE" = 1 ]; then
  say "Downloading Chromium for the browser engine"
  "$VENV_PYTHON" -m playwright install chromium
fi

# ── Settings file ─────────────────────────────────────────────────────────
say "Writing $SETTINGS"
SF_MYSQL="$MYSQL" SF_SQLITE="$SQLITE" SF_AUTH="$AUTH" SF_REGISTRATION="$REGISTRATION" SF_HOST="$HOST" SF_TLS_CERT="$TLS_CERT" SF_TLS_KEY="$TLS_KEY" SF_NO_TLS="$NO_TLS" SF_SMTP_HOST="$SMTP_HOST" SF_SMTP_PORT="$SMTP_PORT" SF_SMTP_FROM="$SMTP_FROM" SF_SMTP_USER="$SMTP_USER" SF_SMTP_SECURITY="$SMTP_SECURITY" SF_REQUIRE_EMAIL="$REQUIRE_EMAIL" SF_REQUIRE_VERIFIED="$REQUIRE_VERIFIED" SF_EMAIL_DOMAINS="$EMAIL_DOMAINS" SF_NO_EMAIL="$NO_EMAIL" "$VENV_PYTHON" - "$SETTINGS" "$VENV_PYTHON" "$PORT" <<'PY'
import json, os, sys
path, python, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
mysql, back_to_sqlite = os.environ.get("SF_MYSQL", ""), os.environ.get("SF_SQLITE") == "1"
auth = os.environ.get("SF_AUTH", "")
registration = os.environ.get("SF_REGISTRATION", "").lower()
host, tls_cert, tls_key = os.environ.get("SF_HOST", ""), os.environ.get("SF_TLS_CERT", ""), os.environ.get("SF_TLS_KEY", "")
no_tls, tls_password = os.environ.get("SF_NO_TLS") == "1", os.environ.get("SF_TLS_CERT_PASSWORD", "")
if registration not in ("", "open", "disabled"):
    sys.exit("--registration must be open or disabled")
# Issue #353: email addresses, verification and password reset by mail.
smtp_host, smtp_from = os.environ.get("SF_SMTP_HOST", ""), os.environ.get("SF_SMTP_FROM", "")
smtp_port, smtp_user = os.environ.get("SF_SMTP_PORT", ""), os.environ.get("SF_SMTP_USER", "")
smtp_security, smtp_password = os.environ.get("SF_SMTP_SECURITY", ""), os.environ.get("SF_SMTP_PASSWORD", "")
require_email, require_verified = os.environ.get("SF_REQUIRE_EMAIL") == "1", os.environ.get("SF_REQUIRE_VERIFIED") == "1"
email_domains, no_email = os.environ.get("SF_EMAIL_DOMAINS", ""), os.environ.get("SF_NO_EMAIL") == "1"
if smtp_security and smtp_security.lower() not in ("starttls", "sslonconnect", "none"):
    sys.exit("--smtp-security must be StartTls, SslOnConnect or None")
if registration == "open" and auth == "off":
    sys.exit("--registration open needs authentication; drop --disable-auth")
data = {}
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except ValueError:
        data = {}
data.setdefault("Companion", {})["PythonExecutable"] = python
if port != 5000:
    data["Companion"]["Port"] = port
else:
    data["Companion"].pop("Port", None)
# Issue #277: storage backend — only touched when asked for, so re-running the
# installer keeps an earlier --mysql choice.
if mysql:
    data["Companion"]["Storage"] = {"Provider": "MySql", "MySql": {"ConnectionString": mysql}}
elif back_to_sqlite:
    data["Companion"].pop("Storage", None)
# Issue #278: per-user authentication — likewise only touched when asked for.
if auth == "on":
    data["Companion"]["Auth"] = {"Enabled": True}
elif auth == "off":
    data["Companion"].pop("Auth", None)
# Issue #352: self-service accounts (needs authentication on) and HTTPS.
if registration == "open":
    data["Companion"]["Auth"] = {**data["Companion"].get("Auth", {}), "Enabled": True, "Registration": "Open"}
elif registration == "disabled" and "Auth" in data["Companion"]:
    data["Companion"]["Auth"].pop("Registration", None)
if host:
    data["Companion"]["Host"] = host
if tls_cert:
    tls = {"Mode": "Certificate", "CertificatePath": tls_cert}
    if tls_key:
        tls["CertificateKeyPath"] = tls_key
    if tls_password:
        tls["CertificatePassword"] = tls_password
    data["Companion"]["Tls"] = tls
elif no_tls:
    data["Companion"].pop("Tls", None)
if smtp_host:
    smtp = data["Companion"].setdefault("Email", {}).setdefault("Smtp", {})
    smtp["Host"] = smtp_host
    if smtp_from: smtp["From"] = smtp_from
    if smtp_port: smtp["Port"] = int(smtp_port)
    if smtp_user: smtp["Username"] = smtp_user
    if smtp_password: smtp["Password"] = smtp_password
    if smtp_security: smtp["Security"] = smtp_security
rules = data["Companion"].setdefault("Auth", {}).setdefault("Email", {})
if require_email: rules["Required"] = True
if require_verified: rules["RequireVerified"] = True
if email_domains: rules["AllowedDomains"] = [d.strip() for d in email_domains.split(",") if d.strip()]
if not rules: data["Companion"]["Auth"].pop("Email")
if not data["Companion"]["Auth"]: data["Companion"].pop("Auth")
if no_email:
    data["Companion"].pop("Email", None)
    if "Auth" in data["Companion"]:
        data["Companion"]["Auth"].pop("Email", None)
        if not data["Companion"]["Auth"]: data["Companion"].pop("Auth")
if (require_email or require_verified or email_domains) and not data["Companion"].get("Auth", {}).get("Enabled"):
    sys.exit("--require-email/--require-verified-email/--email-domains need authentication: add --enable-auth or --registration open")
if require_verified and not data["Companion"].get("Email", {}).get("Smtp", {}).get("Host"):
    sys.exit("--require-verified-email needs an SMTP server: add --smtp-host")
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
PY
chmod 600 "$SETTINGS"

# ── Autostart / start ─────────────────────────────────────────────────────
if [ "$AUTOSTART" = 1 ]; then
  if [ "$OS" = linux ]; then
    if command -v systemctl >/dev/null 2>&1; then
      say "Registering a systemd user service (starts at login)"
      mkdir -p "$HOME/.config/systemd/user"
      cat > "$HOME/.config/systemd/user/scraping-factory-companion.service" <<UNIT
[Unit]
Description=Scraping Factory companion

[Service]
ExecStart=$BIN
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
      systemctl --user daemon-reload
      systemctl --user enable scraping-factory-companion.service
    else
      echo "systemctl not found — skipping autostart (start the companion yourself: $BIN)" >&2
      AUTOSTART=0
    fi
  else
    say "Registering a LaunchAgent (starts at login)"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$HOME/Library/LaunchAgents/com.scrapingfactory.companion.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.scrapingfactory.companion</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
  fi
fi

# The scheme the health check uses: HTTPS when the settings file now has a certificate.
SCHEME=http
grep -q '"Certificate"' "$SETTINGS" 2>/dev/null && SCHEME=https

if [ "$START" = 1 ]; then
  say "Starting the companion"
  if [ "$AUTOSTART" = 1 ] && [ "$OS" = linux ]; then
    systemctl --user start scraping-factory-companion.service
  elif [ "$AUTOSTART" = 1 ] && [ "$OS" = mac ]; then
    launchctl load "$HOME/Library/LaunchAgents/com.scrapingfactory.companion.plist"
  else
    nohup "$BIN" >"$LOG" 2>&1 &
    echo $! > "$DATA_DIR/companion.pid"
  fi
  for _ in $(seq 1 30); do
    # -k: with HTTPS the certificate is made for the public name, not "localhost".
    if curl -fsk "$SCHEME://localhost:$PORT/health" >/dev/null 2>&1; then UP=1; break; fi
    sleep 1
  done
  [ "${UP:-0}" = 1 ] && echo "The companion is running on $SCHEME://localhost:$PORT" \
                     || echo "The companion did not answer on port $PORT within 30 s — see $LOG" >&2
fi

if [ "$AUTH" = on ]; then
  printf '\nAuthentication is ON. Create a user (prints their access key once) with:\n  %s user add <name>\nand give existing data to someone with:  %s user adopt <name>\n' "$BIN" "$BIN"
fi

cat <<DONE

Installed.

Last step — load the extension into your browser (Chrome, Edge or Opera):
  1. Open the extensions page (chrome://extensions, edge://extensions or opera://extensions)
  2. Turn on "Developer mode"
  3. Click "Load unpacked" and choose:
       $APP_DIR/extension

Start the companion manually any time with:  $BIN
Remove everything again with:                $SRC/uninstall.sh
DONE
