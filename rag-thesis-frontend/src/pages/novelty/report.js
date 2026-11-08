import { normalizePercent, scanMetrics, verdictLabel } from '../../lib/utils.js'

export const DEFAULT_DEAN_NAME = 'CHRISTINE CHARMAINE G. SAN JOSE, DIT'
export const DEFAULT_DEAN_TITLE = 'Dean, CCSICT'
export const DEFAULT_ADVISER_ROLE = 'Thesis / Capstone Adviser'

function safeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stripMarkdown(value) {
  return safeText(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
}

export function buildNoveltyReport(scan, generatedAt = new Date().toISOString()) {
  const metrics = scanMetrics(scan)
  return {
    report_version: '2026-07-25',
    generated_at: generatedAt,
    scope: 'metadata-only novelty advisory',
    source: {
      kind: Array.isArray(scan?.capsule_sections) ? 'capsule proposal' : 'manuscript',
      filename: safeText(scan?.filename) || 'Unnamed submission',
      scanned_at: scan?.created_at || null,
      department: scan?.department || null,
    },
    advisory: {
      threshold_percent: normalizePercent(scan?.threshold || 85),
      highest_passage_similarity_percent: metrics.highest,
      matched_chunk_coverage_percent: metrics.coverage,
      matched_chunks: metrics.matchedChunks,
      total_chunks: metrics.totalChunks,
      verdict_code: metrics.verdict,
      verdict_label: verdictLabel(metrics.verdict),
    },
    matched_studies: (scan?.top_matches || []).map((study) => ({
      title: safeText(study?.title) || 'Untitled thesis',
      authors: safeText(study?.authors) || null,
      year: study?.year || null,
      track: safeText(study?.track) || null,
      highest_passage_similarity_percent: normalizePercent(study?.similarity),
    })),
    // Section, similarity and the closest thesis's title only; the capsule's own
    // text and the archived excerpts stay out, like the manuscript export.
    ...(Array.isArray(scan?.capsule_sections) ? {
      capsule_sections: scan.capsule_sections.map((row) => ({
        section: safeText(row?.label) || safeText(row?.key) || 'Section',
        similarity_percent: normalizePercent(row?.similarity),
        flagged: row?.flagged === true,
        compared_by: row?.basis === 'wording' ? 'title wording' : 'meaning',
        closest_thesis: row?.closest ? {
          title: safeText(row.closest.title) || 'Untitled thesis',
          year: row.closest.year || null,
        } : null,
      })),
    } : {}),
    limitations: [
      'This screening is advisory and does not determine plagiarism.',
      'Highest passage similarity and matched-chunk coverage measure different properties.',
      'A qualified faculty reviewer must interpret the result in academic context.',
      'Uploaded and archived manuscript excerpts are intentionally excluded from this export.',
    ],
  }
}

/* ---------- Minimal CRC-32 + STORE ZIP builder for .docx ---------- */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function packZipStore(entries) {
  const encoder = new TextEncoder()
  const files = entries.map(({ name, content }) => {
    const nameBytes = encoder.encode(name)
    const dataBytes = typeof content === 'string' ? encoder.encode(content) : content
    return {
      nameBytes,
      dataBytes,
      crc: crc32(dataBytes),
    }
  })

  let localSize = 0
  let centralSize = 0
  for (const file of files) {
    localSize += 30 + file.nameBytes.length + file.dataBytes.length
    centralSize += 46 + file.nameBytes.length
  }

  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let offset = 0

  for (const file of files) {
    file.offset = offset
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0, true)
    view.setUint16(offset + 8, 0, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, 0x21, true)
    view.setUint32(offset + 14, file.crc, true)
    view.setUint32(offset + 18, file.dataBytes.length, true)
    view.setUint32(offset + 22, file.dataBytes.length, true)
    view.setUint16(offset + 26, file.nameBytes.length, true)
    view.setUint16(offset + 28, 0, true)
    out.set(file.nameBytes, offset + 30)
    out.set(file.dataBytes, offset + 30 + file.nameBytes.length)
    offset += 30 + file.nameBytes.length + file.dataBytes.length
  }

  const centralStart = offset
  for (const file of files) {
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 20, true)
    view.setUint16(offset + 8, 0, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, 0, true)
    view.setUint16(offset + 14, 0x21, true)
    view.setUint32(offset + 16, file.crc, true)
    view.setUint32(offset + 20, file.dataBytes.length, true)
    view.setUint32(offset + 24, file.dataBytes.length, true)
    view.setUint16(offset + 28, file.nameBytes.length, true)
    view.setUint16(offset + 30, 0, true)
    view.setUint16(offset + 32, 0, true)
    view.setUint16(offset + 34, 0, true)
    view.setUint16(offset + 36, 0, true)
    view.setUint32(offset + 38, 0, true)
    view.setUint32(offset + 42, file.offset, true)
    out.set(file.nameBytes, offset + 46)
    offset += 46 + file.nameBytes.length
  }

  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 4, 0, true)
  view.setUint16(offset + 6, 0, true)
  view.setUint16(offset + 8, files.length, true)
  view.setUint16(offset + 10, files.length, true)
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true)

  return out
}

/* ---------- WordprocessingML document builder ---------- */

function wParagraph(text, {
  align = 'left', bold = false, italic = false, sizeHalfPt = 22,
  color = '1F2937', spaceBefore = 0, spaceAfter = 100, bottomRule = false,
} = {}) {
  const borderXml = bottomRule
    ? '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="14532D"/></w:pBdr>'
    : ''
  const rPr = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>',
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    `<w:color w:val="${color}"/>`,
    `<w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/>`,
  ].join('')
  return (
    `<w:p>`
    + `<w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/>${borderXml}</w:pPr>`
    + `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
    + `</w:p>`
  )
}

function wCell(text, { bold = false, shade = '', align = 'left', widthDxa = 4500 } = {}) {
  const shdXml = shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''
  return (
    `<w:tc>`
    + `<w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/>${shdXml}`
    + `<w:tcMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar>`
    + `</w:tcPr>`
    + wParagraph(text, { align, bold, sizeHalfPt: 20, spaceBefore: 20, spaceAfter: 20 })
    + `</w:tc>`
  )
}

function wTable(rowsXml, { bordered = true } = {}) {
  const borderStyle = bordered
    ? '<w:tblBorders>'
      + '<w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
      + '<w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
      + '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
      + '<w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
      + '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
      + '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
      + '</w:tblBorders>'
    : '<w:tblBorders>'
      + '<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>'
      + '<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>'
      + '</w:tblBorders>'
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>${borderStyle}</w:tblPr>${rowsXml.join('')}</w:tbl>`
}

function formatReportDate(isoString) {
  if (!isoString) return new Date().toISOString().slice(0, 10)
  const parsed = new Date(isoString)
  if (Number.isNaN(parsed.getTime())) return String(isoString)
  return parsed.toISOString().slice(0, 10)
}

function buildMatchesTableXml(report) {
  if (Array.isArray(report.capsule_sections)) {
    const header = `<w:tr>`
      + wCell('Capsule Section', { bold: true, shade: 'F1F5F9', widthDxa: 2400 })
      + wCell('Closest Archived Thesis', { bold: true, shade: 'F1F5F9', widthDxa: 4560 })
      + wCell('Similarity', { bold: true, shade: 'F1F5F9', align: 'right', widthDxa: 1200 })
      + wCell('Status', { bold: true, shade: 'F1F5F9', align: 'center', widthDxa: 1200 })
      + `</w:tr>`
    const rows = report.capsule_sections.map((sec) => {
      const closest = sec.closest_thesis
        ? `${sec.closest_thesis.title}${sec.closest_thesis.year ? ` (${sec.closest_thesis.year})` : ''}`
        : 'No closely similar archived thesis'
      return `<w:tr>`
        + wCell(sec.section, { bold: true, widthDxa: 2400 })
        + wCell(closest, { widthDxa: 4560 })
        + wCell(`${Number(sec.similarity_percent || 0).toFixed(1)}%`, { align: 'right', widthDxa: 1200 })
        + wCell(sec.flagged ? 'FLAGGED' : 'Clear', { bold: sec.flagged, align: 'center', widthDxa: 1200 })
        + `</w:tr>`
    })
    return wTable([header, ...rows])
  }

  if (!report.matched_studies.length) {
    return wParagraph('No archived thesis reached the similarity threshold.', {
      italic: true, color: '475569', spaceBefore: 60, spaceAfter: 120,
    })
  }

  const header = `<w:tr>`
    + wCell('Archived Thesis Title', { bold: true, shade: 'F1F5F9', widthDxa: 4560 })
    + wCell('Authors & Year', { bold: true, shade: 'F1F5F9', widthDxa: 2600 })
    + wCell('Program / Track', { bold: true, shade: 'F1F5F9', widthDxa: 1000 })
    + wCell('Similarity', { bold: true, shade: 'F1F5F9', align: 'right', widthDxa: 1200 })
    + `</w:tr>`
  const rows = report.matched_studies.map((study) => {
    const authorYear = [study.authors, study.year].filter(Boolean).join(' · ') || '—'
    return `<w:tr>`
      + wCell(study.title, { bold: true, widthDxa: 4560 })
      + wCell(authorYear, { widthDxa: 2600 })
      + wCell(study.track || '—', { widthDxa: 1000 })
      + wCell(`${Number(study.highest_passage_similarity_percent || 0).toFixed(2)}%`, { align: 'right', widthDxa: 1200 })
      + `</w:tr>`
  })
  return wTable([header, ...rows])
}

function buildSignatoryBlockXml({ adviserName, adviserRole, deanName, deanTitle }) {
  const preparedName = safeText(adviserName) || '____________________________________'
  const preparedRole = safeText(adviserRole) || DEFAULT_ADVISER_ROLE
  const resolvedDeanName = safeText(deanName) || DEFAULT_DEAN_NAME
  const resolvedDeanTitle = safeText(deanTitle) || DEFAULT_DEAN_TITLE

  const sigRow = `<w:tr>`
    + `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>`
    + wParagraph('Prepared / Screened by:', { italic: true, sizeHalfPt: 19, color: '475569', spaceBefore: 80, spaceAfter: 280 })
    + wParagraph(preparedName, { bold: true, sizeHalfPt: 21, spaceBefore: 0, spaceAfter: 20 })
    + wParagraph(preparedRole, { sizeHalfPt: 19, color: '334155', spaceBefore: 0, spaceAfter: 40 })
    + wParagraph('Signature over Printed Name / Date', { italic: true, sizeHalfPt: 17, color: '64748B', spaceBefore: 0, spaceAfter: 40 })
    + `</w:tc>`
    + `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>`
    + wParagraph('Noted and Endorsed by:', { italic: true, sizeHalfPt: 19, color: '475569', spaceBefore: 80, spaceAfter: 280 })
    + wParagraph(resolvedDeanName, { bold: true, sizeHalfPt: 21, spaceBefore: 0, spaceAfter: 20 })
    + wParagraph(resolvedDeanTitle, { bold: true, sizeHalfPt: 19, color: '14532D', spaceBefore: 0, spaceAfter: 40 })
    + wParagraph('Signature over Printed Name / Date', { italic: true, sizeHalfPt: 17, color: '64748B', spaceBefore: 0, spaceAfter: 40 })
    + `</w:tc>`
    + `</w:tr>`

  return wTable([sigRow], { bordered: false })
}

export function buildNoveltyDocxBytes(scan, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString()
  const report = buildNoveltyReport(scan, generatedAt)
  const metrics = scanMetrics(scan)
  const isCapsule = report.source.kind === 'capsule proposal'
  const department = report.source.department || 'CCSICT'
  const summaryText = stripMarkdown(scan?.verdict_summary)

  const summaryRows = [
    ['Submission / Working Title', report.source.filename],
    ['Screening Mode', isCapsule ? 'Capsule Concept Proposal' : 'Full Thesis / Capstone Manuscript'],
    ['College / Department', department],
    ['Screening Date', formatReportDate(report.source.scanned_at || generatedAt)],
    ['Advisory Verdict', `${report.advisory.verdict_label} (Threshold: ${report.advisory.threshold_percent.toFixed(0)}%)`],
    ['Closest Single Archived Thesis', `${metrics.concentration.toFixed(2)}%`],
    ['Highest Passage / Section Similarity', `${report.advisory.highest_passage_similarity_percent.toFixed(2)}%`],
    [
      isCapsule ? 'Sections Flagged' : 'Matched Chunks / Coverage',
      isCapsule
        ? `${report.advisory.matched_chunks} / ${report.advisory.total_chunks} sections`
        : `${report.advisory.matched_chunks} / ${report.advisory.total_chunks} chunks (${report.advisory.matched_chunk_coverage_percent.toFixed(2)}%)`,
    ],
  ].map(([label, value]) => (
    `<w:tr>`
    + wCell(label, { bold: true, shade: 'F8FAFC', widthDxa: 3200 })
    + wCell(value, { widthDxa: 6160 })
    + `</w:tr>`
  ))

  const bodyParts = [
    wParagraph('Republic of the Philippines', { align: 'center', sizeHalfPt: 20, spaceBefore: 0, spaceAfter: 20 }),
    wParagraph('ISABELA STATE UNIVERSITY', { align: 'center', bold: true, sizeHalfPt: 26, color: '14532D', spaceBefore: 0, spaceAfter: 20 }),
    wParagraph('Echague, Isabela', { align: 'center', sizeHalfPt: 20, spaceBefore: 0, spaceAfter: 20 }),
    wParagraph(
      'COLLEGE OF COMPUTING STUDIES, INFORMATION AND COMMUNICATION TECHNOLOGY',
      { align: 'center', bold: true, sizeHalfPt: 20, spaceBefore: 0, spaceAfter: 120, bottomRule: true },
    ),
    wParagraph(
      'THESIS / CAPSTONE NOVELTY & SIMILARITY SCREENING REPORT',
      { align: 'center', bold: true, sizeHalfPt: 24, color: '0F172A', spaceBefore: 160, spaceAfter: 40 },
    ),
    wParagraph(
      'Generated via IskAI Closed-Domain Archive & Semantic Novelty Screening System',
      { align: 'center', italic: true, sizeHalfPt: 18, color: '475569', spaceBefore: 0, spaceAfter: 180 },
    ),
    wParagraph('I. SUBMISSION & SCREENING SUMMARY', { bold: true, sizeHalfPt: 22, color: '14532D', spaceBefore: 120, spaceAfter: 80 }),
    wTable(summaryRows),
    wParagraph(
      isCapsule ? 'II. PER-SECTION ARCHIVE COMPARISON' : 'II. CLOSEST ARCHIVED THESES',
      { bold: true, sizeHalfPt: 22, color: '14532D', spaceBefore: 200, spaceAfter: 80 },
    ),
    buildMatchesTableXml(report),
    ...(summaryText ? [
      wParagraph('III. ADVISORY EXPLANATION', { bold: true, sizeHalfPt: 22, color: '14532D', spaceBefore: 200, spaceAfter: 80 }),
      ...summaryText.split(/\n{2,}/).filter(Boolean).map((para) => (
        wParagraph(para.replace(/\s+/g, ' ').trim(), { sizeHalfPt: 20, spaceBefore: 40, spaceAfter: 80 })
      )),
    ] : []),
    wParagraph('IV. CERTIFICATION & ENDORSEMENT', { bold: true, sizeHalfPt: 22, color: '14532D', spaceBefore: 200, spaceAfter: 60 }),
    wParagraph(
      'This certifies that the above thesis/capstone submission has been screened against the institutional '
      + 'research archive using semantic and lexical similarity analysis. This report is an academic advisory '
      + 'for topic validation and faculty review.',
      { sizeHalfPt: 19, color: '334155', spaceBefore: 0, spaceAfter: 120 },
    ),
    buildSignatoryBlockXml({
      adviserName: options.adviserName,
      adviserRole: options.adviserRole,
      deanName: options.deanName,
      deanTitle: options.deanTitle,
    }),
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440"/></w:sectPr>`,
  ]

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:body>${bodyParts.join('')}</w:body></w:document>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
    + `</Types>`

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
    + `</Relationships>`

  return packZipStore([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: 'word/document.xml', content: documentXml },
  ])
}

function reportSlug(filename) {
  return safeText(filename)
    .toLowerCase()
    .replace(/\.pdf$|\.docx$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'submission'
}

export function downloadNoveltyReport(scan, options = {}) {
  const bytes = buildNoveltyDocxBytes(scan, options)
  const slug = reportSlug(scan?.filename)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `novelty-report-${slug}.docx`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadNoveltyJsonReport(scan) {
  const report = buildNoveltyReport(scan)
  const slug = reportSlug(report.source.filename)
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `novelty-report-${slug}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
