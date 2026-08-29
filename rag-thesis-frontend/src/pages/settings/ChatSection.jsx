import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter, Keyboard, MessageSquareText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiErrorMessage, deleteAllSessions, getSessions } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { getChatPrefs, setChatPref } from '../../lib/chatPrefs'
import { THESIS_CATEGORIES } from '../../lib/catalog'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'
import { ConfirmDialog } from '../../components/ui/Modal'
import { SectionCard } from './SectionCard'

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300',
        checked ? 'bg-gradient-to-r from-forest-600 to-forest-500 shadow-md shadow-forest-900/25' : 'bg-forest-900/15 dark:bg-white/15',
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all duration-300',
          checked ? 'left-6' : 'left-1',
        )}
      />
    </button>
  )
}

function ClearConversations({ isLoading, isError, refetch }) {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const clearAll = async () => {
    setBusy(true)
    try {
      await deleteAllSessions()
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('All conversations cleared')
      setConfirmOpen(false)
    } catch (err) {
      toast.error('Could not clear conversations', { description: apiErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-flame-500/20 bg-flame-500/5 p-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold">Clear all conversations</div>
        <p className="mt-0.5 text-xs text-ink-muted">
          Permanently deletes every saved conversation and its messages from your account.
        </p>
        {isError && <p className="mt-1 text-xs text-flame-700 dark:text-flame-300">Conversation history could not be loaded.</p>}
      </div>
      {isError ? (
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)} disabled={isLoading}>
          <Trash2 size={14} /> {isLoading ? 'Loading...' : 'Clear all'}
        </Button>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={clearAll}
        title="Clear all conversations?"
        message="Every conversation currently saved to your account and every message in them will be permanently deleted. This cannot be undone."
        confirmLabel="Clear all"
        danger
        loading={busy}
      />
    </div>
  )
}

export function ChatSection() {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState(getChatPrefs)
  const { isLoading, isError, refetch } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
    enabled: !!user,
  })

  const update = (key, value) => setPrefs(setChatPref(key, value))

  return (
    <div className="space-y-5">
      <SectionCard icon={MessageSquareText} title="Ask IskAI" description="Defaults applied to every new conversation.">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Filter size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold">Default category filter</div>
                <p className="text-xs text-ink-muted">New chats start scoped to this thesis category.</p>
              </div>
            </div>
            <Select
              value={prefs.defaultCategory}
              onChange={(event) => update('defaultCategory', event.target.value)}
              className="h-9 w-48"
              aria-label="Default thesis category filter"
            >
              <option value="">All categories</option>
              {THESIS_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-forest-900/10 pt-5 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-3">
              <Keyboard size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold">Press Enter to send</div>
                <p className="text-xs text-ink-muted">
                  {prefs.sendKey === 'enter'
                    ? 'Enter sends · Shift + Enter adds a new line.'
                    : 'Ctrl + Enter sends · Enter adds a new line.'}
                </p>
              </div>
            </div>
            <Toggle
              checked={prefs.sendKey === 'enter'}
              onChange={(on) => update('sendKey', on ? 'enter' : 'ctrlEnter')}
              label="Press Enter to send messages"
            />
          </div>
        </div>
      </SectionCard>

      {user && (
        <SectionCard icon={Trash2} title="Conversation data" description="Manage everything IskAI remembers for you.">
          <ClearConversations isLoading={isLoading} isError={isError} refetch={refetch} />
        </SectionCard>
      )}
    </div>
  )
}
