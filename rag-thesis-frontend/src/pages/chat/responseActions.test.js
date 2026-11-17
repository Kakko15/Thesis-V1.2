import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  copyText,
  downloadResearchNote,
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

test('speech text is empty for absent or non-string answers', () => {
  assert.equal(plainResponseText(undefined), '')
  assert.equal(plainResponseText(42), '')
  assert.equal(
    plainResponseText('  See [the study](https://example.test/a) [2] , `now` !  '),
    'See the study citation 2, now!',
  )
})

test('copy-with-sources falls back safely for sparse source metadata', () => {
  assert.equal(responseWithSources(null), '')
  assert.equal(responseWithSources({ answer: '  Only text.  ', sources: 'not-a-list' }), 'Only text.')
  assert.equal(responseWithSources({ answer: 'No evidence.', sources: [] }), 'No evidence.')
  assert.equal(
    responseWithSources({
      answer: 42,
      sources: [
        { title: '   ', authors: null, year: 0 },
        { citation_id: 3, title: ' Titled ', authors: '  ', year: null },
      ],
    }),
    '\n\nEvidence sources\nArchived thesis\n[3] Titled',
  )
})

test('response details describe notices, conversation replies and saved snapshots', () => {
  assert.deepEqual(responseDetails({
    answer: 'Hello there.',
    messageKind: 'notice',
    notice_type: 'conversation',
    sources: null,
    createdAt: '2026-11-17T00:00:00.000Z',
  }), {
    type: 'System response',
    generation: 'Local conversational response',
    citations: 0,
    passages: 0,
    studies: 0,
    archive: 'Saved response snapshot',
    createdAt: '2026-11-17T00:00:00.000Z',
  })
  assert.deepEqual(responseDetails(undefined), {
    type: 'Research answer',
    generation: 'Archive-grounded RAG',
    citations: 0,
    passages: 0,
    studies: 0,
    archive: 'Saved response snapshot',
    createdAt: null,
  })
  // Sources without an id still count as passages but not as distinct studies.
  assert.equal(responseDetails({ sources: [{ id: null }, { id: 'p2' }] }).studies, 1)
})

/* Browser API stubs --------------------------------------------------------- */

function stubGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original)
    else delete globalThis[name]
  })
}

function fakeDocument() {
  const calls = []
  const appended = []
  const created = []
  const document = {
    body: { appendChild: (node) => { appended.push(node); calls.push(['appendChild', node.tag]) } },
    createElement(tag) {
      const node = {
        tag,
        style: {},
        select: () => calls.push(['select', tag]),
        remove: () => calls.push(['remove', tag]),
        click: () => calls.push(['click', tag]),
      }
      created.push(node)
      return node
    },
    execCommand: (command) => { calls.push(['execCommand', command]); return true },
  }
  return { document, calls, appended, created }
}

test('copyText uses the async clipboard API with trimmed text when available', async (t) => {
  const written = []
  stubGlobal(t, 'navigator', { clipboard: { writeText: async (value) => { written.push(value) } } })
  const dom = fakeDocument()
  stubGlobal(t, 'document', dom.document)

  await copyText('  Copied answer [1].  ')

  assert.deepEqual(written, ['Copied answer [1].'])
  assert.deepEqual(dom.calls, [], 'the textarea fallback is not touched')
})

test('copyText falls back to a hidden textarea when the clipboard API is missing', async (t) => {
  const cases = [['no clipboard', {}], ['clipboard without writeText', { clipboard: {} }]]
  for (const [name, navigatorStub] of cases) await t.test(name, async (st) => {
    stubGlobal(st, 'navigator', navigatorStub)
    const dom = fakeDocument()
    stubGlobal(st, 'document', dom.document)

    await copyText('  Fallback text  ')

    assert.equal(dom.created.length, 1)
    const [helper] = dom.created
    assert.equal(helper.tag, 'textarea')
    assert.equal(helper.value, 'Fallback text')
    assert.deepEqual(helper.style, { position: 'fixed', opacity: '0' })
    assert.deepEqual(dom.appended, [helper])
    assert.deepEqual(dom.calls, [
      ['appendChild', 'textarea'],
      ['select', 'textarea'],
      ['execCommand', 'copy'],
      ['remove', 'textarea'],
    ])
  })
})

test('copyText copies an empty string for non-text input', async (t) => {
  const written = []
  stubGlobal(t, 'navigator', { clipboard: { writeText: async (value) => { written.push(value) } } })
  await copyText(null)
  assert.deepEqual(written, [''])
})

test('downloadResearchNote saves a plain-text note with sources and releases the URL', async (t) => {
  const dom = fakeDocument()
  stubGlobal(t, 'document', dom.document)
  const blobs = []
  t.mock.method(URL, 'createObjectURL', (blob) => { blobs.push(blob); return 'blob:note-1' })
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {})

  downloadResearchNote({
    answer: 'A supported result [1].',
    sources: [{ citation_id: 1, title: 'Archive Study', authors: 'A. Researcher', year: 2026 }],
  })

  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].type, 'text/plain;charset=utf-8')
  assert.equal(
    await blobs[0].text(),
    'IskAI research note\n\nA supported result [1].\n\nEvidence sources\n[1] Archive Study - A. Researcher (2026)'
      + '\n\nGenerated by the ISU Thesis AI Library. Verify important claims against the cited archive metadata.\n',
  )

  assert.equal(dom.created.length, 1)
  const [anchor] = dom.created
  assert.equal(anchor.tag, 'a')
  assert.equal(anchor.href, 'blob:note-1')
  assert.equal(anchor.download, 'iskai-research-note.txt')
  assert.deepEqual(dom.calls, [['click', 'a']])
  assert.equal(revoke.mock.callCount(), 1)
  assert.deepEqual(revoke.mock.calls[0].arguments, ['blob:note-1'])
})

test('browser API stubs are restored after each test', () => {
  assert.match(String(globalThis.navigator?.userAgent), /Node\.js/)
  assert.equal(typeof globalThis.document, 'undefined')
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
