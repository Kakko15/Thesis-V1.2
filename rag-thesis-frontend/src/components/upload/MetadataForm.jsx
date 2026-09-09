import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookText, ChevronDown, FileSignature, Lock, Sparkles, Tags } from 'lucide-react'
import { Input, Textarea, Select, Field } from '../ui/Input'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import {
  THESIS_CATEGORIES, programSelectionById, specializationSelection,
} from '../../lib/catalog'

const { duration, easing, stagger } = motionTokens

// Quicker than the shared `staggerItem`, which is tuned for cards entering a
// scrolled page. A form that takes 600ms per field to settle reads as sluggish.
const sectionStagger = {
  hidden: {},
  show: { transition: { staggerChildren: stagger.compact, delayChildren: 0.06 } },
}
const fieldRise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: duration.medium, ease: easing.standard } },
}

/**
 * The extraction step fills the form silently, so a reader had no way to tell
 * an autofilled value from one they typed — the difference that decides
 * whether a field needs checking. The marker disappears on first edit.
 *
 * Deliberately quiet: this was a filled `Badge`, and three of them down the
 * Identity column carried more weight than the labels they annotated. It is a
 * footnote on a value, not a status worth a pill.
 */
function AutofillChip({ show }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          initial={{ opacity: 0, scale: 0.85, y: -2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -2 }}
          transition={{ duration: duration.short, ease: easing.standard }}
          className="inline-flex items-center gap-1 rounded-full bg-gold-400/15 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-gold-700 dark:text-gold-300 border border-gold-400/30 shadow-xs"
        >
          <Sparkles size={11} aria-hidden="true" className="animate-pulse" /> autofilled
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function Section({ icon: Icon, title, headingId, children }) {
  return (
    <motion.section
      variants={fieldRise}
      aria-labelledby={headingId}
      className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/70 p-5 sm:p-6 shadow-xs backdrop-blur-xs transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-3 border-b border-[var(--border)]/60 pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600/15 to-forest-800/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300 ring-1 ring-forest-500/20 shadow-xs">
          <Icon size={16} aria-hidden="true" />
        </span>
        <h2 id={headingId} className="font-display text-sm font-bold tracking-tight text-ink">{title}</h2>
      </div>
      <div className="pt-1">
        {children}
      </div>
    </motion.section>
  )
}

/**
 * The label content shared by both field wrappers.
 *
 * The required marker is rendered here rather than passed through to `Field`,
 * so the asterisk stays attached to the label text instead of landing after
 * the autofill marker.
 */
function FieldLabel({ label, required, autofilled }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>
        {label}
        {required && <span className="ml-1 text-flame-500">*</span>}
      </span>
      <AutofillChip show={Boolean(autofilled)} />
    </span>
  )
}

/** A `Field` around a plain `Input`, whose label carries the autofill marker. */
function LabelledField({ label, autofilled, required, ...props }) {
  return (
    <Field label={<FieldLabel label={label} required={required} autofilled={autofilled} />} {...props} />
  )
}

/**
 * The same, around a `Select`.
 *
 * `nameFromLabel={false}` is the reason this wrapper exists. `Field` lends its
 * visible label to a lone `Select` child as `aria-labelledby`, which outranks
 * the `aria-label` the E2E suite matches these comboboxes by (see
 * e2e/critical-flows.spec.js:489-492). Opting out leaves the accessible name on
 * the control — which is what finally lets the specialization below carry a
 * visible label of its own, instead of sitting unlabelled under the program
 * because the label slot was reserved for the program's accessible name.
 */
function SelectField({ label, required, autofilled, ...props }) {
  return (
    <Field
      nameFromLabel={false}
      label={<FieldLabel label={label} required={required} autofilled={autofilled} />}
      {...props}
    />
  )
}

function AbstractDisclosure({ value, onChange }) {
  // Collapsed by default: it is optional, and expanded it pushed the wizard's
  // own actions below the fold on a laptop. Any pasted text keeps it open.
  const [open, setOpen] = useState(Boolean(value))
  const charCount = value ? value.length : 0

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/60 transition-colors hover:bg-[var(--surface-2)]/90">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left outline-none transition-colors duration-200"
      >
        <div className="flex items-center gap-2">
          <BookText size={15} className="text-ink-muted shrink-0" aria-hidden="true" />
          <span className="min-w-0 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Add an abstract
          </span>
          {charCount > 0 && (
            <span className="rounded-full bg-forest-500/15 px-2 py-0.5 text-[10px] font-mono font-medium text-forest-700 dark:text-forest-300">
              {charCount} chars
            </span>
          )}
        </div>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('shrink-0 text-ink-faint transition-transform duration-300', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.medium, ease: easing.standard }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-2">
              <Textarea
                value={value}
                onChange={onChange}
                placeholder="Paste the thesis abstract…"
                rows={4}
                aria-label="Thesis abstract"
              />
              <p className="text-[11px] text-ink-faint">
                Abstracts provide rich context for semantic indexing and assist researcher discovery.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Step 2 of the wizard, grouped into identity / classification / description.
 *
 * The eleven controls used to sit in one flat stack where the thesis title and
 * the optional abstract carried identical weight. Grouping them gives the eye
 * three short lists instead of one long one, and lets the optional third
 * collapse.
 *
 * Every grid cell holds exactly one labelled control. The classification row
 * used to stack the program and its specialization in the left cell against a
 * single control in the right, so the two columns ended at different heights
 * and left a hole under Department.
 */
export function MetadataForm({
  form, errors, autofilled, departments, isSuperadmin, enforcedDepartment, loadingDepts,
  programs, specializations, onField, onForm, onBlurValidate,
}) {
  const set = (key) => (event) => onField(key, event.target.value)
  const programsUnavailable = !form.department || programs.length === 0

  return (
    <motion.div variants={sectionStagger} initial="hidden" animate="show" className="space-y-7">
      <Section
        icon={FileSignature}
        title="Identity"
        headingId="upload-identity-heading"
      >
        <div className="space-y-5">
          <LabelledField label="Thesis title" error={errors.title} required autofilled={autofilled.title}>
            <Input
              value={form.title}
              onChange={set('title')}
              onBlur={onBlurValidate}
              placeholder="Full official thesis title"
              error={errors.title}
            />
          </LabelledField>
          <div className="grid gap-5 sm:grid-cols-2">
            <LabelledField
              label="Authors"
              autofilled={autofilled.authors}
            >
              <Input value={form.authors} onChange={set('authors')} placeholder="Dela Cruz, J., Santos, M." />
            </LabelledField>
            {/* 'e.g.' prefixed and derived from the clock: a bare
                '2024' here reads as an autofilled value in the muted
                placeholder colour, and was mistaken for one. */}
            <LabelledField
              label="Year completed"
              error={errors.year}
              autofilled={autofilled.year}
            >
              <Input
                value={form.year}
                onChange={set('year')}
                onBlur={onBlurValidate}
                placeholder={`e.g. ${new Date().getFullYear()}`}
                inputMode="numeric"
                maxLength={4}
                error={errors.year}
              />
            </LabelledField>
          </div>
        </div>
      </Section>

      <Section
        icon={Tags}
        title="Classification"
        headingId="upload-classification-heading"
      >
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Thesis category"
              required
            >
              <Select value={form.thesis_category} onChange={set('thesis_category')} aria-label="Select thesis category">
                {THESIS_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </Select>
            </SelectField>
            {/* Department leads the program on purpose: it decides which
                programs load at all, and while it sat to the right of them the
                cascade read child-before-parent. */}
            {isSuperadmin ? (
              /* The marker is honest on a Select now: `set-form` drops any
                 claim whose value the patch changed (uploadState.js), so it
                 disappears the moment a superadmin picks a different
                 department instead of going on crediting the extractor. */
              <SelectField
                label="Department"
                error={errors.department}
                required
                autofilled={autofilled.department}
              >
                <Select
                  value={form.department}
                  onChange={(event) => onForm((current) => ({
                    ...current,
                    department: event.target.value,
                    track: '',
                    program_id: '',
                    specialization_id: '',
                    requires_specialization: false,
                  }))}
                  error={errors.department}
                  disabled={loadingDepts}
                  aria-label="Select thesis department"
                >
                  <option value="">Select a Department…</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.name}>{department.name}</option>
                  ))}
                </Select>
              </SelectField>
            ) : (
              /* Everyone else is pinned to their profile's department by
                 dependencies/auth.resolve_effective_department, so this reads
                 out a fact rather than taking input. It used to be a bare Badge
                 in an input-shaped box under a required asterisk, which
                 explained nothing; the lock and "Assigned" say why it cannot be
                 changed. Same shell as the sign-up form's department field. */
              <Field label="Department">
                <div className="flex h-11 items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-sm text-[var(--foreground)] shadow-xs">
                  <Lock size={14} className="text-forest-600 dark:text-forest-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">{enforcedDepartment}</span>
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-forest-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-forest-700 dark:text-forest-300 border border-forest-500/20">
                    Assigned
                  </span>
                </div>
              </Field>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Widens to the full row when the chosen program has no
                specializations, so the reveal below never leaves a dead cell. */}
            <div className={cn('min-w-0', specializations.length === 0 && 'sm:col-span-2')}>
              <SelectField
                label="Academic program"
                error={errors.program_id}
                required={form.thesis_category !== 'faculty'}
                autofilled={autofilled.program_id}
              >
                <Select
                  value={form.program_id}
                  onChange={(event) => onForm((current) => ({
                    ...current,
                    ...programSelectionById(programs, event.target.value),
                  }))}
                  error={errors.program_id}
                  disabled={programsUnavailable}
                  aria-label="Select academic program"
                >
                  <option value="">Select program…</option>
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>{program.code} — {program.name}</option>
                  ))}
                </Select>
              </SelectField>
            </div>

            {/* Only some programs carry specializations, so this reveals itself
                rather than reserving an empty slot. Enter-only animation: on
                exit the program cell reclaims the full row immediately, which
                would shunt a shrinking cell onto a third grid row and make it
                fall away sideways. */}
            {specializations.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: duration.medium, ease: easing.standard }}
                className="min-w-0"
              >
                <SelectField
                  label="Specialization"
                  error={errors.specialization_id}
                  required
                >
                  <Select
                    value={form.specialization_id}
                    onChange={(event) => onForm((current) => ({
                      ...current,
                      ...specializationSelection(specializations, event.target.value),
                    }))}
                    error={errors.specialization_id}
                    aria-label="Select academic specialization"
                  >
                    <option value="">Select specialization…</option>
                    {specializations.map((item) => (
                      <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                    ))}
                  </Select>
                </SelectField>
              </motion.div>
            )}
          </div>
        </div>
      </Section>

      <Section
        icon={BookText}
        title="Description"
        headingId="upload-description-heading"
      >
        <AbstractDisclosure value={form.abstract} onChange={set('abstract')} />
      </Section>
    </motion.div>
  )
}
