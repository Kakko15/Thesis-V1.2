# Operations and Security Runbook

## Deployment processes

Production requires continuously running frontend, FastAPI, ingestion worker, and ClamAV components. Redis backs shared rate limits. Start the portable stack with:

```powershell
docker compose -f docker-compose.operations.yml up -d --build
```

The worker is a long-running service. An idle worker polls safely and is not stuck. Uploads remain queued if no healthy worker is running. Local development may run the API and worker separately:

```powershell
cd rag-thesis-backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload --port 8000
python -m workers.ingestion_worker
```

Set `MALWARE_SCAN_MODE=disabled` only for explicit local development. Production configuration validation rejects disabled malware scanning.

## Migration and rollback boundary

`migrations/20260724_operations_security.sql` is additive. Back up the database and Storage before applying it. Validate it in disposable Supabase first, then apply it during an authorized maintenance window. Application processes can be rolled back independently; do not delete the additive tables during an incident.

## Monitoring and cancellation

- `/health/worker` exposes only `healthy` or `degraded`.
- Superadmins use the Operations tab for queue depth, stale workers, retries, delayed cleanup, and alerts.
- Upload owners can cancel their active jobs; superadmins can cancel any job.
- Processing stops only at a safe checkpoint. Final commit locks the job and rejects pending cancellation.
- Alert webhooks are optional. Configure both webhook settings; payloads are HMAC-SHA256 signed.

## Retention

The dry-run report is safe immediately. Automatic enforcement remains disabled until institutional approval. The apply request is rejected unless `RETENTION_ENFORCEMENT_ENABLED=true`. Active papers, chunks, and originals are never removed. Failed and cancelled staging objects enter recoverable cleanup. Jobs are retained 30 days, job events and resolved alerts 90 days, security events one year, and open alerts until resolved.

## Backup

Run from the backend directory after the Supabase CLI is logged in and linked. The script automatically reads `SUPABASE_URL` and `SUPABASE_KEY` from the backend `.env`, creates a timestamped folder, and prompts only for the storage encryption passphrase:

```powershell
.\scripts\backup_system.ps1
```

Optional `-BackupPath`, `-EnvFile`, `-SupabaseUrl`, and `-ServiceRoleKey` overrides remain available for controlled recovery workflows. The script creates database dumps, an AES-256-GCM encrypted backup of `pdfs` and `avatars`, and filename-free SHA-256 reports. The passphrase is never written to disk. Store it in an approved password manager.

## Scheduled unattended backups

One-time setup as the operator account that stays able to log on to the backup machine (DPAPI binds the passphrase file to that user and machine):

```powershell
# 1. Store the backup passphrase, DPAPI-protected (12+ characters; keep a copy in the approved password manager)
Read-Host 'Backup passphrase' -AsSecureString |
  ConvertFrom-SecureString |
  Set-Content -Encoding UTF8 "$HOME\.isu-backup-passphrase.dpapi"

# 2. Confirm the Supabase CLI is logged in and linked, then register the nightly task (02:00, keeps newest 14)
cd rag-thesis-backend
.\scripts\register_backup_task.ps1

# 3. Validate immediately
Start-ScheduledTask -TaskName 'ISU Thesis Library nightly backup'
.\scripts\check_backup_freshness.ps1
```

`scripts\scheduled_backup.ps1` wraps `backup_system.ps1`: the passphrase reaches only the process environment (`BACKUP_PASSPHRASE`, already supported by `storage_backup.py`), transcripts go to `ISU-Thesis-Backups\logs\`, pruning to the newest N runs happens only after a successful run, and a run without a `sha256-manifest.json` is treated as failed. `scripts\check_backup_freshness.ps1` exits non-zero when the newest completed backup is older than 48 hours — wire it into monitoring or run it before maintenance windows. Restore procedures are unchanged (next section).

## Disposable restore drill

Never restore into production. Start disposable local Supabase, restore the database using its local PostgreSQL URI, then restore Storage using its local service-role key:

```powershell
$db = Read-Host 'Disposable local PostgreSQL URI' -AsSecureString
.\scripts\restore_database_local.ps1 -BackupPath 'C:\path\to\backup' -LocalDatabaseUrl $db

$localKey = Read-Host 'Disposable local service-role key' -AsSecureString
.\scripts\restore_storage_local.ps1 -BackupPath 'C:\path\to\backup' `
  -LocalSupabaseUrl 'http://127.0.0.1:54321' -LocalServiceRoleKey $localKey
```

Both scripts reject non-local targets. Verify private bucket access and one retrieval fixture manually, record the results, then explicitly stop and delete the disposable stack.

## Security header validation

After an HTTPS deployment:

```powershell
cd rag-thesis-frontend
npm run security:headers -- https://your-deployment.example
```

This is deployment verification; repository tests do not prove the public host is configured correctly.
