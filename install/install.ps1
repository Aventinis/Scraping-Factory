# Issue #346: installs Scraping Factory's companion for the current user
# (Windows) from an unpacked release bundle — copies the companion and the
# extension into %APPDATA%\ScrapingFactory, creates a dedicated Python
# virtual environment with the packages the generated scripts need, records
# that interpreter in the companion's per-user settings file, optionally
# registers a start at every login, and starts the companion now.
#
# Run it from the unpacked bundle:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Autostart] [-BrowserEngine] [-NoExcel] [-NoStart] [-Port N]
#                                                          [-MySql CONNECTION_STRING | -Sqlite]
#   -BrowserEngine  also install Playwright and download Chromium (~150 MB)
#   -NoExcel        skip openpyxl (only needed for the Excel output format)
#   -Autostart      start the companion automatically at login
#   -NoStart        don't start the companion now
#   -Port N         listen on port N instead of 5000 (then enter the address
#                   http://localhost:N once in the extension's error screen)
#   -MySql STRING   keep saved configurations, outputs, blueprints and presets
#                   in a MySQL/MariaDB database instead of local SQLite files,
#                   e.g. "Server=db;Database=scrapingfactory;User ID=sf;Password=..."
#                   (the environment variable SF_MYSQL_CONNECTION_STRING works
#                   too and keeps the password out of the process list)
#   -Sqlite         switch an existing installation back to local SQLite
# Safe to run again: it updates an existing installation in place.
param(
    [switch]$BrowserEngine,
    [switch]$NoExcel,
    [switch]$Autostart,
    [switch]$NoStart,
    [int]$Port = 5000,
    [string]$MySql = $env:SF_MYSQL_CONNECTION_STRING,
    [switch]$Sqlite
)
$ErrorActionPreference = 'Stop'

$Src = $PSScriptRoot
if (-not (Test-Path (Join-Path $Src 'companion\ScrapingFactory.Companion.exe'))) {
    throw 'Run this script from the unpacked bundle (companion\ not found next to it).'
}

$DataDir = Join-Path $env:APPDATA 'ScrapingFactory'
$AppDir = Join-Path $DataDir 'app'
$VenvDir = Join-Path $DataDir 'venv'
$Settings = Join-Path $DataDir 'companion.settings.json'
$Bin = Join-Path $AppDir 'companion\ScrapingFactory.Companion.exe'
$TaskName = 'ScrapingFactoryCompanion'

function Say($text) { Write-Host ""; Write-Host "==> $text" }

# ── Python ────────────────────────────────────────────────────────────────
function Find-Python {
    foreach ($candidate in @(@('py', '-3'), @('python'), @('python3'))) {
        try {
            $exe = $candidate[0]; $extra = @($candidate | Select-Object -Skip 1)
            $path = & $exe @extra -c "import sys; print(sys.executable if sys.version_info >= (3, 9) else '')" 2>$null
            if ($LASTEXITCODE -eq 0 -and $path) { return @{ Exe = $exe; Extra = $extra } }
        } catch { }
    }
    return $null
}
$Python = Find-Python
if (-not $Python) {
    throw 'Python 3.9 or newer is required (the companion runs your generated script once as a trial). Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and run this script again.'
}

# ── Stop a running companion so its files can be replaced ─────────────────
Say 'Stopping a running companion, if any'
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Get-Process -Name 'ScrapingFactory.Companion' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ── Files ─────────────────────────────────────────────────────────────────
Say "Installing into $AppDir"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Copy-Item -Recurse (Join-Path $Src 'companion') $AppDir
Copy-Item -Recurse (Join-Path $Src 'extension') $AppDir
if (Test-Path (Join-Path $Src 'VERSION')) { Copy-Item (Join-Path $Src 'VERSION') $AppDir }
# Downloaded, unsigned files carry a "from the internet" mark that makes
# SmartScreen ask on the first start.
Get-ChildItem -Recurse $AppDir | Unblock-File -ErrorAction SilentlyContinue

# ── Python environment ────────────────────────────────────────────────────
Say "Creating the Python environment ($VenvDir)"
& $Python.Exe @($Python.Extra) -m venv $VenvDir
if ($LASTEXITCODE -ne 0) { throw 'Could not create a virtual environment.' }
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
& $VenvPython -m pip install --quiet --upgrade pip
$Packages = @('requests', 'beautifulsoup4')
if (-not $NoExcel) { $Packages += 'openpyxl' }
if ($BrowserEngine) { $Packages += 'playwright' }
Say ("Installing Python packages: " + ($Packages -join ' '))
& $VenvPython -m pip install --quiet @Packages
if ($LASTEXITCODE -ne 0) { throw 'Installing the Python packages failed.' }
if ($BrowserEngine) {
    Say 'Downloading Chromium for the browser engine'
    & $VenvPython -m playwright install chromium
}

# ── Settings file ─────────────────────────────────────────────────────────
Say "Writing $Settings"
$WriteSettings = @'
import json, os, sys
path, python, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
mysql, back_to_sqlite = os.environ.get("SF_MYSQL", ""), os.environ.get("SF_SQLITE") == "1"
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
# Issue #277: storage backend - only touched when asked for, so re-running the
# installer keeps an earlier -MySql choice.
if mysql:
    data["Companion"]["Storage"] = {"Provider": "MySql", "MySql": {"ConnectionString": mysql}}
elif back_to_sqlite:
    data["Companion"].pop("Storage", None)
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
'@
$env:SF_MYSQL = if ($MySql) { $MySql } else { '' }
$env:SF_SQLITE = if ($Sqlite) { '1' } else { '0' }
$WriteSettings | & $VenvPython - $Settings $VenvPython $Port
Remove-Item Env:\SF_MYSQL, Env:\SF_SQLITE -ErrorAction SilentlyContinue

# ── Autostart / start ─────────────────────────────────────────────────────
if ($Autostart) {
    Say 'Registering a scheduled task (starts at login)'
    $action = New-ScheduledTaskAction -Execute $Bin
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $taskSettings -Force | Out-Null
}

if (-not $NoStart) {
    Say 'Starting the companion'
    if ($Autostart) { Start-ScheduledTask -TaskName $TaskName } else { Start-Process -FilePath $Bin -WindowStyle Hidden }
    $up = $false
    for ($i = 0; $i -lt 30 -and -not $up; $i++) {
        try { Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/health" | Out-Null; $up = $true } catch { Start-Sleep -Seconds 1 }
    }
    if ($up) { Write-Host "The companion is running on http://localhost:$Port" }
    else { Write-Warning "The companion did not answer on port $Port within 30 s." }
}

Write-Host @"

Installed.

Last step - load the extension into your browser (Chrome, Edge or Opera):
  1. Open the extensions page (chrome://extensions, edge://extensions or opera://extensions)
  2. Turn on "Developer mode"
  3. Click "Load unpacked" and choose:
       $AppDir\extension

Start the companion manually any time with:  $Bin
Remove everything again with:                $Src\uninstall.ps1
"@
