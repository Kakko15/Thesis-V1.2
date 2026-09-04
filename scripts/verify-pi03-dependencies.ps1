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

# `npm audit --json` answers a registry failure with a valid JSON body that
# carries no `metadata` block -- {"message": "request to ... failed", "error":
# {...}} -- and with the same exit code 1 it uses for real findings. Reading the
# counts out of that payload gives 0 High and 0 Critical, so an unreachable
# advisory endpoint was recorded as a PASS on a tree that had never been
# audited. A response therefore counts only when it actually carries
# `metadata.vulnerabilities`; anything else is a failed audit, retried up to
# three times and then reported as a failure. npm's bulk endpoint timed out
# repeatedly on 2026-09-04, which is how this was found.
$npmReport = Join-Path $evidenceDir "npm-audit.json"
$npmStderr = Join-Path $evidenceDir "npm-audit.stderr.txt"
$npmJson = $null
$npmExit = $null

Push-Location (Join-Path $repoRoot "rag-thesis-frontend")
try {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $npmOutput = & npm.cmd audit --omit=dev --audit-level=high --json `
            --fetch-timeout=45000 --fetch-retries=1 2> $npmStderr
        $npmExit = $LASTEXITCODE
        $npmText = $npmOutput -join [Environment]::NewLine
        # Retained whatever it is: an error payload is evidence of the failure.
        $npmText | Set-Content -Encoding utf8 $npmReport

        $parsed = $null
        if (-not [string]::IsNullOrWhiteSpace($npmText)) {
            try { $parsed = $npmText | ConvertFrom-Json } catch { $parsed = $null }
        }
        if ($null -ne $parsed -and $null -ne $parsed.metadata.vulnerabilities) {
            $npmJson = $parsed
            break
        }

        Write-Warning "npm audit returned no vulnerability report (attempt $attempt/3, exit $npmExit)."
        if ($attempt -lt 3) { Start-Sleep -Seconds 15 }
    }
} finally {
    Pop-Location
}

$ErrorActionPreference = $savedPreference

if (-not (Test-Path $pipReport)) {
    throw "pip-audit did not create its JSON report (exit $pipExit)."
}

$pipJson = Get-Content -Raw $pipReport | ConvertFrom-Json
if ($null -eq $pipJson -or $null -eq $pipJson.dependencies) {
    throw "pip-audit produced no dependency report (exit $pipExit). The Python environment was NOT audited; see $pipReport."
}

if ($null -eq $npmJson) {
    throw "npm audit returned no vulnerability report after 3 attempts (exit $npmExit). The production dependency tree was NOT audited; see $npmReport and $npmStderr."
}

$pipVulnerabilities = @(
    $pipJson.dependencies |
        ForEach-Object { @($_.vulns) } |
        Where-Object { $_ }
)
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
