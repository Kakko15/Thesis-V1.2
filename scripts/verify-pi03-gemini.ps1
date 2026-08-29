[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'docker-compose.operations.yml'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceDir = Join-Path $repoRoot "docs\evidence\security\pi-03-gemini-$stamp"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

$savedPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& docker compose -f $composeFile build --pull api worker
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $savedPreference
if ($buildExit -ne 0) {
    throw 'Unable to rebuild the API/worker release image containing the smoke runner.'
}

$mount = "${evidenceDir}:/evidence"
$ErrorActionPreference = 'Continue'
& docker compose -f $composeFile run --rm --no-deps `
    -v $mount `
    api python scripts/gemini_release_smoke.py --output /evidence/gemini-smoke.json
$smokeExit = $LASTEXITCODE
$ErrorActionPreference = $savedPreference
if ($smokeExit -ne 0) {
    throw "Live Gemini release smoke failed (exit $smokeExit)."
}

$reportPath = Join-Path $evidenceDir 'gemini-smoke.json'
if (-not (Test-Path $reportPath)) {
    throw 'The release container did not create gemini-smoke.json.'
}
$report = Get-Content -Raw $reportPath | ConvertFrom-Json
$expected = @{
    chat_model = 'gemini-3.6-flash'
    verdict_model = 'gemini-3.5-flash-lite'
    embedding_model = 'models/gemini-embedding-001'
    embedding_dimensions = 768
}
foreach ($key in $expected.Keys) {
    if ($report.configuration.$key -ne $expected[$key]) {
        throw "Unexpected deployed Gemini configuration for ${key}: $($report.configuration.$key)"
    }
}
if ($report.result -ne 'PASS') {
    throw 'Gemini smoke report did not pass every check.'
}

$imageId = & docker image inspect thesis-v1-api:latest --format '{{.Id}}'
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to capture the tested API image ID.'
}
$summary = @(
    '# PI-03 Live Gemini Deployment Smoke',
    '',
    "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    "- Tested release image: ``$imageId``",
    '- Chat: `gemini-3.6-flash` — live response received',
    '- Verdict: `gemini-3.5-flash-lite` — live response received',
    '- Embeddings: `gemini-embedding-001` — 768 finite values received',
    '- Input data: synthetic only',
    '- Response content or credentials retained: No',
    '- Result: **PASS**'
)
$summary | Set-Content -Encoding utf8 (Join-Path $evidenceDir 'SUMMARY.md')

$hashes = Get-ChildItem -File $evidenceDir |
    Where-Object Name -ne 'SHA256SUMS.txt' |
    Sort-Object Name |
    Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
$hashes | Set-Content -Encoding ascii (Join-Path $evidenceDir 'SHA256SUMS.txt')

Write-Host "Evidence: $evidenceDir"
Write-Host 'PI-03 live Gemini deployment verification passed.'
