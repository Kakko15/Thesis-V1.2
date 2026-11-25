import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LEGAL_DOCUMENTS,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_TABS,
  resolveLegalDocument,
} from './legalContent.js'

test('all three institutional legal documents are defined with structured sections', () => {
  assert.ok(LEGAL_EFFECTIVE_DATE.length > 0)
  assert.deepEqual(
    LEGAL_TABS.map((tab) => tab.key),
    ['agreement', 'terms', 'privacy'],
  )
  for (const tab of LEGAL_TABS) {
    const doc = LEGAL_DOCUMENTS[tab.key]
    assert.equal(doc.key, tab.key)
    assert.ok(doc.title.length > 0)
    assert.ok(doc.subtitle.length > 0)
    assert.ok(doc.summary.length > 0)
    assert.ok(doc.sections.length >= 5)
    for (const section of doc.sections) {
      assert.ok(section.id)
      assert.ok(section.heading)
      assert.ok(Array.isArray(section.paragraphs) && section.paragraphs.length > 0)
    }
  }
})

test('resolveLegalDocument resolves exact slugs case-insensitively and defaults to agreement', () => {
  assert.equal(resolveLegalDocument('agreement').key, 'agreement')
  assert.equal(resolveLegalDocument('terms').key, 'terms')
  assert.equal(resolveLegalDocument('PRIVACY').key, 'privacy')
  assert.equal(resolveLegalDocument('  terms  ').key, 'terms')
  assert.equal(resolveLegalDocument('').key, 'agreement')
  assert.equal(resolveLegalDocument(undefined).key, 'agreement')
  assert.equal(resolveLegalDocument('unknown-page').key, 'agreement')
})
