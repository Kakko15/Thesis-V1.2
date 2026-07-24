[CmdletBinding()]
param(
    [string]$ApiImage = "thesis-v1-api:latest",
    [string]$WorkerImage = "thesis-v1-worker:latest",
    [string]$FrontendImage = "thesis-v1-frontend:latest",
    [string]$TrivyImage = "aquasec/trivy:0.72.0"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidenceDir = Join-Path $repoRoot "docs\evidence\security\pi-03-$stamp"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

$images = [ordered]@{
    api      = $ApiImage
    worker   = $WorkerImage
    frontend = $FrontendImage
}

$inspect = foreach ($entry in $images.GetEnumerator()) {
    $raw = & docker image inspect $entry.Value 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect $($entry.Value): $raw"
    }
    [pscustomobject]@{
        component = $entry.Key
        image     = $entry.Value
        inspect   = $raw | ConvertFrom-Json
    }
}
$inspect | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 (Join-Path $evidenceDir "image-inspect.json")

$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$trivyVersion = & docker run --rm $TrivyImage version 2>&1
$trivyVersionExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
if ($trivyVersionExitCode -ne 0) {
    throw "Unable to run pinned Trivy image ${TrivyImage}: $trivyVersion"
}
$trivyVersion | Set-Content -Encoding utf8 (Join-Path $evidenceDir "trivy-version.txt")

$results = foreach ($entry in $images.GetEnumerator()) {
    $outputName = "$($entry.Key)-trivy.json"
    $mount = "type=bind,source=$evidenceDir,target=/evidence"
    $scanArguments = @(
        "run", "--rm",
        "--mount", $mount,
        "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
        $TrivyImage, "image",
        "--scanners", "vuln",
        "--severity", "HIGH,CRITICAL",
        "--format", "json",
        "--output", "/evidence/$outputName",
        $entry.Value
    )
    $ErrorActionPreference = "Continue"
    & docker @scanArguments
    $scanExitCode = $LASTEXITCODE
    $ErrorActionPreference = $savedErrorActionPreference
    if ($scanExitCode -ne 0) {
        throw "Trivy failed while scanning $($entry.Value)."
    }

    $report = Get-Content -Raw (Join-Path $evidenceDir $outputName) | ConvertFrom-Json
    $vulnerabilities = @(
        $report.Results |
            ForEach-Object { @($_.Vulnerabilities) } |
            Where-Object { $_ -and $_.Severity -in @("HIGH", "CRITICAL") }
    )

    [pscustomobject]@{
        component = $entry.Key
        image = $entry.Value
        high = @($vulnerabilities | Where-Object Severity -eq "HIGH").Count
        critical = @($vulnerabilities | Where-Object Severity -eq "CRITICAL").Count
        total = $vulnerabilities.Count
        report = $outputName
    }
}

$totalFindings = ($results | Measure-Object -Property total -Sum).Sum
$status = if ($totalFindings -eq 0) { "PASS" } else { "FAIL" }
$summary = @(
    "# PI-03 Container Security Evidence"
    ""
    "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    "- Scanner: $TrivyImage"
    "- Scope: all OS and application vulnerabilities reported as HIGH or CRITICAL"
    "- Unfixed findings ignored: No"
    "- Result: **$status**"
    ""
    "| Component | Image | High | Critical | Total | Report |"
    "|---|---|---:|---:|---:|---|"
)
foreach ($result in $results) {
    $summary += "| $($result.component) | ``$($result.image)`` | $($result.high) | $($result.critical) | $($result.total) | ``$($result.report)`` |"
}
$summary += ""
$summary += "Combined High/Critical findings: **$totalFindings**"
$summary | Set-Content -Encoding utf8 (Join-Path $evidenceDir "SUMMARY.md")

$hashes = Get-ChildItem -File $evidenceDir |
    Where-Object Name -ne "SHA256SUMS.txt" |
    Sort-Object Name |
    Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
$hashes | Set-Content -Encoding ascii (Join-Path $evidenceDir "SHA256SUMS.txt")

Write-Host "Evidence: $evidenceDir"
$results | Format-Table -AutoSize
if ($totalFindings -ne 0) {
    throw "PI-03 verification failed: $totalFindings High/Critical finding(s) remain."
}
Write-Host "PI-03 container security verification passed with zero High/Critical findings."
