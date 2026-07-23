# Secret Rotation Runbook

Never paste secret values into tickets, commits, chat logs, screenshots, or command history. Record the rotation date, owner, and validation result without recording the value.

## Standard sequence

1. Create the replacement secret at the provider.
2. Store it in the approved deployment secret manager.
3. Deploy dependent services one at a time and verify health.
4. Revoke the previous secret only after every dependent service is healthy.
5. Review privacy-safe logs and security events for unexpected failures.

## Secret-specific notes

- **Supabase publishable/anon key:** update the frontend build and API consumers, deploy, then revoke the old key when supported.
- **Supabase service-role key:** update only API, worker, and guarded backup automation. Never place it in frontend variables.
- **Supabase JWT secret:** use Supabase's supported signing-key workflow and its overlap period.
- **Gemini API key:** update API and worker secrets, verify embedding and generation smoke tests, then revoke the old key.
- **Turnstile:** the site key is public; the secret remains in Supabase CAPTCHA settings. Validate every protected auth initiation before revocation.
- **Redis credential:** rotate the URI or ACL password, restart API replicas, then workers, and verify shared rate limiting.
- **Webhook signing secret:** coordinate a dual-secret verification window with the receiver when possible.

## Suspected exposure

Revoke first, rotate all potentially related credentials, invalidate sessions where appropriate, review security audit events, and document scope and remediation. Do not log the exposed value.

