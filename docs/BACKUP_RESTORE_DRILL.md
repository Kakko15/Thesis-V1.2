# Backup and restore drill — declared targets and measured results

An untested backup is a hypothesis. This file is where it becomes evidence.

Everything in §8.1 of the improvements report is now in place *except* the parts
that can only be done by a person on the backup machine. Those are listed at the
bottom as a checklist, in order.

---

## Declared targets

| Target | Value | Where it lives | Meaning |
|---|---|---|---|
| **RPO** — recovery point objective | **24 hours** | `BACKUP_RPO_HOURS` | The most data we accept losing. Also the staleness threshold: when the newest recorded backup is older than this, the operations monitor raises a `backup_stale` critical alert |
| **RTO** — recovery time objective | **4 hours** | `BACKUP_RTO_HOURS` | How long a full restore may take, from decision to a serving system |

These are the pilot commitments proposed in §8.1. They are deliberately modest:
nightly backups on a single machine cannot honestly promise better, and a target
you miss is worse than a target you set conservatively.

`BACKUP_RPO_HOURS` defaults to `0`, which disables the staleness check. Set it to
`24` **after** the nightly task is registered and the first backup is recorded —
otherwise the monitor correctly but uselessly alerts that no backup exists.

`BACKUP_RTO_HOURS` is recorded, not enforced. Nothing in the API can verify a
restore time; the measured figures below are the only evidence.

---

## Measured results

Fill in one row per drill. Run one **before the defense** and quarterly after.

| Date | Backup used | Data restored | Measured RTO | Measured RPO | Result | Notes |
|---|---|---|---|---|---|---|
| _(pending)_ | | | | | | First drill not yet run |

**Measured RTO** is wall-clock from starting the restore to a system answering
`/health` with the restored data present. **Measured RPO** is the age of the
backup at the moment of the simulated failure, i.e. how much data would have been
lost.

Record a failed or partial drill too. A drill that reveals a gap is the drill
doing its job; deleting the row is how a system acquires a backup nobody has
ever restored.

---

## Running a drill

Restore into a **disposable Supabase project**, never over production.

```powershell
# 1. Note the start time, and the age of the backup you are about to restore.
# 2. Restore the database, then storage, into the disposable project.
cd rag-thesis-backend\scripts
.\restore_database_local.ps1 -BackupPath <backup-folder>
.\restore_storage_local.ps1  -BackupPath <backup-folder>

# 3. Point a local API at the disposable project and confirm it serves.
#    Check a real thesis is retrievable, not just that /health returns 200 --
#    an empty database is also healthy.

# 4. Stop the clock. Record both figures in the table above.
```

A rehearsal that should *not* reset the staleness clock:

```powershell
.\scheduled_backup.ps1 -SkipRecording
```

---

## Operator checklist — what is still outstanding

These require the backup machine, a credential, or a human decision, so they were
deliberately not automated.

- [ ] **Create the passphrase file.** One-time, on the account that will run the
      task. The command is in the header comment of `scheduled_backup.ps1`. The
      file is DPAPI-protected: only that user on that machine can decrypt it.
- [ ] **Register the nightly task.**
      `.\register_backup_task.ps1 -Time 02:00 -KeepLast 14`
      Supply the account password when prompted so it runs while logged out;
      without one it registers as logged-in-only and will miss nights.
- [ ] **Seed the first record**, so the staleness alert has a baseline:
      `.\record_backup_run.ps1 -BackupDirectory <newest-backup-folder>`
- [ ] **Set `BACKUP_RPO_HOURS=24`** in the backend `.env` and restart the API.
      Confirm `/maintenance/operations/summary` reports
      `"backup_monitored": true` and `"backup_stale": false`.
- [ ] **Run the first restore drill** and fill in the table above.
- [ ] **Confirm the alert path works.** Easiest honest test: temporarily set
      `BACKUP_RPO_HOURS=1` with a backup older than an hour, confirm the
      `backup_stale` alert appears in `/maintenance/alerts`, then set it back.
      Testing the alarm is part of installing it.

---

## What the system does on its own, once the above is done

- `scheduled_backup.ps1` records every successful run through
  `record_backup_run.ps1`. Recording is best-effort: it never fails a backup that
  already succeeded on disk, it warns instead.
- The operations monitor raises **`backup_stale`** (critical) when the newest
  recorded backup exceeds the RPO, or when no backup has ever been recorded. It
  clears automatically once a fresh backup lands.
- If the operations webhook is configured, that alert is delivered signed over
  HTTPS like any other.
- Nothing sensitive leaves the backup machine: no paths, no hostnames, no file
  names — a stamp, a count, a size, a digest, and an opaque machine fingerprint.
