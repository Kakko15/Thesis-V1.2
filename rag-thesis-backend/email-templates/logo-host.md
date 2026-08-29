# Logo Hosting for Email Templates

Email clients block remote SVG and do not support Supabase template
attachments, so the templates reference a **public PNG**:

```html
<img src="{{ .SiteURL }}/isu-thesis-ai-mark.png" width="84" height="84" alt="ISU Thesis AI Library">
```

## How it works today (chosen option)

The transparent-background PNG is hosted in the project's **public Supabase
Storage bucket** and referenced by a hardcoded public URL:

```text
https://bpxkbeyyxocfvxsxbzgy.supabase.co/storage/v1/object/public/public-assets/isu-thesis-ai-mark.png
```

Why this over `{{ .SiteURL }}`: in local development the Site URL is
`localhost`, which Gmail/Outlook can never reach, and it keeps the email
independent of the frontend's deploy domain. Storage objects on the public
bucket are served over CDN and are reachable from every mail client.

The source file also remains in the repo at
`rag-thesis-frontend/public/isu-thesis-ai-mark.png` (512×512, transparent) —
re-upload it with the service-role key if the artwork ever changes:

```powershell
$key = (Select-String -Path "rag-thesis-backend\.env" -Pattern '^SUPABASE_KEY=(.+)$').Matches[0].Groups[1].Value
$bytes = [System.IO.File]::ReadAllBytes("rag-thesis-frontend\public\isu-thesis-ai-mark.png")
Invoke-RestMethod -Method Post `
  -Uri "https://bpxkbeyyxocfvxsxbzgy.supabase.co/storage/v1/object/public-assets/isu-thesis-ai-mark.png" `
  -Headers @{ Authorization = "Bearer $key"; apikey = $key; "x-upsert" = "true" } `
  -Body $bytes -ContentType "image/png"
```

### If the logo ever 404s in a real email

1. Open the public URL above in a browser — it must return the PNG.
2. If the object was deleted, re-run the upload command above.
3. If you rename the object or bucket, update the `src` in
   `confirm-signup.html`, regenerate `preview.html` (see `README.md`), and
   re-paste the body into Supabase → Authentication → Emails → Confirm signup.

## Fallback behavior (by design)

With images blocked (Gmail default for unknown senders, Outlook desktop, or a
localhost Site URL), recipients see the alt text plus the styled text lockup
`ISU Thesis AI Library / CCSICT · Echague` on the emerald hero — the email
still reads as branded and the code chip is untouched.

## Alternatives (not currently used)

| Option | When to prefer it |
|---|---|
| `{{ .SiteURL }}/isu-thesis-ai-mark.png` | Only after the frontend is deployed to a permanent public domain AND Supabase's Site URL is set to it; breaks in localhost development. |
| Raw GitHub URL | Zero-infra public host, but couples the email to the repo's default branch and leaks the repo path. |
| Own CDN / static host | Best caching control at scale; overkill for the defense deployment. |

Source assets on the maintainer's machine:

```text
C:\Users\Kazuha\Desktop\ISU-Thesis-AI-Library-Logo.png              (512×512, on white)
C:\Users\Kazuha\Desktop\ISU-Thesis-AI-Library-Logo-transparent.png  (512×512, transparent — the file deployed)
```

Regenerate them from the vector source
`rag-thesis-frontend/public/isu-thesis-ai-mark.svg` with headless Chrome:

```powershell
# Transparent
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu `
  --hide-scrollbars --default-background-color=00000000 `
  --screenshot="ISU-Thesis-AI-Library-Logo-transparent.png" --window-size=512,512 `
  "file:///C:/Users/Kazuha/Desktop/Thesis-V1/rag-thesis-frontend/public/isu-thesis-ai-mark.svg"
```
