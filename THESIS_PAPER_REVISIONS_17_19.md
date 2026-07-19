# Thesis Paper Revisions for Items 17–19

These revisions align the proposal with the implemented system. The original PDF is preserved because no editable manuscript source was supplied.

## Item 17 — Strict indirect access

The existing thesis policy remains authoritative: no student, faculty member, administrator, superadministrator, or Guest Researcher can view, browse, or download an original thesis manuscript through the application. Original PDFs are retained only in private backend storage for ingestion, controlled re-indexing, rollback, retention, and deletion operations. User-facing citations expose approved metadata and evidence locations only.

## Item 18 — Evaluation scope and multi-department architecture

Replace statements implying that the entire deployable application is permanently limited to one department with the following distinction:

> The formal corpus, experiment, Golden Dataset, reported evaluation, and Guest Researcher experience are restricted to CCSICT. The deployed architecture remains department-aware to support future authorized institutional expansion. Authenticated users are isolated to their assigned department, while a superadministrator may deliberately select a validated department. Records from other departments are excluded from the CCSICT experiment and reported results.

The formal deployment setting is `THESIS_EVALUATION_DEPARTMENT=CCSICT`.

## Item 19 — Figure 8 actor correction

Rename the **Researcher** actor in Figure 8 to **Guest Researcher**. Update the accompanying System Architecture paragraph to:

> Administrators use the protected ingestion interface to manage approved thesis records. Authenticated students and faculty use the features permitted to their assigned roles and departments. A Guest Researcher may submit CCSICT research questions without an account, but guest conversations are not saved and the guest cannot change departments, access administrative functions, or view/download original manuscripts.

No authenticated `researcher` database role is added. “Future Researchers” in the significance section remains a beneficiary category rather than an application authorization role.
