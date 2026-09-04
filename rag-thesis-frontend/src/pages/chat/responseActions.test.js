import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  plainResponseText,
  responseDetails,
  responseWithSources,
} from './responseActions.js'

test('speech text removes markdown syntax and speaks citation numbers clearly', () => {
  assert.equal(
    plainResponseText('**Finding:** RAG is used [1].'),
    'Finding: RAG is used citation 1.',
  )
})

test('response details report only visible provenance', () => {
  assert.deepEqual(responseDetails({
    answer: 'Supported [1][2].',
    messageKind: 'answer',
    archive_current: true,
    sources: [
      { id: 'p1', citation_id: 1 },
      { id: 'p1', citation_id: 2 },
    ],
  }), {
    type: 'Research answer',
    generation: 'Archive-grounded RAG',
    citations: 2,
    passages: 2,
    studies: 1,
    archive: 'Current indexed archive',
    createdAt: null,
  })
})

test('copy-with-sources text includes safe archive metadata', () => {
  assert.equal(
    responseWithSources({
      answer: 'A supported result [1].',
      sources: [{ citation_id: 1, title: 'Archive Study', authors: 'A. Researcher', year: 2026 }],
    }),
    'A supported result [1].\n\nEvidence sources\n[1] Archive Study - A. Researcher (2026)',
  )
})

test('the AI bubble exposes the complete response action set', () => {
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  for (const label of [
    'Redo response', 'Copy response', 'Listen', 'Copy with sources',
    'Download research note', 'Ask a follow-up', 'See response details',
  ]) {
    assert.match(chat, new RegExp(label))
  }
  assert.match(chat, /branchBeforePrompt\(messages, prompt\.id\)/)
  assert.match(chat, /answerMessage\.answer/)
  assert.match(chat, /createdAt: new Date\(\)\.toISOString\(\)/)
})
