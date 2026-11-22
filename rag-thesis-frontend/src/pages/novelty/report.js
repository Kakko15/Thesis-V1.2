import { normalizePercent, scanMetrics, verdictLabel } from '../../lib/utils.js'
import { APP_MARK_PNG_BASE64, ISU_LOGO_JPEG_BASE64 } from './reportLogos.js'

export const DEFAULT_DEAN_NAME = 'ALBERT A. VINLUAN, DIT'
export const DEFAULT_DEAN_TITLE = 'Dean, CCSICT'
export const DEFAULT_ADVISER_ROLE = 'Thesis / Capstone Adviser'

function safeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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

// Entries carry either XML text or raw bytes (the letterhead images).
function packZipStore(entries) {
  const encoder = new TextEncoder()
  const files = entries.map(({ name, content }) => {
    const nameBytes = encoder.encode(name)
    const dataBytes = content instanceof Uint8Array ? content : encoder.encode(content)
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

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/* ---------- WordprocessingML document builder ---------- */

// ISU green and gold, with slate neutrals for body copy.
const GREEN = '14532D'
const GREEN_TINT = 'EEF6F0'
const GOLD = 'C99A06'
const INK = '1F2937'
const MUTED = '64748B'
const RULE = 'CBD5E1'
const CONTENT_WIDTH = 9360
const EMU_PER_INCH = 914400

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

const VERDICT_TONES = {
  clear: { fill: 'EEF7F0', edge: '15803D', ink: '14532D' },
  review_suggested: { fill: 'FEF6E4', edge: 'B45309', ink: '92400E' },
  high_overlap: { fill: 'FDECEC', edge: 'B91C1C', ink: '991B1B' },
  exact_duplicate: { fill: 'FDECEC', edge: 'B91C1C', ink: '991B1B' },
}

function wRun(text, {
  bold = false, italic = false, sizeHalfPt = 22, color = INK, spacing = 0,
} = {}) {
  const rPr = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    `<w:color w:val="${color}"/>`,
    spacing ? `<w:spacing w:val="${spacing}"/>` : '',
    `<w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/>`,
  ].join('')
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
}

const TAB_RUN = '<w:r><w:tab/></w:r>'

function border(side, { val = 'single', sz = 6, space = 1, color = RULE } = {}) {
  return `<w:${side} w:val="${val}" w:sz="${sz}" w:space="${space}" w:color="${color}"/>`
}

// `content` is plain text or an array of { text, bold, italic, color } runs.
function wParagraph(content, {
  align = 'left', bold = false, italic = false, sizeHalfPt = 22,
  color = INK, spaceBefore = 0, spaceAfter = 100,
  borders = '', shade = '', indentLeft = 0, hanging = 0, keepNext = false,
  spacing = 0, prefixXml = '',
} = {}) {
  const pBdr = borders ? `<w:pBdr>${borders}</w:pBdr>` : ''
  const runs = Array.isArray(content)
    ? content.map((run) => wRun(run.text, {
      bold: run.bold ?? bold, italic: run.italic ?? italic, color: run.color ?? color, sizeHalfPt, spacing,
    })).join('')
    : wRun(content, { bold, italic, sizeHalfPt, color, spacing })
  const pPr = [
    keepNext ? '<w:keepNext/>' : '',
    pBdr,
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    `<w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/>`,
    indentLeft || hanging ? `<w:ind w:left="${indentLeft}" w:hanging="${hanging}"/>` : '',
    `<w:jc w:val="${align}"/>`,
  ].join('')
  return `<w:p><w:pPr>${pPr}</w:pPr>${prefixXml}${runs}</w:p>`
}

function wImageRun({ relId, docPrId, name, descr, widthIn, heightIn }) {
  const cx = Math.round(widthIn * EMU_PER_INCH)
  const cy = Math.round(heightIn * EMU_PER_INCH)
  return '<w:r><w:drawing>'
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${docPrId}" name="${name}" descr="${xmlEscape(descr)}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
}

function wCell(content, {
  bold = false, shade = '', align = 'left', widthDxa = 4500, color = INK,
  sizeHalfPt = 20, vAlign = 'center', borders = '', margins = [90, 140],
} = {}) {
  const shdXml = shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''
  const [vMar, hMar] = margins
  const body = Array.isArray(content) && content.every((part) => typeof part === 'string' && part.startsWith('<w:'))
    ? content.join('')
    : wParagraph(content, { align, bold, color, sizeHalfPt, spaceBefore: 20, spaceAfter: 20 })
  return (
    `<w:tc>`
    + `<w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/>${borders ? `<w:tcBorders>${borders}</w:tcBorders>` : ''}${shdXml}`
    + `<w:tcMar><w:top w:w="${vMar}" w:type="dxa"/><w:bottom w:w="${vMar}" w:type="dxa"/>`
    + `<w:left w:w="${hMar}" w:type="dxa"/><w:right w:w="${hMar}" w:type="dxa"/></w:tcMar>`
    + `<w:vAlign w:val="${vAlign}"/>`
    + `</w:tcPr>`
    + body
    + `</w:tc>`
  )
}

function wRow(cellsXml, { header = false } = {}) {
  const trPr = '<w:cantSplit/>' + (header ? '<w:tblHeader/>' : '')
  return `<w:tr><w:trPr>${trPr}</w:trPr>${cellsXml}</w:tr>`
}

function wTable(rowsXml, widths, { bordered = true } = {}) {
  const lines = bordered
    ? ['top', 'left', 'bottom', 'right'].map((side) => border(side, { sz: 6, space: 0 })).join('')
      + border('insideH', { sz: 4, space: 0, color: 'E2E8F0' })
      + border('insideV', { sz: 4, space: 0, color: 'E2E8F0' })
    : ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="none"/>`).join('')
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblBorders>${lines}</w:tblBorders>`
    + `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml.join('')}</w:tbl>`
}

function sectionHeading(text) {
  return wParagraph(text, {
    bold: true, sizeHalfPt: 23, color: GREEN, spaceBefore: 260, spaceAfter: 100, keepNext: true,
    borders: border('bottom', { sz: 8, space: 3, color: GOLD }),
  })
}

// Always called with the scan date or the (always non-empty) generation time.
function formatReportDate(isoString) {
  const parsed = new Date(isoString)
  if (Number.isNaN(parsed.getTime())) return String(isoString)
  return parsed.toISOString().slice(0, 10)
}

function reportNumber(report, scanId) {
  const stamp = formatReportDate(report.source.scanned_at || report.generated_at).replace(/[^0-9]/g, '').slice(0, 8)
  const seed = new TextEncoder().encode(`${scanId ?? ''}|${report.source.filename}|${report.source.scanned_at ?? report.generated_at}`)
  const hash = crc32(seed).toString(16).toUpperCase().padStart(8, '0').slice(0, 6)
  return `NSR-${stamp || '00000000'}-${hash}`
}

/* ---------- Advisory explanation: a small Markdown subset ---------- */

// Bold, italic and code spans become runs; stray emphasis markers are dropped.
function inlineRuns(text) {
  const runs = []
  const pattern = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|`(.+?)`/g
  let last = 0
  let match = pattern.exec(text)
  while (match) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) })
    if (match[1]) runs.push({ text: match[1], bold: true, italic: true })
    else if (match[2] || match[3]) runs.push({ text: match[2] || match[3], bold: true })
    else runs.push({ text: match[4] || match[5], italic: Boolean(match[4]) })
    last = pattern.lastIndex
    match = pattern.exec(text)
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs
    .map((run) => ({ ...run, text: run.text.replace(/\*+/g, '') }))
    .filter((run) => run.text.length > 0)
}

function hasText(runs) {
  return runs.some((run) => run.text.trim())
}

function advisoryXml(markdown) {
  const blocks = []
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /^([-*_])(\s*\1){2,}$/.test(trimmed)) continue

    const heading = trimmed.match(/^#{1,6}\s+(.*)$/) || trimmed.match(/^\*\*([^*]{1,120})\*\*:?$/)
    if (heading) {
      const runs = inlineRuns(heading[1]).map((run) => ({ ...run, bold: true }))
      if (hasText(runs)) {
        blocks.push(wParagraph(runs, { sizeHalfPt: 21, color: GREEN, spaceBefore: 160, spaceAfter: 60, keepNext: true }))
      }
      continue
    }

    const item = line.match(/^(\s*)(?:([*+-])|(\d+)[.)])\s+(.*)$/)
    if (item) {
      const runs = inlineRuns(item[4])
      if (!hasText(runs)) continue
      const level = item[1].length >= 2 ? 1 : 0
      const marker = item[2] ? (level ? '◦' : '•') : `${item[3]}.`
      blocks.push(wParagraph(runs, {
        sizeHalfPt: 20, spaceBefore: 20, spaceAfter: 60, indentLeft: 360 + level * 360, hanging: 300, align: 'both',
        prefixXml: wRun(marker, { sizeHalfPt: 20, color: GREEN, bold: true }) + TAB_RUN,
      }))
      continue
    }

    const runs = inlineRuns(trimmed)
    if (hasText(runs)) blocks.push(wParagraph(runs, { sizeHalfPt: 20, spaceBefore: 40, spaceAfter: 80, align: 'both' }))
  }
  return blocks
}

/* ---------- Report sections ---------- */

const LOGO_REL = 'rIdIsuLogo'
const MARK_REL = 'rIdAppMark'
const FOOTER_REL = 'rIdFooter'

function letterheadXml() {
  const side = 1500
  const middle = CONTENT_WIDTH - side * 2
  const center = [
    wParagraph('Republic of the Philippines', { align: 'center', sizeHalfPt: 19, color: '374151', spaceAfter: 0 }),
    wParagraph('ISABELA STATE UNIVERSITY', { align: 'center', bold: true, sizeHalfPt: 30, color: GREEN, spaceAfter: 0, spacing: 10 }),
    wParagraph('Echague, Isabela', { align: 'center', sizeHalfPt: 19, color: '374151', spaceAfter: 60 }),
    wParagraph('College of Computing Studies, Information and Communication Technology', {
      align: 'center', bold: true, sizeHalfPt: 19, color: GOLD, spaceAfter: 0,
    }),
  ]
  const logoCell = wCell([
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/></w:pPr>${wImageRun({
      relId: LOGO_REL, docPrId: 1, name: 'ISU Seal', descr: 'Isabela State University seal', widthIn: 0.98, heightIn: 0.98,
    })}</w:p>`,
  ], { widthDxa: side, margins: [0, 0] })
  const markCell = wCell([
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="right"/></w:pPr>${wImageRun({
      relId: MARK_REL, docPrId: 2, name: 'IskAI Mark', descr: 'IskAI, ISU Thesis AI Library mark', widthIn: 0.8, heightIn: 0.8,
    })}</w:p>`,
    wParagraph('IskAI', { align: 'right', bold: true, sizeHalfPt: 17, color: GREEN, spaceAfter: 0, spacing: 8 }),
  ], { widthDxa: side, margins: [0, 0] })
  return [
    wTable([wRow(logoCell + wCell(center, { widthDxa: middle, margins: [0, 60] }) + markCell)], [side, middle, side], { bordered: false }),
    wParagraph('', {
      sizeHalfPt: 8, spaceBefore: 0, spaceAfter: 0,
      borders: border('bottom', { val: 'thickThinSmallGap', sz: 24, space: 1, color: GREEN }),
    }),
  ]
}

function titleBlockXml(report, scanId, generatedAt) {
  const pad = (side) => border(side, { sz: 4, space: 6, color: GREEN })
  return [
    wParagraph('THESIS / CAPSTONE NOVELTY & SIMILARITY SCREENING REPORT', {
      align: 'center', bold: true, sizeHalfPt: 25, color: 'FFFFFF', spaceBefore: 220, spaceAfter: 0, spacing: 8,
      shade: GREEN, borders: pad('top') + pad('bottom') + pad('left') + pad('right'),
    }),
    wParagraph('Generated via IskAI Closed-Domain Archive & Semantic Novelty Screening System', {
      align: 'center', italic: true, sizeHalfPt: 18, color: '475569', spaceBefore: 100, spaceAfter: 20,
    }),
    wParagraph([
      { text: 'Report No. ', color: MUTED },
      { text: reportNumber(report, scanId), bold: true, color: INK },
      { text: '   |   Generated ', color: MUTED },
      { text: formatReportDate(generatedAt), bold: true, color: INK },
    ], { align: 'center', sizeHalfPt: 17, spaceAfter: 120 }),
  ]
}

function verdictCalloutXml(report, metrics, isCapsule) {
  const tone = VERDICT_TONES[report.advisory.verdict_code] || VERDICT_TONES.clear
  const facts = isCapsule
    ? `Highest section similarity ${report.advisory.highest_passage_similarity_percent.toFixed(2)}%   ·   `
      + `Sections flagged ${report.advisory.matched_chunks} of ${report.advisory.total_chunks}   ·   `
      + `Threshold ${report.advisory.threshold_percent.toFixed(0)}%`
    : `Highest passage similarity ${report.advisory.highest_passage_similarity_percent.toFixed(2)}%   ·   `
      + `Closest single thesis ${metrics.concentration.toFixed(2)}%   ·   `
      + `Coverage ${report.advisory.matched_chunk_coverage_percent.toFixed(2)}%   ·   `
      + `Threshold ${report.advisory.threshold_percent.toFixed(0)}%`
  const edges = border('left', { sz: 36, space: 0, color: tone.edge })
    + ['top', 'bottom', 'right'].map((side) => border(side, { sz: 4, space: 0, color: tone.edge })).join('')
  const cell = wCell([
    wParagraph('ADVISORY VERDICT', { bold: true, sizeHalfPt: 15, color: MUTED, spacing: 20, spaceAfter: 20 }),
    wParagraph(report.advisory.verdict_label.toUpperCase(), { bold: true, sizeHalfPt: 30, color: tone.ink, spaceAfter: 40 }),
    wParagraph(facts, { sizeHalfPt: 18, color: '334155', spaceAfter: 0 }),
  ], { widthDxa: CONTENT_WIDTH, shade: tone.fill, borders: edges, margins: [140, 240] })
  return wTable([wRow(cell)], [CONTENT_WIDTH], { bordered: false })
}

function headerCell(text, widthDxa, align = 'left') {
  return wCell(text, { bold: true, shade: GREEN, color: 'FFFFFF', align, widthDxa, sizeHalfPt: 19 })
}

function buildMatchesTableXml(report) {
  const threshold = report.advisory.threshold_percent
  if (Array.isArray(report.capsule_sections)) {
    const widths = [2400, 4560, 1200, 1200]
    const header = wRow(
      headerCell('Capsule Section', widths[0])
      + headerCell('Closest Archived Thesis', widths[1])
      + headerCell('Similarity', widths[2], 'right')
      + headerCell('Status', widths[3], 'center'),
      { header: true },
    )
    const rows = report.capsule_sections.map((sec, index) => {
      const shade = index % 2 ? 'F8FAFC' : ''
      const closest = sec.closest_thesis
        ? `${sec.closest_thesis.title}${sec.closest_thesis.year ? ` (${sec.closest_thesis.year})` : ''}`
        : 'No closely similar archived thesis'
      return wRow(
        wCell(sec.section, { bold: true, widthDxa: widths[0], shade })
        + wCell(closest, { widthDxa: widths[1], shade })
        + wCell(`${Number(sec.similarity_percent || 0).toFixed(1)}%`, { align: 'right', widthDxa: widths[2], shade })
        + wCell(sec.flagged ? 'FLAGGED' : 'Clear', {
          bold: true, align: 'center', widthDxa: widths[3], color: sec.flagged ? 'B91C1C' : '15803D', shade,
        }),
      )
    })
    return wTable([header, ...rows], widths)
  }

  if (!report.matched_studies.length) {
    return wParagraph('No archived thesis reached the similarity threshold.', {
      italic: true, color: '475569', spaceBefore: 60, spaceAfter: 120,
    })
  }

  const widths = [4360, 2500, 1200, 1300]
  const header = wRow(
    headerCell('Archived Thesis Title', widths[0])
    + headerCell('Authors & Year', widths[1])
    + headerCell('Program / Track', widths[2])
    + headerCell('Similarity', widths[3], 'right'),
    { header: true },
  )
  const rows = report.matched_studies.map((study, index) => {
    const shade = index % 2 ? 'F8FAFC' : ''
    const authorYear = [study.authors, study.year].filter(Boolean).join(' · ') || '—'
    const similarity = Number(study.highest_passage_similarity_percent || 0)
    return wRow(
      wCell(study.title, { bold: true, widthDxa: widths[0], shade })
      + wCell(authorYear, { widthDxa: widths[1], shade })
      + wCell(study.track || '—', { widthDxa: widths[2], shade })
      + wCell(`${similarity.toFixed(2)}%`, {
        bold: true, align: 'right', widthDxa: widths[3], shade, color: similarity >= threshold ? 'B45309' : INK,
      }),
    )
  })
  return wTable([header, ...rows], widths)
}

// The signature rule sits above the printed name; with no name supplied the
// line is left blank for the signatory to print theirs by hand.
function signatoryCellXml(label, name, role, roleColor) {
  return wCell([
    wParagraph(label, { italic: true, sizeHalfPt: 19, color: '475569', spaceBefore: 80, spaceAfter: 560 }),
    wParagraph(name || '\u00a0', {
      bold: true, sizeHalfPt: 21, spaceAfter: 20,
      borders: border('top', { sz: 6, space: 4, color: '475569' }),
    }),
    wParagraph(role, { bold: roleColor === GREEN, sizeHalfPt: 19, color: roleColor, spaceAfter: 40 }),
    wParagraph('Signature over Printed Name / Date', { italic: true, sizeHalfPt: 17, color: MUTED, spaceAfter: 40 }),
  ], { widthDxa: CONTENT_WIDTH / 2, vAlign: 'top', margins: [0, 200] })
}

function buildSignatoryBlockXml({ adviserName, adviserRole, deanName, deanTitle }) {
  const preparedName = safeText(adviserName)
  const preparedRole = safeText(adviserRole) || DEFAULT_ADVISER_ROLE
  const resolvedDeanName = safeText(deanName) || DEFAULT_DEAN_NAME
  const resolvedDeanTitle = safeText(deanTitle) || DEFAULT_DEAN_TITLE

  const sigRow = wRow(
    signatoryCellXml('Prepared / Screened by:', preparedName, preparedRole, '334155')
    + signatoryCellXml('Noted and Endorsed by:', resolvedDeanName, resolvedDeanTitle, GREEN),
  )
  return wTable([sigRow], [CONTENT_WIDTH / 2, CONTENT_WIDTH / 2], { bordered: false })
}

function footerXml() {
  const small = { sizeHalfPt: 16, color: MUTED }
  // Every field run carries the footer size, or Word redraws the number at 11 pt.
  const fieldRPr = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/>'
    + `<w:color w:val="${INK}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>`
  const field = (instr) => `<w:r>${fieldRPr}<w:fldChar w:fldCharType="begin"/></w:r>`
    + `<w:r>${fieldRPr}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>`
    + `<w:r>${fieldRPr}<w:fldChar w:fldCharType="separate"/></w:r>`
    + wRun('1', { ...small, bold: true, color: INK })
    + `<w:r>${fieldRPr}<w:fldChar w:fldCharType="end"/></w:r>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>`
    + '<w:p><w:pPr>'
    + `<w:pBdr>${border('top', { sz: 6, space: 6, color: GOLD })}</w:pBdr>`
    + `<w:tabs><w:tab w:val="right" w:pos="${CONTENT_WIDTH}"/></w:tabs><w:spacing w:before="0" w:after="0"/>`
    + '</w:pPr>'
    + wRun('IskAI', { ...small, bold: true, color: GREEN })
    + wRun('  ·  ISU Thesis AI Library  ·  Novelty & Similarity Screening Report  ·  Advisory, not a plagiarism verdict', small)
    + TAB_RUN
    + wRun('Page ', small) + field('PAGE') + wRun(' of ', small) + field('NUMPAGES')
    + '</w:p></w:ftr>'
}

export function buildNoveltyDocxBytes(scan, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString()
  const report = buildNoveltyReport(scan, generatedAt)
  const metrics = scanMetrics(scan)
  const isCapsule = report.source.kind === 'capsule proposal'
  const department = report.source.department || 'CCSICT'
  const summaryText = safeText(scan?.verdict_summary)

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
  ].map(([label, value]) => wRow(
    wCell(label, { bold: true, shade: GREEN_TINT, color: GREEN, widthDxa: 3200 })
    + wCell(value, { widthDxa: 6160 }),
  ))

  const advisoryBlocks = summaryText ? advisoryXml(summaryText) : []

  const bodyParts = [
    ...letterheadXml(),
    ...titleBlockXml(report, scan?.id, generatedAt),
    verdictCalloutXml(report, metrics, isCapsule),
    sectionHeading('I. SUBMISSION & SCREENING SUMMARY'),
    wTable(summaryRows, [3200, 6160]),
    sectionHeading(isCapsule ? 'II. PER-SECTION ARCHIVE COMPARISON' : 'II. CLOSEST ARCHIVED THESES'),
    buildMatchesTableXml(report),
    ...(advisoryBlocks.length ? [sectionHeading('III. ADVISORY EXPLANATION'), ...advisoryBlocks] : []),
    sectionHeading('IV. CERTIFICATION & ENDORSEMENT'),
    wParagraph(
      'This certifies that the above thesis/capstone submission has been screened against the institutional '
      + 'research archive using semantic and lexical similarity analysis. This report is an academic advisory '
      + 'for topic validation and faculty review.',
      { sizeHalfPt: 19, color: '334155', spaceBefore: 0, spaceAfter: 160, align: 'both', keepNext: true },
    ),
    buildSignatoryBlockXml({
      adviserName: options.adviserName,
      adviserRole: options.adviserRole,
      deanName: options.deanName,
      deanTitle: options.deanTitle,
    }),
    `<w:sectPr><w:footerReference w:type="default" r:id="${FOOTER_REL}"/>`
    + '<w:pgSz w:w="12240" w:h="15840"/>'
    + '<w:pgMar w:top="864" w:right="1440" w:bottom="1080" w:left="1440" w:header="540" w:footer="540" w:gutter="0"/>'
    + '</w:sectPr>',
  ]

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document ${NS}>`
    + `<w:body>${bodyParts.join('')}</w:body></w:document>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="jpeg" ContentType="image/jpeg"/>`
    + `<Default Extension="png" ContentType="image/png"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
    + `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`
    + `</Types>`

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
    + `</Relationships>`

  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="${LOGO_REL}" Type="${rel}/image" Target="media/isu-logo.jpeg"/>`
    + `<Relationship Id="${MARK_REL}" Type="${rel}/image" Target="media/iskai-mark.png"/>`
    + `<Relationship Id="${FOOTER_REL}" Type="${rel}/footer" Target="footer1.xml"/>`
    + `</Relationships>`

  return packZipStore([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: documentRelsXml },
    { name: 'word/footer1.xml', content: footerXml() },
    { name: 'word/media/isu-logo.jpeg', content: base64ToBytes(ISU_LOGO_JPEG_BASE64) },
    { name: 'word/media/iskai-mark.png', content: base64ToBytes(APP_MARK_PNG_BASE64) },
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
