import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STUDENT_STARTER_PROMPTS,
  buildPaperChatPrompt,
  computeDashboardStats,
  formatRoleSubtitle,
  groupPapersByTrack,
  mfaNudgeStorageKey,
} from './dashboardState.js'

describe('formatRoleSubtitle', () => {
  it('capitalizes the role without capitalizing the preposition "at"', () => {
    assert.equal(formatRoleSubtitle('student', 'CCSICT'), 'Student at CCSICT')
    assert.equal(formatRoleSubtitle('faculty', 'CCSICT'), 'Faculty at CCSICT')
    assert.equal(formatRoleSubtitle('admin', 'CCSICT'), 'Administrator at CCSICT')
    assert.equal(formatRoleSubtitle('superadmin', 'CCSICT'), 'Super Admin at System')
    assert.equal(formatRoleSubtitle('student', ''), 'Student at Unassigned')
    assert.equal(formatRoleSubtitle('', 'CCSICT'), 'Member at CCSICT')
  })
})

describe('computeDashboardStats', () => {
  it('handles empty or null paper lists safely', () => {
    assert.deepEqual(computeDashboardStats(null, 2026), {
      total: 0,
      tracks: 0,
      distinctYears: 0,
      yearRangeLabel: '—',
      recentWindowCount: 0,
      chunks: 0,
    })
    assert.deepEqual(computeDashboardStats([], 2026), {
      total: 0,
      tracks: 0,
      distinctYears: 0,
      yearRangeLabel: '—',
      recentWindowCount: 0,
      chunks: 0,
    })
  })

  it('computes distinct years, single-year and multi-year range labels, 5-year active count, and chunks accurately', () => {
    const singleYear = [{ id: '1', track: 'BSCS', year: 2026, chunk_count: 18 }]
    assert.deepEqual(computeDashboardStats(singleYear, 2026), {
      total: 1,
      tracks: 1,
      distinctYears: 1,
      yearRangeLabel: '2026',
      recentWindowCount: 1,
      chunks: 18,
    })

    const papers = [
      { id: '1', track: 'BSCS', year: 2020, chunk_count: 25 },
      { id: '2', track: 'BSIT', year: 2024, chunk_count: 30 },
      { id: '3', track: 'BSCS', year: 2026, chunk_count: null },
    ]
    const stats = computeDashboardStats(papers, 2026)
    assert.equal(stats.total, 3)
    assert.equal(stats.tracks, 2)
    assert.equal(stats.distinctYears, 3)
    assert.equal(stats.yearRangeLabel, '2020–2026')
    assert.equal(stats.recentWindowCount, 2)
    assert.equal(stats.chunks, 55)
  })
})

describe('groupPapersByTrack', () => {
  it('aggregates and sorts tracks by paper count descending then name ascending', () => {
    assert.deepEqual(groupPapersByTrack(null), [])
    const papers = [
      { track: 'BLIS' },
      { track: 'BSCS' },
      { track: 'BSCS' },
      { track: '' },
      { track: 'Web and Mobile Application Development' },
    ]
    assert.deepEqual(groupPapersByTrack(papers), [
      { track: 'BSCS', count: 2 },
      { track: 'BLIS', count: 1 },
      { track: 'Web and Mobile Application Development', count: 1 },
    ])
  })
})

describe('buildPaperChatPrompt, mfaNudgeStorageKey & STUDENT_STARTER_PROMPTS', () => {
  it('builds a focused research inquiry prompt for a specific thesis', () => {
    const prompt = buildPaperChatPrompt({
      title: 'MANGO FRUIT QUALITY DETECTION',
      authors: 'Carl Rainier M. Manalili',
      year: 2024,
    })
    assert.match(prompt, /MANGO FRUIT QUALITY DETECTION/)
    assert.match(prompt, /2024/)
    assert.equal(buildPaperChatPrompt({}), 'Summarize the key findings and methodology of this thesis.')
    assert.equal(mfaNudgeStorageKey('user-123'), 'iskai_mfa_nudge_dismissed_user-123')
    assert.equal(mfaNudgeStorageKey(''), 'iskai_mfa_nudge_dismissed_anonymous')
    assert.ok(STUDENT_STARTER_PROMPTS.length >= 3)
  })
})
