# PI-08 Institutional Approval, Privacy Review, and Corpus Lock Protocol

| Control | Value |
|---|---|
| System | IskAI - ISU Echague Thesis Library |
| Institutional scope | CCSICT, Isabela State University - Echague |
| Research owners | Ahron John F. Barlis and Carlo Rossi P. Gallardo |
| Purpose | Fixed 50-thesis baseline-versus-RAG defense evaluation |
| Repository status | Protocol and locking controls implemented; institutional decisions pending |
| Sensitive records | Controlled outside Git; only document references and SHA-256 receipts enter release evidence |

This protocol is an approval packet and technical control, not a substitute for an ISU legal or Data Protection Officer determination. No researcher may sign for an institutional approver or mark an unanswered field complete.

## 1. Non-negotiable release rule

The corpus may be locked only when all four written approvals are complete, exactly 50 eligible CCSICT theses have passed individual rights/privacy review, and the manifest tool produces a valid SHA-256 receipt. Until then, PI-08 remains `BLOCKED-EXTERNAL`.

The unpaid Gemini API profile may receive only content that an authorized human reviewer has confirmed is redacted, non-personal, non-sensitive, and non-confidential. Google states that content submitted to unpaid services may be used to improve its products and may be reviewed by humans, and instructs users not to submit personal, sensitive, or confidential information. If a thesis cannot meet this restriction, it is excluded from the unpaid profile; institutional approval does not override provider terms.

## 2. Required institutional approvals

Keep signed originals in the ISU-controlled records location. Record only the final document ID, approver name/role, approval date, and SHA-256 in the private working manifest.

| Gate | Required decision | Required approver | Acceptance evidence |
|---|---|---|---|
| Academic scope | The sampling purpose, CCSICT boundary, inclusion/exclusion rules, and defense use are acceptable | Serving CCSICT Department Chair | Signed approval document and hash |
| Custodial/rights authority | ISU may use each selected manuscript for the specified local processing and evaluation purpose | Serving University Librarian or formally delegated records custodian | Signed approval document and per-paper rights reference |
| Privacy review | Lawful basis, transparency/notice, proportionality, retention, security, data-subject handling, and third-party processing are acceptable | ISU Data Protection Officer or formally authorized privacy officer | Signed privacy decision and, if required, completed PIA/DPIA reference |
| Research methodology | The purposive sampling procedure and final 50 records match the approved thesis method | Thesis adviser | Signed methodology/corpus approval and hash |

Minimum wording for every approval:

- exact system and research title;
- exact purpose and CCSICT-only defense scope;
- data categories and whether manuscript text leaves ISU-controlled infrastructure;
- Gemini service tier and provider data-use restriction;
- roles allowed to ingest, review, evaluate, back up, and delete data;
- retention end date or triggering event;
- withdrawal, correction, incident, and escalation contact;
- explicit approve, approve-with-conditions, or reject decision;
- approver's printed name, position, signature, and date.

## 3. Privacy review worksheet

The authorized privacy reviewer completes every row. `Pending` or a blank answer blocks corpus locking.

| Review question | Required recorded answer |
|---|---|
| Who is the Personal Information Controller and who operates the system? | Named ISU unit and accountable contact |
| What is the declared, specific purpose? | Fixed CCSICT thesis defense evaluation; no unrelated reuse |
| What lawful basis authorizes each processing activity? | Written institutional determination, including any consent/notice requirement |
| What personal or sensitive information occurs in manuscripts or metadata? | Data inventory and per-paper screening result |
| Is each field necessary and proportionate? | Keep/remove decision with rationale |
| What content reaches Supabase, Gemini, logs, traces, backups, and evaluator exports? | Data-flow inventory for every processor/location |
| Can unpaid Gemini receive the content? | Yes only for human-verified redacted, non-personal, non-sensitive, non-confidential content; otherwise no |
| How are data-subject rights and corrections handled? | Contact, identity verification, response, and audit procedure |
| What is the retention/deletion rule? | Approved duration/event, backup expiry, deletion owner, and evidence |
| What security controls apply? | Access control, MFA, RLS, encryption, malware scanning, audit, backup, recovery, and incident handling |
| Is a PIA/DPIA or data-sharing agreement required? | Formal decision and document reference |
| What residual risks remain? | Owner, treatment, due date, and acceptance decision |

The review applies the Philippine privacy principles of transparency, legitimate purpose, proportionality, data quality, security, and retention limitation. Official references are listed in Section 9.

## 4. Per-thesis eligibility checklist

Every selected paper needs one completed row in the controlled candidate register before it enters the manifest.

| Check | Pass condition |
|---|---|
| CCSICT provenance | Custodian confirms the record belongs to CCSICT |
| Program classification | One of BSCS/Data Mining, BSIT/WMAD, BSIT/NETSEC, BSDSA, BSIS, or BLIS; ambiguity is reviewed, never guessed |
| Sampling fit | Meets the faculty-approved inclusion criteria and no exclusion criterion |
| Rights authority | Per-paper approval/reference permits the declared processing |
| Privacy screen | Human reviewer checks the entire content, appendices, images, tables, and OCR output |
| Redaction verification | Redacted derivative contains no personal, sensitive, privileged, or confidential content for unpaid Gemini |
| Integrity | Source and redacted files each have a lowercase SHA-256 digest |
| Index provenance | Embedding model, dimensions, preprocessing, chunking, and index fingerprint are recorded |
| Duplicate control | Paper ID, corpus record ID, and source digest are unique |
| Final eligibility | `unpaid_gemini_eligible=true` is signed off by the authorized reviewer |

Automated regular-expression redaction is only a first pass. It cannot certify narrative disclosures, faces in images, signatures, health/financial data, free-text participant details, confidential partner data, or contextual re-identification. Human review is mandatory.

**Thesis category restriction.** The evaluation corpus is `thesis_category = 'student'` only. The archive also accepts faculty-authored manuscripts (`thesis_category = 'faculty'`, migration `20260819_thesis_category.sql`), but they are ineligible for this corpus: every paper indexed before that migration backfills to `student`, and no faculty-category paper may be added to the evaluation department's archive during an evaluation window without a new corpus ID under the §5 change-control procedure.

## 5. Sampling and change control

1. The thesis adviser approves inclusion/exclusion criteria before titles are selected.
2. The researchers create a controlled candidate register; rejected candidates retain only a reason code and audit reference.
3. The librarian verifies custody/rights and the privacy reviewer screens each proposed paper.
4. The final set contains exactly 50 unique papers. No program quota is invented unless the adviser approves it in writing.
5. The researchers calculate source, redacted-content, and index-fingerprint SHA-256 values.
6. Both researchers reconcile the manifest against the controlled register.
7. The thesis adviser approves the final list.
8. The locking tool creates a sorted immutable manifest and separate receipt.
9. Any later paper change creates a new corpus ID, new approvals as required, and a new receipt. The prior version is never overwritten.

## 6. Manifest workflow

The tracked template contains no real thesis or approver data:

`rag-thesis-backend/evaluation/corpus/corpus_manifest.template.json`

Copy it into the ignored controlled directory and populate it only from approved records:

```powershell
Copy-Item `
  rag-thesis-backend/evaluation/corpus/corpus_manifest.template.json `
  rag-thesis-backend/evaluation/corpus/private/corpus_manifest.working.json
```

Validate the working structure:

```powershell
cd rag-thesis-backend
.\.venv312\Scripts\python.exe -m scripts.corpus_manifest validate `
  evaluation/corpus/private/corpus_manifest.working.json
```

After all approvals and 50 records are complete, set `status` to `approved` and run the strict gate:

```powershell
.\.venv312\Scripts\python.exe -m scripts.corpus_manifest validate `
  evaluation/corpus/private/corpus_manifest.working.json --lock-ready
```

Create immutable artifacts. Neither output may already exist:

```powershell
.\.venv312\Scripts\python.exe -m scripts.corpus_manifest lock `
  evaluation/corpus/private/corpus_manifest.working.json `
  --manifest-output evaluation/corpus/private/corpus-2026-defense.locked.json `
  --receipt-output evaluation/results/release-2026-08-28/corpus.receipt.json
```

Verify before every formal evaluation:

```powershell
.\.venv312\Scripts\python.exe -m scripts.corpus_manifest verify `
  evaluation/corpus/private/corpus-2026-defense.locked.json `
  evaluation/results/release-2026-08-28/corpus.receipt.json
```

The receipt is safe to include in release evidence only after confirming it contains hashes and counts, not manuscript text or signatures.

## 7. Approval register

Complete this register only after receiving the signed source document. Signature images remain outside Git.

| Gate | Approver name | Position | Decision | Approval date | Document ID | SHA-256 | Status |
|---|---|---|---|---|---|---|---|
| CCSICT academic scope | Pending | CCSICT Department Chair | Pending | Pending | Pending | Pending | BLOCKED-EXTERNAL |
| Corpus custody/rights | Pending | University Librarian | Pending | Pending | Pending | Pending | BLOCKED-EXTERNAL |
| Privacy review | Pending | Authorized privacy officer | Pending | Pending | Pending | Pending | BLOCKED-EXTERNAL |
| Final methodology/corpus | Pending | Thesis adviser | Pending | Pending | Pending | Pending | BLOCKED-EXTERNAL |

## 8. PI-08 completion evidence

PI-08 may be changed to `VERIFIED` only when all of these exist:

- four completed approval-register rows with matching controlled originals;
- privacy worksheet and any required PIA/DPIA or agreement;
- exactly 50 individually eligible papers;
- locked manifest that passes `verify`;
- corpus receipt included in the versioned release evidence;
- named owner and approved deletion/retention event;
- two-researcher reconciliation record;
- no unresolved provider-terms, privacy, rights, or confidentiality exception.

## 9. Official references

- [Republic Act No. 10173 - Data Privacy Act of 2012](https://privacy.gov.ph/data-privacy-act/)
- [Implementing Rules and Regulations of the Data Privacy Act](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/)
- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)

Reference review date: 2026-07-25. Recheck provider terms immediately before institutional approval and corpus locking.
