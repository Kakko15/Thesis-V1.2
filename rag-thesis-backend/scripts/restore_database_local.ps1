param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [Parameter(Mandatory=$true)][SecureString]$LocalDatabaseUrl
)
$ErrorActionPreference = 'Stop'
$plainUri = [System.Net.NetworkCredential]::new('', $LocalDatabaseUrl).Password
$parsed = [Uri]$plainUri
if ($parsed.Host -notin @('localhost', '127.0.0.1', 'host.docker.internal')) {
  throw 'Restore rejected: database target must be a disposable local PostgreSQL instance.'
}
$resolved = [System.IO.Path]::GetFullPath($BackupPath)
foreach ($file in @('roles.sql', 'schema.sql', 'data.sql')) {
  if (-not (Test-Path -LiteralPath (Join-Path $resolved $file))) {
    throw "Required backup file is missing: $file"
  }
}
$containerUri = $plainUri.Replace('localhost', 'host.docker.internal').Replace('127.0.0.1', 'host.docker.internal')
$envFile = Join-Path ([System.IO.Path]::GetTempPath()) ("isu-restore-" + [Guid]::NewGuid() + '.env')
try {
  [System.IO.File]::WriteAllText($envFile, "PGURI=$containerUri")
  docker run --rm --env-file $envFile -v "${resolved}:/backup:ro" postgres:17-alpine `
    sh -c 'psql "$PGURI" -v ON_ERROR_STOP=1 -f /backup/roles.sql && psql "$PGURI" -v ON_ERROR_STOP=1 -f /backup/schema.sql && psql "$PGURI" -v ON_ERROR_STOP=1 -f /backup/data.sql && psql "$PGURI" -Atc "select ''papers='' || count(*) from public.papers; select ''chunks='' || count(*) from public.chunks; select ''orphan_chunks='' || count(*) from public.chunks c left join public.papers p on p.id=c.paper_id where p.id is null;"'
  if ($LASTEXITCODE -ne 0) { throw 'Disposable database restore verification failed.' }
} finally {
  Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
}
Write-Host 'Disposable local database restore and relationship checks passed.'
