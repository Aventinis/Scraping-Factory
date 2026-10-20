# Issue #346: removes what install.ps1 set up — the scheduled task, the
# running companion, the installed program, the Python environment and the
# companion settings file. Saved configurations, outputs, blueprints and
# presets (the *.db files in the same folder) are kept unless you pass -Purge.
param([switch]$Purge)
$ErrorActionPreference = 'Continue'

$DataDir = Join-Path $env:APPDATA 'ScrapingFactory'
$TaskName = 'ScrapingFactoryCompanion'

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-Process -Name 'ScrapingFactory.Companion' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Remove-Item -Recurse -Force (Join-Path $DataDir 'app'), (Join-Path $DataDir 'venv') -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $DataDir 'companion.settings.json') -ErrorAction SilentlyContinue
if ($Purge) {
    Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue
    Write-Host 'Removed everything, including your saved data.'
} else {
    Write-Host "Removed the installation. Your saved data (in $DataDir) was kept - use -Purge to delete it too."
}
Write-Host "Remember to remove the extension from your browser's extensions page."
