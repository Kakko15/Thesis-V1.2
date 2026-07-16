import { useMemo, useState } from 'react'
import { ArrowRight, Palette, Search, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './ui/Modal'
import { Input } from './ui/Input'

export function CommandPalette({ open, onClose, items, onOpenAppearance, onOpenProfile }) {
  const [query, setQuery] = useState('')
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

  const run = (command) => {
    setQuery('')
    onClose()
    command.run()
  }

  const close = () => {
    setQuery('')
    onClose()
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
          data-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filtered[0]) run(filtered[0])
          }}
          placeholder="Search destinations and actions"
          aria-label="Search commands"
          className="pl-10"
        />
      </div>
      <div className="mt-3 space-y-1" role="listbox" aria-label="Commands">
        {filtered.map((command) => {
          const Icon = command.icon
          return (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => run(command)}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[var(--accent)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-container)] text-[var(--primary-container-foreground)]">
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{command.label}</span>
                <span className="block truncate text-xs opacity-55">{command.description}</span>
              </span>
              <ArrowRight size={15} className="opacity-35" aria-hidden="true" />
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-sm opacity-55">No matching destination or action.</p>
        )}
      </div>
    </Modal>
  )
}
