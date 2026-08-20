[CmdletBinding()]
param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$CodexCommand = 'codex',
    [switch]$Push,
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$OutputPath = Join-Path $RepoRoot 'data\usage.json'

function Write-JsonLine {
    param(
        [System.Diagnostics.Process]$Process,
        [hashtable]$Payload
    )

    $json = $Payload | ConvertTo-Json -Compress -Depth 16
    $Process.StandardInput.WriteLine($json)
    $Process.StandardInput.Flush()
}

function Read-ResponseById {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$Id,
        [int]$TimeoutSeconds
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)

    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "Codex App Server exited before response id=$Id (exit=$($Process.ExitCode))"
        }

        $task = $Process.StandardOutput.ReadLineAsync()
        $remaining = [Math]::Max(
            100,
            [int](($deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds)
        )

        if (-not $task.Wait($remaining)) {
            throw "Timed out waiting for Codex App Server response id=$Id"
        }

        $line = $task.Result

        if ($null -eq $line) {
            break
        }

        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        try {
            $message = $line | ConvertFrom-Json
        }
        catch {
            Write-Verbose "Ignoring non-JSON stdout: $line"
            continue
        }

        if ($message.id -eq $Id) {
            if ($message.error) {
                throw "Codex App Server error: $($message.error | ConvertTo-Json -Compress -Depth 8)"
            }

            return $message
        }
    }

    throw "Timed out waiting for Codex App Server response id=$Id"
}

function Convert-RateWindow {
    param($Window)

    if ($null -eq $Window) {
        return $null
    }

    $duration = if ($null -ne $Window.windowDurationMins) {
        [int64]$Window.windowDurationMins
    }
    else {
        $null
    }

    $kind = switch ($duration) {
        300   { 'fiveHour' }
        10080 { 'weekly' }
        default {
            if ($duration) {
                "window_$duration"
            }
            else {
                'unknown'
            }
        }
    }

    $used = if ($null -ne $Window.usedPercent) {
        [double]$Window.usedPercent
    }
    else {
        0.0
    }

    $remaining = [Math]::Max(
        0,
        [Math]::Min(100, 100 - $used)
    )

    $resetIso = $null

    if ($null -ne $Window.resetsAt) {
        $resetIso = [DateTimeOffset]::FromUnixTimeSeconds(
            [int64]$Window.resetsAt
        ).ToString('o')
    }

    return [ordered]@{
        kind = $kind
        windowDurationMins = $duration
        usedPercent = [Math]::Round($used, 2)
        remainingPercent = [Math]::Round($remaining, 2)
        resetsAt = $resetIso
    }
}

function Convert-RateLimitSnapshot {
    param(
        [string]$FallbackLimitId,
        $Snapshot
    )

    if ($null -eq $Snapshot) {
        return $null
    }

    $windows = @()

    foreach ($window in @($Snapshot.primary, $Snapshot.secondary)) {
        $converted = Convert-RateWindow $window

        if ($null -ne $converted) {
            $windows += $converted
        }
    }

    $limitId = if (-not [string]::IsNullOrWhiteSpace([string]$Snapshot.limitId)) {
        [string]$Snapshot.limitId
    }
    else {
        $FallbackLimitId
    }

    $limitName = if (-not [string]::IsNullOrWhiteSpace([string]$Snapshot.limitName)) {
        [string]$Snapshot.limitName
    }
    elseif ($limitId -eq 'codex_bengalfox') {
        'GPT-5.3-Codex-Spark'
    }
    elseif ($limitId -eq 'codex') {
        'Codex'
    }
    else {
        $limitId
    }

    return [ordered]@{
        limitId = $limitId
        limitName = $limitName
        planType = $Snapshot.planType
        windows = $windows
    }
}

function Get-CodexVersion {
    param([string]$Command)

    try {
        $text = & $env:ComSpec /d /s /c "$Command --version" 2>&1
        return (($text | Out-String).Trim())
    }
    catch {
        return 'unknown'
    }
}

$commandText = if (Test-Path -LiteralPath $CodexCommand -ErrorAction SilentlyContinue) {
    "`"$CodexCommand`" app-server --stdio"
}
else {
    "$CodexCommand app-server --stdio"
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $env:ComSpec
$psi.Arguments = "/d /s /c `"$commandText`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables['RUST_LOG'] = 'error'

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi

try {
    $version = Get-CodexVersion $CodexCommand

    Write-Host "Codex: $version" -ForegroundColor DarkGray
    Write-Host 'Reading Codex rate limits...' -ForegroundColor Cyan

    if (-not $process.Start()) {
        throw 'Could not start Codex App Server.'
    }

    Write-JsonLine $process @{
        method = 'initialize'
        id = 1
        params = @{
            clientInfo = @{
                name = 'ai_usage_meter'
                title = 'AI Usage Meter'
                version = '0.4.0'
            }
            capabilities = @{
                experimentalApi = $true
            }
        }
    }

    $null = Read-ResponseById $process 1 $TimeoutSeconds

    Write-JsonLine $process @{
        method = 'initialized'
    }

    Write-JsonLine $process @{
        method = 'account/rateLimits/read'
        id = 2
    }

    $response = Read-ResponseById $process 2 $TimeoutSeconds
    $result = $response.result

    if ($null -eq $result) {
        throw 'Codex returned no rate-limit result.'
    }

    $limits = @()
    $seenIds = @{}

    if ($result.rateLimitsByLimitId) {
        foreach ($property in $result.rateLimitsByLimitId.PSObject.Properties) {
            $converted = Convert-RateLimitSnapshot $property.Name $property.Value

            if ($null -ne $converted) {
                $limits += $converted
                $seenIds[$converted.limitId] = $true
            }
        }
    }

    if ($result.rateLimits) {
        $fallbackId = if (-not [string]::IsNullOrWhiteSpace([string]$result.rateLimits.limitId)) {
            [string]$result.rateLimits.limitId
        }
        else {
            'codex'
        }

        if (-not $seenIds.ContainsKey($fallbackId)) {
            $converted = Convert-RateLimitSnapshot $fallbackId $result.rateLimits

            if ($null -ne $converted) {
                $limits += $converted
                $seenIds[$converted.limitId] = $true
            }
        }
    }

    $codexLimit = $limits | Where-Object {
        $_.limitId -eq 'codex'
    } | Select-Object -First 1

    if ($null -eq $codexLimit) {
        throw 'No general Codex rate-limit snapshot was found.'
    }

    $payload = [ordered]@{
        schemaVersion = 2
        source = 'codex-app-server'
        updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        planType = $codexLimit.planType
        limitId = 'codex'
        windows = $codexLimit.windows
        limits = $limits
    }

    $outputDir = Split-Path -Parent $OutputPath
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

    $payload |
        ConvertTo-Json -Depth 16 |
        Set-Content -LiteralPath $OutputPath -Encoding utf8

    Write-Host "Updated: $OutputPath" -ForegroundColor Green

    foreach ($limit in $limits) {
        foreach ($window in $limit.windows) {
            if ($window.kind -eq 'weekly') {
                Write-Host (
                    "  {0}: weekly remaining {1}%" -f
                    $limit.limitName,
                    $window.remainingPercent
                )
            }
        }
    }

    if ($Push) {
        Push-Location $RepoRoot

        try {
            & git add -- 'data/usage.json'

            if ($LASTEXITCODE -ne 0) {
                throw 'git add failed.'
            }

            & git diff --cached --quiet

            if ($LASTEXITCODE -eq 0) {
                Write-Host 'No usage change to push.' -ForegroundColor Yellow
            }
            else {
                $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'

                & git commit -m "Update Codex usage ($stamp)"

                if ($LASTEXITCODE -ne 0) {
                    throw 'git commit failed.'
                }

                & git push origin main

                if ($LASTEXITCODE -ne 0) {
                    throw 'git push failed.'
                }

                Write-Host 'Pushed usage update to GitHub.' -ForegroundColor Green
            }
        }
        finally {
            Pop-Location
        }
    }
}
catch {
    $original = $_.Exception.Message

    if ($process -and -not $process.HasExited) {
        try {
            $process.Kill()
        }
        catch {}

        try {
            $process.WaitForExit(3000) | Out-Null
        }
        catch {}
    }

    $stderr = ''

    if ($process) {
        try {
            $stderr = $process.StandardError.ReadToEnd().Trim()
        }
        catch {}
    }

    if ($stderr) {
        throw "$original`nCodex App Server stderr:`n$stderr"
    }

    throw
}
finally {
    if ($process -and -not $process.HasExited) {
        try {
            $process.StandardInput.Close()
        }
        catch {}

        try {
            $process.Kill()
        }
        catch {}
    }

    if ($process) {
        $process.Dispose()
    }
}

