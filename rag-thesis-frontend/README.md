# ISU Thesis AI Library — Frontend

React and Vite client for the CCSICT thesis archive, grounded RAG chat, novelty screening, manuscript ingestion, and role-scoped administration.

## Architecture

- `src/pages`: route-level screens. Routes and the three Admin tabs are lazy-loaded.
- `src/components`: reusable interface, layout, and optional Three.js scene components.
- `src/context`: authentication, profile, feature-permission, and appearance state.
- `src/pages/archive`: archive query/filter hook plus pure filtering helpers.
- `src/pages/upload`: upload reducer and deterministic polling guards.
- `src/testing` and `e2e`: fail-closed local fixtures and Playwright critical flows.
- `src/api.js`: the only browser-facing backend transport layer.

Decorative Three.js scenes load only after capability, preference, viewport, visibility, and browser-idle checks. Reduced-motion and low-effects users retain the complete application without downloading or rendering desktop-only thesis cards.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- The FastAPI backend running on `http://127.0.0.1:8000` for normal development

## Environment

Create `.env.local` and provide values for these names. Never commit the file or paste secrets into issues or test reports.

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=
```

`VITE_API_URL` is optional in local development because Vite proxies supported API paths to port 8000. Only the public Supabase anon key belongs in the browser; never use a service-role key here.

## Development commands

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run preview
```

Install and run the isolated Chromium E2E suite with:

```powershell
npm.cmd run test:e2e:install
npm.cmd run test:e2e
```

## Roles and protected routes

- Guest Researcher: guest chat only; CCSICT scope; no saved conversations or full-text access.
- Student: dashboard, archive, and saved chat within the profile department.
- Faculty: student access plus novelty screening.
- Administrator: department-scoped upload and administration.
- Superadmin: validated cross-department administration.

`/dashboard`, `/archive`, `/novelty`, `/upload`, and `/admin` are protected by the profile and feature-permission checks in `ProtectedRoute`. `/chat` also permits the constrained guest experience. The backend remains authoritative for permissions and department isolation.

## E2E isolation

Playwright starts Vite in `e2e` mode. That mode injects deterministic local auth/API fixtures and a fail-closed `/__e2e_api` guard. An unexpected request fails instead of reaching Supabase, storage, the backend, or Gemini. Never replace these fixtures with live credentials.

The critical suite covers protected-route redirects, grounded guest chat and refresh recovery, API retry behavior, legacy-safe archive rendering, faculty novelty metrics, and the administrator upload journey.

## Production build and deployment

Run `npm.cmd run build` and deploy the generated `dist` directory. Configure the host to serve `index.html` for unknown browser routes so hard refreshes on `/chat`, `/upload`, and other React routes do not return 404. Configure the production backend URL and CORS origin explicitly.

## Troubleshooting

- Backend unavailable or repeated connection errors: start FastAPI on port 8000 and confirm `/health` returns 200.
- A hard refresh returns JSON/404: enable the SPA history fallback in the web host; Vite already handles this locally.
- Login returns to the sign-in page: verify the Supabase URL/anon key, profile status, department, and role.
- Archive is empty: confirm the backend points to the intended Supabase project and the paper has a ready active index.
- WebGL warning or blank decoration: the application intentionally falls back to the Aurora background after context loss, reduced motion, low effects, unsupported WebGL, or a small viewport.
- E2E reports an unmocked request: add an explicit route fixture; do not weaken the fail-closed guard.
