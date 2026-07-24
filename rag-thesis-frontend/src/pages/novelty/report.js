import { normalizePercent, scanMetrics, verdictLabel } from '../../lib/utils.js'

function safeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildNoveltyReport(scan, generatedAt = new Date().toISOString()) {
  const metrics = scanMetrics(scan)
  return {
    report_version: '2026-07-25',
    generated_at: generatedAt,
    scope: 'metadata-only novelty advisory',
    source: {
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
    limitations: [
      'This screening is advisory and does not determine plagiarism.',
      'Highest passage similarity and matched-chunk coverage measure different properties.',
      'A qualified faculty reviewer must interpret the result in academic context.',
      'Uploaded and archived manuscript excerpts are intentionally excluded from this export.',
    ],
  }
}

export function downloadNoveltyReport(scan) {
  const report = buildNoveltyReport(scan)
  const slug = report.source.filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'submission'
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `novelty-report-${slug}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
