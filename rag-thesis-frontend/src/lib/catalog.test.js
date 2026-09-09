import assert from 'node:assert/strict'
import test from 'node:test'

import {
  THESIS_CATEGORIES, departmentPrograms, isFacultyThesis, normalizeDepartments,
  programSelection, programSelectionById, specializationSelection, thesisCategoryLabel,
} from './catalog.js'

const departments = [{ id: 'ccsict', name: 'CCSICT' }]

test('normalizes legacy array and versioned catalog responses', () => {
  assert.deepEqual(normalizeDepartments(departments), departments)
  assert.deepEqual(normalizeDepartments({ departments }), departments)
})

test('returns an empty array for invalid catalog responses', () => {
  assert.deepEqual(normalizeDepartments(null), [])
  assert.deepEqual(normalizeDepartments('<!doctype html>'), [])
  assert.deepEqual(normalizeDepartments({ detail: 'Unavailable' }), [])
})

test('removes malformed department entries', () => {
  assert.deepEqual(
    normalizeDepartments([null, 'CCSICT', departments[0], []]),
    departments,
  )
})

test('thesis categories are exactly student and faculty', () => {
  assert.deepEqual(THESIS_CATEGORIES.map((category) => category.value), ['student', 'faculty'])
})

test('category labels default unknown or missing values to student', () => {
  assert.equal(thesisCategoryLabel('faculty'), 'Faculty Research')
  assert.equal(thesisCategoryLabel('student'), 'Student Thesis')
  assert.equal(thesisCategoryLabel(undefined), 'Student Thesis')
  assert.equal(thesisCategoryLabel('graduate'), 'Student Thesis')
})

test('only an explicit faculty category marks a paper as Faculty Research', () => {
  assert.equal(isFacultyThesis({ thesis_category: 'faculty' }), true)
  assert.equal(isFacultyThesis({ thesis_category: 'student' }), false)
  // Papers indexed before the category migration carry no field.
  assert.equal(isFacultyThesis({}), false)
  assert.equal(isFacultyThesis(null), false)
})

const catalog = [{
  id: 'dept-ccsict',
  name: 'CCSICT',
  programs: [
    {
      id: 'p-bscs', code: 'BSCS', name: 'Bachelor of Science in Computer Science',
      specializations: [{ id: 's-dm', code: 'DM', name: 'Data Mining' }],
    },
    { id: 'p-blis', code: 'BLIS', name: 'Bachelor of Library and Information Science' },
  ],
}, {
  id: 'dept-cas',
  name: 'CAS',
  programs: [{ id: 'p-abcom', code: 'ABCOM', name: 'Bachelor of Arts in Communication', specializations: [] }],
}]

test('departmentPrograms scopes the picker to one college', () => {
  assert.deepEqual(departmentPrograms(catalog, 'CAS').map((p) => p.code), ['ABCOM'])
  assert.deepEqual(departmentPrograms(catalog, 'CCSICT').map((p) => p.code), ['BSCS', 'BLIS'])
  assert.deepEqual(departmentPrograms(catalog, 'COE'), [])
  assert.deepEqual(departmentPrograms(catalog, ''), [])
  assert.deepEqual(departmentPrograms(undefined, 'CCSICT'), [])
})

test('programSelection turns an extracted code into the form’s classification', () => {
  assert.deepEqual(programSelection(catalog, 'CCSICT', 'BSCS', 'DM'), {
    program_id: 'p-bscs',
    specialization_id: 's-dm',
    requires_specialization: true,
    // What resolve_academic_selection stamps into papers.track for a program
    // that carries specializations.
    track: 'Data Mining',
  })
  // A program with no specializations tracks by its own code instead.
  assert.deepEqual(programSelection(catalog, 'CCSICT', 'BLIS'), {
    program_id: 'p-blis', specialization_id: '', requires_specialization: false, track: 'BLIS',
  })
  // The degree was read but not the major: the form asks for the missing half
  // rather than guessing it.
  assert.deepEqual(programSelection(catalog, 'CCSICT', 'BSCS'), {
    program_id: 'p-bscs', specialization_id: '', requires_specialization: true, track: '',
  })
})

test('programSelection drops a code that does not exist in the department', () => {
  // The extractor matches across the whole catalog, so a CAS degree can come
  // back for a CCSICT upload. Resolving inside the selected department is what
  // stops it being autofilled into a form the upload would be rejected for.
  assert.equal(programSelection(catalog, 'CCSICT', 'ABCOM'), null)
  assert.equal(programSelection(catalog, 'COE', 'BSCS'), null)
  assert.equal(programSelection(catalog, 'CCSICT', ''), null)
  assert.equal(programSelection(catalog, 'CCSICT', undefined), null)
  // An unknown specialization leaves the program standing and asks for it.
  assert.deepEqual(programSelection(catalog, 'CCSICT', 'BSCS', 'NETSEC'), {
    program_id: 'p-bscs', specialization_id: '', requires_specialization: true, track: '',
  })
})

test('the by-id selections match what programSelection produces', () => {
  const programs = departmentPrograms(catalog, 'CCSICT')
  assert.deepEqual(programSelectionById(programs, 'p-blis'), programSelection(catalog, 'CCSICT', 'BLIS'))
  assert.deepEqual(programSelectionById(programs, 'p-bscs'), programSelection(catalog, 'CCSICT', 'BSCS'))
  // Clearing the program clears the specialization with it, so a row can never
  // keep a major under no degree.
  assert.deepEqual(programSelectionById(programs, ''), {
    program_id: '', specialization_id: '', requires_specialization: false, track: '',
  })
  const specializations = programs[0].specializations
  assert.deepEqual(specializationSelection(specializations, 's-dm'), {
    specialization_id: 's-dm', track: 'Data Mining',
  })
  assert.deepEqual(specializationSelection(specializations, ''), { specialization_id: '', track: '' })
})
