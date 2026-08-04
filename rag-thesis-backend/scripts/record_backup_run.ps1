# Records a completed backup against the API's operations monitor (§8.1), so a
# nightly task that silently stops firing raises a `backup_stale` alert instead
# of looking identical to a healthy system.
#
# Called automatically by scheduled_backup.ps1 after a successful run. Safe to
# run by hand against an existing backup folder, which is how you seed the first
# record after registering the task.
#
# What is sent: the backup folder's stamp, its completion time, how many
# artifacts it contains, their total size, a digest of the manifest, and an
# opaque machine fingerprint. No paths, no hostnames, no file names -- matching
# how ingestion_workers hashes its worker ids.
param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [string]$BackupId,
  [string]$EnvFile,
  [string]$SupabaseUrl,
  [SecureString]$ServiceRoleKey
)
$ErrorActionPreference = 'Stop'

$backendRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
  $EnvFile = Join-Path $backendRoot '.env'
}
if (-not (Test-Path -LiteralPath $BackupDirectory -PathType Container)) {
  throw "Backup directory not found: $BackupDirectory"
}
if (-not $BackupId) {
  $BackupId = Split-Path -Leaf $BackupDirectory
}

$manifestPath = Join-Path $BackupDirectory 'sha256-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Refusing to record a backup with no sha256 manifest: $manifestPath"
}

function Get-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Backend environment file was not found: $Path"
  }
  $escapedName = [regex]::Escape($Name)
  foreach ($line in Get-Content -LiteralPath $Path) {
    $match = [regex]::Match($line, "^\s*$escapedName\s*=\s*(.*)\s*$")
    if (-not $match.Success) { continue }
    $value = $match.Groups[1].Value.Trim()
    if ($value.Length -ge 2 -and (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    )) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
  }
  return $null
}

if (-not $SupabaseUrl) {
  $SupabaseUrl = Get-DotEnvValue -Path $EnvFile -Name 'SUPABASE_URL'
}
if ($ServiceRoleKey) {
  $plainServiceKey = [System.Net.NetworkCredential]::new('', $ServiceRoleKey).Password
} else {
  $plainServiceKey = Get-DotEnvValue -Path $EnvFile -Name 'SUPABASE_KEY'
}
if (-not $SupabaseUrl -or $SupabaseUrl -notmatch '^https://[^/]+\.supabase\.co/?$') {
  throw 'SUPABASE_URL is missing or invalid in the backend .env file.'
}
if (-not $plainServiceKey -or $plainServiceKey -match '^your-') {
  throw 'SUPABASE_KEY is missing or still contains a placeholder in the backend .env file.'
}

$artifacts = Get-ChildItem -LiteralPath $BackupDirectory -File |
  Where-Object { $_.Name -ne 'sha256-manifest.json' }
if ($artifacts.Count -lt 1) {
  throw "Refusing to record a backup with no artifacts: $BackupDirectory"
}

$manifestItem = Get-Item -LiteralPath $manifestPath
$totalBytes = ($artifacts | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }

# A digest of the manifest identifies the backup without describing its contents.
$manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()

# Opaque and stable per machine: enough to tell two backup hosts apart, not
# enough to identify one.
$fingerprintSource = "$env:COMPUTERNAME|$env:USERDOMAIN"
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $hostFingerprint = ([System.BitConverter]::ToString(
    $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($fingerprintSource))
  ) -replace '-', '').ToLowerInvariant().Substring(0, 16)
} finally {
  $sha.Dispose()
}

$body = @{
  p_backup_id       = $BackupId
  p_completed_at    = $manifestItem.LastWriteTimeUtc.ToString('o')
  p_artifact_count  = [int]$artifacts.Count
  p_total_bytes     = [long]$totalBytes
  p_manifest_sha256 = $manifestHash
  p_host_fingerprint = $hostFingerprint
} | ConvertTo-Json -Compress

$endpoint = ($SupabaseUrl.TrimEnd('/')) + '/rest/v1/rpc/record_backup_run'
try {
  Invoke-RestMethod -Method Post -Uri $endpoint -Body $body -ContentType 'application/json' -Headers @{
    apikey        = $plainServiceKey
    Authorization = "Bearer $plainServiceKey"
  } | Out-Null
  Write-Host "Recorded backup $BackupId ($($artifacts.Count) artifacts, $totalBytes bytes)"
} finally {
  $plainServiceKey = $null
  $body = $null
}
