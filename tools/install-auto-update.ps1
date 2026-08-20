[CmdletBinding()]
param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [int]$Minutes = 30
)

$ErrorActionPreference = 'Stop'
if ($Minutes -lt 5) { throw 'Minutes must be 5 or greater.' }

$script = Join-Path $RepoRoot 'tools\update-codex-usage.ps1'
if (-not (Test-Path $script)) { throw "Not found: $script" }

$taskName = 'AI Usage Meter - Codex Update'
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`" -RepoRoot `"$RepoRoot`" -Push"

& schtasks.exe /Create /TN $taskName /TR $taskCommand /SC MINUTE /MO $Minutes /F
if ($LASTEXITCODE -ne 0) { throw 'Failed to create scheduled task.' }

Write-Host "Scheduled task installed: $taskName (every $Minutes minutes)" -ForegroundColor Green
