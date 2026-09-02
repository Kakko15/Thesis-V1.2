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
# The compose file forces APP_ENVIRONMENT=production on the api service, and the
# production validator in config.py refuses to start without a Redis rate-limit
# store, privileged MFA, ClamAV and a non-zero GUEST_DAILY_TOKEN_BUDGET. None of
# those controls is exercised by the smoke, which only calls Gemini with
# synthetic input, and a development .env legitimately carries none of them; run
# without the override and Settings() raised before the first model call. The
# image, the code and the model set under test are unchanged by the override.
$ErrorActionPreference = 'Continue'
& docker compose -f $composeFile run --rm --no-deps `
    -e APP_ENVIRONMENT=development `
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
# Model names and latencies come from the report, not from constants, so the
# summary cannot disagree with the JSON beside it (the 2026-07-25 summary
# hard-coded an embedding model the report did not record).
$latency = $report.observed.latency_ms
$summary = @(
    '# PI-03 Live Gemini Deployment Smoke',
    '',
    "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    "- Tested release image: ``$imageId``",
    '- Route: direct Google API; the smoke builds its own Gemini clients and never uses LLM_BASE_URL',
    "- Chat: ``$($report.configuration.chat_model)`` - live response received ($($latency.chat) ms)",
    "- Verdict: ``$($report.configuration.verdict_model)`` - live response received ($($latency.verdict) ms)",
    "- Embeddings: ``$($report.configuration.embedding_model)`` - $($report.observed.embedding_dimensions) finite values received ($($latency.embedding) ms)",
    '- Input data: synthetic only',
    '- Response content or credentials retained: No',
    "- Result: **$($report.result)**"
)
# LF and no byte-order mark, matching .gitattributes (eol=lf) so the hashes
# recorded below stay valid for the bytes git stores and checks out.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $evidenceDir 'SUMMARY.md'), (($summary -join "`n") + "`n"), $utf8NoBom)

$hashes = Get-ChildItem -File $evidenceDir |
    Where-Object Name -ne 'SHA256SUMS.txt' |
    Sort-Object Name |
    Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
[System.IO.File]::WriteAllText((Join-Path $evidenceDir 'SHA256SUMS.txt'), (($hashes -join "`n") + "`n"), (New-Object System.Text.ASCIIEncoding))

Write-Host "Evidence: $evidenceDir"
Write-Host 'PI-03 live Gemini deployment verification passed.'
