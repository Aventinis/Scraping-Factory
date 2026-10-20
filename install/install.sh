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
#   --browser-engine  also install Playwright and download Chromium (~150 MB)
#   --no-excel        skip openpyxl (only needed for the Excel output format)
#   --autostart       start the companion automatically at login
#   --no-start        don't start the companion now
#   --port N          listen on port N instead of 5000 (then enter the address
#                     http://localhost:N once in the extension's error screen)
# Safe to run again: it updates an existing installation in place.
set -euo pipefail

BROWSER_ENGINE=0; EXCEL=1; AUTOSTART=0; START=1; PORT=5000
while [ $# -gt 0 ]; do
  arg="$1"; shift
  case "$arg" in
    --port) PORT="${1:?--port needs a number}"; shift ;;
    --browser-engine) BROWSER_ENGINE=1 ;;
    --no-excel) EXCEL=0 ;;
    --autostart) AUTOSTART=1 ;;
    --no-start) START=0 ;;
    -h|--help) sed -n 2,21p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
"$VENV_PYTHON" - "$SETTINGS" "$VENV_PYTHON" "$PORT" <<'PY'
import json, os, sys
path, python, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
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
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
PY

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
    if curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1; then UP=1; break; fi
    sleep 1
  done
  [ "${UP:-0}" = 1 ] && echo "The companion is running on http://localhost:$PORT" \
                     || echo "The companion did not answer on port $PORT within 30 s — see $LOG" >&2
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
