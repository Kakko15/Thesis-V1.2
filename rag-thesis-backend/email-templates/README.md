# ISU Thesis AI Library — Email Templates

Production HTML email templates for the project's custom Gmail SMTP sender,
brand-matched to the app's "ISU Material 3 You" design system (emerald + gold,
Plus Jakarta Sans / Inter / JetBrains Mono, 32px glass card, aurora hero).

| File | Purpose |
|---|---|
| `confirm-signup.html` | **Production** — paste into Supabase (see below) |
| `preview.html` | Generated local browser preview with sample values (`893573`); regenerate after editing the production file (not committed) |
| `logo-host.md` | How the logo image is hosted and what to do if it ever 404s |

## Deploy: Confirm signup template

1. Open the Supabase Dashboard → your project → **Authentication → Emails**
   (or **Authentication → Email Templates**) → **Confirm signup**.
2. Replace the entire **Body (HTML)** with the contents of
   [`confirm-signup.html`](confirm-signup.html).
3. Set **Subject** to:

   ```text
   Confirm your ISU Thesis AI Library account
   ```

   Keep the one-time code in the email body so lock-screen notifications and
   mail-routing logs do not expose it.
4. **Save**, then send a real test signup and verify in Gmail web + mobile.

### Template variables used (keep verbatim)

| Variable | Used for |
|---|---|
| `{{ .Token }}` | The 6-digit OTP shown in the code chip. **Required** — the app verifies it with `supabase.auth.verifyOtp({ email, token, type: 'signup' })`. |
| `{{ .ConfirmationURL }}` | De-emphasized one-click fallback button + footer link. |
| `{{ .Email }}` | Shown in the greeting so users can spot a mistyped address. |

The logo is **not** a template variable: it is a hardcoded public Supabase
Storage URL (see `logo-host.md`), so it loads in every mail client regardless
of the project's Site URL.

> Never remove `{{ .Token }}` while the frontend uses the six-box OTP step
> (`VerifyEmailStep.jsx`). Removing it silently breaks signup verification.

## Required Supabase URL configuration

Dashboard → **Authentication → URL Configuration**:

- **Site URL** = the deployed frontend origin (e.g. `https://thesis.your-domain`
  or `http://localhost:5173` in development). `{{ .ConfirmationURL }}` redirects
  here after confirmation.
- **Redirect URLs** must include the same origin.

In **local development** the logo still loads, because it is served from the
public Supabase Storage bucket rather than from `localhost`. The Site URL
setting only affects where `{{ .ConfirmationURL }}` redirects after the
one-click confirm.

## Regenerating the preview

After editing `confirm-signup.html`, regenerate `preview.html` from the repo
root (PowerShell):

```powershell
   $tpl = Get-Content -LiteralPath "rag-thesis-backend\email-templates\confirm-signup.html" -Raw -Encoding UTF8
   $prev = $tpl.Replace('{{ .SiteURL }}', 'https://your-frontend.example')`
            .Replace('{{ .Token }}', '893573')`
            .Replace('{{ .Email }}', 'carlo.gallardo@example.com')`
            .Replace('{{ .ConfirmationURL }}', '#')
Set-Content -LiteralPath "rag-thesis-backend\email-templates\preview.html" -Value $prev -Encoding UTF8
```

Then open the generated `preview.html` in a browser (or screenshot it headlessly).
Replace `<repo-root>` below with the absolute path to this checkout:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu `
  --hide-scrollbars --force-device-scale-factor=1 `
  --screenshot="preview.png" --window-size=720,1100 `
  "file:///<repo-root>/rag-thesis-backend/email-templates/preview.html"
```

## Design notes / known email-client constraints

- **Table layout + inline CSS only**; the `<style>` block carries only
  progressive enhancement (Google Fonts import, mobile media query). Outlook
  (Word renderer) gets the `mso` Arial fallback and a VML roundrect button.
- **Six-digit segmentation**: the template engine outputs `{{ .Token }}` as one
  string and cannot split digits into separate boxes. The in-app six-box look
  is approximated with a bordered chip, JetBrains Mono, and wide
  letter-spacing — the email-safe industry standard.
- **Forced light mode** (`color-scheme: light` + explicit `bgcolor`s) so Gmail /
  Outlook dark-mode auto-inversion cannot wreck the palette.
- **No remote SVG, no CID attachments** — Supabase's template field is a single
  HTML string with no multipart support, so the logo is a hosted PNG.
- The **3D aura** is static layered radial gradients (`#046a38`, `#10b96c`,
  `#f2a900`) matching the app's Aurora/WebGL backdrop; clients without
  gradient support degrade to the solid `#046a38` brand green.
