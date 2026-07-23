param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [Parameter(Mandatory=$true)][string]$LocalSupabaseUrl,
  [Parameter(Mandatory=$true)][SecureString]$LocalServiceRoleKey
)
$ErrorActionPreference = 'Stop'
$uri = [Uri]$LocalSupabaseUrl
if ($uri.Host -notin @('localhost', '127.0.0.1', 'host.docker.internal')) {
  throw 'Restore rejected: LocalSupabaseUrl must point to a disposable local Supabase instance.'
}
$archive = Join-Path ([System.IO.Path]::GetFullPath($BackupPath)) 'storage.isubackup'
$backendRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $backendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
  $pythonPath = 'python'
}
& $pythonPath "$PSScriptRoot\storage_backup.py" verify --input $archive
if ($LASTEXITCODE -ne 0) { throw 'Encrypted Storage backup verification failed.' }
$env:SUPABASE_BACKUP_KEY = [System.Net.NetworkCredential]::new('', $LocalServiceRoleKey).Password
try {
  & $pythonPath "$PSScriptRoot\storage_backup.py" restore-local --url $LocalSupabaseUrl --input $archive
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted Storage restore failed.' }
} finally {
  Remove-Item Env:SUPABASE_BACKUP_KEY -ErrorAction SilentlyContinue
}
Write-Host 'Encrypted Storage restore completed against the guarded local target.'
