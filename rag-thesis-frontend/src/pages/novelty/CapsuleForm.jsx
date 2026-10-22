import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileUp, Loader2, ScanSearch } from 'lucide-react'
import { extractCapsule, apiErrorMessage } from '../../api'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { ConfirmDialog } from '../../components/ui/Modal'
import {
  CAPSULE_FIELDS, CAPSULE_FILE_ACCEPT, EMPTY_CAPSULE, applyExtractedCapsule, capsuleError, capsuleFileError,
  loadCapsuleDraft, overwrittenFields, saveCapsuleDraft, screenedSections,
} from './capsule'

const LABELS = Object.fromEntries(CAPSULE_FIELDS.map((field) => [field.key, field.label.toLowerCase()]))

function listOf(keys) {
  const names = keys.map((key) => LABELS[key])
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * A capsule proposal, typed or uploaded section by section, and screened on submit.
 *
 * An upload fills the form rather than screening straight away: the file is
 * split into sections by its headings, which a template can word differently,
 * so the reviewer sees what landed where before anything is compared.
 *
 * Timeline and budget are left out on purpose: they belong in a capsule but say
 * nothing about whether the study has been done, so asking for them here would
 * be typing that cannot change the result. The draft is kept in this browser,
 * because a capsule is several paragraphs and a reload should not cost them.
 */
export function CapsuleForm({ onScan, scanning }) {
  const [capsule, setCapsule] = useState(loadCapsuleDraft)
  const [touched, setTouched] = useState(false)
  const [reading, setReading] = useState(false)
  const [source, setSource] = useState(null) // { name, filled: [...] } after an upload
  const [pending, setPending] = useState(null) // { name, extracted } awaiting overwrite consent
  const inputRef = useRef(null)

  useEffect(() => { saveCapsuleDraft(capsule) }, [capsule])

  const error = capsuleError(capsule)
  const sections = screenedSections(capsule)
  const empty = CAPSULE_FIELDS.every((field) => !capsule[field.key].trim())
  const busy = scanning || reading

  const apply = (name, extracted) => {
    const { capsule: next, filled } = applyExtractedCapsule(capsule, extracted)
    setCapsule(next)
    setTouched(false)
    setSource({ name, filled })
    if (filled.length === 0) {
      toast.warning('No sections found in the file', {
        description: 'Its headings were not recognised. Paste each section into the form instead.',
      })
    } else if (filled.length < CAPSULE_FIELDS.length) {
      toast.success(`Filled the ${listOf(filled)} from ${name}`, {
        description: 'Review each section, and add any the file did not have.',
      })
    } else {
      toast.success(`Filled every section from ${name}`, { description: 'Review them before checking.' })
    }
  }

  const readFile = async (file) => {
    const problem = capsuleFileError(file)
    if (problem) {
      toast.error('This file cannot be used', { description: problem })
      return
    }
    setReading(true)
    try {
      const extracted = await extractCapsule(file)
      if (overwrittenFields(capsule, extracted).length > 0) setPending({ name: file.name, extracted })
      else apply(file.name, extracted)
    } catch (err) {
      toast.error('The capsule could not be read', { description: apiErrorMessage(err) })
    } finally {
      setReading(false)
    }
  }

  const submit = (event) => {
    event.preventDefault()
    setTouched(true)
    if (error || busy) return
    onScan(capsule)
  }

  const set = (key) => (event) => setCapsule((current) => ({ ...current, [key]: event.target.value }))

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Capsule proposal" noValidate>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 sm:flex-nowrap">
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">Have the capsule as a file?</div>
          <div className="text-xs text-ink-muted" aria-live="polite">
            {source
              ? source.filled.length
                ? `Filled the ${listOf(source.filled)} from ${source.name}. Review before checking.`
                : `Nothing was recognised in ${source.name}.`
              : 'PDF, Word (.docx) or text. Its sections fill the form below for you to review.'}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={CAPSULE_FILE_ACCEPT}
          aria-label="Choose a capsule file"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readFile(file) }}
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={() => inputRef.current?.click()}>
          {reading
            ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Reading…</>
            : <><FileUp size={14} aria-hidden="true" /> Upload capsule</>}
        </Button>
      </div>

      {CAPSULE_FIELDS.map((field) => {
        const value = capsule[field.key]
        const common = {
          id: `capsule-${field.key}`,
          label: field.label,
          value,
          onChange: set(field.key),
          maxLength: field.max,
          disabled: busy,
          hint: field.hint,
        }
        return field.rows === 0
          ? <Input key={field.key} {...common} required />
          // Grows with its text up to a cap, where the browser supports it:
          // an uploaded section is several paragraphs, and reviewing one
          // through a four-line window meant scrolling inside every box. The
          // cap keeps four long sections from making the page itself long.
          : <Textarea key={field.key} {...common} rows={field.rows} className="max-h-72 [field-sizing:content]" />
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-ink-muted" aria-live="polite">
          {touched && error
            ? <span className="text-flame-600 dark:text-flame-200">{error}</span>
            : sections.length > 1
              ? `${sections.length} sections will be compared against the archive. Timeline and budget are not needed.`
              : 'Add the working title and at least one more section. Timeline and budget are not needed.'}
        </p>
        <div className="flex items-center gap-2">
          {!empty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => { setCapsule({ ...EMPTY_CAPSULE }); setTouched(false); setSource(null) }}
            >
              Clear
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy || (touched && Boolean(error))}>
            {scanning
              ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Checking…</>
              : <><ScanSearch size={14} aria-hidden="true" /> Check capsule</>}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => { apply(pending.name, pending.extracted); setPending(null) }}
        title="Replace what you typed?"
        message={pending
          ? `${pending.name} has its own ${listOf(overwrittenFields(capsule, pending.extracted))}. `
            + 'Using the file replaces what you typed there; sections the file does not have are kept.'
          : ''}
        confirmLabel="Use the file"
      />
    </form>
  )
}
