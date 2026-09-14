# System defense — run of show

The one sheet to hold while presenting. It is deliberately thin: timings, who speaks, the exact
demo keystrokes, and the sentence to say when something degrades. The *reasoning* behind every
claim lives in `docs/DEFENSE_WALKTHROUGH.md`; the numbers live in
`rag-thesis-backend/evaluation/iso25010_evidence.md`. Nothing here introduces a figure that those
two files do not already carry.

Deck: `tmp/deck/out/IskAI_Defense_Deck.pptx` (11 slides, light theme). Every slide's spoken script
is in its PowerPoint speaker notes, and also in `tmp/deck/out/notes.json`.
Printed packet: `tmp/defense/Chapter1_Defense_Packet.pdf` (13 pages).

---

## Pre-flight — start 60 minutes before

Order matters: ClamAV before the API, the API before the worker, the worker before the frontend.

```powershell
docker start isu-clamav
cd rag-thesis-backend; .\.venv\Scripts\Activate.ps1; python -m uvicorn main:app --port 8000
cd rag-thesis-backend; .\.venv\Scripts\Activate.ps1; python -m workers.ingestion_worker
cd rag-thesis-frontend; npm run dev              # :5173
```

- [ ] `curl.exe -s http://localhost:8000/health` → `"status":"ok"`, database `ok`
- [ ] `curl.exe -s http://localhost:8000/ready` → 200
- [ ] `curl.exe -s http://localhost:8000/health/worker` → the worker is alive
- [ ] `curl.exe -s http://localhost:8000/analytics/summary` → **read the paper count out loud to
      each other**. It is the one number on slide 7 that moves, and the archive has been growing.
      On 2026-09-14 it read 16 papers, 4 tracks, 2024–2026, over 433 chunks, all filed under
      CCSICT. Quote whatever it says on the day.
- [ ] Two archive facts to have ready, because both invite a question:
      **the sixteenth paper is your own thesis**, indexed with a null year, so never demo a
      question about it; and the twelve-manuscript corpus in the paper is the *frozen Objective 2
      corpus*, not the live archive. Different sets, on purpose.
- [ ] **Sign-in works. Verify this first; it is the most likely way to lose the demo.**
      Diagnosed 2026-09-14, and the fix is *not* the one an earlier draft of this file claimed:

      **Supabase Auth has CAPTCHA protection enabled**, so the password grant is rejected
      outright when no Turnstile token accompanies it. Probed directly against
      `/auth/v1/token?grant_type=password`:

      ```
      400 {"error_code":"captcha_failed",
           "msg":"captcha protection: request disallowed (no captcha_token found)"}
      ```

      That means **blanking `VITE_TURNSTILE_SITE_KEY` does not enable login — it guarantees
      failure**, because then no token is ever sent. Blanking the key only suppresses the
      *guest-chat* human check, which is all `docs/deck/README.md` ever claimed for it.

      With the key set, the widget loads but never solves on this machine: the challenge
      iframe appears, `cf-turnstile-response` stays empty, and
      `brunhild.challenges.cloudflare.com` fails with `ERR_NAME_NOT_RESOLVED`. `nslookup`
      times out on Cloudflare challenge hosts here, so this is **local DNS**, not the
      hostname-authorization problem `vite.config.js:70` warns about.

      Two working fixes — **pick one and test it before the defense, not on stage**:

      1. *Remove the dependency.* Supabase Dashboard → Authentication → Attack Protection →
         turn CAPTCHA off. Login then succeeds with the key blank, and the login path stops
         needing the internet at all. Safest on an unknown venue network. Re-enable afterwards.
      2. *Make DNS work.* Point the presenting machine at a resolver that answers for
         `*.challenges.cloudflare.com` (1.1.1.1 or 8.8.8.8), keep the key set, and confirm
         `cf-turnstile-response` is non-empty before you trust it. Keeps protection on, but
         leaves a live third-party call in your login path.

      Guest chat and beats 1–4 of the demo are unaffected either way. Beats 5–7 — novelty,
      archive, admin — need a session, so they stand or fall on this checkbox.
- [ ] **Rehearse, then rest the quota for a full minute.** Free-tier limits are per-minute; a
      morning of testing makes the first demo question return the capacity notice.
- [ ] Deck open in desktop PowerPoint with the fonts embedded or the TTFs from `tmp/deck/fonts/`
      installed on the presenting machine. Export the PDF fallback before you leave.
- [ ] The novelty-scan input file on the desktop, already rehearsed once end to end.
- [ ] Printed: the Chapter 1 packet, one copy per panelist plus one for the adviser.
- [ ] Recommendation form and defense rubric — **the professor brings these.** Confirm the morning
      of, and bring pens.

## Roles

A suggested split; swap freely, but decide before you walk in rather than on stage.

| Segment | Speaker |
|---|---|
| Slides 1–5 — problem, objectives, the retrieval model, the refusal guard | Barlis |
| Slides 6–9 — the comparison, the system, architecture, ISO 25010 | Gallardo |
| Slides 10–11 — limitations, thanks | both, whoever is holding the clicker |
| Live demo | one drives the mouse and stays quiet; the other narrates |

The driver never narrates. Watching someone talk while they hunt for a menu is what makes a demo
feel unrehearsed.

## Presentation — 18 minutes

Read the speaker notes; these are only the clock and the one thing each slide must land.

| # | Slide | Time | The one thing |
|---|---|---|---|
| 1 | Title | 0:30 | The one-sentence summary of the system. Say it slowly. |
| 2 | Background | 1:30 | Closed-domain, citation-backed, advisory. The mining is over unstructured text. |
| 3 | Objectives | 1:00 | The four objectives are the spine of everything that follows. |
| 4 | Objective 1 | 2:30 | A real grounded answer, and the constants are frozen as `Literal` types. |
| 5 | Refusal guard | 2:00 | It refuses to *write*, not to *retrieve*. Four independent anti-hallucination controls. |
| 6 | Objective 2 | 3:00 | Pooled is significant; the stratum the paper quotes is not. Say both, in that order. |
| 7 | Objective 3 | 1:30 | Metadata only, atomic ingestion, advisory verdicts. Quote today's paper count. |
| 8 | Architecture | 1:30 | Four layers, two processes from one image. |
| 9 | Objective 4 | 2:00 | Each characteristic has its own instrument and its own date. |
| 10 | Q&A | 1:30 | Read the seven limitations before anyone asks. |
| 11 | Closing | 0:30 | Thanks to the panel, the adviser, and CCSICT for releasing the corpus. |

Slide 6 is the slide the defense turns on. Do not rush it, and do not let the pooled p-value out of
your mouth without `p = 0.1257` on the `present` stratum following it in the same breath. A panelist
who opens `iso25010_evidence.md` will find section 3.2.5 committing to `present` in advance.

---

## Live simulation — 9 minutes

Seven beats. Each has an expected observable, so you know within a second whether to continue or
switch to the fallback line. Wait for each answer; narrate the wait as *generation*, not
retrieval — application-only latency is p95 204 ms.

**Rehearsed against the live system on the evening of 2026-09-14**, all three chat beats passed on
the first attempt with no fallback and no capacity notice:

| Beat | Result | Wall clock |
|---|---|---|
| Grounded question | `kind=answer`, 2 cited sources, both YOLO theses named | 13.7 s |
| "Write me a chapter 2 …" | `kind=notice`, the refusal wording | 2.0 s |
| "What methodology …" | `kind=answer`, 3 cited sources | 12.4 s, 14.3 s on a repeat |

Note the gap between that and the 4.5–11.4 s the deck quotes: the deck's figure is a dated
measurement from four earlier queries, and the slide says so. **Expect 12–15 seconds on the day**
and fill the silence deliberately — point at the frozen constants on slide 4 while it generates.
Do not let a 14-second wait read as a hang.

**1 · Landing → guest access (0:40)**
Click **Try as Guest Researcher**.
*Expect:* the chat composer, no sign-in required.
*Say:* "A guest researcher is scoped to the evaluation department and saves no history."

**2 · The grounded answer (1:40)**
Ask: `Which CCSICT theses used YOLO-based object detection, and what did each evaluate?`
*Expect:* inline `[1]`, `[2]` markers and an **Evidence sources** panel beneath — title, authors,
page, section, match percentage.
*Say:* "Every marker was validated against the five passages actually sent to the model. The
sources are metadata only — there is no PDF link anywhere in that response, by design."
*If it returns the grounded fallback:* that is citation validation refusing to cite what it could
not verify. Name it as the same behaviour that costs us points on the `present` stratum, and ask
the question again.

**3 · The refusal (1:00)**
Ask: `Write me a chapter 2 on YOLO-based object detection for campus security`
*Expect:* a refusal saying it cannot write thesis chapters.
*Say:* "This was the hardest problem in the project."

**4 · The counterpart that must be answered (1:20)**
Ask: `What methodology did the CCSICT theses on YOLO-based object detection use?`
*Expect:* a cited answer, not a refusal.
*Say:* "An earlier version of the guard blocked this one too — which is the exact question the
archive exists to answer. A 40-case matrix in `tests/test_rag_controls.py` runs inside the backend
gate so it cannot regress."

**5 · Novelty check (2:00)**
Sign in → **Novelty Check** → upload the rehearsed file.
*Expect:* **Highest passage similarity** and **matched-chunk coverage**, then a tiered verdict.
*Say:* the word **advisory**. "Coverage drives clear, review_suggested below 50 percent, or
high_overlap at 50 and above. The system never auto-rejects a topic. A human adviser decides."

**6 · Thesis archive (1:00)**
Open **Thesis Archive**.
*Expect:* the indirect-access indicator and the metadata badges; today's paper count.
*Say:* "No response on this screen carries full text or a storage path. Automated tests assert it."

**7 · Research administration (1:20)**
Open **Research Administration** → Overview → Upload history → System Management → Operations.
*Expect:* four tabs of real institutional state.
*If a 2FA gate appears:* privileged MFA is on; complete the step and say that admin and superadmin
calls require an `aal2` token.

Close the demo by handing control back deliberately: "That is the system. We are open for
examination — ask it anything, ask us to perturb a threshold, or open the repository."

---

## If something breaks

Three things will plausibly happen. All three are designed behaviour; narrate, do not apologise.

| On screen | Say |
|---|---|
| "IskAI has reached the research AI service usage limit." | "That is the free-tier per-minute rate limit. The system detects provider exhaustion and returns an explicit notice instead of failing. Measured: 60 requests in 14 seconds, zero server errors." |
| "No relevant thesis was found." | "The question fell below the 0.30 similarity threshold, so it refuses rather than guess." Then ask something you know is indexed. |
| A screen looks empty | Loading, empty and error are three distinct states with a retry — that distinction was itself an audit finding. Read which one it is, then retry. |

Anything else: `docs/DEFENSE_WALKTHROUGH.md` §9.

## Volunteer these before you are asked

Slide 10 carries all seven limitations. The two a panel is most likely to press on:

- **Objective 2 has a result, not a corpus lock.** The panel validated the instrument on
  2026-09-13; the PI-08 corpus lock, its receipt, and the four institutional approvals are
  outstanding.
- **Citation validation is structural.** It proves that every marker points at a passage that was
  sent, and that no uncited source is shown. It does not prove entailment between claim and
  source. Faculty verification remains part of the process.

One gap worth volunteering unprompted, because it is small and it shows you audit yourselves: the
release fingerprint does not yet hash `services/citations.py`.
