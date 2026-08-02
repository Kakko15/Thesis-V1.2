# Registers (or updates) the Windows Scheduled Task that runs the nightly
# backup. Run once as the operator account after creating the DPAPI passphrase
# file (see scheduled_backup.ps1 header).
#
# Logon type matters here:
#   * Password        - runs while logged out. Windows stores the credential;
#                       the full user profile is loaded, so both the network
#                       (Supabase) and the DPAPI passphrase file are reachable.
#                       This is the only mode that makes the backup unattended.
#   * InteractiveToken - runs ONLY while the operator is logged in. Chosen when
#                       no password is supplied, or with -AllowLoggedInOnly.
#   * S4U             - deliberately unused: it cannot reach network resources
#                       or decrypt DPAPI data, so this backup would fail.
param(
  [string]$TaskName = 'ISU Thesis Library nightly backup',
  [string]$Time = '02:00',
  [string]$PassphraseFile = (Join-Path $HOME '.isu-backup-passphrase.dpapi'),
  [string]$BackupRoot = (Join-Path $HOME 'Documents\ISU-Thesis-Backups'),
  [int]$KeepLast = 14,
  # Windows account password. Supply it (or answer the prompt) to run backups
  # while logged out. Windows keeps it in its own credential store; it is never
  # written to this repository.
  [SecureString]$AccountPassword,
  # Register a logged-in-only task without prompting for a password.
  [switch]$AllowLoggedInOnly
)
$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'scheduled_backup.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw "scheduled_backup.ps1 was not found next to this script: $script"
}
if (-not (Test-Path -LiteralPath $PassphraseFile -PathType Leaf)) {
  throw "Create the DPAPI passphrase file first (see scheduled_backup.ps1 header): $PassphraseFile"
}

$userId = "$env:USERDOMAIN\$env:USERNAME"
if (-not $AccountPassword -and -not $AllowLoggedInOnly) {
  Write-Host "Windows needs the password for $userId to run backups while you are logged out."
  Write-Host 'It is stored by Windows, never by this repository.'
  Write-Host 'Press Enter without typing to register a logged-in-only task instead.'
  $AccountPassword = Read-Host "Password for $userId" -AsSecureString
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

$registerArgs = @{
  TaskName    = $TaskName
  Action      = $action
  Trigger     = $trigger
  Settings    = $settings
  Description = 'Encrypted Supabase database + Storage backup (see docs/OPERATIONS_SECURITY_RUNBOOK.md)'
  Force       = $true
}

$plainPassword = $null
if ($AccountPassword) {
  $plainPassword = [System.Net.NetworkCredential]::new('', $AccountPassword).Password
}

# Read-Host -AsSecureString returns an EMPTY SecureString rather than $null when
# the operator just presses Enter, and any SecureString object is truthy. Decide
# the mode on the decrypted length so a skipped password cannot be mistaken for
# an unattended registration.
$unattended = -not [string]::IsNullOrEmpty($plainPassword)

try {
  if ($unattended) {
    $registerArgs.User = $userId
    $registerArgs.Password = $plainPassword
  } else {
    $registerArgs.Principal = New-ScheduledTaskPrincipal `
      -UserId $userId -LogonType InteractiveToken -RunLevel Limited
  }
  Register-ScheduledTask @registerArgs | Out-Null
} finally {
  $plainPassword = $null
  $registerArgs.Remove('Password')
}

Write-Host "Scheduled task '$TaskName' registered for $Time daily."
Write-Host "Validate now with: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host 'Then confirm freshness with: .\scripts\check_backup_freshness.ps1'
if ($unattended) {
  Write-Host 'Mode: unattended - the backup runs on schedule even when you are logged out.'
  Write-Host 'Re-run this script after any Windows password change, or the task fails silently.'
} else {
  Write-Warning 'Mode: logged-in only - NO password was supplied, so backups will NOT run while this account is logged out. Re-run and supply the password to make them unattended.'
}
