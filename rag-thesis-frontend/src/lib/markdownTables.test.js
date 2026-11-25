import assert from 'node:assert/strict'
import test from 'node:test'

import { splitMarkdownTables, splitTableRow } from './markdownTables.js'

test('a GFM table becomes a table segment between the prose around it', () => {
  const segments = splitMarkdownTables([
    '### Overlap',
    '',
    '| Section | Similarity |',
    '|:---|---:|',
    '| Methodology | **91%** |',
    '| Scope |',
    '',
    'Faculty decide.',
  ].join('\n'))
  assert.deepEqual(segments, [
    { type: 'markdown', text: '### Overlap\n' },
    { type: 'table', header: ['Section', 'Similarity'], rows: [['Methodology', '**91%**'], ['Scope', '']] },
    { type: 'markdown', text: '\nFaculty decide.' },
  ])
})

test('rows without outer pipes and escaped pipes are read like GFM', () => {
  assert.deepEqual(splitTableRow('a | b \\| c'), ['a', 'b | c'])
  assert.deepEqual(splitTableRow('| a | b \\|'), ['a', 'b |'])
  assert.deepEqual(
    splitMarkdownTables('a | b\n--- | ---\n1 | 2\r\nafter'),
    [
      { type: 'table', header: ['a', 'b'], rows: [['1', '2']] },
      { type: 'markdown', text: 'after' },
    ],
  )
})

test('pipes that are not a table stay prose', () => {
  const fenced = '```\n| a | b |\n|---|---|\n```'
  assert.deepEqual(splitMarkdownTables(fenced), [{ type: 'markdown', text: fenced }])
  // A divider whose column count differs from the header is not a table.
  assert.deepEqual(splitMarkdownTables('| a | b |\n|---|'), [{ type: 'markdown', text: '| a | b |\n|---|' }])
  assert.deepEqual(splitMarkdownTables('| a |\nnot a divider'), [{ type: 'markdown', text: '| a |\nnot a divider' }])
  assert.deepEqual(splitMarkdownTables('| a |\n\n|---|'), [{ type: 'markdown', text: '| a |\n\n|---|' }])
  assert.deepEqual(splitMarkdownTables('| a |'), [{ type: 'markdown', text: '| a |' }])
  assert.deepEqual(splitMarkdownTables(null), [{ type: 'markdown', text: '' }])
})
