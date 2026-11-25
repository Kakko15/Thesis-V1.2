import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  answerAnnouncement, branchBeforePrompt, dropPendingPrompt, editWarningMessage, laterTurnCount,
  matchesSavedRows, settledTranscript,
} from './transcript.js'

const user = (text) => ({ id: text, kind: 'user', text })
const ai = (answer) => ({ id: answer, kind: 'ai', answer })

test('a freshly arrived answer is announced as plain prose', () => {
  const fresh = { ...ai('**ISU-CANNER** used a CNN [1][2, 3]. See [the paper](https://x.test).\n\n| a | b |\n|---|---|'), isNew: true }
  assert.equal(
    answerAnnouncement([user('q'), fresh]),
    'IskAI answered: ISU-CANNER used a CNN. See the paper. a b',
  )
})

test('restored, pending and empty transcripts announce nothing new', () => {
  assert.equal(answerAnnouncement([user('q'), ai('saved answer')]), '')
  assert.equal(answerAnnouncement([user('q')]), '')
  assert.equal(answerAnnouncement([]), '')
  assert.equal(answerAnnouncement(null), '')
  assert.equal(answerAnnouncement([{ kind: 'ai', isNew: true, answer: '```code```' }]), 'IskAI answered.')
})

test('a long answer is cut at a word boundary', () => {
  const long = { ...ai('word '.repeat(100)), isNew: true }
  const spoken = answerAnnouncement([long], 20)
  assert.equal(spoken, 'IskAI answered: word word word word…')
  assert.equal(answerAnnouncement([{ kind: 'ai', isNew: true, answer: 'x'.repeat(30) }], 10), `IskAI answered: ${'x'.repeat(10)}…`)
})

test('an abandoned question is withdrawn from the transcript', () => {
  assert.deepEqual(
    dropPendingPrompt([user('first'), ai('answered'), user('pending')]),
    [user('first'), ai('answered')],
  )
  assert.deepEqual(dropPendingPrompt([user('only')]), [])
})

test('a completed exchange is left alone', () => {
  const settled = [user('asked'), ai('answered')]
  assert.deepEqual(dropPendingPrompt(settled), settled)
  // Only the trailing entry is considered: an earlier question already has its
  // answer and must survive.
  assert.equal(dropPendingPrompt(settled).length, 2)
})

test('it never throws on an empty or absent transcript', () => {
  assert.deepEqual(dropPendingPrompt([]), [])
  assert.deepEqual(dropPendingPrompt(undefined), [])
  assert.deepEqual(dropPendingPrompt(null), [])
})

test('it does not mutate the list it is given', () => {
  const messages = [user('asked'), user('pending')]
  const before = messages.length
  dropPendingPrompt(messages)
  assert.equal(messages.length, before)
})

test('editing a settled prompt keeps only the branch before that turn', () => {
  const transcript = [
    user('first'), ai('first answer'),
    user('second'), ai('second answer'),
  ]

  assert.deepEqual(branchBeforePrompt(transcript, 'first'), {
    messages: [],
    turn: 0,
  })
  assert.deepEqual(branchBeforePrompt(transcript, 'second'), {
    messages: [user('first'), ai('first answer')],
    turn: 1,
  })
})

test('a missing prompt does not alter the transcript', () => {
  const transcript = [user('first'), ai('answer')]
  assert.deepEqual(branchBeforePrompt(transcript, 'missing'), {
    messages: transcript,
    turn: null,
  })
})

test('branching an empty or absent transcript yields an empty branch', () => {
  for (const messages of [undefined, null, 'not-a-list']) {
    assert.deepEqual(branchBeforePrompt(messages, 'first'), { messages: [], turn: null })
  }
})

test('only a user turn with the edited id starts the branch', () => {
  const transcript = [user('first'), { ...ai('first answer'), id: 'second' }, user('second')]
  assert.deepEqual(branchBeforePrompt(transcript, 'second'), {
    messages: transcript.slice(0, 2),
    turn: 1,
  })
})

test('settled edits send one replacement against the shortened branch', () => {
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  const start = chat.indexOf('const updatePrompt = ')
  const rest = chat.slice(start)
  const end = rest.search(/\n {2}const loadSession = /)
  const body = rest.slice(0, end)

  assert.match(body, /branchBeforePrompt\(messages, original\.id\)/)
  assert.match(body, /setMessages\(branch\.messages\)/)
  assert.match(body, /send\(updated, \{\s*baseMessages: branch\.messages,/)
  assert.equal((body.match(/send\(updated/g) || []).length, 2)
})

test('both abandon paths withdraw the prompt through this function', () => {
  /* stopWaiting trimmed the bubble inline and updatePrompt did not, so editing
   * a pending prompt left the superseded wording above the edited one. Both
   * must route through dropPendingPrompt, and neither may reintroduce its own
   * copy of the slice. */
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')

  const abandonHandlers = ['const stopWaiting = ', 'const updatePrompt = ']
  for (const opener of abandonHandlers) {
    const start = chat.indexOf(opener)
    assert.notEqual(start, -1, `Chat.jsx no longer declares ${opener.trim()}`)
    // Up to the next top-level `const x = ` declaration.
    const rest = chat.slice(start + opener.length)
    const end = rest.search(/\n {2}const \w+ = /)
    const body = end === -1 ? rest : rest.slice(0, end)
    assert.match(body, /dropPendingPrompt(?:\(|\))/, `${opener.trim()} does not withdraw the pending prompt`)
  }

  assert.doesNotMatch(
    chat, /kind === 'user' \? current\.slice\(0, -1\)/,
    'Chat.jsx still carries an inline copy of the trim',
  )
})

test('opening a conversation cancels the answer still in flight', () => {
  /* An answer in flight belongs to the conversation being left. Without the
   * abort it was appended to the transcript that had just replaced it, and a
   * request that created a new session then made that session active while
   * another one's messages were on screen. The generation counter covers the
   * other half: two quick switches must not let the slower fetch win. */
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  const start = chat.indexOf('const loadSession = ')
  assert.notEqual(start, -1, 'Chat.jsx no longer declares loadSession')
  const rest = chat.slice(start)
  const end = rest.search(/\n {2}const newConversation = /)
  const body = end === -1 ? rest : rest.slice(0, end)

  assert.match(body, /requestControllerRef\.current\?\.abort\(/, 'loadSession does not abort')
  assert.match(body, /sessionLoadRef\.current = generation/, 'loadSession takes no generation')
  assert.match(
    body, /if \(sessionLoadRef\.current !== generation\) return/,
    'loadSession does not discard a superseded fetch',
  )
})

test('the request carries visible conversation replies for no-repeat selection', () => {
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  assert.match(chat, /message\.notice_type === 'conversation'/)
  assert.match(chat, /\.map\(\(message\) => message\.answer\)/)
  assert.match(chat, /\.slice\(-30\)/)
})

test('a cached transcript never replays entrance animations', () => {
  const fresh = { ...ai('new answer'), isNew: true }
  const prompt = { ...user('asked'), isNew: true }
  const settled = settledTranscript([user('old'), ai('old answer'), prompt, fresh])
  assert.equal(settled.some((message) => message.isNew), false)
  assert.deepEqual(settled[3], { ...fresh, isNew: false })
  // Entries that never animated are passed through untouched.
  assert.equal(settled[0].id, 'old')
  for (const messages of [undefined, null, 'not-a-list']) {
    assert.deepEqual(settledTranscript(messages), [])
  }
})

test('a cached transcript matches the saved rows it was built from', () => {
  const rows = [
    { question: 'first', answer: 'first answer' },
    { question: 'second', answer: 'second answer' },
  ]
  const shown = [user('first'), ai('first answer'), user('second'), ai('second answer')]
  assert.equal(matchesSavedRows(shown, rows), true)
  assert.equal(matchesSavedRows([], []), true)
})

test('any saved change elsewhere makes the cached transcript stale', () => {
  const rows = [{ question: 'first', answer: 'first answer' }]
  const shown = [user('first'), ai('first answer')]
  // Another device added a turn.
  assert.equal(matchesSavedRows(shown, [...rows, { question: 'more', answer: 'x' }]), false)
  // A regenerated answer.
  assert.equal(matchesSavedRows(shown, [{ question: 'first', answer: 'rewritten' }]), false)
  // An edited prompt.
  assert.equal(matchesSavedRows(shown, [{ question: 'edited', answer: 'first answer' }]), false)
  // A pending prompt on screen is not a saved turn.
  assert.equal(matchesSavedRows([...shown, user('pending')], rows), false)
  assert.equal(matchesSavedRows(null, rows), false)
  assert.equal(matchesSavedRows(shown, null), false)
})

test('opening a conversation paints from the cache before any fetch', () => {
  /* The click must not wait on the network when the transcript is cached or
   * already being prefetched: the cached copy is read synchronously first, a
   * miss joins any in-flight prefetch through fetchQuery, and the sidebar
   * starts that prefetch on hover, focus and press. */
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  const start = chat.indexOf('const loadSession = ')
  const rest = chat.slice(start)
  const body = rest.slice(0, rest.search(/\n {2}const newConversation = /))
  const cacheRead = body.indexOf('queryClient.getQueryData(query.queryKey)')
  const networkRead = body.indexOf('getSessionMessages(')
  assert.notEqual(cacheRead, -1, 'loadSession no longer reads the transcript cache')
  assert.ok(cacheRead < networkRead, 'loadSession fetches before consulting the cache')
  assert.match(body, /queryClient\.fetchQuery\(query\)/)
  for (const handler of ['onPointerEnter', 'onFocus', 'onPointerDown']) {
    assert.match(chat, new RegExp(`${handler}=\\{\\(\\) => onPrefetch\\?\\.\\(s\\)\\}`))
  }
})

test('an edit warns only about the questions that come after it', () => {
  const messages = [
    { id: 'u1', kind: 'user' }, { id: 'a1', kind: 'ai' },
    { id: 'u2', kind: 'user' }, { id: 'a2', kind: 'ai' },
    { id: 'u3', kind: 'user' }, { id: 'a3', kind: 'ai' },
  ]
  assert.equal(laterTurnCount(messages, 'u1'), 2)
  assert.equal(laterTurnCount(messages, 'u2'), 1)
  // Editing the newest question only replaces its own answer.
  assert.equal(laterTurnCount(messages, 'u3'), 0)
  assert.equal(laterTurnCount(messages, 'a1'), 0)
  assert.equal(laterTurnCount(messages, 'missing'), 0)
  assert.equal(laterTurnCount(null, 'u1'), 0)
})

test('the edit warning names what will be lost', () => {
  assert.equal(editWarningMessage(1, true), 'Your edited question will be answered again, and the question that follows it and its answer will be permanently deleted from this conversation.')
  assert.equal(editWarningMessage(3, false), 'Your edited question will be answered again, and the 3 questions that follow it and their answers will be removed.')
})
