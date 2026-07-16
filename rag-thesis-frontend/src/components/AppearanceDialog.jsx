import { Check, Gauge, Leaf, Monitor, Moon, Palette, Sparkles, Sun } from 'lucide-react'
import { usePreferences } from '../context/PreferencesContext'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
import { Select } from './ui/Input'
import { Modal } from './ui/Modal'

const themeOptions = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const paletteOptions = [
  { value: 'isu', label: 'ISU Classic', swatch: 'from-forest-700 to-gold-300' },
  { value: 'emerald', label: 'Emerald', swatch: 'from-emerald-700 to-emerald-300' },
  { value: 'gold', label: 'Golden', swatch: 'from-amber-700 to-amber-300' },
]

function ChoiceGrid({ value, options, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup">
      {options.map(({ value: optionValue, label, icon: Icon, swatch }) => {
        const active = value === optionValue
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(optionValue)}
            className={cn(
              'relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-xs font-semibold transition-colors',
              active
                ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary-container-foreground)]'
                : 'border-[var(--border)] bg-[var(--surface-1)] hover:bg-[var(--accent)]',
            )}
          >
            {swatch ? (
              <span className={cn('h-7 w-7 rounded-full bg-gradient-to-br shadow-inner', swatch)} />
            ) : (
              <Icon size={20} aria-hidden="true" />
            )}
            {label}
            {active && <Check size={13} className="absolute right-2 top-2" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

export function AppearanceDialog({ open, onClose }) {
  const {
    theme, palette, motion, effects, updatePreference, resetPreferences,
  } = usePreferences()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Appearance and energy"
      description="Personalize the interface without changing research content or access permissions."
    >
      <div className="space-y-6">
        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Sun size={16} aria-hidden="true" /> Color mode
          </div>
          <ChoiceGrid value={theme} options={themeOptions} onChange={(value) => updatePreference('theme', value)} />
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Palette size={16} aria-hidden="true" /> Tonal palette
          </div>
          <ChoiceGrid value={palette} options={paletteOptions} onChange={(value) => updatePreference('palette', value)} />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Gauge size={16} aria-hidden="true" /> Motion
            </span>
            <Select
              value={motion}
              onChange={(event) => updatePreference('motion', event.target.value)}
              aria-label="Motion"
            >
              <option value="system">Follow device</option>
              <option value="full">Full motion</option>
              <option value="reduced">Reduced motion</option>
            </Select>
          </div>
          <div className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Leaf size={16} aria-hidden="true" /> Visual effects
            </span>
            <Select
              value={effects}
              onChange={(event) => updatePreference('effects', event.target.value)}
              aria-label="Visual effects"
            >
              <option value="balanced">Balanced</option>
              <option value="full">Full glass and 3D</option>
              <option value="low">Low energy</option>
            </Select>
          </div>
        </section>

        <div className="surface-tonal flex gap-3 rounded-2xl p-4 text-sm">
          <Sparkles size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="opacity-75">
            Low Energy removes heavy blur and decorative loops. Reduced Motion keeps every task available without animated transitions.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={resetPreferences}>Reset</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}
