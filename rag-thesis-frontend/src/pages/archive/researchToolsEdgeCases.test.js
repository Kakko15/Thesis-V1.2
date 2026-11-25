import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SAVED_PAPERS,
  READING_LIST_EVENT,
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

describe('toSentenceCaseTitle edge cases', () => {
  it('returns the fallback for non-string or blank titles', () => {
    assert.equal(toSentenceCaseTitle(undefined), 'Untitled study')
    assert.equal(toSentenceCaseTitle(42), 'Untitled study')
    assert.equal(toSentenceCaseTitle('   '), 'Untitled study')
  })

  it('leaves letterless titles untouched and sentence-cases mixed-case ones', () => {
    assert.equal(toSentenceCaseTitle('  2024   ---  '), '2024 ---')
    assert.equal(toSentenceCaseTitle('Mostly Mixed Case Title'), 'Mostly mixed case title')
    assert.equal(toSentenceCaseTitle('Intro: — Part Two'), 'Intro: — Part two')
  })

  it('handles hyphenated acronyms, colons after acronyms and punctuation-only tokens', () => {
    assert.equal(
      toSentenceCaseTitle('USING RAG: A STUDY OF QR-CODE AND RFID-BASED E-LEARNING — PART TWO'),
      'Using RAG: A study of QR-code and RFID-based e-learning — part two',
    )
    assert.equal(toSentenceCaseTitle('HELLO: WORLD-WIDE WEB'), 'Hello: World-wide web')
  })
})

describe('formatAuthorsApa edge cases', () => {
  it('returns Anonymous for non-string, unknown or title-only author strings', () => {
    assert.equal(formatAuthorsApa(null), 'Anonymous')
    assert.equal(formatAuthorsApa('unknown'), 'Anonymous')
    assert.equal(formatAuthorsApa('PhD; Engr'), 'Anonymous')
  })

  it('keeps single names, ignores suffixes on two-part names, and drops letterless initials', () => {
    assert.equal(formatAuthorsApa('Plato'), 'Plato')
    // Only names with more than two parts treat a trailing token as a suffix.
    assert.equal(formatAuthorsApa('Smith Jr'), 'Jr, S.')
    // A compound-surname prefix only applies when a given name precedes it.
    assert.equal(formatAuthorsApa('Del Pilar'), 'Pilar, D.')
    assert.equal(formatAuthorsApa('Juan Del Pilar'), 'Del Pilar, J.')
    // Given-name tokens without letters contribute no initial.
    assert.equal(formatAuthorsApa('Ana 3 Reyes'), 'Reyes, A.')
    assert.equal(formatAuthorsApa('123 Smith'), 'Smith')
    assert.equal(formatAuthorsApa('123 456 Smith Jr.'), 'Smith, Jr.')
  })

  it('joins two authors with an ampersand and three or more with a serial comma', () => {
    assert.equal(formatAuthorsApa('Ana Reyes and Ben Cruz'), 'Reyes, A., & Cruz, B.')
    assert.equal(formatAuthorsApa('Ana Reyes & Ben Cruz; Carl Diaz'), 'Reyes, A., Cruz, B., & Diaz, C.')
  })
})

describe('citation formatting fallbacks', () => {
  it('builds an APA citation for an empty paper', () => {
    assert.equal(
      formatApaCitation(undefined),
      'Anonymous (n.d.). Untitled study [Undergraduate thesis, Isabela State University – Echague Campus]. ISU Thesis Archive.',
    )
    assert.equal(
      formatApaCitation({ title: 'A study.', department: '   ', year: 2020, authors: 'Plato' }),
      'Plato (2020). A study [Undergraduate thesis, Isabela State University – Echague Campus]. ISU Thesis Archive.',
    )
    assert.match(formatApaCitation({ department: 42 }), /ISU Thesis Archive\.$/)
  })

  it('builds a BibTeX entry with fallback key parts and no track note', () => {
    assert.equal(
      formatBibtexCitation(undefined),
      '@thesis{anonymousndstudy,\n'
        + '  title = {Untitled study},\n'
        + '  author = {Anonymous},\n'
        + '  year = {n.d.},\n'
        + '  type = {Undergraduate thesis},\n'
        + '  institution = {Isabela State University -- Echague Campus (CCSICT)}\n'
        + '}',
    )
    const bib = formatBibtexCitation({
      authors: 'Unknown authors',
      title: 'The AI of it',
      department: '  CAS  ',
      year: 2021,
    })
    assert.match(bib, /^@thesis\{anonymous2021study,/)
    assert.match(bib, /author = \{Anonymous\}/)
    assert.match(bib, /institution = \{Isabela State University -- Echague Campus \(CAS\)\}\n\}$/)
    assert.doesNotMatch(bib, /note = /)
  })

  it('falls back to "thesis" when the first surname has no ASCII letters or digits', () => {
    const bib = formatBibtexCitation({ authors: '李 王 & Ana Reyes', title: 'Robotics study', year: 2022 })
    assert.match(bib, /^@thesis\{thesis2022robotics,/)
    assert.match(bib, /author = \{李 王 and Ana Reyes\}/)
    assert.equal(formatBibtexCitation({ authors: '   ', title: 42 }).split('\n')[2], '  author = {Anonymous},')
  })
})

describe('saved paper id parsing', () => {
  it('rejects non-string, blank and non-array payloads', () => {
    assert.deepEqual(parseSavedPaperIds(null), [])
    assert.deepEqual(parseSavedPaperIds('   '), [])
    assert.deepEqual(parseSavedPaperIds('{"a":1}'), [])
  })

  it('skips null, blank and duplicate ids and caps the list', () => {
    assert.deepEqual(parseSavedPaperIds(JSON.stringify([null, ' x ', '  ', 'x', 7])), ['x', '7'])
    const many = Array.from({ length: MAX_SAVED_PAPERS + 5 }, (_, idx) => `p${idx}`)
    const parsed = parseSavedPaperIds(JSON.stringify(many))
    assert.equal(parsed.length, MAX_SAVED_PAPERS)
    assert.equal(parsed.at(-1), `p${MAX_SAVED_PAPERS - 1}`)
  })

  it('uses the guest key for non-string or blank user ids and trims real ones', () => {
    assert.equal(readingListStorageKey(undefined), 'iskai_reading_list_guest')
    assert.equal(readingListStorageKey(5), 'iskai_reading_list_guest')
    assert.equal(readingListStorageKey('  u-9  '), 'iskai_reading_list_u-9')
  })
})

describe('browser reading-list storage', () => {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const originalWindow = globalThis.window
  let store
  let listeners
  let dispatched

  function installWindow(localStorage) {
    globalThis.window = {
      localStorage,
      addEventListener: (type, fn) => listeners.push(['add', type, fn]),
      removeEventListener: (type, fn) => listeners.push(['remove', type, fn]),
      dispatchEvent: (event) => {
        dispatched.push(event)
        return true
      },
    }
  }

  beforeEach(() => {
    store = new Map()
    listeners = []
    dispatched = []
    installWindow({
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    })
  })

  afterEach(() => {
    if (hadWindow) globalThis.window = originalWindow
    else delete globalThis.window
  })

  it('writes, reads and snapshots ids through localStorage and announces the change', () => {
    assert.deepEqual(readSavedPaperIds('u-1'), [])
    assert.equal(getReadingListSnapshot('u-1'), '[]')

    writeSavedPaperIds('u-1', ['a', 'b'])
    assert.equal(store.get('iskai_reading_list_u-1'), '["a","b"]')
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, READING_LIST_EVENT)
    assert.deepEqual(dispatched[0].detail, { userId: 'u-1', ids: ['a', 'b'] })

    assert.deepEqual(readSavedPaperIds('u-1'), ['a', 'b'])
    assert.equal(getReadingListSnapshot('u-1'), '["a","b"]')
  })

  it('subscribes to both the custom and storage events and unsubscribes from both', () => {
    const callback = () => {}
    const unsubscribe = subscribeReadingList(callback)
    assert.deepEqual(listeners, [
      ['add', READING_LIST_EVENT, callback],
      ['add', 'storage', callback],
    ])
    unsubscribe()
    assert.deepEqual(listeners.slice(2), [
      ['remove', READING_LIST_EVENT, callback],
      ['remove', 'storage', callback],
    ])
  })

  it('swallows storage errors from private browsing or quota limits', () => {
    installWindow({
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    assert.deepEqual(readSavedPaperIds('u-1'), [])
    assert.equal(getReadingListSnapshot('u-1'), '[]')
    assert.doesNotThrow(() => writeSavedPaperIds('u-1', ['a']))
    assert.equal(dispatched.length, 0)
  })
})

describe('toggle helpers with malformed input', () => {
  it('ignores blank paper ids and coerces non-array lists', () => {
    assert.deepEqual(toggleSavedPaperId('nope', null), { nextIds: [], saved: false })
    assert.deepEqual(toggleSavedPaperId([1, 2], undefined), { nextIds: ['1', '2'], saved: false })
    assert.deepEqual(toggleSavedPaperId([1], '  '), { nextIds: ['1'], saved: false })
    assert.deepEqual(toggleSavedPaperId(null, 3), { nextIds: ['3'], saved: true })

    assert.deepEqual(toggleComparePaperId(undefined, null), { nextIds: [], added: false, capped: false })
    assert.deepEqual(toggleComparePaperId([1], undefined), { nextIds: ['1'], added: false, capped: false })
    assert.deepEqual(toggleComparePaperId({}, 9), { nextIds: ['9'], added: true, capped: false })
  })

  it('caps the saved list at the maximum, dropping the oldest', () => {
    const full = Array.from({ length: MAX_SAVED_PAPERS }, (_, idx) => `p${idx}`)
    const { nextIds, saved } = toggleSavedPaperId(full, 'new')
    assert.equal(saved, true)
    assert.equal(nextIds.length, MAX_SAVED_PAPERS)
    assert.equal(nextIds[0], 'new')
    assert.equal(nextIds.includes(`p${MAX_SAVED_PAPERS - 1}`), false)
  })
})

describe('comparison prompt and export fallbacks', () => {
  it('skips untitled papers, omits empty metadata and rejects non-arrays', () => {
    assert.equal(buildComparisonPrompt(null), '')
    assert.equal(buildComparisonPrompt([null, { year: 2020 }]), '')
    const prompt = buildComparisonPrompt([
      { title: 'Solo' },
      { title: 'Year only', year: 2021 },
      { title: 'Track only', track: 'BSIT' },
      { year: 2024 },
    ])
    assert.match(prompt, /^Compare the following 3 archived theses/)
    assert.match(prompt, /1\. "Solo"; 2\. "Year only" \(2021\); 3\. "Track only" \(BSIT\) — /)
  })

  it('labels a single study in the export and treats non-arrays as empty', () => {
    const single = buildReadingListExport([null, { title: 'ONLY STUDY', authors: 'Plato', year: 2020 }])
    assert.match(single, /SAVED RRL READING LIST \(1 STUDY\)/)
    assert.match(single, /1\. Plato \(2020\)\. Only study/)
    assert.match(single, /@thesis\{plato2020only,/)
    assert.ok(single.endsWith('}\n'))

    const empty = buildReadingListExport('nope')
    assert.match(empty, /SAVED RRL READING LIST \(0 STUDIES\)/)
    assert.doesNotMatch(empty, /@thesis/)
  })
})
