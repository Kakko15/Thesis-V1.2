import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter, Keyboard, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiErrorMessage, deleteSession, getSessions } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { getChatPrefs, setChatPref } from '../../lib/chatPrefs'
import { THESIS_CATEGORIES } from '../../lib/catalog'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'
import { ConfirmDialog } from '../../components/ui/Modal'
import { SectionCard, SettingItem, SettingRows } from './SectionCard'

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        checked ? 'bg-[var(--primary)]' : 'bg-forest-900/15 dark:bg-white/15',
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

function ClearConversations({ sessions }) {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const clearAll = async () => {
    setBusy(true)
    try {
      const results = await Promise.allSettled(sessions.map((session) => deleteSession(session.id)))
      const failed = results.filter((result) => result.status === 'rejected').length
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (failed > 0) {
        toast.warning(`Cleared ${sessions.length - failed} of ${sessions.length} conversations`, {
          description: 'Some deletions failed — try again in a moment.',
        })
      } else {
        toast.success('All conversations cleared')
      }
      setConfirmOpen(false)
    } catch (err) {
      toast.error('Could not clear conversations', { description: apiErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingItem
        icon={Trash2}
        tone="danger"
        title="Clear all conversations"
        description={`Permanently deletes ${sessions.length === 0 ? 'your' : `all ${sessions.length}`} saved conversation${sessions.length === 1 ? '' : 's'} and their messages.`}
        trailing={(
          <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)} disabled={sessions.length === 0}>
            Clear all
          </Button>
        )}
      />
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={clearAll}
        title="Clear all conversations?"
        message={`${sessions.length} conversation${sessions.length === 1 ? '' : 's'} and every message in them will be permanently deleted. This cannot be undone.`}
        confirmLabel="Clear all"
        danger
        loading={busy}
      />
    </>
  )
}

export function ChatSection() {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState(getChatPrefs)
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
    enabled: !!user,
  })

  const update = (key, value) => setPrefs(setChatPref(key, value))

  return (
    <div className="space-y-5">
      <SectionCard title="Ask IskAI" description="Defaults applied to every new conversation." flush>
        <SettingRows>
          <SettingItem
            icon={Filter}
            title="Default category filter"
            description="New chats start scoped to this thesis category."
            trailing={(
              <Select
                value={prefs.defaultCategory}
                onChange={(event) => update('defaultCategory', event.target.value)}
                className="h-10 w-48 rounded-full"
                aria-label="Default thesis category filter"
              >
                <option value="">All categories</option>
                {THESIS_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </Select>
            )}
          />
          <SettingItem
            icon={Keyboard}
            title="Press Enter to send"
            description={prefs.sendKey === 'enter'
              ? 'Enter sends · Shift + Enter adds a new line.'
              : 'Ctrl + Enter sends · Enter adds a new line.'}
            trailing={(
              <Toggle
                checked={prefs.sendKey === 'enter'}
                onChange={(on) => update('sendKey', on ? 'enter' : 'ctrlEnter')}
                label="Press Enter to send messages"
              />
            )}
          />
        </SettingRows>
      </SectionCard>

      {user && (
        <SectionCard title="Conversation data" description="Manage everything IskAI remembers for you." flush>
          <SettingRows>
            <ClearConversations sessions={sessions} />
          </SettingRows>
        </SectionCard>
      )}
    </div>
  )
}
