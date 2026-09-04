import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { branchBeforePrompt, dropPendingPrompt } from './transcript.js'

const user = (text) => ({ id: text, kind: 'user', text })
const ai = (answer) => ({ id: answer, kind: 'ai', answer })

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
