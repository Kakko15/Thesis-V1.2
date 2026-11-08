import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, Clock3, Pencil, Plus, Save, Search, ShieldCheck, TerminalSquare, Trash2, UserCog, X as CloseIcon,
} from 'lucide-react'
import {
  apiErrorMessage, createDepartment, deleteDepartment, deletePaper, deleteUser, getDepartments,
  getFeaturePermissions, getMalwareScanningSetting, getSystemLogs, listPapers, listUsers,
  updateDepartment, updateFeaturePermissions, updateMalwareScanningSetting,
  updateUserDetails, updateUserRole,
} from '../../api'
import { useAuth } from '../../context/AuthContext'
import { GlassCard } from '../../components/ui/GlassCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { Badge, RoleBadge } from '../../components/ui/Badge'
import { Input, Select } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Modal'
import { formatDate } from '../../lib/utils'
import { isFacultyThesis } from '../../lib/catalog'
import { avatarPublicUrl } from '../../lib/avatar'
import { TableScroller } from '../../components/ui/TableScroller'
import { TableStateRow } from '../../components/ui/TableStateRow'
import { PaginationFooter } from '../../components/ui/Pagination'
import {
  ARCHIVE_RETENTION_YEARS, isWithinRetentionWindow, summarizeArchiveRetention,
} from '../archive/archiveFilters'

function PaginationControls({ page, setPage, total, limit }) {
  return (
    <PaginationFooter
      page={page}
      setPage={setPage}
      total={total}
      limit={limit}
      className="px-6"
    />
  )
}

function FeaturePermissionsManagement() {
  const { broadcastFeatureUpdate } = useAuth()
  const queryClient = useQueryClient()
  const { data: features, isLoading, error, refetch } = useQuery({ queryKey: ['features'], queryFn: getFeaturePermissions })

  const handleToggle = async (role, feature) => {
    if (!features) return
    const current = features[role] || {}
    const newValue = !current[feature]
    const payload = {
      ...features,
      [role]: { ...current, [feature]: newValue }
    }
    
    // Optimistic update
    queryClient.setQueryData(['features'], payload)
    
    try {
      await updateFeaturePermissions(payload)
      toast.success(`${feature} for ${role} ${newValue ? 'enabled' : 'disabled'}`)
      
      // Fire a realtime broadcast so all connected clients instantly refetch without needing table RLS
      broadcastFeatureUpdate?.()
    } catch (err) {
      toast.error('Failed to update feature', { description: apiErrorMessage(err) })
      queryClient.invalidateQueries({ queryKey: ['features'] })
    }
  }

  return (
    <GlassCard className="overflow-hidden mb-6">
      <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">Role Feature Permissions</div>
      </div>
      <TableScroller label="Role feature permissions">
        <table className="w-full text-left text-sm">
          <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider text-ink-muted dark:bg-white/5">
            <tr>
              <th className="px-6 py-3 w-1/4">Role</th>
              <th className="px-6 py-3 w-3/4">Granted Features</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
            <TableStateRow
              colSpan={2}
              loading={isLoading}
              error={error}
              onRetry={() => refetch()}
              loadingLabel="Loading features..."
              errorLabel="Role permissions could not be loaded. The toggles below would show every feature as disabled, which is not what the server has stored."
            />
            {!isLoading && !error && (
              ['student', 'faculty'].map(role => (
                <tr key={role} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                  <td className="px-6 py-4 font-bold capitalize">{role}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-4">
                      {['chat', 'archive', 'novelty', 'upload'].map(feature => {
                        const isEnabled = features?.[role]?.[feature] || false
                        const labelMap = {
                          chat: 'AI Chat',
                          archive: 'Archive',
                          novelty: 'Novelty Check',
                          upload: 'Upload Thesis'
                        }
                        return (
                          <label key={feature} className="flex items-center gap-2 cursor-pointer group">
                            <div className="relative inline-flex items-center">
                              <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={isEnabled}
                                onChange={() => handleToggle(role, feature)}
                              />
                              <div className="w-9 h-5 bg-forest-900/20 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-forest-500"></div>
                            </div>
                            <span className="text-sm font-medium group-hover:text-forest-700 dark:group-hover:text-gold-400 transition-colors">
                              {labelMap[feature]}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroller>
    </GlassCard>
  )
}

function MalwareScanningManagement() {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const {
    data, isLoading, error, refetch,
  } = useQuery({
    queryKey: ['malware-scanning-setting'],
    queryFn: getMalwareScanningSetting,
  })

  const applySetting = async (enabled) => {
    setSaving(true)
    const previous = data
    queryClient.setQueryData(['malware-scanning-setting'], (current) => ({
      ...current,
      enabled,
      status: enabled ? current?.status : 'disabled',
    }))
    try {
      const updated = await updateMalwareScanningSetting(enabled)
      queryClient.setQueryData(['malware-scanning-setting'], updated)
      toast.success(`Malware scanning ${enabled ? 'enabled' : 'disabled'} for all uploads`)
    } catch (err) {
      queryClient.setQueryData(['malware-scanning-setting'], previous)
      toast.error('Failed to update malware scanning', { description: apiErrorMessage(err) })
    } finally {
      setSaving(false)
      setConfirmDisable(false)
    }
  }

  const enabled = Boolean(data?.enabled)

  return (
    <>
      <GlassCard className="overflow-hidden mb-6">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10">
          <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">Global Upload Security</div>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300">
              <ShieldCheck size={17} aria-hidden="true" />
            </span>
            <div>
              <div className="font-semibold text-ink">Malware check for all uploads</div>
              <p className="mt-1 max-w-2xl text-xs text-ink-muted">
                Scans capsule files, novelty manuscripts, and single or batch thesis uploads with ClamAV before their contents are read.
              </p>
              {!isLoading && !error && !data?.configured && (
                <p className="mt-2 text-xs font-medium text-flame-500">
                  ClamAV is not configured on this backend, so scanning cannot be enabled here.
                </p>
              )}
              {!enabled && data?.configured && (
                <p className="mt-2 text-xs font-medium text-flame-500">
                  Malware scanning is off. Uploaded files will be processed without a malware check.
                </p>
              )}
              {error && (
                <div className="mt-2 flex items-center gap-2 text-xs text-flame-500">
                  The malware setting could not be loaded.
                  <Button variant="ghost" size="sm" onClick={() => refetch()}>Retry</Button>
                </div>
              )}
            </div>
          </div>
          <label className="flex shrink-0 items-center gap-3 cursor-pointer">
            <span className="text-sm font-medium">{isLoading ? 'Loading…' : enabled ? 'On' : 'Off'}</span>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={enabled}
                disabled={isLoading || Boolean(error) || saving || !data?.configured}
                onChange={(event) => {
                  if (event.target.checked) applySetting(true)
                  else setConfirmDisable(true)
                }}
                aria-label="Malware check for all uploads"
              />
              <span className="h-6 w-11 rounded-full bg-forest-900/20 transition-colors peer-checked:bg-forest-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-transform peer-checked:after:translate-x-full" />
            </span>
          </label>
        </div>
      </GlassCard>
      <ConfirmDialog
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => applySetting(false)}
        title="Turn off malware scanning?"
        message="This applies to every user and every upload type. Files will be read and processed without a ClamAV malware check until a superadmin turns it back on."
        confirmLabel="Turn off"
        danger
        loading={saving}
      />
    </>
  )
}

/**
 * Raw activity log.
 *
 * Not a table, so the three async states are spelled out rather than delegated
 * to TableStateRow. An empty log pane and a failed log fetch look identical
 * otherwise — and this is the surface an administrator opens precisely when
 * something is already wrong, so "no logs" must not be able to mean "the log
 * request failed".
 */
function SystemLogsPanel({ logs, loading, error, onRetry }) {
  const body = () => {
    if (error) {
      return (
        <div className="flex flex-col items-start gap-2">
          <span className="text-flame-400">System logs could not be loaded.</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
        </div>
      )
    }
    if (loading) return <div className="opacity-50">Loading system logs...</div>
    if (logs.length === 0) return <div className="opacity-50">No activity has been logged yet.</div>
    return logs.map(log => (
      <div key={log.id} className="border-b border-white/10 pb-2">
        <span className="text-forest-400">[{new Date(log.created_at).toISOString()}]</span>{' '}
        <span className="text-gold-400">{log.action}</span>{' '}
        <span className="opacity-60">USER:{log.user?.email || log.user_id || 'system'}</span>{' '}
        <span className="text-white/80">{JSON.stringify(log.detail)}</span>
      </div>
    ))
  }
  return (
    <GlassCard className="p-6">
      <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
        <TerminalSquare size={13} /> Raw System Logs
      </div>
      <div className="bg-canvas-950 text-white rounded-2xl p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-2">
        {body()}
      </div>
    </GlassCard>
  )
}

function DepartmentsManagement() {
  const queryClient = useQueryClient()
  const {
    data: departments = [], isLoading, error, refetch,
  } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', track_label: '', tracks: '' })
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const paginated = departments.slice((page - 1) * 5, page * 5)

  const startEdit = (d) => {
    setEditingId(d.id)
    setForm({ name: d.name, track_label: d.track_label, tracks: d.tracks.join(', ') })
  }
  
  const startCreate = () => {
    setEditingId('new')
    setForm({ name: '', track_label: 'Academic track', tracks: '' })
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name.trim(),
        track_label: form.track_label.trim(),
        tracks: form.tracks.split(',').map(t => t.trim()).filter(Boolean)
      }
      if (editingId === 'new') {
        await createDepartment(payload)
        toast.success('Department created')
      } else {
        await updateDepartment(editingId, payload)
        toast.success('Department updated')
      }
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setEditingId(null)
    } catch (err) {
      toast.error('Failed to save department', { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDepartment(deleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error('Failed to delete department', { description: apiErrorMessage(err) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
    <GlassCard className="flex flex-col justify-between overflow-hidden mb-6">
      <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">Departments & Tracks Configuration</div>
        <Button size="sm" onClick={startCreate} disabled={editingId !== null}><Plus size={14} className="mr-1" /> Add Dept</Button>
      </div>
      <TableScroller label="Departments and tracks configuration" className="flex-1 min-h-[300px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider text-ink-muted dark:bg-white/5">
            <tr>
              <th className="px-6 py-3">Dept Name</th>
              <th className="px-6 py-3">Track Label</th>
              <th className="px-6 py-3">Tracks (Options)</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
            <TableStateRow
              colSpan={4}
              loading={isLoading}
              error={error}
              empty={departments.length === 0}
              onRetry={() => refetch()}
              loadingLabel="Loading departments..."
              emptyLabel="No departments have been created yet."
              errorLabel="Departments could not be loaded."
            />
            {!isLoading && !error && (
              <>
                {paginated.map(d => (
                  <tr key={d.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4">
                      {editingId === d.id ? <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="h-8 text-xs max-w-[120px]" /> : (
                        <>
                          <div className="font-bold">{d.name}</div>
                          {d.title && <div className="mt-0.5 text-xs text-ink-muted">{d.title}</div>}
                        </>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingId === d.id ? <Input value={form.track_label} onChange={e => setForm({...form, track_label: e.target.value})} className="h-8 text-xs max-w-[150px]" /> : d.track_label}
                    </td>
                    <td className="px-6 py-4">
                      {editingId === d.id ? (
                        <Input value={form.tracks} onChange={e => setForm({...form, tracks: e.target.value})} placeholder="Comma-separated" className="h-8 text-xs w-full min-w-[200px]" />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {d.tracks.map(t => <Badge key={t} tone="neutral" className="text-xs py-0">{t}</Badge>)}
                          {d.tracks.length === 0 && <span className="text-ink-faint italic text-xs">No tracks</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {editingId === d.id ? (
                          <>
                            <Button size="icon-sm" onClick={handleSave} aria-label="Save"><Save size={14} /></Button>
                            <Button size="icon-sm" variant="ghost" onClick={cancelEdit} aria-label="Cancel"><CloseIcon size={14} /></Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon-sm" variant="ghost" onClick={() => startEdit(d)} aria-label="Edit"><Pencil size={14} /></Button>
                            <Button size="icon-sm" variant="ghost" className="text-flame-500 hover:text-flame-600 hover:bg-flame-500/10" onClick={() => setDeleteTarget(d)} aria-label={`Delete ${d.name}`}><Trash2 size={14} /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {editingId === 'new' && (
                  <tr className="bg-forest-900/5 dark:bg-white/5">
                    <td className="px-6 py-4"><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="E.g. CBEA" className="h-8 text-xs max-w-[120px]" /></td>
                    <td className="px-6 py-4"><Input value={form.track_label} onChange={e => setForm({...form, track_label: e.target.value})} placeholder="E.g. Program" className="h-8 text-xs max-w-[150px]" /></td>
                    <td className="px-6 py-4"><Input value={form.tracks} onChange={e => setForm({...form, tracks: e.target.value})} placeholder="Comma-separated tracks" className="h-8 text-xs w-full min-w-[200px]" /></td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="icon-sm" onClick={handleSave} aria-label="Save"><Save size={14} /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={cancelEdit} aria-label="Cancel"><CloseIcon size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </TableScroller>
      <PaginationControls page={page} setPage={setPage} total={departments.length} limit={5} />
    </GlassCard>
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      onClose={() => !deleting && setDeleteTarget(null)}
      onConfirm={handleDelete}
      title="Delete department?"
      message={`This will permanently delete ${deleteTarget?.name || 'this department'} and its track configuration.`}
      confirmLabel="Delete department"
      danger
      loading={deleting}
    />
    </>
  )
}

/** A name the API will accept.
 *
 *  `UserUpdate.full_name` is required and rejects a blank string, while a
 *  profile row may legitimately carry none — so an account without a name made
 *  every edit fail validation with a 422 the administrator could not act on.
 */
function displayNameFor(user) {
  return (user?.full_name || '').trim() || user?.email?.split('@')[0] || 'Unknown'
}

/** Active department names, keeping `current` selectable even if its college
 *  has since been archived so an editor cannot silently reassign a record. */
function departmentOptions(departments, current) {
  const names = departments.map((department) => department.name).filter(Boolean)
  return current && !names.includes(current) ? [current, ...names] : names
}

function FiveYearStorageRetentionCard({ papers }) {
  const queryClient = useQueryClient()
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [purging, setPurging] = useState(false)
  const summary = summarizeArchiveRetention(papers)
  const currentMb = (summary.estimatedVectorKb / 1024).toFixed(2)

  const handlePurgeExpired = async () => {
    setPurging(true)
    let removed = 0
    try {
      for (const paper of summary.expiredPapers) {
        await deletePaper(paper.id)
        removed += 1
      }
      queryClient.invalidateQueries({ queryKey: ['papers'] })
      toast.success(`Purged ${removed} expired manuscript${removed === 1 ? '' : 's'} older than ${ARCHIVE_RETENTION_YEARS} years`)
    } catch (err) {
      toast.error('Retention purge encountered an error', { description: apiErrorMessage(err) })
    } finally {
      setPurging(false)
      setConfirmPurge(false)
    }
  }

  return (
    <>
      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300">
              <Clock3 size={16} aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">
                {ARCHIVE_RETENTION_YEARS}-Year Storage &amp; Archive Retention Policy
              </div>
              <p className="text-xs text-ink-muted">
                Active recency window: <span className="font-semibold text-ink">{summary.cutoffYear}–{summary.referenceYear}</span>.
                {' '}Staged PDFs are deleted after chunking &amp; vector indexing (~120 KB per thesis).
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={summary.expiredCount === 0 || purging}
            onClick={() => setConfirmPurge(true)}
          >
            <Trash2 size={13} /> Purge &gt; {ARCHIVE_RETENTION_YEARS} yrs ({summary.expiredCount})
          </Button>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-4">
          <div className="rounded-2xl border border-forest-900/10 bg-[var(--surface-1)] p-4 dark:border-white/10">
            <div className="text-xs font-medium text-ink-muted">Active Window (≤ {ARCHIVE_RETENTION_YEARS} yrs)</div>
            <div className="mt-1 font-display text-2xl font-extrabold text-forest-700 dark:text-forest-300">
              {summary.activeCount}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              Completed {summary.cutoffYear}–{summary.referenceYear}
            </div>
          </div>

          <div className="rounded-2xl border border-forest-900/10 bg-[var(--surface-1)] p-4 dark:border-white/10">
            <div className="text-xs font-medium text-ink-muted">Past {ARCHIVE_RETENTION_YEARS}-Year Window</div>
            <div className="mt-1 font-display text-2xl font-extrabold text-ink">
              {summary.expiredCount}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              Completed before {summary.cutoffYear}
            </div>
          </div>

          <div className="rounded-2xl border border-forest-900/10 bg-[var(--surface-1)] p-4 dark:border-white/10">
            <div className="text-xs font-medium text-ink-muted">Current Index Footprint</div>
            <div className="mt-1 font-display text-2xl font-extrabold text-ink">
              ~{currentMb} MB
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              0 MB permanent PDF bloat
            </div>
          </div>

          <div className="rounded-2xl border border-forest-900/10 bg-[var(--surface-1)] p-4 dark:border-white/10">
            <div className="text-xs font-medium text-ink-muted">5-Year Capacity Projection</div>
            <div className="mt-1 font-display text-2xl font-extrabold text-ink">
              ~{summary.projectedFiveYearMb} MB
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              Est. 5-year pgvector + metadata
            </div>
          </div>
        </div>
      </GlassCard>

      <ConfirmDialog
        open={confirmPurge}
        onClose={() => !purging && setConfirmPurge(false)}
        onConfirm={handlePurgeExpired}
        title={`Purge ${summary.expiredCount} expired thesis record${summary.expiredCount === 1 ? '' : 's'}?`}
        message={`This permanently removes ${summary.expiredCount} thesis record${summary.expiredCount === 1 ? '' : 's'} completed before ${summary.cutoffYear} (outside the ${ARCHIVE_RETENTION_YEARS}-year retention window) and their vector chunks.`}
        confirmLabel="Purge expired theses"
        danger
        loading={purging}
      />
    </>
  )
}

function filterAdminPapers(papers, deptFilter, retentionFilter, searchQuery) {
  const q = (searchQuery || '').toLowerCase()
  return papers.filter((p) => {
    if (deptFilter !== 'all' && p.department !== deptFilter) return false
    if (retentionFilter === 'active' && !isWithinRetentionWindow(p.year)) return false
    if (retentionFilter === 'expired' && isWithinRetentionWindow(p.year)) return false
    if (q && !p.title?.toLowerCase().includes(q) && !p.authors?.toLowerCase().includes(q)) return false
    return true
  })
}

export default function SystemManagementTab() {
  const { user: me, role: myRole, isSuperadmin, department: myDept } = useAuth()
  const queryClient = useQueryClient()
  const [editingUser, setEditingUser] = useState(null)
  const [deptFilter, setDeptFilter] = useState(isSuperadmin ? 'all' : (myDept || 'all'))
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [paperSearchQuery, setPaperSearchQuery] = useState('')
  const [paperDeptFilter, setPaperDeptFilter] = useState(isSuperadmin ? 'all' : (myDept || 'all'))
  const [paperRetentionFilter, setPaperRetentionFilter] = useState('all')
  const [paperPage, setPaperPage] = useState(1)
  const [confirmation, setConfirmation] = useState(null)
  const [confirming, setConfirming] = useState(false)
  
  const {
    data: users = [], isLoading: loadingUsers, error: usersError, refetch: refetchUsers,
  } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  // The department pickers below were hardcoded to CCSICT and CAS. They now
  // follow the server catalog, which publishes only active departments, so the
  // other ISU colleges appear here the moment they are scaled up.
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
  })
  const departmentNames = departmentOptions(departments)
  const editableDepartments = departmentOptions(departments, editingUser?.department)

  const filteredUsers = users.filter(u => {
    if (deptFilter !== 'all' && u.department !== deptFilter) return false
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (statusFilter !== 'all' && u.status !== statusFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!u.full_name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false
    }
    return true
  })
  const paginatedUsers = filteredUsers.slice((userPage - 1) * 5, userPage * 5)
  
  const {
    data: logs = [], isLoading: loadingLogs, error: logsError, refetch: refetchLogs,
  } = useQuery({
    queryKey: ['system-logs'],
    queryFn: () => getSystemLogs(200),
  })

  const {
    data: papers = [], isLoading: loadingPapers, error: papersError, refetch: refetchPapers,
  } = useQuery({
    queryKey: ['papers', 'all'],
    queryFn: () => listPapers(null),
  })
  const filteredPapers = filterAdminPapers(papers, paperDeptFilter, paperRetentionFilter, paperSearchQuery)
  const paginatedPapers = filteredPapers.slice((paperPage - 1) * 5, paperPage * 5)

  const handleUpdate = async (userId, data) => {
    try {
      // Exactly the four fields the endpoint reads, and never a blank name.
      // Posting the whole profile row sent `full_name: null` for an account
      // that has none, which `UserUpdate` rejects before the edit is applied.
      await updateUserDetails(userId, {
        full_name: displayNameFor(data),
        role: data.role,
        department: data.department,
        status: data.status,
      })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
      setEditingUser(null)
    } catch (err) {
      toast.error('Update failed', { description: apiErrorMessage(err) })
    }
  }

  const deleteSelectedUser = async (userId) => {
    try {
      await deleteUser(userId)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deleted')
    } catch (err) {
      toast.error('Delete failed', { description: apiErrorMessage(err) })
    }
  }

  const updateUserStatus = async (selectedUser, status) => {
    try {
      const fallbackName = displayNameFor(selectedUser)
      if (myRole === 'superadmin') {
        await updateUserDetails(selectedUser.id, {
          full_name: fallbackName,
          role: selectedUser.role,
          department: selectedUser.department,
          status,
        })
      } else {
        await updateUserRole(selectedUser.id, { role: selectedUser.role, status })
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`User ${status}`)
    } catch (err) {
      toast.error(`Failed to ${status === 'approved' ? 'approve' : 'reject'} user`, {
        description: apiErrorMessage(err),
      })
    }
  }

  const requestStatusChange = (selectedUser, status) => {
    const action = status === 'approved' ? 'Approve' : 'Reject'
    setConfirmation({
      title: `${action} user?`,
      message: `${action} ${selectedUser.full_name || selectedUser.email}? Their access will update immediately.`,
      confirmLabel: action,
      danger: status === 'rejected',
      run: () => updateUserStatus(selectedUser, status),
    })
  }

  const requestDeleteUser = (selectedUser) => {
    setConfirmation({
      title: 'Permanently delete user?',
      message: `Delete ${selectedUser.full_name || selectedUser.email}? This action cannot be undone.`,
      confirmLabel: 'Delete user',
      danger: true,
      run: () => deleteSelectedUser(selectedUser.id),
    })
  }

  const confirmRequestedAction = async () => {
    if (!confirmation) return
    setConfirming(true)
    try {
      await confirmation.run()
      setConfirmation(null)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <GlassCard className="flex flex-col justify-between overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">User Directory</div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <Input
                className="pl-9 h-8 text-xs w-[160px] rounded-xl"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setUserPage(1); }}
              />
            </div>
            {isSuperadmin && (
              <Select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setUserPage(1); }} className="h-8 w-[110px] rounded-xl px-2.5 text-xs" aria-label="Filter users by department">
                <option value="all">All Depts</option>
                {departmentNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
            )}
            <Select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setUserPage(1); }} className="h-8 w-[110px] rounded-xl px-2.5 text-xs" aria-label="Filter users by role">
              <option value="all">All Roles</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="admin">Admin</option>
              {isSuperadmin && <option value="superadmin">Superadmin</option>}
            </Select>
            <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setUserPage(1); }} className="h-8 w-[110px] rounded-xl px-2.5 text-xs" aria-label="Filter users by status">
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>
        </div>
        <TableScroller label="User directory" className="flex-1 min-h-[350px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider text-ink-muted dark:bg-white/5">
              <tr>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Dept</th>
                <th className="px-6 py-3">Joined</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              <TableStateRow
                colSpan={6}
                loading={loadingUsers}
                error={usersError}
                empty={filteredUsers.length === 0}
                onRetry={() => refetchUsers()}
                loadingLabel="Loading users..."
                emptyLabel="No users found."
                errorLabel="The user directory could not be loaded."
              />
              {!loadingUsers && !usersError && filteredUsers.length > 0 && (
                // Declarative table-cell variants are intentionally colocated for editing consistency.
                // eslint-disable-next-line complexity
                paginatedUsers.map(u => (
                  <tr key={u.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id ? (
                        <Input 
                          value={editingUser.full_name} 
                          onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })} 
                          className="h-8 text-xs max-w-[200px]"
                        />
                      ) : (
                        <div className="flex items-center gap-3">
                          {avatarPublicUrl(u.avatar_url) ? (
                            <img src={avatarPublicUrl(u.avatar_url)} alt={u.full_name || u.email} className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm" />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest-900/10 text-xs font-bold text-forest-700 dark:bg-white/10 dark:text-forest-300 shadow-sm uppercase">
                              {(u.full_name || u.email || '?').charAt(0)}
                            </div>
                          )}
                          <div>
                            <div className="font-bold">{u.full_name || u.email}</div>
                            <div className="mt-0.5 text-xs font-semibold text-forest-700 dark:text-gold-400 capitalize">
                              {u.role === 'superadmin' ? 'Super Admin at System' : <>{u.role === 'admin' ? 'Administrator' : u.role} at {u.department || 'Unassigned'}</>}
                            </div>
                            <div className="mt-0.5 text-xs text-ink-muted">{u.email}</div>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id ? (
                        <Select
                          value={editingUser.role}
                          onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                          className="h-8 rounded-xl px-2.5 text-xs w-[120px]"
                          aria-label={`Role for ${u.email}`}
                        >
                          <option value="student">Student</option>
                          <option value="faculty">Faculty</option>
                          {isSuperadmin && <option value="admin">Admin</option>}
                          {isSuperadmin && <option value="superadmin">Superadmin</option>}
                        </Select>
                      ) : (
                        <RoleBadge role={u.role} />
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id && isSuperadmin ? (
                        <Select
                          value={editingUser.status || 'approved'}
                          onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                          className="h-8 rounded-xl px-2.5 text-xs w-[100px]"
                          aria-label={`Status for ${u.email}`}
                        >
                          <option value="approved">Approved</option>
                          <option value="pending">Pending</option>
                          <option value="rejected">Rejected</option>
                        </Select>
                      ) : (
                        <Badge tone={u.status === 'pending' ? 'warning' : u.status === 'rejected' ? 'critical' : 'success'}>
                          {u.status || 'approved'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id ? (
                        <Select
                          value={editingUser.department || ''}
                          onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                          className="h-8 rounded-xl px-2.5 text-xs w-[100px]"
                          aria-label={`Department for ${u.email}`}
                        >
                          {editableDepartments.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone="neutral">{u.department || 'Unassigned'}</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-ink-muted">{formatDate(u.created_at)}</td>
                    <td className="px-6 py-4 text-right">
                      {u.id !== me?.id && (
                        <div className="flex justify-end gap-2">
                          {u.status === 'pending' && (isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                            <>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-8 py-0 px-3 text-xs text-flame-500 hover:text-flame-600 hover:bg-flame-500/10"
                                onClick={() => requestStatusChange(u, 'rejected')}
                              >
                                Reject
                              </Button>
                              <Button 
                                size="sm" 
                                variant="primary" 
                                className="h-8 py-0 px-3 text-xs"
                                onClick={() => requestStatusChange(u, 'approved')}
                              >
                                Approve
                              </Button>
                            </>
                          )}
                          {editingUser?.id === u.id ? (
                            <Button size="icon-sm" onClick={() => handleUpdate(u.id, editingUser)} aria-label="Save"><Save size={14} /></Button>
                          ) : (
                            (isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                              <Button size="icon-sm" variant="ghost" onClick={() => setEditingUser(u)} aria-label="Edit"><UserCog size={14} /></Button>
                            )
                          )}
                          {(isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                            <Button size="icon-sm" variant="ghost" className="text-flame-500 hover:text-flame-600 hover:bg-flame-500/10" onClick={() => requestDeleteUser(u)} aria-label={`Delete ${u.full_name || u.email}`}><Trash2 size={14} /></Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroller>
        <PaginationControls page={userPage} setPage={setUserPage} total={filteredUsers.length} limit={5} />
      </GlassCard>

      <SystemLogsPanel
        logs={logs}
        loading={loadingLogs}
        error={logsError}
        onRetry={() => refetchLogs()}
      />

      {myRole === 'superadmin' && (
        <>
          <FeaturePermissionsManagement />
          <MalwareScanningManagement />
          <DepartmentsManagement />
        </>
      )}

      <FiveYearStorageRetentionCard papers={papers} />

      <GlassCard className="flex flex-col justify-between overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">Database Papers & Buckets</div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <Input
                className="pl-9 h-8 text-xs w-[160px] rounded-xl"
                placeholder="Search titles, authors..."
                value={paperSearchQuery}
                onChange={(e) => { setPaperSearchQuery(e.target.value); setPaperPage(1); }}
              />
            </div>
            <Select
              value={paperRetentionFilter}
              onChange={(e) => { setPaperRetentionFilter(e.target.value); setPaperPage(1); }}
              className="h-8 w-[140px] rounded-xl px-2.5 text-xs"
              aria-label="Filter papers by 5-year retention"
            >
              <option value="all">All Years</option>
              <option value="active">Active (≤ 5 yrs)</option>
              <option value="expired">Past 5 yrs</option>
            </Select>
            {isSuperadmin && (
              <Select value={paperDeptFilter} onChange={e => { setPaperDeptFilter(e.target.value); setPaperPage(1); }} className="h-8 w-[110px] rounded-xl px-2.5 text-xs" aria-label="Filter papers by department">
                <option value="all">All Depts</option>
                {departmentNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
            )}
          </div>
        </div>
        <TableScroller label="Database papers and buckets" className="flex-1 min-h-[350px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider text-ink-muted dark:bg-white/5">
              <tr>
                <th className="px-6 py-3">Title & Authors</th>
                <th className="px-6 py-3">Dept / Track / Retention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              <TableStateRow
                colSpan={2}
                loading={loadingPapers}
                error={papersError}
                empty={filteredPapers.length === 0}
                onRetry={() => refetchPapers()}
                loadingLabel="Loading database papers..."
                emptyLabel="No papers found."
                errorLabel="The paper index could not be loaded."
              />
              {!loadingPapers && !papersError && filteredPapers.length > 0 && (
                paginatedPapers.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4 max-w-sm">
                      <div className="font-bold line-clamp-1">{p.title}</div>
                      <div className="text-xs text-ink-muted line-clamp-1 mt-0.5">{p.authors || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone="neutral">{p.department || 'Unassigned'}</Badge>
                        <Badge tone="forest">{p.track}</Badge>
                        {p.year && <Badge tone="neutral">{p.year}</Badge>}
                        <Badge tone={isWithinRetentionWindow(p.year) ? 'forest' : 'gold'}>
                          {isWithinRetentionWindow(p.year) ? '≤ 5 yrs' : '> 5 yrs'}
                        </Badge>
                        {isFacultyThesis(p) && <Badge tone="gold">Faculty Research</Badge>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroller>
        <PaginationControls page={paperPage} setPage={setPaperPage} total={filteredPapers.length} limit={5} />
      </GlassCard>
      <ConfirmDialog
        open={Boolean(confirmation)}
        onClose={() => !confirming && setConfirmation(null)}
        onConfirm={confirmRequestedAction}
        title={confirmation?.title}
        message={confirmation?.message}
        confirmLabel={confirmation?.confirmLabel}
        danger={confirmation?.danger}
        loading={confirming}
      />
    </div>
  )
}
