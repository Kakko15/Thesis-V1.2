import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, Pencil, Plus, Save, Search, TerminalSquare, Trash2, UserCog, X as CloseIcon,
} from 'lucide-react'
import {
  apiErrorMessage, createDepartment, deleteDepartment, deleteUser, getDepartments,
  getFeaturePermissions, getSystemLogs, listPapers, listUsers, updateDepartment,
  updateFeaturePermissions, updateUserDetails, updateUserRole,
} from '../../api'
import { useAuth } from '../../context/AuthContext'
import { GlassCard } from '../../components/ui/GlassCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { Badge, RoleBadge } from '../../components/ui/Badge'
import { Input, Select } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Modal'
import { formatDate } from '../../lib/utils'
import { avatarPublicUrl } from '../../lib/avatar'

function PaginationControls({ page, setPage, total, limit }) {
  const totalPages = Math.ceil(total / limit)
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-between border-t border-forest-900/10 px-6 py-3 dark:border-white/10">
      <div className="text-xs opacity-60">Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total}</div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="h-auto px-3 py-1 text-xs">Prev</Button>
        <Button size="sm" variant="secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="h-auto px-3 py-1 text-xs">Next</Button>
      </div>
    </div>
  )
}

function FeaturePermissionsManagement() {
  const { broadcastFeatureUpdate } = useAuth()
  const queryClient = useQueryClient()
  const { data: features, isLoading } = useQuery({ queryKey: ['features'], queryFn: getFeaturePermissions })

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
        <div className="text-sm font-bold uppercase tracking-wider opacity-70">Role Feature Permissions</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
            <tr>
              <th className="px-6 py-3 w-1/4">Role</th>
              <th className="px-6 py-3 w-3/4">Granted Features</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
            {isLoading ? (
              <tr><td colSpan={2} className="px-6 py-8 text-center opacity-50">Loading features...</td></tr>
            ) : (
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
                            <span className="text-sm font-medium group-hover:text-forest-600 dark:group-hover:text-gold-400 transition-colors">
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
      </div>
    </GlassCard>
  )
}

function DepartmentsManagement() {
  const queryClient = useQueryClient()
  const { data: departments = [], isLoading } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  
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
    <GlassCard className="overflow-hidden mb-6">
      <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-wider opacity-70">Departments & Tracks Configuration</div>
        <Button size="sm" onClick={startCreate} disabled={editingId !== null}><Plus size={14} className="mr-1" /> Add Dept</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
            <tr>
              <th className="px-6 py-3">Dept Name</th>
              <th className="px-6 py-3">Track Label</th>
              <th className="px-6 py-3">Tracks (Options)</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
            {isLoading ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center opacity-50">Loading departments...</td></tr>
            ) : (
              <>
                {paginated.map(d => (
                  <tr key={d.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4">
                      {editingId === d.id ? <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="h-8 text-xs max-w-[120px]" /> : <div className="font-bold">{d.name}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {editingId === d.id ? <Input value={form.track_label} onChange={e => setForm({...form, track_label: e.target.value})} className="h-8 text-xs max-w-[150px]" /> : d.track_label}
                    </td>
                    <td className="px-6 py-4">
                      {editingId === d.id ? (
                        <Input value={form.tracks} onChange={e => setForm({...form, tracks: e.target.value})} placeholder="Comma-separated" className="h-8 text-xs w-full min-w-[200px]" />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {d.tracks.map(t => <Badge key={t} tone="neutral" className="text-[10px] py-0">{t}</Badge>)}
                          {d.tracks.length === 0 && <span className="opacity-40 italic text-xs">No tracks</span>}
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
      </div>
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
  const [paperPage, setPaperPage] = useState(1)
  const [confirmation, setConfirmation] = useState(null)
  const [confirming, setConfirming] = useState(false)
  
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })
  
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
  
  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['system-logs'],
    queryFn: () => getSystemLogs(200),
  })

  const { data: papers = [], isLoading: loadingPapers } = useQuery({
    queryKey: ['papers', 'all'],
    queryFn: () => listPapers(null),
  })
  const filteredPapers = papers.filter(p => {
    if (paperDeptFilter !== 'all' && p.department !== paperDeptFilter) return false
    if (paperSearchQuery) {
      const q = paperSearchQuery.toLowerCase()
      if (!p.title?.toLowerCase().includes(q) && !p.authors?.toLowerCase().includes(q)) return false
    }
    return true
  })
  const paginatedPapers = filteredPapers.slice((paperPage - 1) * 5, paperPage * 5)

  const handleUpdate = async (userId, data) => {
    try {
      await updateUserDetails(userId, data)
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
      const fallbackName = selectedUser.full_name || selectedUser.email.split('@')[0] || 'Unknown'
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
      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider opacity-70">User Directory</div>
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
                <option value="CCSICT">CCSICT</option>
                <option value="CAS">CAS</option>
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
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
              {loadingUsers ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center opacity-50">Loading users...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center opacity-50">No users found.</td></tr>
              ) : (
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
                            <div className="mt-0.5 text-[0.65rem] font-semibold text-forest-600 dark:text-gold-400 capitalize">
                              {u.role === 'superadmin' ? 'Super Admin at System' : <>{u.role === 'admin' ? 'Administrator' : u.role} at {u.department || 'Unassigned'}</>}
                            </div>
                            <div className="mt-0.5 text-xs opacity-60">{u.email}</div>
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
                          <option value="CCSICT">CCSICT</option>
                          <option value="CAS">CAS</option>
                        </Select>
                      ) : (
                        <Badge tone="neutral">{u.department || 'Unassigned'}</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs opacity-70">{formatDate(u.created_at)}</td>
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
        </div>
        <PaginationControls page={userPage} setPage={setUserPage} total={filteredUsers.length} limit={5} />
      </GlassCard>

      <GlassCard className="p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
          <TerminalSquare size={13} /> Raw System Logs
        </div>
        <div className="bg-canvas-950 text-white rounded-2xl p-4 font-mono text-[0.65rem] max-h-96 overflow-y-auto space-y-2">
          {loadingLogs ? <div className="opacity-50">Loading system logs...</div> : (
            logs.map(log => (
              <div key={log.id} className="border-b border-white/10 pb-2">
                <span className="text-forest-400">[{new Date(log.created_at).toISOString()}]</span>{' '}
                <span className="text-gold-400">{log.action}</span>{' '}
                <span className="opacity-60">USER:{log.user?.email || log.user_id || 'system'}</span>{' '}
                <span className="text-white/80">{JSON.stringify(log.detail)}</span>
              </div>
            ))
          )}
        </div>
      </GlassCard>

      {myRole === 'superadmin' && (
        <>
          <FeaturePermissionsManagement />
          <DepartmentsManagement />
        </>
      )}

      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider opacity-70">Database Papers & Buckets</div>
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
            {isSuperadmin && (
              <Select value={paperDeptFilter} onChange={e => { setPaperDeptFilter(e.target.value); setPaperPage(1); }} className="h-8 w-[110px] rounded-xl px-2.5 text-xs" aria-label="Filter papers by department">
                <option value="all">All Depts</option>
                <option value="CCSICT">CCSICT</option>
                <option value="CAS">CAS</option>
              </Select>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
              <tr>
                <th className="px-6 py-3">Title & Authors</th>
                <th className="px-6 py-3">Dept / Track</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              {loadingPapers ? (
                <tr><td colSpan={2} className="px-6 py-8 text-center opacity-50">Loading database papers...</td></tr>
              ) : filteredPapers.length === 0 ? (
                <tr><td colSpan={2} className="px-6 py-8 text-center opacity-50">No papers found.</td></tr>
              ) : (
                paginatedPapers.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4 max-w-sm">
                      <div className="font-bold line-clamp-1">{p.title}</div>
                      <div className="text-xs opacity-60 line-clamp-1 mt-0.5">{p.authors || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-1">
                        <Badge tone="neutral">{p.department || 'Unassigned'}</Badge>
                        <Badge tone="forest">{p.track}</Badge>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
