import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookText, ChevronDown, FileSignature, Sparkles, Tags } from 'lucide-react'
import { Input, Textarea, Select, Field } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { THESIS_CATEGORIES } from '../../lib/catalog'

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
 * whether a field needs checking. The chip disappears on first edit.
 */
function AutofillChip({ show }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: duration.short, ease: easing.standard }}
          className="inline-flex"
        >
          <Badge tone="forest"><Sparkles size={11} aria-hidden="true" /> Autofilled</Badge>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function Section({ icon: Icon, title, hint, headingId, children }) {
  return (
    <motion.section variants={fieldRise} aria-labelledby={headingId} className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300">
          <Icon size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-sm font-bold">{title}</h2>
          <p className="text-xs text-ink-muted">{hint}</p>
        </div>
      </div>
      {children}
    </motion.section>
  )
}

/**
 * A `Field` whose label carries the autofill chip.
 *
 * Only ever wraps a plain `Input`. `Field` special-cases a *direct* `Select`
 * child to wire `aria-labelledby`, which would then outrank the `aria-label`
 * the E2E suite selects those comboboxes by — so the Selects below keep their
 * original plain-string labels and go without a chip.
 *
 * The required marker is rendered here rather than passed through, so the
 * asterisk stays attached to the label text instead of landing after the chip.
 */
function LabelledField({ label, autofilled, required, ...props }) {
  return (
    <Field
      label={(
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            {label}
            {required && <span className="ml-1 text-flame-500">*</span>}
          </span>
          <AutofillChip show={Boolean(autofilled)} />
        </span>
      )}
      {...props}
    />
  )
}

function AbstractDisclosure({ value, onChange }) {
  // Collapsed by default: it is optional, and expanded it pushed the wizard's
  // own actions below the fold on a laptop. Any pasted text keeps it open.
  const [open, setOpen] = useState(Boolean(value))
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left outline-none transition-colors duration-200 hover:bg-[var(--surface-2)]"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wider text-ink-muted">Add an abstract</span>
          <span className="mt-0.5 block text-xs text-ink-faint">Optional, but it improves archive browsing</span>
        </span>
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
            <div className="px-4 pb-4">
              <Textarea
                value={value}
                onChange={onChange}
                placeholder="Paste the thesis abstract…"
                rows={4}
                aria-label="Thesis abstract"
              />
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
 */
export function MetadataForm({
  form, errors, autofilled, departments, isSuperadmin, enforcedDepartment, loadingDepts,
  programs, specializations, onField, onForm, onBlurValidate,
}) {
  const set = (key) => (event) => onField(key, event.target.value)

  return (
    <motion.div variants={sectionStagger} initial="hidden" animate="show" className="space-y-7">
      <Section
        icon={FileSignature}
        title="Identity"
        hint="How the thesis is cited"
        headingId="upload-identity-heading"
      >
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
            hint="Separate multiple authors with commas"
            autofilled={autofilled.authors}
          >
            <Input value={form.authors} onChange={set('authors')} placeholder="Dela Cruz, J., Santos, M." />
          </LabelledField>
          {/* 'e.g.' prefixed and derived from the clock: a bare
              '2024' here reads as an autofilled value in the muted
              placeholder colour, and was mistaken for one. */}
          <LabelledField label="Year completed" error={errors.year} autofilled={autofilled.year}>
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
      </Section>

      <Section
        icon={Tags}
        title="Classification"
        hint="Where the thesis belongs in the archive"
        headingId="upload-classification-heading"
      >
        <Field label="Thesis category" required hint="Who authored the manuscript — not your account role">
          <Select value={form.thesis_category} onChange={set('thesis_category')} aria-label="Select thesis category">
            {THESIS_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Academic program"
            error={errors.program_id}
            required={form.thesis_category !== 'faculty'}
            hint={form.thesis_category === 'faculty'
              ? 'Optional for faculty research'
              : 'Validated against the official CCSICT catalog'}
          >
            <Select
              value={form.program_id}
              onChange={(event) => {
                const program = programs.find((item) => item.id === event.target.value)
                onForm((current) => ({
                  ...current,
                  program_id: event.target.value,
                  specialization_id: '',
                  requires_specialization: Boolean(program?.specializations?.length),
                  track: program?.specializations?.length ? '' : (program?.code || ''),
                }))
              }}
              error={errors.program_id}
              disabled={!form.department || programs.length === 0}
              aria-label="Select academic program"
            >
              <option value="">Select program…</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>{program.code} — {program.name}</option>
              ))}
            </Select>
            {/* Only some programs carry specializations, so this reveals itself
                rather than reserving an empty slot. It stays a sibling of the
                program Select inside this one Field on purpose — see above. */}
            <AnimatePresence initial={false}>
              {specializations.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: duration.medium, ease: easing.standard }}
                  className="overflow-hidden"
                >
                  <Select
                    className="mt-2"
                    value={form.specialization_id}
                    onChange={(event) => {
                      const specialization = specializations.find((item) => item.id === event.target.value)
                      onForm((current) => ({
                        ...current,
                        specialization_id: event.target.value,
                        track: specialization?.name || '',
                      }))
                    }}
                    error={errors.specialization_id}
                    aria-label="Select academic specialization"
                  >
                    <option value="">Select specialization…</option>
                    {specializations.map((item) => (
                      <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                    ))}
                  </Select>
                  {errors.specialization_id && (
                    <p className="mt-1.5 text-xs font-medium text-flame-500">{errors.specialization_id}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Field>
          <Field
            label="Department"
            error={errors.department}
            required
            hint="Department this thesis belongs to"
          >
            {isSuperadmin ? (
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
            ) : (
              <div className="flex h-11 items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3">
                <Badge tone="neutral">{enforcedDepartment}</Badge>
              </div>
            )}
          </Field>
        </div>
      </Section>

      <Section
        icon={BookText}
        title="Description"
        hint="Optional context for readers browsing the archive"
        headingId="upload-description-heading"
      >
        <AbstractDisclosure value={form.abstract} onChange={set('abstract')} />
      </Section>
    </motion.div>
  )
}
