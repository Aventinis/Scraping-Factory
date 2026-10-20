#!/usr/bin/env bash
# Issue #346: removes what install.sh set up — the autostart entry, the
# running companion, the installed program, the Python environment and the
# companion settings file. Saved configurations, outputs, blueprints and
# presets (the *.db files in the same folder) are kept unless you pass --purge.
set -euo pipefail

PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help) echo "Usage: ./uninstall.sh [--purge]   (--purge also deletes your saved data)"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Darwin) DATA_DIR="$HOME/Library/Application Support/ScrapingFactory"; OS=mac ;;
  *)      DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ScrapingFactory"; OS=linux ;;
esac

if [ "$OS" = linux ] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now scraping-factory-companion.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/scraping-factory-companion.service"
  systemctl --user daemon-reload 2>/dev/null || true
fi
if [ "$OS" = mac ]; then
  launchctl unload "$HOME/Library/LaunchAgents/com.scrapingfactory.companion.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.scrapingfactory.companion.plist"
fi
[ -f "$DATA_DIR/companion.pid" ] && kill "$(cat "$DATA_DIR/companion.pid")" 2>/dev/null || true

rm -rf "$DATA_DIR/app" "$DATA_DIR/venv"
rm -f "$DATA_DIR/companion.settings.json" "$DATA_DIR/companion.pid" "$DATA_DIR/companion.log"
if [ "$PURGE" = 1 ]; then
  rm -rf "$DATA_DIR"
  echo "Removed everything, including your saved data."
else
  echo "Removed the installation. Your saved data (in $DATA_DIR) was kept — use --purge to delete it too."
fi
echo "Remember to remove the extension from your browser's extensions page."
