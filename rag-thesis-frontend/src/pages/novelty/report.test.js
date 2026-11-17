import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNoveltyReport,
  buildNoveltyDocxBytes,
  DEFAULT_ADVISER_ROLE,
  DEFAULT_DEAN_NAME,
  downloadNoveltyJsonReport,
  downloadNoveltyReport,
  DEFAULT_DEAN_TITLE,
} from './report.js'

test('novelty export contains useful metadata without manuscript excerpts or chat', () => {
  const report = buildNoveltyReport({
    filename: 'Proposal.pdf',
    created_at: '2026-07-25T00:00:00Z',
    department: 'CCSICT',
    threshold: 85,
    highest_similarity: 91.25,
    matched_chunk_percentage: 25,
    matched_chunk_count: 2,
    total_chunks: 8,
    verdict_level: 'review_suggested',
    verdict_summary: 'Faculty review is suggested.',
    top_matches: [{
      title: 'Archived Study', authors: 'Researcher', year: 2025,
      track: 'Data Mining', similarity: 91.25, database_text: 'private archived excerpt',
    }],
    matched_chunks: [{ uploaded_text: 'private upload', database_text: 'private archive' }],
    chat_log: [{ content: 'private reviewer exchange' }],
  }, '2026-07-25T01:00:00Z')

  const serialized = JSON.stringify(report)
  assert.equal(report.scope, 'metadata-only novelty advisory')
  assert.equal(report.advisory.highest_passage_similarity_percent, 91.25)
  assert.equal(report.matched_studies[0].title, 'Archived Study')
  assert.doesNotMatch(serialized, /private upload|private archive|private reviewer exchange/)
})

test('novelty export fails closed for malformed optional values', () => {
  const report = buildNoveltyReport(null, '2026-07-25T01:00:00Z')
  assert.equal(report.source.filename, 'Unnamed submission')
  assert.deepEqual(report.matched_studies, [])
  assert.equal(report.advisory.matched_chunks, 0)
})

test('a capsule export names its sections and still carries no text', () => {
  const report = buildNoveltyReport({
    filename: 'A Smart Intruder Detection System',
    total_chunks: 4,
    matched_chunk_count: 1,
    capsule_sections: [
      { key: 'title', label: 'Working title', similarity: 92, flagged: true, basis: 'wording',
        closest: { id: 'p1', title: 'SECURE: A Smart Intruder Detection System', year: 2024 } },
      { key: 'methodology', label: 'Methodology', similarity: 0, flagged: false, basis: 'meaning', closest: null },
    ],
  })
  assert.equal(report.source.kind, 'capsule proposal')
  assert.deepEqual(report.capsule_sections, [
    { section: 'Working title', similarity_percent: 92, flagged: true, compared_by: 'title wording',
      closest_thesis: { title: 'SECURE: A Smart Intruder Detection System', year: 2024 } },
    { section: 'Methodology', similarity_percent: 0, flagged: false, compared_by: 'meaning', closest_thesis: null },
  ])
  assert.equal(buildNoveltyReport({ filename: 'draft.pdf' }).source.kind, 'manuscript')
  assert.equal('capsule_sections' in buildNoveltyReport({ filename: 'draft.pdf' }), false)
})

test('buildNoveltyDocxBytes produces a valid .docx archive with official template and Dean signature block', () => {
  const scan = {
    filename: 'Smart_Campus_IoT.pdf',
    created_at: '2026-09-24T08:30:00Z',
    department: 'CCSICT',
    threshold: 85,
    highest_similarity: 88.4,
    matched_chunk_percentage: 20,
    matched_chunk_count: 2,
    total_chunks: 10,
    verdict_level: 'review_suggested',
    verdict_summary: 'Moderate overlap detected in the methodology section.',
    top_matches: [{
      title: 'IoT Energy Monitoring for Campus Buildings',
      authors: 'Dela Cruz, J., Santos, M.',
      year: 2024,
      track: 'BSIT',
      similarity: 88.4,
      database_text: 'secret archived passage',
    }],
    matched_chunks: [{ uploaded_text: 'secret uploaded passage', database_text: 'secret archived passage' }],
    chat_log: [{ content: 'secret reviewer chat' }],
  }

  const bytes = buildNoveltyDocxBytes(scan, {
    generatedAt: '2026-09-24T09:00:00Z',
    adviserName: 'Joe G. Lagarteja, DIT',
  })

  assert.equal(bytes instanceof Uint8Array, true)
  // ZIP magic bytes: PK\x03\x04
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  assert.equal(bytes[2], 0x03)
  assert.equal(bytes[3], 0x04)

  const archiveText = new TextDecoder().decode(bytes)
  assert.match(archiveText, /\[Content_Types\]\.xml/)
  assert.match(archiveText, /word\/document\.xml/)
  assert.match(archiveText, /ISABELA STATE UNIVERSITY/)
  assert.match(archiveText, /NOVELTY &amp; SIMILARITY SCREENING REPORT/)
  assert.match(archiveText, /Smart_Campus_IoT\.pdf/)
  assert.match(archiveText, /IoT Energy Monitoring for Campus Buildings/)
  assert.match(archiveText, /Joe G\. Lagarteja, DIT/)
  assert.match(archiveText, new RegExp(DEFAULT_DEAN_NAME))
  assert.match(archiveText, new RegExp(DEFAULT_DEAN_TITLE))
  assert.doesNotMatch(archiveText, /secret uploaded passage|secret archived passage|secret reviewer chat/)
})

test('buildNoveltyDocxBytes renders capsule section table and custom Dean signatory when provided', () => {
  const capsuleScan = {
    filename: 'Capsule_Proposal',
    total_chunks: 4,
    matched_chunk_count: 1,
    capsule_sections: [
      {
        key: 'title',
        label: 'Working title',
        similarity: 92,
        flagged: true,
        basis: 'wording',
        closest: { id: 'p1', title: 'SECURE: A Smart Intruder Detection System', year: 2024 },
      },
      {
        key: 'methodology',
        label: 'Methodology',
        similarity: 0,
        flagged: false,
        basis: 'meaning',
        closest: null,
      },
    ],
  }

  const bytes = buildNoveltyDocxBytes(capsuleScan, {
    adviserName: 'Albert A. Vinluan, DIT',
    deanName: 'CHRISTINE CHARMAINE G. SAN JOSE, DIT',
    deanTitle: 'Dean, CCSICT',
  })
  const archiveText = new TextDecoder().decode(bytes)
  assert.match(archiveText, /Capsule Concept Proposal/)
  assert.match(archiveText, /II\. PER-SECTION ARCHIVE COMPARISON/)
  assert.match(archiveText, /SECURE: A Smart Intruder Detection System \(2024\)/)
  assert.match(archiveText, /FLAGGED/)
  assert.match(archiveText, /Albert A\. Vinluan, DIT/)
  assert.match(archiveText, /CHRISTINE CHARMAINE G\. SAN JOSE, DIT/)
})

function documentXml(bytes) {
  const text = new TextDecoder().decode(bytes)
  const start = text.indexOf('<w:document')
  const end = text.indexOf('</w:document>') + '</w:document>'.length
  assert.ok(start > 0 && end > start, 'archive should carry word/document.xml')
  return text.slice(start, end)
}

test('matched studies fall back to placeholders for missing title, authors, year and track', () => {
  const scan = {
    filename: 'Draft.pdf',
    top_matches: [
      null,
      { title: '   ', authors: '', track: 42, similarity: 0.5 },
      { title: 'Authors Only', authors: 'Reyes, A.', similarity: 70 },
      { title: 'Year Only', year: 2021, track: 'BSCS' },
    ],
  }
  const report = buildNoveltyReport(scan, '2026-07-25T01:00:00Z')
  assert.deepEqual(report.matched_studies, [
    { title: 'Untitled thesis', authors: null, year: null, track: null, highest_passage_similarity_percent: 0 },
    { title: 'Untitled thesis', authors: null, year: null, track: null, highest_passage_similarity_percent: 50 },
    { title: 'Authors Only', authors: 'Reyes, A.', year: null, track: null, highest_passage_similarity_percent: 70 },
    { title: 'Year Only', authors: null, year: 2021, track: 'BSCS', highest_passage_similarity_percent: 0 },
  ])

  const xml = documentXml(buildNoveltyDocxBytes(scan, { generatedAt: '2026-07-25T01:00:00Z' }))
  assert.equal(xml.match(/>Untitled thesis</g).length, 2)
  assert.match(xml, />Reyes, A\.</)
  assert.match(xml, />2021</)
  assert.match(xml, />BSCS</)
  // No authors and no year, and no track, read as a dash rather than an empty cell.
  assert.equal(xml.match(/>—</g).length, 5)
  // Two study rows with no similarity, plus the summary's highest-passage and
  // closest-thesis figures, which are 0 for this scan.
  assert.equal(xml.match(/>0\.00%</g).length, 4)
  assert.match(xml, />50\.00%</)
  assert.match(xml, />70\.00%</)
})

test('capsule sections fall back to their key, a generic label, and an untitled closest thesis', () => {
  const scan = {
    filename: 'Capsule',
    capsule_sections: [
      null,
      { key: 'objectives', similarity: 41.5, closest: { title: '', year: 0 } },
      { key: 'rationale', label: '  ', similarity: 60, flagged: true, closest: { title: 'Older Study' } },
    ],
  }
  const report = buildNoveltyReport(scan, '2026-07-25T01:00:00Z')
  assert.deepEqual(report.capsule_sections, [
    { section: 'Section', similarity_percent: 0, flagged: false, compared_by: 'meaning', closest_thesis: null },
    { section: 'objectives', similarity_percent: 41.5, flagged: false, compared_by: 'meaning',
      closest_thesis: { title: 'Untitled thesis', year: null } },
    { section: 'rationale', similarity_percent: 60, flagged: true, compared_by: 'meaning',
      closest_thesis: { title: 'Older Study', year: null } },
  ])

  const xml = documentXml(buildNoveltyDocxBytes(scan, { generatedAt: '2026-07-25T01:00:00Z' }))
  assert.match(xml, />No closely similar archived thesis</)
  // A closest thesis without a year carries no empty "()" suffix.
  assert.match(xml, />Untitled thesis</)
  assert.match(xml, />Older Study</)
  assert.doesNotMatch(xml, /\(\)|\(null\)/)
  assert.match(xml, />41\.5%</)
  assert.equal(xml.match(/>Clear</g).length, 2)
  assert.equal(xml.match(/>FLAGGED</g).length, 1)
})

test('a manuscript with no matches says so instead of drawing an empty table', () => {
  const xml = documentXml(buildNoveltyDocxBytes({ filename: 'Clean.pdf', top_matches: [] }, {
    generatedAt: '2026-07-25T01:00:00Z',
  }))
  assert.match(xml, /II\. CLOSEST ARCHIVED THESES/)
  assert.match(xml, />No archived thesis reached the similarity threshold\.</)
  assert.doesNotMatch(xml, /Archived Thesis Title/)
})

test('the screening date prefers the scan date, keeps an unparseable one verbatim, and falls back to today', () => {
  const dated = documentXml(buildNoveltyDocxBytes({ created_at: '2026-03-04T23:00:00Z' }, {
    generatedAt: '2026-07-25T01:00:00Z',
  }))
  assert.match(dated, />2026-03-04</)

  const garbled = documentXml(buildNoveltyDocxBytes({ created_at: 'sometime in March' }, {
    generatedAt: '2026-07-25T01:00:00Z',
  }))
  assert.match(garbled, />sometime in March</)

  const fromGenerated = documentXml(buildNoveltyDocxBytes({}, { generatedAt: '2026-07-25T01:00:00Z' }))
  assert.match(fromGenerated, />2026-07-25</)

  const before = new Date().toISOString().slice(0, 10)
  const today = documentXml(buildNoveltyDocxBytes({}))
  const after = new Date().toISOString().slice(0, 10)
  assert.ok(today.includes(`>${before}<`) || today.includes(`>${after}<`))
})

test('the signatory block leaves a signature line and default roles when nothing is supplied', () => {
  const xml = documentXml(buildNoveltyDocxBytes({ filename: 'Draft.pdf' }, { generatedAt: '2026-07-25T01:00:00Z' }))
  assert.match(xml, />____________________________________</)
  assert.ok(xml.includes(`>${DEFAULT_ADVISER_ROLE}<`))
  assert.ok(xml.includes(`>${DEFAULT_DEAN_NAME}<`))
  assert.ok(xml.includes(`>${DEFAULT_DEAN_TITLE}<`))

  const custom = documentXml(buildNoveltyDocxBytes({ filename: 'Draft.pdf' }, {
    generatedAt: '2026-07-25T01:00:00Z',
    adviserName: '  Maria <Santos> & Co.  ',
    adviserRole: 'Capstone Coordinator',
    deanName: 'Acting Dean',
    deanTitle: 'OIC, CCSICT',
  }))
  // Supplied names are trimmed and XML-escaped.
  assert.match(custom, />Maria &lt;Santos&gt; &amp; Co\.</)
  assert.match(custom, />Capstone Coordinator</)
  assert.match(custom, />Acting Dean</)
  assert.match(custom, />OIC, CCSICT</)
  assert.doesNotMatch(custom, new RegExp(DEFAULT_DEAN_NAME))
  assert.doesNotMatch(custom, /____/)
})

async function captureDownload(run) {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const originalDocument = globalThis.document
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const events = []
  const anchors = []
  let blob = null
  globalThis.document = {
    createElement(tag) {
      const anchor = {
        tag,
        href: '',
        download: '',
        click() { events.push(['click', anchor.href, anchor.download]) },
      }
      anchors.push(anchor)
      return anchor
    },
  }
  URL.createObjectURL = (value) => {
    blob = value
    events.push(['create'])
    return 'blob:novelty-report-1'
  }
  URL.revokeObjectURL = (url) => { events.push(['revoke', url]) }
  try {
    run()
  } finally {
    if (hadDocument) globalThis.document = originalDocument
    else delete globalThis.document
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
  return { events, anchors, blob }
}

test('downloadNoveltyReport saves the .docx under a slug of the file name and releases the URL', async () => {
  const scan = {
    filename: '  Smart Campus: IoT (Final).PDF ',
    created_at: '2026-09-24T08:30:00Z',
    top_matches: [{ title: 'IoT Energy Monitoring', similarity: 88.4 }],
  }
  const options = { generatedAt: '2026-09-24T09:00:00Z', adviserName: 'Joe G. Lagarteja, DIT' }
  const { events, anchors, blob } = await captureDownload(() => downloadNoveltyReport(scan, options))

  assert.equal(anchors.length, 1)
  assert.equal(anchors[0].tag, 'a')
  assert.deepEqual(events, [
    ['create'],
    ['click', 'blob:novelty-report-1', 'novelty-report-smart-campus-iot-final.docx'],
    ['revoke', 'blob:novelty-report-1'],
  ])
  assert.ok(blob instanceof Blob)
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const saved = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual(saved, buildNoveltyDocxBytes(scan, options))
  assert.equal('document' in globalThis, false)
})

test('downloadNoveltyReport names untitled or symbol-only submissions "submission" and caps long slugs', async () => {
  const untitled = await captureDownload(() => downloadNoveltyReport(null))
  assert.equal(untitled.anchors[0].download, 'novelty-report-submission.docx')

  const symbols = await captureDownload(() => downloadNoveltyReport({ filename: '***.docx' }))
  assert.equal(symbols.anchors[0].download, 'novelty-report-submission.docx')

  const long = await captureDownload(() => downloadNoveltyReport({ filename: `${'a'.repeat(80)}.pdf` }))
  assert.equal(long.anchors[0].download, `novelty-report-${'a'.repeat(60)}.docx`)
})

test('downloadNoveltyJsonReport saves the metadata-only JSON report', async () => {
  const scan = {
    filename: 'Thesis Draft v2.pdf',
    highest_similarity: 91.25,
    top_matches: [{ title: 'Archived Study', similarity: 91.25, database_text: 'private archived excerpt' }],
    matched_chunks: [{ uploaded_text: 'private upload' }],
  }
  const { events, blob } = await captureDownload(() => downloadNoveltyJsonReport(scan))

  assert.deepEqual(events, [
    ['create'],
    ['click', 'blob:novelty-report-1', 'novelty-report-thesis-draft-v2.json'],
    ['revoke', 'blob:novelty-report-1'],
  ])
  assert.equal(blob.type, 'application/json')
  const text = await blob.text()
  // Pretty-printed with two-space indentation.
  assert.match(text, /^\{\n {2}"report_version"/)
  const saved = JSON.parse(text)
  const expected = buildNoveltyReport(scan, saved.generated_at)
  assert.deepEqual(saved, expected)
  assert.equal(Number.isNaN(Date.parse(saved.generated_at)), false)
  assert.doesNotMatch(text, /private archived excerpt|private upload/)

  const unnamed = await captureDownload(() => downloadNoveltyJsonReport(undefined))
  // The JSON report names an unnamed scan "Unnamed submission", and the file follows suit.
  assert.equal(unnamed.anchors[0].download, 'novelty-report-unnamed-submission.json')
})
