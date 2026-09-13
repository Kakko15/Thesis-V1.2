# System-defense deck — reproducible build

The 15-slide PowerPoint for the system defense of *A Centralized AI-Powered Thesis Library
Using Retrieval-Augmented Generation* (IskAI) is generated, not hand-made, so every figure on a
slide traces to a file the panel can open. This directory holds the generator; the scratch
inputs and outputs live under the gitignored `tmp/deck/`.

## Why it exists

The defense deck is an evidence instrument. Two rules are enforced by code rather than by
care: the pooled Objective 2 p-value never appears on a slide without the `present` stratum's
p-value beside it (`verify.py`), and no Objective 4 number reaches a slide unless
`evaluation/iso25010_evidence.md` contains it in a dated revalidation block (`evidence.py`
parses the block by regex and raises otherwise). Screenshots are real captures of the running
app; fabricated e2e fixtures are refused by the build unless explicitly allowed for a draft.

## Layout

| File | Role |
|---|---|
| `theme.py` | palette, type, geometry; the validated chart colours and why they differ from the UI accents |
| `fonts.py` | fetches the OFL TTFs once (Montserrat, DM Sans, JetBrains Mono) for matplotlib; Canva maps them natively |
| `evidence.py` | reads `comparison_20260913_064053.json` and the dated ISO 25010 block; self-checks; `assert_quoted` |
| `content.py` | every word and every speaker note, with sources; no geometry, no colour |
| `orb.py` | the landing page's constellation orb (same seeded geometry as `ConstellationOrb.jsx`) rendered as transparent stills at three angles plus a converged ring |
| `charts.py` | forest plot and paired-difference chart at exactly their placed size, so 14 pt stays 14 pt |
| `pptx_helpers.py` | glass cards, chips, tables, block-arc gauges; raw DrawingML for alpha, shadows, picture opacity |
| `xml_post.py` | Morph transitions (`p159:morph`, with the mandatory fallback) and `scene3d` camera presets |
| `build.py` | the fifteen slides; persistent objects named `!!orb`, `!!rail1-4`, `!!obj1-4`, `!!frame1-4`, `!!statement`, `!!ring` so Morph moves them |
| `verify.py` | reopens the deck and proves the rules below; exit 1 on any failure |
| `capture.mjs` | Playwright driver for dark-theme captures at 2560 x 1440; live and fixture modes; `--promote` into `assets/captures/` |
| `export_slides.ps1` | exports every slide to PNG through desktop PowerPoint and prints the transition it reads |
| `assets/captures/` | the promoted captures with `manifest.json` (route, mode, timestamp, commit, sha256) and `archive_state.json` |

## Build

```powershell
uv venv tmp/deck/.venv --python 3.14
uv pip install --python tmp/deck/.venv/Scripts/python.exe -r docs/deck/requirements-deck.txt

tmp/deck/.venv/Scripts/python.exe -m docs.deck.evidence      # prints every figure the deck will quote
tmp/deck/.venv/Scripts/python.exe -m docs.deck.build         # -> tmp/deck/out/IskAI_Defense_Deck.pptx
tmp/deck/.venv/Scripts/python.exe -m docs.deck.verify
powershell -ExecutionPolicy Bypass -File docs/deck/export_slides.ps1   # PNGs + the transition PowerPoint reads
```

`build.py` refuses to run when a capture is missing or is a fixture stand-in; `--allow-missing`
and `--allow-fixture-captures` produce a labelled draft, and `verify.py --draft` tolerates it.
The venv is deliberately separate from `rag-thesis-backend/.venv`, which must stay identical to
the hash lock; nothing here touches `requirements.txt`.

## Captures

Run the app in its dark theme. Guest surfaces need only the API and the frontend; the frontend
must start with the Turnstile site key blank or the composer shows the human check:

```powershell
cd rag-thesis-backend; .\.venv\Scripts\Activate.ps1; python -m uvicorn main:app --port 8000
cd rag-thesis-frontend; $env:VITE_TURNSTILE_SITE_KEY=''; npm run dev
node docs/deck/capture.mjs --mode live                                   # landing, login, three chat states
node docs/deck/capture.mjs --mode live --keys chat_grounded --zoom 0.72 --height 1000   # question + answer + sources in one frame
node docs/deck/capture.mjs --promote landing,chat_grounded,chat_refused,chat_answered
```

Signed-in surfaces need a real session once:

```powershell
node docs/deck/capture.mjs --mode live --login          # a headed browser opens; sign in; the session is saved to tmp/deck/auth-state.json
node docs/deck/capture.mjs --mode live --keys archive,dashboard,admin_overview,admin_upload_history,admin_system,admin_operations
node docs/deck/capture.mjs --mode live --keys novelty --novelty-file <a rehearsed proposal .pdf or .txt>
node docs/deck/capture.mjs --promote archive,novelty
```

The Gemini free tier is per minute; the script pauses between chat captures and the capture
of a real ingestion (`/upload` mid-pipeline) is left manual because it spends quota.
`--mode fixtures` captures the deterministic `:4173` build with fabricated data for layout work
only; those entries are marked `fixture` in the manifest and the final build rejects them.

## Palette validation

Run on 2026-09-14 with the dataviz skill's `validate_palette.js`, `--mode dark`, surface `#111827`:

| Pair | Result |
|---|---|
| UI accents `#34d388`, `#FFC72C` | FAIL lightness band (OKLCH L 0.77 / 0.86 above the 0.48-0.67 dark band): kept for chips, rail and orb, not for chart marks |
| `#14a86e`, `#e66767` (green / red) | FAIL CVD separation, deutan ΔE 4.6; every green/red pair failed (best 5.5) |
| `#14a86e`, `#d95926` (green / dark orange) | PASS all checks, deutan ΔE 8.1, normal 27.4 — the diverging poles |
| `#14a86e`, `#c98500` (green / amber) | PASS all checks, protan ΔE 8.5 — stratum vs emphasised `present` |

Text contrast on `#070B14`: primary 17.9:1, secondary 7.8:1, both accents above 10:1.

## What `verify.py` proves

15 slides; every text run has an explicit size of at least 14 pt; the string `3.222e-05` never
appears on a slide without `0.1257`; every picture blob resolves; speaker notes on every slide;
shape names unique per slide; `!!orb` on slides 1, 14 and 15; the Morph plan applied on slides
2-15 with a fallback and durations between 500 and 1500 ms; no `[CAPTURE]` or `[VERIFY]`
markers; file under 150 MB.

## Two things learned building it

- PowerPoint's Morph element is `p159:morph` (namespace `.../powerpoint/2015/09/main`), not
  `p14:morph`. The `p14` variant is silently dropped and the slide re-saves with no transition;
  confirmed by round-tripping through PowerPoint 365 16.0.20326. The duration stays `p14:dur`.
- The COM entry-effect codes PowerPoint reports for Morph are 3954 (objects), 3955 (words),
  3956 (characters); `export_slides.ps1` prints them by name.

## After the build

Import the `.pptx` into Canva (Upload → open as a design) for Match & Move at 75 % speed and any
3D pieces from the Elements library; Canva drops PowerPoint transitions and `scene3d` cameras on
import, keeps solid-fill alpha and speaker notes, and maps all three fonts natively. Export a PDF
as the no-motion fallback. In desktop PowerPoint, embed the fonts (File → Options → Save) or
install the TTFs from `tmp/deck/fonts/` on the presenting machine.
