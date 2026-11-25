/**
 * Institutional legal documents for the ISU CCSICT IskAI Thesis Library:
 * Terms of Agreement, Terms of Service, and Privacy Policy.
 */

export const LEGAL_EFFECTIVE_DATE = 'November 26, 2026'

export const LEGAL_TABS = [
  { key: 'agreement', label: 'Terms of Agreement', shortLabel: 'Agreement', path: '/legal/agreement' },
  { key: 'terms', label: 'Terms of Service', shortLabel: 'Terms', path: '/legal/terms' },
  { key: 'privacy', label: 'Privacy Policy', shortLabel: 'Privacy', path: '/legal/privacy' },
]

export const LEGAL_DOCUMENTS = {
  agreement: {
    key: 'agreement',
    title: 'Terms of Agreement',
    subtitle: 'Academic Research & User Agreement for the ISU CCSICT Thesis AI Library (IskAI).',
    summary:
      'By creating an account or accessing IskAI as a Guest Researcher, you agree to use archived CCSICT thesis knowledge ethically, respect authors’ intellectual property, and follow institutional academic integrity standards.',
    sections: [
      {
        id: 'acceptance',
        heading: '1. Acceptance & Institutional Eligibility',
        paragraphs: [
          'This Terms of Agreement (“Agreement”) governs your access to and use of the Isabela State University – College of Computing Studies, Information and Communication Technology (ISU CCSICT) Thesis AI Library (“IskAI” or the “System”). By checking the agreement box during registration, signing in, or continuing as a Guest Researcher, you confirm that you have read, understood, and accepted this Agreement together with our Terms of Service and Privacy Policy.',
          'Institutional accounts using an @isu.edu.ph email address are provisioned for immediate student access upon email verification. Accounts registered with non-institutional email addresses or requesting faculty privileges require review and approval by a CCSICT administrator before full access is granted.',
        ],
      },
      {
        id: 'indirect-access-ip',
        heading: '2. Indirect-Access Model & Intellectual Property',
        paragraphs: [
          'All theses, capstone projects, and faculty research manuscripts indexed in IskAI remain the intellectual property of their respective authors and Isabela State University under Republic Act No. 8293 (Intellectual Property Code of the Philippines).',
          'To safeguard unpublished and institutional manuscripts, IskAI operates on a strict indirect-access model: the System does not distribute downloadable full-text thesis PDFs or raw archived passages to general users. Instead, IskAI provides citation-grounded syntheses, bibliographic metadata, and verified reference locations (page numbers and section headings) so researchers can consult the physical or authorized library copy when needed.',
        ],
      },
      {
        id: 'academic-integrity',
        heading: '3. Academic Integrity & Proper Attribution',
        paragraphs: [
          'You agree to use IskAI solely as a research discovery, literature-review, and citation-assistance tool. You must properly cite every referenced thesis using the provided APA or BibTeX citations and verify critical figures, methodologies, and findings against the primary manuscript before submitting academic work.',
          'You must not represent AI-synthesized summaries or explanations as your own original research writing. Novelty Check similarity scores and the 85% duplication advisory threshold are deterministic screening aids for advisers and students, and do not replace formal thesis-committee or institutional academic review.',
        ],
      },
      {
        id: 'acceptable-use',
        heading: '4. Prohibited Conduct',
        paragraphs: [
          'When using IskAI, you agree not to:',
        ],
        bullets: [
          'Attempt to extract, reconstruct, scrape, or bulk-export raw archived thesis text through prompt injection, automated scripts, or API abuse.',
          'Bypass or tamper with security controls, including Cloudflare Turnstile verification, rate limits, role-based permissions, or multi-factor authentication.',
          'Upload manuscripts containing malware, falsified authorship, or materials you are not authorized to submit for archival ingestion or novelty screening.',
          'Share your account credentials or impersonate another student, faculty member, or administrator.',
        ],
      },
      {
        id: 'governance',
        heading: '5. Institutional Governance & Enforcement',
        paragraphs: [
          'CCSICT administrators and superadministrators may audit activity logs, suspend or revoke accounts, and restrict access in response to violations of this Agreement or ISU academic conduct policies. Questions regarding this Agreement may be directed to the CCSICT Dean’s Office or Thesis Library Administrator at Isabela State University – Echague Campus.',
        ],
      },
    ],
  },

  terms: {
    key: 'terms',
    title: 'Terms of Service',
    subtitle: 'Operational rules, service boundaries, and responsibilities for using the IskAI platform.',
    summary:
      'These Terms of Service define how IskAI operates, what each user role may do, how uploaded manuscripts and AI responses are handled, and the institutional limits of liability.',
    sections: [
      {
        id: 'service-scope',
        heading: '1. Scope of Service',
        paragraphs: [
          'IskAI is an institutional research platform developed and operated for the College of Computing Studies, Information and Communication Technology (CCSICT), Isabela State University – Echague Campus. Core capabilities include citation-grounded Retrieval-Augmented Generation (RAG) chat, searchable thesis metadata browsing, faculty novelty/duplication screening, and authorized thesis ingestion.',
          'Features are provided according to your assigned institutional role (Guest Researcher, Student, Faculty, Admin, or Superadmin) and may be enabled, modified, or maintained by CCSICT administrators at any time.',
        ],
      },
      {
        id: 'accounts-security',
        heading: '2. Accounts, Roles & Security',
        paragraphs: [
          'You are responsible for maintaining the confidentiality of your login credentials and for all activity conducted under your account. Privileged roles (Admin and Superadmin) are subject to mandatory multi-factor authentication (MFA) and stricter session-timeout controls.',
          'Guest Researcher sessions are limited to public archive queries, do not persist chat history on the server, and are subject to anti-bot verification and daily usage budgets.',
        ],
      },
      {
        id: 'uploads-ingestion',
        heading: '3. Manuscript Uploads & Automated Processing',
        paragraphs: [
          'Authorized faculty and administrators who upload PDF manuscripts for archival ingestion or novelty screening represent that the files are legitimate institutional or candidate academic works. Uploaded files undergo automated malware scanning (ClamAV), text/OCR extraction, chunking, and vector indexing.',
          'Files flagged by malware scanning or failing validation checks are rejected automatically and logged for security review.',
        ],
      },
      {
        id: 'ai-limitations',
        heading: '4. AI Synthesis Limitations & Disclaimers',
        paragraphs: [
          'IskAI synthesizes answers strictly from retrieved passages of indexed theses and attaches citation markers linking to source metadata. However, automated retrieval and language models may omit relevant passages, misinterpret complex tables, or reflect OCR imperfections in older scanned manuscripts.',
          'The System is provided on an “as is” and “as available” basis for academic support. ISU CCSICT does not guarantee uninterrupted availability—particularly during third-party AI or hosting provider outages—and is not liable for academic, grading, or publication decisions made without verifying primary source manuscripts.',
        ],
      },
      {
        id: 'suspension-changes',
        heading: '5. Suspension, Termination & Updates',
        paragraphs: [
          'We reserve the right to suspend or terminate accounts that violate these Terms, pose security risks, or lose institutional eligibility. We may update these Terms of Service as the System evolves; the effective date at the top of this page reflects the latest revision. Continued use after an update constitutes acceptance of the revised Terms.',
        ],
      },
      {
        id: 'governing-law',
        heading: '6. Governing Law',
        paragraphs: [
          'These Terms of Service are governed by the laws of the Republic of the Philippines and applicable policies of Isabela State University.',
        ],
      },
    ],
  },

  privacy: {
    key: 'privacy',
    title: 'Privacy Policy',
    subtitle: 'How ISU CCSICT collects, uses, protects, and retains your data under the Data Privacy Act of 2012 (RA 10173).',
    summary:
      'We collect only the information needed to authenticate your institutional account, save your research sessions, screen uploads for safety, and protect the thesis archive. We never sell personal data.',
    sections: [
      {
        id: 'data-collected',
        heading: '1. Information We Collect',
        paragraphs: [
          'Depending on how you use IskAI, we collect and process the following categories of information:',
        ],
        bullets: [
          'Account & Identity Data: Full name, email address, assigned department (e.g., CCSICT), institutional role, approval status, and optional profile avatar.',
          'Authentication & Security Data: Password hashes (managed by Supabase Auth), MFA enrollment status, Turnstile verification outcomes, and rate-limiting/audit logs.',
          'Research Activity Data: Signed-in chat prompts, AI responses, conversation titles, saved thesis bookmarks, and faculty novelty-scan submissions and follow-up questions.',
          'Archived Thesis Metadata: Bibliographic records (titles, authors, advisers, panels, programs, years, abstracts) of institutional theses authorized for indexing.',
        ],
      },
      {
        id: 'how-we-use',
        heading: '2. Purpose of Processing',
        paragraphs: [
          'Your information is processed exclusively for legitimate institutional and academic purposes: authenticating users, enforcing role-based access control, delivering citation-grounded thesis search and novelty checks, preventing abuse or malware uploads, and maintaining system reliability and ISO/IEC 25010 operational telemetry.',
        ],
      },
      {
        id: 'third-party-processors',
        heading: '3. Infrastructure & Third-Party Service Providers',
        paragraphs: [
          'To operate IskAI reliably and securely, limited data is processed by trusted infrastructure providers strictly as necessary to fulfill your requests:',
        ],
        bullets: [
          'Supabase: Authentication, PostgreSQL database, pgvector index, and row-level security enforcement.',
          'Google Gemini (and configured fallback AI gateways): Embedding generation and citation-grounded answer synthesis for submitted queries and novelty scans.',
          'Cloudflare Turnstile: Bot and abuse prevention on authentication and guest chat surfaces.',
          'ClamAV (self-hosted): Local malware scanning of uploaded files before processing.',
        ],
      },
      {
        id: 'security-safeguards',
        heading: '4. Data Security & Indirect-Access Safeguards',
        paragraphs: [
          'We implement technical and organizational safeguards including HTTPS/TLS transport encryption, PostgreSQL Row-Level Security (RLS) isolating user chat sessions and novelty scans, privileged-account MFA, automated malware scanning, and strict indirect-access filtering so raw archived thesis chunks are never exposed to client browsers.',
        ],
      },
      {
        id: 'retention',
        heading: '5. Data Retention & User Controls',
        paragraphs: [
          'Guest Researcher conversations are not stored in our database. Signed-in users may rename or delete their own chat conversations at any time from the Conversations sidebar, and may manage saved bookmarks and security preferences in Settings.',
          'Operational logs and novelty-scan history are retained according to CCSICT administrative retention schedules and purged periodically under documented retention controls.',
        ],
      },
      {
        id: 'ra-10173-rights',
        heading: '6. Your Rights Under RA 10173',
        paragraphs: [
          'In accordance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), you have the right to be informed, to access your personal data, to request rectification of inaccurate records, to request erasure or blocking where appropriate, and to raise privacy concerns with the university’s Data Protection Officer or the National Privacy Commission.',
        ],
      },
      {
        id: 'contact',
        heading: '7. Institutional Contact',
        paragraphs: [
          'For privacy inquiries, data-access requests, or account-deletion assistance, please contact the College of Computing Studies, Information and Communication Technology (CCSICT), Isabela State University – Echague Campus, San Fabian, Echague, Isabela, Philippines.',
        ],
      },
    ],
  },
}

export function resolveLegalDocument(slug) {
  const normalized = (slug || '').trim().toLowerCase()
  return LEGAL_DOCUMENTS[normalized] || LEGAL_DOCUMENTS.agreement
}
