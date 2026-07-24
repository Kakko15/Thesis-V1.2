[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidenceDir = Join-Path $repoRoot "docs\evidence\security\pi-03-multiarch-$stamp"
$scratchRoot = Join-Path ([System.IO.Path]::GetTempPath()) "pi03-multiarch-$stamp"
New-Item -ItemType Directory -Path $evidenceDir, $scratchRoot -Force | Out-Null

function Get-EnvFileValues([string]$Path) {
    $values = @{}
    if (Test-Path $Path) {
        Get-Content $Path | ForEach-Object {
            if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
                $values[$matches[1]] = $matches[2]
            }
        }
    }
    return $values
}

function Read-OciBlob([string]$Layout, [string]$Digest) {
    $algorithm, $hash = $Digest -split ':', 2
    if ($algorithm -ne 'sha256' -or -not $hash) {
        throw "Unsupported OCI digest: $Digest"
    }
    $path = Join-Path $Layout "blobs\sha256\$hash"
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $hash.ToLowerInvariant()) {
        throw "OCI blob digest mismatch for $Digest"
    }
    return Get-Content -Raw $path | ConvertFrom-Json
}

function Find-PlatformManifests([string]$Layout, $Descriptor) {
    if ($Descriptor.platform.os -eq 'linux' -and $Descriptor.platform.architecture -in @('amd64', 'arm64')) {
        return @($Descriptor)
    }
    if ($Descriptor.mediaType -notmatch 'index|manifest.list') {
        return @()
    }
    $document = Read-OciBlob $Layout $Descriptor.digest
    $found = @()
    foreach ($child in @($document.manifests)) {
        $found += Find-PlatformManifests $Layout $child
    }
    return $found
}

function Build-And-Inspect(
    [string]$Name,
    [string]$ImageName,
    [string]$Dockerfile,
    [string]$Context,
    [string[]]$BuildArguments = @()
) {
    $archive = Join-Path $scratchRoot "$Name.oci.tar"
    $metadata = Join-Path $evidenceDir "$Name-build-metadata.json"
    $arguments = @(
        'buildx', 'build', '--pull',
        '--platform', 'linux/amd64,linux/arm64',
        '--provenance=true', '--sbom=true',
        '--tag', "$ImageName`:pi03-$stamp",
        '--metadata-file', $metadata,
        '--output', "type=oci,dest=$archive"
    ) + $BuildArguments + @('-f', $Dockerfile, $Context)

    $buildLog = Join-Path $evidenceDir "$Name-build.log"
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # Display and persist Buildx output without returning thousands of log
    # records from this function into the compact JSON evidence object.
    & docker @arguments 2>&1 | Tee-Object -FilePath $buildLog | Out-Host
    $buildExit = $LASTEXITCODE
    $ErrorActionPreference = $savedPreference
    if ($buildExit -ne 0) {
        $logTail = @(Get-Content -LiteralPath $buildLog -Tail 40 -ErrorAction SilentlyContinue)
        if ($logTail.Count -gt 0) {
            Write-Host "`nLast 40 build-log lines:" -ForegroundColor Yellow
            $logTail | ForEach-Object { Write-Host $_ }
        }
        throw "Multi-architecture build failed for $Name. Full diagnostics: $buildLog"
    }

    $layout = Join-Path $scratchRoot "$Name-layout"
    New-Item -ItemType Directory -Path $layout -Force | Out-Null
    & tar.exe -xf $archive -C $layout
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to extract OCI layout for $Name."
    }

    $rootIndex = Get-Content -Raw (Join-Path $layout 'index.json') | ConvertFrom-Json
    $platforms = @()
    foreach ($descriptor in @($rootIndex.manifests)) {
        $platforms += Find-PlatformManifests $layout $descriptor
    }
    $platforms = @($platforms | Sort-Object { $_.platform.architecture } -Unique)
    foreach ($architecture in @('amd64', 'arm64')) {
        if (-not ($platforms | Where-Object { $_.platform.architecture -eq $architecture })) {
            throw "$Name OCI index is missing linux/$architecture."
        }
    }

    $buildMetadata = Get-Content -Raw $metadata | ConvertFrom-Json
    [pscustomobject]@{
        component = $Name
        image = $ImageName
        index_digest = $buildMetadata.'containerimage.digest'
        platforms = @($platforms | ForEach-Object {
            [pscustomobject]@{
                os = $_.platform.os
                architecture = $_.platform.architecture
                digest = $_.digest
                size = $_.size
            }
        })
    }
}

$releaseEnv = Get-EnvFileValues (Join-Path $repoRoot '.env')
$frontendArgs = @()
foreach ($key in @('PUBLIC_API_ORIGIN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY')) {
    if ($releaseEnv.ContainsKey($key)) {
        $frontendArgs += @('--build-arg', "$key=$($releaseEnv[$key])")
    }
}

try {
    $backend = Build-And-Inspect `
        -Name 'api' `
        -ImageName 'thesis-v1-api' `
        -Dockerfile (Join-Path $repoRoot 'rag-thesis-backend\Dockerfile') `
        -Context (Join-Path $repoRoot 'rag-thesis-backend')
    $frontend = Build-And-Inspect `
        -Name 'frontend' `
        -ImageName 'thesis-v1-frontend' `
        -Dockerfile (Join-Path $repoRoot 'rag-thesis-frontend\Dockerfile') `
        -Context (Join-Path $repoRoot 'rag-thesis-frontend') `
        -BuildArguments $frontendArgs

    $worker = [pscustomobject]@{
        component = 'worker'
        image = 'thesis-v1-worker'
        index_digest = $backend.index_digest
        platforms = $backend.platforms
        shared_image_contract = 'Worker uses the exact backend Dockerfile and image content; only the Compose command differs.'
    }
    $report = [ordered]@{
        schema_version = 1
        generated_at = (Get-Date).ToString('o')
        platforms_required = @('linux/amd64', 'linux/arm64')
        result = 'PASS'
        images = @($backend, $worker, $frontend)
    }
    $report | ConvertTo-Json -Depth 10 |
        Set-Content -Encoding utf8 (Join-Path $evidenceDir 'multiarch-digests.json')

    $summary = @(
        '# PI-03 Multi-Architecture Image Evidence',
        '',
        "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
        '- Platforms: `linux/amd64`, `linux/arm64`',
        '- OCI blob digests independently SHA-256 verified: Yes',
        '- Result: **PASS**',
        '',
        '| Component | OCI index digest | amd64 manifest | arm64 manifest |',
        '|---|---|---|---|'
    )
    foreach ($image in $report.images) {
        $amd64 = ($image.platforms | Where-Object architecture -eq 'amd64').digest
        $arm64 = ($image.platforms | Where-Object architecture -eq 'arm64').digest
        $summary += "| $($image.component) | ``$($image.index_digest)`` | ``$amd64`` | ``$arm64`` |"
    }
    $summary | Set-Content -Encoding utf8 (Join-Path $evidenceDir 'SUMMARY.md')

    $hashes = Get-ChildItem -File $evidenceDir |
        Where-Object Name -ne 'SHA256SUMS.txt' |
        Sort-Object Name |
        Get-FileHash -Algorithm SHA256 |
        ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
    $hashes | Set-Content -Encoding ascii (Join-Path $evidenceDir 'SHA256SUMS.txt')
    Write-Host "Evidence: $evidenceDir"
    Write-Host 'PI-03 amd64/arm64 digest verification passed.'
} finally {
    if (Test-Path $scratchRoot) {
        Remove-Item -LiteralPath $scratchRoot -Recurse -Force
    }
}
