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
#                                                          [-EnableAuth | -DisableAuth] [-Registration open|disabled]
#                                                          [-HostName HOST] [-TlsCert FILE [-TlsKey FILE]] [-NoTls]
#                                                          [-SmtpHost HOST [-SmtpPort N] [-SmtpFrom ADDR] [-SmtpUser NAME]
#                                                           [-SmtpSecurity StartTls|SslOnConnect|None]] [-NoEmail]
#                                                          [-RequireEmail] [-RequireVerifiedEmail] [-EmailDomains a.com,b.org]
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
#   -EnableAuth     require a personal access key for every request (for a
#                   companion several people share); create the users afterwards
#                   with:  <installed companion> user add <name>
#   -DisableAuth    switch authentication off again (the default)
#   -Registration open|disabled
#                   let people create their own account from the extension
#                   (open - implies -EnableAuth) or not (disabled, the default)
#   -HostName HOST  listen on HOST instead of localhost (e.g. 0.0.0.0). The
#                   companion refuses to listen beyond this computer without
#                   HTTPS, because passwords and keys would travel in clear text
#   -TlsCert FILE   serve HTTPS with this certificate (a .pfx, with the password
#                   in SF_TLS_CERT_PASSWORD; or a PEM file plus -TlsKey FILE).
#                   Users then enter https://HOST:PORT in the extension's error screen
#   -NoTls          switch HTTPS off again (the default)
#   -SmtpHost HOST  send mail through this SMTP server, so accounts can have an email
#                   address that is verified with a mailed code and a forgotten
#                   password can be reset by email. Needs -SmtpFrom (the sender
#                   address); the SMTP password goes in SF_SMTP_PASSWORD, never on
#                   the command line. Default security StartTls on port 587.
#   -RequireEmail   people must give an email address when they register
#   -RequireVerifiedEmail
#                   an account can only use the companion once its address is confirmed
#   -EmailDomains   accept only addresses of these domains (comma-separated)
#   -NoEmail        remove the SMTP settings and the email rules again
# Safe to run again: it updates an existing installation in place.
param(
    [switch]$BrowserEngine,
    [switch]$NoExcel,
    [switch]$Autostart,
    [switch]$NoStart,
    [int]$Port = 5000,
    [string]$MySql = $env:SF_MYSQL_CONNECTION_STRING,
    [switch]$Sqlite,
    [switch]$EnableAuth,
    [switch]$DisableAuth,
    [string]$Registration = '',
    [string]$HostName = '',
    [string]$TlsCert = '',
    [string]$TlsKey = '',
    [switch]$NoTls,
    [string]$SmtpHost = '',
    [int]$SmtpPort = 0,
    [string]$SmtpFrom = '',
    [string]$SmtpUser = '',
    [string]$SmtpSecurity = '',
    [switch]$RequireEmail,
    [switch]$RequireVerifiedEmail,
    [string]$EmailDomains = '',
    [switch]$NoEmail
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
auth = os.environ.get("SF_AUTH", "")
registration = os.environ.get("SF_REGISTRATION", "").lower()
host, tls_cert, tls_key = os.environ.get("SF_HOST", ""), os.environ.get("SF_TLS_CERT", ""), os.environ.get("SF_TLS_KEY", "")
no_tls, tls_password = os.environ.get("SF_NO_TLS") == "1", os.environ.get("SF_TLS_CERT_PASSWORD", "")
if registration not in ("", "open", "disabled"):
    sys.exit("-Registration must be open or disabled")
# Issue #353: email addresses, verification and password reset by mail.
smtp_host, smtp_from = os.environ.get("SF_SMTP_HOST", ""), os.environ.get("SF_SMTP_FROM", "")
smtp_port, smtp_user = os.environ.get("SF_SMTP_PORT", ""), os.environ.get("SF_SMTP_USER", "")
smtp_security, smtp_password = os.environ.get("SF_SMTP_SECURITY", ""), os.environ.get("SF_SMTP_PASSWORD", "")
require_email, require_verified = os.environ.get("SF_REQUIRE_EMAIL") == "1", os.environ.get("SF_REQUIRE_VERIFIED") == "1"
email_domains, no_email = os.environ.get("SF_EMAIL_DOMAINS", ""), os.environ.get("SF_NO_EMAIL") == "1"
if smtp_security and smtp_security.lower() not in ("starttls", "sslonconnect", "none"):
    sys.exit("-SmtpSecurity must be StartTls, SslOnConnect or None")
if registration == "open" and auth == "off":
    sys.exit("-Registration open needs authentication; drop -DisableAuth")
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
# Issue #278: per-user authentication - likewise only touched when asked for.
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
    sys.exit("-RequireEmail/-RequireVerifiedEmail/-EmailDomains need authentication: add -EnableAuth or -Registration open")
if require_verified and not data["Companion"].get("Email", {}).get("Smtp", {}).get("Host"):
    sys.exit("-RequireVerifiedEmail needs an SMTP server: add -SmtpHost")
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
'@
$env:SF_MYSQL = if ($MySql) { $MySql } else { '' }
$env:SF_SQLITE = if ($Sqlite) { '1' } else { '0' }
$env:SF_AUTH = if ($EnableAuth) { 'on' } elseif ($DisableAuth) { 'off' } else { '' }
$env:SF_REGISTRATION = $Registration
$env:SF_HOST = $HostName
$env:SF_TLS_CERT = $TlsCert
$env:SF_TLS_KEY = $TlsKey
$env:SF_NO_TLS = if ($NoTls) { '1' } else { '0' }
$env:SF_SMTP_HOST = $SmtpHost
$env:SF_SMTP_PORT = if ($SmtpPort -gt 0) { "$SmtpPort" } else { '' }
$env:SF_SMTP_FROM = $SmtpFrom
$env:SF_SMTP_USER = $SmtpUser
$env:SF_SMTP_SECURITY = $SmtpSecurity
$env:SF_REQUIRE_EMAIL = if ($RequireEmail) { '1' } else { '0' }
$env:SF_REQUIRE_VERIFIED = if ($RequireVerifiedEmail) { '1' } else { '0' }
$env:SF_EMAIL_DOMAINS = $EmailDomains
$env:SF_NO_EMAIL = if ($NoEmail) { '1' } else { '0' }
$WriteSettings | & $VenvPython - $Settings $VenvPython $Port
Remove-Item Env:\SF_MYSQL, Env:\SF_SQLITE, Env:\SF_AUTH, Env:\SF_REGISTRATION, Env:\SF_HOST, Env:\SF_TLS_CERT, Env:\SF_TLS_KEY, Env:\SF_NO_TLS, Env:\SF_SMTP_HOST, Env:\SF_SMTP_PORT, Env:\SF_SMTP_FROM, Env:\SF_SMTP_USER, Env:\SF_SMTP_SECURITY, Env:\SF_REQUIRE_EMAIL, Env:\SF_REQUIRE_VERIFIED, Env:\SF_EMAIL_DOMAINS, Env:\SF_NO_EMAIL -ErrorAction SilentlyContinue

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
    # HTTPS when the settings file now has a certificate (it is made for the
    # public name, not "localhost", hence the certificate check is skipped here).
    $Scheme = if ((Test-Path $Settings) -and (Select-String -Path $Settings -Pattern '"Certificate"' -Quiet)) { 'https' } else { 'http' }
    $Probe = @{ UseBasicParsing = $true }
    if ($Scheme -eq 'https' -and (Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipCertificateCheck')) { $Probe.SkipCertificateCheck = $true }
    for ($i = 0; $i -lt 30 -and -not $up; $i++) {
        try { Invoke-WebRequest @Probe "${Scheme}://localhost:$Port/health" | Out-Null; $up = $true } catch { Start-Sleep -Seconds 1 }
    }
    if ($up) { Write-Host "The companion is running on ${Scheme}://localhost:$Port" }
    else { Write-Warning "The companion did not answer on port $Port within 30 s." }
}

if ($EnableAuth) {
    Write-Host ""
    Write-Host "Authentication is ON. Create a user (prints their access key once) with:"
    Write-Host "  $Bin user add <name>"
    Write-Host "and give existing data to someone with:  $Bin user adopt <name>"
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
