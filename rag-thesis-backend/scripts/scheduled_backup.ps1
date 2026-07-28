# Unattended nightly backup wrapper around backup_system.ps1.
#
# One-time operator setup (same Windows account that will run the task):
#   Read-Host 'Backup passphrase' -AsSecureString |
#     ConvertFrom-SecureString |
#     Set-Content -Encoding UTF8 "$HOME\.isu-backup-passphrase.dpapi"
#
# The file is DPAPI-protected: only this user on this machine can decrypt it.
# The plaintext passphrase exists only in this process's environment for the
# duration of the run and is never written to disk or logs.
param(
  [string]$PassphraseFile = (Join-Path $HOME '.isu-backup-passphrase.dpapi'),
  [string]$BackupRoot = (Join-Path $HOME 'Documents\ISU-Thesis-Backups'),
  # 0 keeps every backup. A positive value prunes to the newest N backup
  # folders AFTER a successful run; failed runs never trigger pruning.
  [int]$KeepLast = 0
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path (Join-Path $BackupRoot 'logs') | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
Start-Transcript -Path (Join-Path $BackupRoot "logs\backup-$stamp.log") | Out-Null

try {
  if (-not (Test-Path -LiteralPath $PassphraseFile -PathType Leaf)) {
    throw "Passphrase file not found: $PassphraseFile. See the setup comment at the top of this script."
  }
  $secure = Get-Content -LiteralPath $PassphraseFile | ConvertTo-SecureString
  $env:BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new('', $secure).Password
  try {
    & (Join-Path $PSScriptRoot 'backup_system.ps1') -BackupPath (Join-Path $BackupRoot $stamp)
  } finally {
    Remove-Item Env:BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  }

  $manifest = Join-Path (Join-Path $BackupRoot $stamp) 'sha256-manifest.json'
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw 'Backup finished without a sha256 manifest; treating the run as failed.'
  }

  if ($KeepLast -gt 0) {
    $backups = Get-ChildItem -LiteralPath $BackupRoot -Directory |
      Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}-\d{6}$' } |
      Sort-Object Name -Descending
    $stale = $backups | Select-Object -Skip $KeepLast
    foreach ($old in $stale) {
      Write-Host "Pruning old backup $($old.Name)"
      Remove-Item -LiteralPath $old.FullName -Recurse -Force -Confirm:$false
    }
  }
  Write-Host "Scheduled backup succeeded: $stamp"
} finally {
  Stop-Transcript | Out-Null
}
