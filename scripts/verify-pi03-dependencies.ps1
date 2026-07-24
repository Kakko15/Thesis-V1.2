[CmdletBinding()]
param(
    [string]$BackendImage = "thesis-v1-api:latest"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidenceDir = Join-Path $repoRoot "docs\evidence\security\pi-03-dependencies-$stamp"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

$savedPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"

$pipReport = Join-Path $evidenceDir "pip-audit.json"
& docker image inspect $BackendImage *> $null
if ($LASTEXITCODE -ne 0) {
    $ErrorActionPreference = $savedPreference
    throw "Release image not found: $BackendImage. Build or run the Gemini verifier first."
}

# Audit the exact installed Linux release environment. Resolving the production
# requirements on Windows incorrectly attempts to compile Linux-only OCR wheels.
$mount = "${evidenceDir}:/evidence"
$auditCode = @'
import subprocess
import sys

subprocess.check_call([
    sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
    '--no-cache-dir', 'pip-audit==2.10.1',
])
subprocess.check_call([
    sys.executable, '-m', 'pip_audit', '--local', '--format', 'json',
    '--output', '/evidence/pip-audit.json',
])
'@
& docker run --rm --entrypoint python -v $mount $BackendImage -c $auditCode
$pipExit = $LASTEXITCODE

Push-Location (Join-Path $repoRoot "rag-thesis-frontend")
try {
    $npmStderr = Join-Path $evidenceDir "npm-audit.stderr.txt"
    $npmOutput = & npm.cmd audit --omit=dev --audit-level=high --json 2> $npmStderr
    $npmExit = $LASTEXITCODE
    $npmOutput -join [Environment]::NewLine |
        Set-Content -Encoding utf8 (Join-Path $evidenceDir "npm-audit.json")
} finally {
    Pop-Location
}

$ErrorActionPreference = $savedPreference

if (-not (Test-Path $pipReport)) {
    throw "pip-audit did not create its JSON report (exit $pipExit)."
}

$pipJson = Get-Content -Raw $pipReport | ConvertFrom-Json
$pipVulnerabilities = @(
    $pipJson.dependencies |
        ForEach-Object { @($_.vulns) } |
        Where-Object { $_ }
)
$npmJson = Get-Content -Raw (Join-Path $evidenceDir "npm-audit.json") | ConvertFrom-Json
$npmHigh = [int]$npmJson.metadata.vulnerabilities.high
$npmCritical = [int]$npmJson.metadata.vulnerabilities.critical
$npmTotalHighCritical = $npmHigh + $npmCritical
$passed = $pipVulnerabilities.Count -eq 0 -and $npmTotalHighCritical -eq 0

$summary = @(
    "# PI-03 Dependency Audit Evidence"
    ""
    "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    "- Python audit: $($pipVulnerabilities.Count) known vulnerabilities"
    "- npm production audit: $npmHigh High, $npmCritical Critical"
    "- Result: **$(if ($passed) { 'PASS' } else { 'FAIL' })**"
    ""
    "Machine-readable reports: ``pip-audit.json`` and ``npm-audit.json``."
)
$summary | Set-Content -Encoding utf8 (Join-Path $evidenceDir "SUMMARY.md")

$hashes = Get-ChildItem -File $evidenceDir |
    Where-Object Name -ne "SHA256SUMS.txt" |
    Sort-Object Name |
    Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
$hashes | Set-Content -Encoding ascii (Join-Path $evidenceDir "SHA256SUMS.txt")

Write-Host "Evidence: $evidenceDir"
Write-Host "Python vulnerabilities: $($pipVulnerabilities.Count)"
Write-Host "npm High/Critical: $npmHigh/$npmCritical"
if (-not $passed) {
    throw "PI-03 dependency verification failed. Review the machine-readable reports."
}
Write-Host "PI-03 dependency verification passed."
