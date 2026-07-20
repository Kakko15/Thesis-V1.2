import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiErrorMessage, deletePaper, getDepartments, getTracks, listPapers } from '../../api'
import { archiveYears, filterArchivePapers, resolveArchiveTracks } from './archiveFilters'

export function useArchiveCatalog({ isSuperadmin, userDepartment }) {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({ query: '', track: '', year: '', department: '' })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)

  const papersQuery = useQuery({ queryKey: ['papers'], queryFn: () => listPapers(null) })
  const { data: tracks = [] } = useQuery({ queryKey: ['tracks'], queryFn: getTracks })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const papers = useMemo(() => papersQuery.data || [], [papersQuery.data])
  const selectedDepartment = isSuperadmin ? filters.department : userDepartment
  const trackOptions = useMemo(
    () => resolveArchiveTracks({ tracks, departments, selectedDepartment }),
    [departments, selectedDepartment, tracks],
  )
  const years = useMemo(() => archiveYears(papers), [papers])
  const filtered = useMemo(
    () => filterArchivePapers(papers, { ...filters, superadmin: isSuperadmin }),
    [filters, isSuperadmin, papers],
  )

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const clearFilters = () => setFilters({ query: '', track: '', year: '', department: '' })
  const submitDelete = async () => {
    if (!deleteTarget?.id) return
    setBusy(true)
    try {
      await deletePaper(deleteTarget.id)
      await queryClient.invalidateQueries({ queryKey: ['papers'] })
      toast.success('Thesis removed from the archive')
      setDeleteTarget(null)
    } catch (error) {
      toast.error('Delete failed', { description: apiErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return {
    ...papersQuery,
    papers,
    departments,
    years,
    filtered,
    filters,
    setFilter,
    clearFilters,
    deleteTarget,
    setDeleteTarget,
    detail,
    setDetail,
    busy,
    submitDelete,
    ...trackOptions,
  }
}
