[CmdletBinding()]
param(
    [string]$RepoRoot,
    [int]$Minutes = 30
)

$ErrorActionPreference = 'Stop'

if ($Minutes -lt 5) {
    throw 'Minutes must be 5 or greater.'
}

# Resolve at runtime. Windows PowerShell can bind param() defaults before
# $PSScriptRoot is populated when scripts are invoked in some ways.
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
        $toolsDir = Split-Path -Parent $PSCommandPath
        $RepoRoot = Split-Path -Parent $toolsDir
    }
    elseif (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $RepoRoot = Split-Path -Parent $PSScriptRoot
    }
    else {
        throw 'Could not determine repository root. Pass -RepoRoot explicitly.'
    }
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$script = Join-Path $RepoRoot 'tools\update-codex-usage.ps1'

if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "Not found: $script"
}

$taskName = 'AI Usage Meter - Codex Update'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskCommand = "`"$powershellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$script`" -RepoRoot `"$RepoRoot`" -Push"

Write-Host "Registering scheduled task..." -ForegroundColor Cyan
Write-Host "  Name : $taskName" -ForegroundColor DarkGray
Write-Host "  Repo : $RepoRoot" -ForegroundColor DarkGray
Write-Host "  Every: $Minutes minutes" -ForegroundColor DarkGray

& schtasks.exe /Create /TN $taskName /TR $taskCommand /SC MINUTE /MO ([string]$Minutes) /F
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create scheduled task (schtasks exit=$LASTEXITCODE)."
}

Write-Host "Scheduled task installed: $taskName (every $Minutes minutes)" -ForegroundColor Green
