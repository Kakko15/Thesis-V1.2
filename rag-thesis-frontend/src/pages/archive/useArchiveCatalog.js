import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiErrorMessage, deletePaper, getDepartments, getTracks, listPapers } from '../../api'
import { paginateItems } from '../../lib/pagination'
import {
  SORT_OPTIONS,
  archiveYears,
  filterArchivePapers,
  resolveArchivePrograms,
  resolveArchiveTracks,
  sortArchivePapers,
} from './archiveFilters'

export const ARCHIVE_PAGE_SIZE = 6

export function useArchiveCatalog({ isSuperadmin, userDepartment }) {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({
    query: '', track: '', program_id: '', specialization_id: '', year: '', department: '',
    thesis_category: '',
  })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [sortBy, setSortByState] = useState('newest')

  const papersQuery = useQuery({ queryKey: ['papers'], queryFn: () => listPapers(null) })
  const { data: tracks = [] } = useQuery({ queryKey: ['tracks'], queryFn: getTracks })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const papers = useMemo(() => papersQuery.data || [], [papersQuery.data])
  const selectedDepartment = isSuperadmin ? filters.department : userDepartment
  const trackOptions = useMemo(
    () => resolveArchiveTracks({ tracks, departments, selectedDepartment }),
    [departments, selectedDepartment, tracks],
  )
  const programOptions = useMemo(
    () => resolveArchivePrograms({
      departments,
      selectedDepartment,
      programId: filters.program_id,
    }),
    [departments, filters.program_id, selectedDepartment],
  )
  const years = useMemo(() => archiveYears(papers), [papers])
  const filtered = useMemo(
    () => {
      const matched = filterArchivePapers(papers, { ...filters, superadmin: isSuperadmin })
      return sortArchivePapers(matched, sortBy, filters.query)
    },
    [filters, isSuperadmin, papers, sortBy],
  )
  const paginated = useMemo(
    () => paginateItems(filtered, page, ARCHIVE_PAGE_SIZE),
    [filtered, page],
  )

  const setSortBy = (value) => {
    setPage(1)
    setSortByState(value)
  }

  const setFilter = (key, value) => {
    setPage(1)
    setFilters((current) => {
      const next = { ...current, [key]: value }
      if (key === 'department') {
        next.track = ''
        next.program_id = ''
        next.specialization_id = ''
      }
      if (key === 'program_id') next.specialization_id = ''
      return next
    })
  }
  const clearFilters = () => {
    setPage(1)
    setFilters({
      query: '', track: '', program_id: '', specialization_id: '', year: '', department: '',
      thesis_category: '',
    })
  }
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
    page,
    setPage,
    paginated,
    pageSize: ARCHIVE_PAGE_SIZE,
    sortBy,
    setSortBy,
    sortOptions: SORT_OPTIONS,
    ...trackOptions,
    ...programOptions,
  }
}
