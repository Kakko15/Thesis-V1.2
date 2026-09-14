# System-defense deck — reproducible build

The 11-slide PowerPoint for the system defense of *A Centralized AI-Powered Thesis Library
Using Retrieval-Augmented Generation* (IskAI) is generated, not hand-made, so every figure on a
slide traces to a file the panel can open. This directory holds the generator; the scratch
inputs and outputs live under the gitignored `tmp/deck/`.

Slides: 1 title · 2 background · 3 objectives · 4 objective 1 · 5 refusal guard · 6 objective 2 ·
7 objective 3 · 8 architecture · 9 objective 4 · 10 Q&A · 11 closing. The limitations and the
live-demo order are spoken from the Q&A slide's notes.

## Why it exists

The defense deck is an evidence instrument. Two rules are enforced by code rather than by care:
the pooled Objective 2 p-value never appears on a slide without the `present` stratum's p-value
beside it (`verify.py`), and no Objective 4 number reaches a slide unless
`evaluation/iso25010_evidence.md` contains it in a dated revalidation block (`evidence.py` parses
the block by regex and raises otherwise). Screenshots are real captures of the running app;
fabricated e2e fixtures are refused by the build unless explicitly allowed for a draft.

Layout is measured, not estimated: `measure.py` wraps every string against the real TrueType
advance widths and stacks measured line heights, so a box that cannot hold its text raises
`Overflow` at build time instead of overlapping on the projector.

## Layout

| File | Role |
|---|---|
| `theme.py` | palette for `DECK_THEME=light` (default) or `dark`, type, geometry; the validated chart colours |
| `measure.py` | text measurement with the deck fonts; the layout engine's ruler |
| `fonts.py` | fetches the OFL TTFs once (Montserrat, DM Sans, JetBrains Mono); Canva maps them natively |
| `evidence.py` | reads `comparison_20260913_064053.json` and the dated ISO 25010 block; self-checks; `assert_quoted` |
| `content.py` | every word and every speaker note, with sources; no geometry, no colour |
| `orb.py` | the landing page's constellation orb (same seeded geometry as `ConstellationOrb.jsx`): three stills, a converged ring, and a 36-frame turntable GIF |
| `charts.py` | forest plot and paired-difference chart at exactly their placed size, so 14 pt stays 14 pt |
| `pptx_helpers.py` | measured text boxes, glass cards, chips, block-arc gauges; raw DrawingML for alpha, shadows, picture opacity |
| `xml_post.py` | Morph transitions (`p159:morph`, with the mandatory fallback), `scene3d` camera presets, and Spin animations |
| `build.py` | the eleven slides, flowed from measured heights; persistent objects named `!!orb`, `!!rail1-4`, `!!obj1-4`, `!!frame1-4`, `!!statement`, `!!ring` so Morph moves them |
| `verify.py` | reopens the deck and proves the rules below; exit 1 on any failure |
| `capture.mjs` | Playwright driver for captures at 2560 x 1440 in the app's light or dark theme; live and fixture modes; `--promote` into `assets/captures/` |
| `export_slides.ps1` | exports every slide to PNG through desktop PowerPoint and prints the transition it reads |
| `assets/captures/` | the promoted captures with `manifest.json` (route, mode, theme, timestamp, commit, sha256) and `archive_state.json` |

## Build

```powershell
uv venv tmp/deck/.venv --python 3.14
uv pip install --python tmp/deck/.venv/Scripts/python.exe -r docs/deck/requirements-deck.txt

tmp/deck/.venv/Scripts/python.exe -m docs.deck.evidence      # prints every figure the deck will quote
tmp/deck/.venv/Scripts/python.exe -m docs.deck.build         # -> tmp/deck/out/IskAI_Defense_Deck.pptx
tmp/deck/.venv/Scripts/python.exe -m docs.deck.verify
powershell -ExecutionPolicy Bypass -File docs/deck/export_slides.ps1   # PNGs + the transition PowerPoint reads
```

`$env:DECK_THEME='dark'` before the build selects the dark palette; renders land in
`tmp/deck/renders/<theme>/`. `build.py` refuses to run when a capture is missing or is a fixture
stand-in; `--allow-missing` and `--allow-fixture-captures` produce a labelled draft, and
`verify.py --draft` tolerates it. The venv is deliberately separate from `rag-thesis-backend/.venv`,
which must stay identical to the hash lock; nothing here touches `requirements.txt`.

## Motion

- **Morph** between every pair of slides (2–11), 500–1500 ms, with the `mc:Fallback` fade that older
  PowerPoint plays. Objects that persist carry the same `!!` name on both slides.
- **Turntable**: slides 1 and 10 carry `orb_turntable.gif`, 36 yaw frames on the slide ground, which
  PowerPoint plays in Slide Show. Slides 2, 3 and 11 spin their orb still with a continuous Spin
  emphasis animation (90 s, 120 s, 60 s per revolution); PowerPoint reports it as effect type 61
  with indefinite repeat.
- Canva import keeps the GIF and the pictures but drops PowerPoint transitions and animations; apply
  Match & Move there by hand.

## Captures

Run the app in its light theme (`--theme dark` for the dark deck). Guest surfaces need only the API
and the frontend; the frontend must start with the Turnstile site key blank or the composer shows
the human check after Send:

```powershell
cd rag-thesis-backend; .\.venv\Scripts\Activate.ps1; python -m uvicorn main:app --port 8000
cd rag-thesis-frontend; $env:VITE_TURNSTILE_SITE_KEY=''; npm run dev -- --port 5174 --strictPort
node docs/deck/capture.mjs --mode live --theme light --base http://localhost:5174 --keys landing,chat_refused,chat_answered
node docs/deck/capture.mjs --mode live --theme light --base http://localhost:5174 --keys chat_grounded --zoom 0.72 --height 1000
node docs/deck/capture.mjs --promote landing,chat_grounded,chat_refused,chat_answered --from live-light
```

A grounded question can land on the grounded fallback; the script detects the notice, keeps that
frame as `chat_fallback.png`, and retries. It also records `/analytics/summary` into
`archive_state.json`, which slide 7 quotes with its read date.

Signed-in surfaces need a real session once:

```powershell
node docs/deck/capture.mjs --mode live --theme light --login          # a headed browser opens; sign in; the session is saved to tmp/deck/auth-state.json
node docs/deck/capture.mjs --mode live --theme light --keys archive,dashboard,admin_overview,admin_upload_history,admin_system,admin_operations
node docs/deck/capture.mjs --mode live --theme light --keys novelty --novelty-file <a rehearsed proposal .pdf or .txt>
node docs/deck/capture.mjs --promote archive,novelty --from live-light
```

`--mode fixtures` captures the deterministic `:4173` build with fabricated data for layout work
only; those entries are marked `fixture` in the manifest and the final build rejects them.

## Palette validation

Run with the dataviz skill's `validate_palette.js` on 2026-09-14:

| Mode, surface | Pair | Result |
|---|---|---|
| dark `#111827` | UI accents `#34d388`, `#FFC72C` | FAIL lightness band (L 0.77 / 0.86): kept for chips, rail and orb, not for chart marks |
| dark `#111827` | `#14a86e`, `#e66767` (green / red) | FAIL CVD separation, deutan ΔE 4.6; every green/red pair failed |
| dark `#111827` | `#14a86e`, `#d95926` (green / dark orange) | PASS, deutan ΔE 8.1 |
| dark `#111827` | `#14a86e`, `#c98500` (green / amber) | PASS, protan ΔE 8.5 |
| light `#ffffff` | `#14a86e`, `#d95926` | PASS, deutan ΔE 8.1, normal 27.4 |
| light `#ffffff` | `#0e8a53`, `#b45309` (green / amber) | WARN CVD 7.4: legal with the bold row label and legend as secondary encoding |

Text contrast: light ground `#F5F7F9` with `#0F172A` 16.6:1, `#5B6472` 5.6:1, `#046A38` 6.3:1,
`#B45309` 4.7:1; dark ground `#070B14` with `#F2F4F7` 17.9:1 and both accents above 10:1.

## What `verify.py` proves

11 slides; every text run has an explicit size of at least 14 pt; the string `3.222e-05` never
appears on a slide without `0.1257`; every picture blob resolves; speaker notes on every slide;
shape names unique per slide; `!!orb` on slides 1, 10 and 11, as a GIF on 1 and 10; Spin on
2, 3 and 11; the Morph plan applied on slides 2–11 with a fallback and durations between 500 and
1500 ms; no `[CAPTURE]` or `[VERIFY]` markers; file under 150 MB.

## Things learned building it

- PowerPoint's Morph element is `p159:morph` (namespace `.../powerpoint/2015/09/main`), not
  `p14:morph`. The `p14` variant is silently dropped and the slide re-saves with no transition;
  confirmed by round-tripping through PowerPoint 365 16.0.20326. The duration stays `p14:dur`.
- COM entry-effect codes for Morph are 3954 (objects), 3955 (words), 3956 (characters); the Spin
  emphasis is effect type 61.
- Character-count estimates of line breaks are wrong for these faces; DM Sans runs about 0.1 in
  per character at 14 pt. Measure with the font files.
- Editing a UTF-8 source with PowerShell's `Set-Content` re-encodes the middle dot, dash and
  section sign; use Python or the Edit tool for files that carry them.

## After the build

Import the `.pptx` into Canva (Upload → open as a design) for Match & Move at 75 % speed and any 3D
pieces from the Elements library; Canva keeps solid-fill alpha, the GIF and speaker notes, maps
all three fonts natively, and drops PowerPoint transitions, animations and `scene3d` cameras.
Export a PDF as the no-motion fallback. In desktop PowerPoint, embed the fonts (File → Options →
Save) or install the TTFs from `tmp/deck/fonts/` on the presenting machine.
