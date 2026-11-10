import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_COMPARE_PAPERS,
  buildComparisonPrompt,
  buildReadingListExport,
  formatApaCitation,
  formatAuthorsApa,
  formatBibtexCitation,
  getReadingListSnapshot,
  parseSavedPaperIds,
  readSavedPaperIds,
  readingListStorageKey,
  subscribeReadingList,
  toSentenceCaseTitle,
  toggleComparePaperId,
  toggleSavedPaperId,
  writeSavedPaperIds,
} from './researchTools.js'

describe('toSentenceCaseTitle', () => {
  it('converts all-caps titles to sentence case while preserving known acronyms and capitalizing after colons', () => {
    assert.equal(
      toSentenceCaseTitle('MANGO FRUIT QUALITY DETECTION AND CLASSIFICATION USING CONVOLUTIONAL NEURAL NETWORK'),
      'Mango fruit quality detection and classification using convolutional neural network',
    )
    assert.equal(
      toSentenceCaseTitle('ISU-CANNER: A DOCUMENT MONITORING SYSTEM FOR CCSICT USING AI AND RAG'),
      'ISU-CANNER: A document monitoring system for CCSICT using AI and RAG',
    )
    assert.equal(
      toSentenceCaseTitle('A CENTRALIZED AI-POWERED THESIS LIBRARY FOR IOT-BASED SYSTEMS'),
      'A centralized AI-powered thesis library for IoT-based systems',
    )
    assert.equal(
      toSentenceCaseTitle('Students’ Assessment of Reader’s Services at Isabela State University – Echague Campus: Basis for Designing a Mobile-Based Library Management System'),
      'Students’ Assessment of Reader’s Services at Isabela State University – Echague Campus: Basis for Designing a Mobile-Based Library Management System',
    )
    assert.equal(toSentenceCaseTitle(''), 'Untitled study')
  })
})

describe('formatAuthorsApa', () => {
  it('formats single, dual, and multi-author strings including compound Filipino surnames in APA 7th style', () => {
    assert.equal(
      formatAuthorsApa('Carl Rainier M. Manalili, Angelyn B. Dela Cruz'),
      'Manalili, C. R. M., & Dela Cruz, A. B.',
    )
    assert.equal(
      formatAuthorsApa('Jahron Jake V. Ebersole'),
      'Ebersole, J. J. V.',
    )
    assert.equal(
      formatAuthorsApa('Fernando D. Pagbilao Jr., Rosel V. Mina'),
      'Pagbilao, F. D., Jr., & Mina, R. V.',
    )
    assert.equal(
      formatAuthorsApa('Rainier Aquino, Kurt Robin Enoy, Chris Lloyd San Jose'),
      'Aquino, R., Enoy, K. R., & San Jose, C. L.',
    )
    assert.equal(formatAuthorsApa(''), 'Anonymous')
    assert.equal(formatAuthorsApa('Unknown authors'), 'Anonymous')
  })
})

describe('formatApaCitation & formatBibtexCitation', () => {
  it('formats undergraduate and faculty theses in APA 7th and BibTeX formats', () => {
    const studentPaper = {
      id: 'p-1',
      title: 'MANGO FRUIT QUALITY DETECTION USING CNN',
      authors: 'Carl Rainier M. Manalili, Angelyn B. Dela Cruz',
      year: 2024,
      department: 'CCSICT',
      track: 'BSCS',
      thesis_category: 'student',
    }
    const apa = formatApaCitation(studentPaper)
    assert.equal(
      apa,
      'Manalili, C. R. M., & Dela Cruz, A. B. (2024). Mango fruit quality detection using CNN [Undergraduate thesis, Isabela State University – Echague Campus]. CCSICT Thesis Archive.',
    )

    const facultyPaper = {
      id: 'p-2',
      title: 'A Centralized AI-Powered Thesis Library',
      authors: 'Joe G. Lagarteja',
      year: null,
      department: 'CCSICT',
      thesis_category: 'faculty',
    }
    assert.equal(
      formatApaCitation(facultyPaper),
      'Lagarteja, J. G. (n.d.). A Centralized AI-Powered Thesis Library [Faculty research, Isabela State University – Echague Campus]. CCSICT Thesis Archive.',
    )

    const bib = formatBibtexCitation(studentPaper)
    assert.match(bib, /^@mastersthesis\{manalili2024mango,/)
    assert.match(bib, /author = \{Carl Rainier M\. Manalili and Angelyn B\. Dela Cruz\}/)
    assert.match(bib, /year = \{2024\}/)
    assert.match(bib, /note = \{Track: BSCS\}/)
  })
})

describe('readingList & comparison helpers', () => {
  it('manages saved paper IDs and enforces the 3-paper comparison cap', () => {
    assert.equal(readingListStorageKey('u-1'), 'iskai_reading_list_u-1')
    assert.equal(readingListStorageKey(''), 'iskai_reading_list_guest')
    assert.deepEqual(parseSavedPaperIds('invalid-json'), [])
    assert.deepEqual(parseSavedPaperIds(JSON.stringify(['a', 'a', '', 12])), ['a', '12'])

    const s1 = toggleSavedPaperId([], 'p-1')
    assert.deepEqual(s1, { nextIds: ['p-1'], saved: true })
    const s2 = toggleSavedPaperId(s1.nextIds, 'p-1')
    assert.deepEqual(s2, { nextIds: [], saved: false })

    assert.equal(MAX_COMPARE_PAPERS, 3)
    const c1 = toggleComparePaperId(['1', '2'], '3')
    assert.deepEqual(c1, { nextIds: ['1', '2', '3'], added: true, capped: false })
    const cCap = toggleComparePaperId(c1.nextIds, '4')
    assert.deepEqual(cCap, { nextIds: ['1', '2', '3'], added: false, capped: true })
    const cRemove = toggleComparePaperId(c1.nextIds, '2')
    assert.deepEqual(cRemove, { nextIds: ['1', '3'], added: false, capped: false })
  })

  it('builds structured RRL comparison prompts and downloadable reading-list exports', () => {
    const papers = [
      { id: '1', title: 'STUDY ONE', authors: 'A. Author', year: 2024, track: 'BSCS' },
      { id: '2', title: 'STUDY TWO', authors: 'B. Researcher', year: 2026, track: 'BLIS' },
    ]
    const prompt = buildComparisonPrompt(papers)
    assert.match(prompt, /Compare the following 2 archived theses/)
    assert.match(prompt, /"STUDY ONE" \(2024, BSCS\)/)
    assert.match(prompt, /"STUDY TWO" \(2026, BLIS\)/)
    assert.equal(buildComparisonPrompt([]), '')

    const exported = buildReadingListExport(papers)
    assert.match(exported, /ISKAI THESIS ARCHIVE — SAVED RRL READING LIST \(2 STUDIES\)/)
    assert.match(exported, /APA 7TH EDITION REFERENCES/)
    assert.match(exported, /BIBTEX ENTRIES/)

    // SSR / Node environment fallbacks
    assert.deepEqual(readSavedPaperIds('u-1'), [])
    assert.equal(getReadingListSnapshot('u-1'), '[]')
    const unsub = subscribeReadingList(() => {})
    assert.equal(typeof unsub, 'function')
    unsub()
    writeSavedPaperIds('u-1', ['1'])
  })
})
