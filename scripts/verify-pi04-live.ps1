[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repoRoot 'rag-thesis-backend'
$envFile = Join-Path $backend '.env'
$python = Join-Path $backend '.venv\Scripts\python.exe'

function Get-DotEnvValue([string]$Name) {
    $match = Get-Content -LiteralPath $envFile |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
        Select-Object -Last 1
    if (-not $match) { return '' }
    return (($match -split '=', 2)[1].Trim().Trim('"').Trim("'"))
}

if ((Get-DotEnvValue 'ALLOW_DISPOSABLE_SUPABASE_TESTS') -ne '1') {
    throw 'Set ALLOW_DISPOSABLE_SUPABASE_TESTS=1 in rag-thesis-backend/.env first.'
}
$testUrl = Get-DotEnvValue 'TEST_SUPABASE_URL'
$testRef = Get-DotEnvValue 'TEST_SUPABASE_PROJECT_REF'
$testKey = Get-DotEnvValue 'TEST_SUPABASE_SERVICE_ROLE_KEY'
$applicationUrl = Get-DotEnvValue 'SUPABASE_URL'
if (-not $testUrl -or -not $testRef -or -not $testKey) {
    throw 'The disposable Supabase URL, project ref, and service-role key are required.'
}
if ($testUrl -eq $applicationUrl -or -not $testUrl.StartsWith("https://$testRef.supabase.co")) {
    throw 'Disposable-project guard rejected the configured Supabase target.'
}
if (-not (Test-Path -LiteralPath $python)) {
    throw "Python environment not found: $python"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceDir = Join-Path $repoRoot "docs\evidence\pi-04\live-$stamp"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$reportPath = Join-Path $evidenceDir 'catalog-live-smoke.json'

$savedUrl = $env:SUPABASE_URL
$savedKey = $env:SUPABASE_KEY
try {
    $env:SUPABASE_URL = $testUrl
    $env:SUPABASE_KEY = $testKey
    Push-Location $backend
    & $python 'scripts\catalog_live_smoke.py' --output $reportPath
    $smokeExit = $LASTEXITCODE
    Pop-Location
} finally {
    $env:SUPABASE_URL = $savedUrl
    $env:SUPABASE_KEY = $savedKey
    if ((Get-Location).Path -eq $backend) { Pop-Location }
}
if ($smokeExit -ne 0 -or -not (Test-Path -LiteralPath $reportPath)) {
    throw "PI-04 live catalog smoke failed (exit $smokeExit)."
}
$report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
if ($report.result -ne 'PASS') { throw 'PI-04 live catalog report did not pass.' }

@(
    '# PI-04 Live Catalog API Verification',
    '',
    "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    '- Target: authorized disposable Supabase project',
    '- API contract: `2026-07-25`',
    '- Programs: `BSCS`, `BSIT`, `BSDSA`, `BSIS`, `BLIS`',
    '- Specializations: `DM`, `WMAD`, `NETSEC`',
    '- Credentials or database rows retained: No',
    '- Result: **PASS**'
) | Set-Content -Encoding utf8 (Join-Path $evidenceDir 'SUMMARY.md')

$hashes = Get-ChildItem -File $evidenceDir |
    Where-Object Name -ne 'SHA256SUMS.txt' |
    Sort-Object Name |
    Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
$hashes | Set-Content -Encoding ascii (Join-Path $evidenceDir 'SHA256SUMS.txt')

Write-Host "Evidence: $evidenceDir"
Write-Host 'PI-04 live catalog API verification passed.'
