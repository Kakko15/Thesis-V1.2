import assert from 'node:assert/strict'
import test from 'node:test'

import { pageLabel, passageRows, readableReportText } from './reportView.js'

test('raw verdict levels and orphan citation markers are cleaned for display', () => {
  assert.equal(
    readableReportText('Advisory level: high_overlap. See `review_suggested` [1] and [2, 3]; level `clear`. [the source](https://x.test)'),
    'Advisory level: High overlap—faculty review required. See Review suggested and; level Clear. [the source](https://x.test)',
  )
  assert.equal(readableReportText('exact_duplicate'), 'Exact duplicate—not indexed')
  assert.equal(readableReportText(undefined), '')
})

test('page labels cover single pages, ranges and unknown pages', () => {
  assert.equal(pageLabel(3, 3), 'p. 3')
  assert.equal(pageLabel(3, null), 'p. 3')
  assert.equal(pageLabel(3, 5), 'pp. 3–5')
  assert.equal(pageLabel(null, 5), '')
  assert.equal(pageLabel(0, 0), '')
})

test('passage rows pair your own text with archived citation metadata, strongest first', () => {
  const rows = passageRows({
    matched_passages: [
      { title: 'ISU-CANNER', year: 2025, similarity: 88, excerpt: 'mine A', uploaded_page_start: 2, uploaded_page_end: 3,
        archived_section: 'Methodology', archived_page_start: 7, archived_page_end: 7 },
      { similarity: '93.5', excerpt: 'mine B', section: 'Objectives' },
      { similarity: 99, excerpt: '' },
      null,
    ],
  })
  assert.deepEqual(rows, [
    { title: 'Archived thesis', year: null, similarity: 93.5, excerpt: 'mine B', yourWhere: 'Objectives', archivedWhere: '' },
    { title: 'ISU-CANNER', year: 2025, similarity: 88, excerpt: 'mine A', yourWhere: 'pp. 2–3', archivedWhere: 'Methodology, p. 7' },
  ])
  assert.deepEqual(passageRows({ matched_passages: [{ excerpt: 'x', similarity: 'n/a' }] })[0].yourWhere, 'Your manuscript')
  assert.deepEqual(passageRows({}), [])
  assert.deepEqual(passageRows(null), [])
})
