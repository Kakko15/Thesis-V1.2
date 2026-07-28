# Registers (or updates) the Windows Scheduled Task that runs the nightly
# unattended backup. Run once as the operator account after creating the
# DPAPI passphrase file (see scheduled_backup.ps1 header).
#
# The task runs as the current interactive user because DPAPI decryption of
# the passphrase file requires the same account; keep the operator account
# able to log on on the backup machine.
param(
  [string]$TaskName = 'ISU Thesis Library nightly backup',
  [string]$Time = '02:00',
  [string]$PassphraseFile = (Join-Path $HOME '.isu-backup-passphrase.dpapi'),
  [string]$BackupRoot = (Join-Path $HOME 'Documents\ISU-Thesis-Backups'),
  [int]$KeepLast = 14
)
$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'scheduled_backup.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw "scheduled_backup.ps1 was not found next to this script: $script"
}
if (-not (Test-Path -LiteralPath $PassphraseFile -PathType Leaf)) {
  throw "Create the DPAPI passphrase file first (see scheduled_backup.ps1 header): $PassphraseFile"
}

$arguments = @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"",
  '-PassphraseFile', "`"$PassphraseFile`"",
  '-BackupRoot', "`"$BackupRoot`"",
  '-KeepLast', $KeepLast
) -join ' '

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Encrypted Supabase database + Storage backup (see docs/OPERATIONS_SECURITY_RUNBOOK.md)' -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered for $Time daily."
Write-Host "Validate now with: Start-ScheduledTask -TaskName '$TaskName'; then check the freshness script."
