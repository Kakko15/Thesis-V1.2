import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Palette, Search, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Modal } from './ui/Modal'
import { Input } from './ui/Input'
import { nextCommandIndex } from '../lib/commandPalette'

/**
 * Ctrl/Cmd+K quick access, as an ARIA combobox over a listbox.
 *
 * Focus stays in the search box and the highlighted command is announced via
 * `aria-activedescendant`. Measured 2026-11-25 in user testing: Arrow keys did
 * nothing, Enter always ran the FIRST match whatever was highlighted, every
 * option reported `aria-selected="false"`, and Enter pressed right after
 * Ctrl+K could land on the page behind the palette.
 */
export function CommandPalette({ open, onClose, items, onOpenAppearance, onOpenProfile }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const listId = useId()
  const navigate = useNavigate()

  const commands = useMemo(() => [
    ...items.map((item) => ({
      id: item.to,
      label: item.label,
      description: `Open ${item.label.toLowerCase()}`,
      icon: item.icon,
      run: () => navigate(item.to),
    })),
    {
      id: 'appearance', label: 'Appearance and energy', description: 'Theme, palette, motion, and effects',
      icon: Palette, run: onOpenAppearance,
    },
    ...(onOpenProfile ? [{
      id: 'profile', label: 'Profile and security', description: 'Account details, avatar, and MFA',
      icon: UserRound, run: onOpenProfile,
    }] : []),
  ], [items, navigate, onOpenAppearance, onOpenProfile])

  const filtered = commands.filter((command) => {
    const haystack = `${command.label} ${command.description}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })
  const active = filtered.length ? Math.min(activeIndex, filtered.length - 1) : -1
  const optionId = (index) => `${listId}-option-${index}`

  // Belt and braces for the dialog's own [data-autofocus] handling: keystrokes
  // after Ctrl+K must reach the search box, never the page underneath.
  useEffect(() => {
    if (!open) return undefined
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const reset = () => {
    setQuery('')
    setActiveIndex(0)
  }

  const run = (command) => {
    reset()
    onClose()
    command.run()
  }

  const close = () => {
    reset()
    onClose()
  }

  const onKeyDown = (event) => {
    // Enter commits an IME candidate rather than choosing a command.
    if (event.nativeEvent.isComposing) return
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      setActiveIndex(nextCommandIndex(event.key, active, filtered.length))
      return
    }
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault()
      run(filtered[active])
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Quick access"
      description="Navigate the thesis library or open common settings."
      className="p-4 sm:p-5"
    >
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-45" aria-hidden="true" />
        <Input
          ref={inputRef}
          data-autofocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search destinations and actions"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          className="pl-10"
        />
      </div>
      <div id={listId} className="mt-3 space-y-1" role="listbox" aria-label="Commands">
        {filtered.map((command, index) => {
          const Icon = command.icon
          const selected = index === active
          return (
            <button
              key={command.id}
              id={optionId(index)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={selected}
              onClick={() => run(command)}
              onMouseEnter={() => setActiveIndex(index)}
              className={
                'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]'
                + (selected ? ' bg-[var(--accent)] text-[var(--accent-foreground)]' : '')
              }
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-container)] text-[var(--primary-container-foreground)]">
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{command.label}</span>
                <span className="block truncate text-xs text-ink-muted">{command.description}</span>
              </span>
              <ArrowRight size={15} className="opacity-35" aria-hidden="true" />
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-ink-muted">No matching destination or action.</p>
        )}
      </div>
    </Modal>
  )
}
