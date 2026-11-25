import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_OPTION_VALUE, fromItemValue, resolveSelectOptions, toRootValue,
} from './selectOptions.js'

const option = (value, label, extra = {}) => ({ key: null, props: { value, children: label, ...extra } })

test('an "All" option with an empty value stays selectable', () => {
  const { emptySelectable, items, placeholderOption } = resolveSelectOptions([
    option('', 'All categories'),
    option('student', 'Student Thesis'),
    option('faculty', 'Faculty Research'),
  ])
  assert.equal(emptySelectable, true)
  assert.equal(placeholderOption.props.children, 'All categories')
  assert.deepEqual(items.map((item) => [item.value, item.label]), [
    [EMPTY_OPTION_VALUE, 'All categories'],
    ['student', 'Student Thesis'],
    ['faculty', 'Faculty Research'],
  ])
})

test('a hidden empty option is placeholder text only, as in a native select', () => {
  const { emptySelectable, items, placeholderOption } = resolveSelectOptions([
    option('', 'Select program…', { hidden: true }),
    option('bsit', 'BSIT'),
  ])
  assert.equal(emptySelectable, false)
  assert.equal(placeholderOption.props.children, 'Select program…')
  assert.deepEqual(items.map((item) => item.value), ['bsit'])
})

test('no empty option means no placeholder and nothing mapped', () => {
  const { emptySelectable, items, placeholderOption } = resolveSelectOptions([
    option('all', 'All theses'),
    option('recent_5', 'Last 5 years'),
  ])
  assert.equal(placeholderOption, null)
  assert.equal(emptySelectable, false)
  assert.deepEqual(items.map((item) => item.value), ['all', 'recent_5'])
})

test('only the first empty option becomes the reset item', () => {
  const { items } = resolveSelectOptions([option('', 'All'), option(null, 'Also empty'), option('x', 'X')])
  assert.deepEqual(items.map((item) => item.label), ['All', 'X'])
})

test('item keys and disabled flags are carried through', () => {
  const { items } = resolveSelectOptions([
    { key: '.$all', props: { value: '', children: 'All' } },
    option('locked', 'Locked', { disabled: true }),
    option(2024, '2024'),
  ])
  assert.deepEqual(items.map((item) => [item.key, item.value, item.disabled]), [
    ['.$all', EMPTY_OPTION_VALUE, false],
    ['locked', 'locked', true],
    ['2024', '2024', false],
  ])
})

test('an empty selection round-trips to and from the sentinel', () => {
  assert.equal(toRootValue('', true), EMPTY_OPTION_VALUE)
  assert.equal(fromItemValue(EMPTY_OPTION_VALUE), '')
  assert.equal(toRootValue('faculty', true), 'faculty')
  assert.equal(fromItemValue('faculty'), 'faculty')
})

test('an unselectable empty value still shows the placeholder', () => {
  assert.equal(toRootValue('', false), '')
  assert.equal(toRootValue(null, true), undefined)
  assert.equal(toRootValue(undefined, false), undefined)
  assert.equal(toRootValue(2025, false), '2025')
})

test('missing options are tolerated', () => {
  assert.deepEqual(resolveSelectOptions(), { placeholderOption: null, emptySelectable: false, items: [] })
})
