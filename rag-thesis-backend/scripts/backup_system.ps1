param(
  [string]$BackupPath,
  [string]$EnvFile,
  [string]$SupabaseUrl,
  [SecureString]$ServiceRoleKey
)
$ErrorActionPreference = 'Stop'

$backendRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $backendRoot
if (-not $EnvFile) {
  $EnvFile = Join-Path $backendRoot '.env'
}
if (-not $BackupPath) {
  $stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
  $BackupPath = Join-Path $HOME "Documents\ISU-Thesis-Backups\$stamp"
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
if (-not $ServiceRoleKey) {
  $plainServiceKey = Get-DotEnvValue -Path $EnvFile -Name 'SUPABASE_KEY'
} else {
  $plainServiceKey = [System.Net.NetworkCredential]::new('', $ServiceRoleKey).Password
}
if (-not $SupabaseUrl -or $SupabaseUrl -notmatch '^https://[^/]+\.supabase\.co/?$') {
  throw 'SUPABASE_URL is missing or invalid in the backend .env file.'
}
if (-not $plainServiceKey -or $plainServiceKey -match '^your-') {
  throw 'SUPABASE_KEY is missing or still contains a placeholder in the backend .env file.'
}

$resolved = [System.IO.Path]::GetFullPath($BackupPath)
New-Item -ItemType Directory -Force -Path $resolved | Out-Null

Push-Location $repositoryRoot
try {
  npx.cmd supabase db dump -f "$resolved\roles.sql" --role-only
  if ($LASTEXITCODE -ne 0) { throw 'Supabase role backup failed.' }
  npx.cmd supabase db dump -f "$resolved\schema.sql"
  if ($LASTEXITCODE -ne 0) { throw 'Supabase schema backup failed.' }
  npx.cmd supabase db dump -f "$resolved\data.sql" --use-copy --data-only `
    -x "storage.buckets_vectors" -x "storage.vector_indexes"
  if ($LASTEXITCODE -ne 0) { throw 'Supabase data backup failed.' }
} finally {
  Pop-Location
}

$pythonPath = Join-Path $backendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
  $pythonPath = 'python'
}
$env:SUPABASE_BACKUP_KEY = $plainServiceKey
try {
  & $pythonPath "$PSScriptRoot\storage_backup.py" backup --url $SupabaseUrl `
    --output "$resolved\storage.isubackup"
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted Storage backup failed.' }
} finally {
  Remove-Item Env:SUPABASE_BACKUP_KEY -ErrorAction SilentlyContinue
  $plainServiceKey = $null
}

$files = Get-ChildItem -LiteralPath $resolved -File
$summary = $files | ForEach-Object {
  [ordered]@{
    kind = if ($_.Extension -eq '.sql') { 'database_dump' } else { 'encrypted_storage_artifact' }
    bytes = $_.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
  }
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 "$resolved\sha256-manifest.json"
Write-Host "Backup completed and hashed at $resolved"
