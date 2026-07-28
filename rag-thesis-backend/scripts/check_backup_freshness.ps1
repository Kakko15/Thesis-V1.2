# Backup staleness check: exits 1 when the newest completed backup (one that
# produced a sha256 manifest) is older than the allowed age, or none exists.
# Wire into monitoring or run manually before maintenance windows.
param(
  [string]$BackupRoot = (Join-Path $HOME 'Documents\ISU-Thesis-Backups'),
  [int]$MaxAgeHours = 48
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
  Write-Host "STALE: backup root does not exist: $BackupRoot"
  exit 1
}

$newest = Get-ChildItem -LiteralPath $BackupRoot -Directory |
  Where-Object {
    $_.Name -match '^\d{4}-\d{2}-\d{2}-\d{6}$' -and
    (Test-Path -LiteralPath (Join-Path $_.FullName 'sha256-manifest.json') -PathType Leaf)
  } |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $newest) {
  Write-Host "STALE: no completed backup (with sha256 manifest) found under $BackupRoot"
  exit 1
}

$manifest = Get-Item -LiteralPath (Join-Path $newest.FullName 'sha256-manifest.json')
$ageHours = [math]::Round(((Get-Date) - $manifest.LastWriteTime).TotalHours, 1)
if ($ageHours -gt $MaxAgeHours) {
  Write-Host "STALE: newest completed backup '$($newest.Name)' is $ageHours hours old (limit $MaxAgeHours)."
  exit 1
}

Write-Host "OK: newest completed backup '$($newest.Name)' is $ageHours hours old (limit $MaxAgeHours)."
exit 0
