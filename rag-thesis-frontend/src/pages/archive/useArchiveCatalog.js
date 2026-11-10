import { useMemo, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiErrorMessage, deletePaper, getDepartments, getTracks, listPapers } from '../../api'
import { paginateItems } from '../../lib/pagination'
import {
  SORT_OPTIONS,
  archiveAdvisers,
  archiveYears,
  filterArchivePapers,
  resolveArchivePrograms,
  resolveArchiveTracks,
  sortArchivePapers,
  trackDisplayLabels,
} from './archiveFilters'
import {
  MAX_COMPARE_PAPERS,
  getReadingListSnapshot,
  parseSavedPaperIds,
  subscribeReadingList,
  toggleComparePaperId,
  toggleSavedPaperId,
  writeSavedPaperIds,
} from './researchTools'

export const ARCHIVE_PAGE_SIZE = 6

export function useArchiveCatalog({ isSuperadmin, userDepartment, userId }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => ({
    query: searchParams.get('query') || '',
    track: searchParams.get('track') || '',
    program_id: '',
    specialization_id: '',
    year: '',
    department: '',
    thesis_category: '',
    adviser: '',
    savedOnly: searchParams.get('saved') === '1',
  }))
  const rawSavedSnapshot = useSyncExternalStore(
    subscribeReadingList,
    () => getReadingListSnapshot(userId),
    () => '[]',
  )
  const savedIds = useMemo(() => parseSavedPaperIds(rawSavedSnapshot), [rawSavedSnapshot])
  const [compareIds, setCompareIds] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailState, setDetailState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [page, setPageState] = useState(1)
  // Which way the results should travel when the page changes. Derived
  // here, where both the old and the new page are known, rather than from
  // a ref read during the grid's render.
  const [pageDirection, setPageDirection] = useState(1)
  const [sortBy, setSortByState] = useState('newest')

  const papersQuery = useQuery({ queryKey: ['papers'], queryFn: () => listPapers(null) })
  const tracksQuery = useQuery({ queryKey: ['tracks'], queryFn: getTracks })
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const tracks = useMemo(() => tracksQuery.data || [], [tracksQuery.data])
  const departments = useMemo(() => departmentsQuery.data || [], [departmentsQuery.data])
  const isLoading = papersQuery.isLoading || tracksQuery.isLoading || departmentsQuery.isLoading
  const papers = useMemo(() => papersQuery.data || [], [papersQuery.data])
  const requestedPaperId = searchParams.get('paper')
  const detail = useMemo(() => {
    if (detailState) return detailState
    if (!requestedPaperId) return null
    return papers.find((p) => String(p.id) === String(requestedPaperId)) || null
  }, [detailState, papers, requestedPaperId])

  const setDetail = (nextDetail) => {
    setDetailState(nextDetail)
    if (!nextDetail && requestedPaperId) {
      const next = new URLSearchParams(searchParams)
      next.delete('paper')
      setSearchParams(next, { replace: true })
    }
  }
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
  const advisers = useMemo(() => archiveAdvisers(papers), [papers])
  const trackLabels = useMemo(() => trackDisplayLabels(departments), [departments])
  const savedSet = useMemo(() => new Set(savedIds.map(String)), [savedIds])
  const savedPapers = useMemo(
    () => papers.filter((p) => savedSet.has(String(p.id))),
    [papers, savedSet],
  )
  const comparePapers = useMemo(
    () => compareIds.map((id) => papers.find((p) => String(p.id) === String(id))).filter(Boolean),
    [compareIds, papers],
  )
  const filtered = useMemo(
    () => {
      const basePool = filters.savedOnly
        ? papers.filter((p) => savedSet.has(String(p.id)))
        : papers
      const matched = filterArchivePapers(
        basePool, { ...filters, superadmin: isSuperadmin }, programOptions.programs,
      )
      return sortArchivePapers(matched, sortBy, filters.query)
    },
    [filters, isSuperadmin, papers, programOptions.programs, savedSet, sortBy],
  )
  const paginated = useMemo(
    () => paginateItems(filtered, page, ARCHIVE_PAGE_SIZE),
    [filtered, page],
  )

  const toggleSaved = (paperId) => {
    const { nextIds, saved } = toggleSavedPaperId(savedIds, paperId)
    writeSavedPaperIds(userId, nextIds)
    toast.success(saved ? 'Saved to your reading list' : 'Removed from reading list')
  }

  const toggleCompare = (paperId) => {
    const { nextIds, capped } = toggleComparePaperId(compareIds, paperId)
    if (capped) {
      toast.info(`You can compare up to ${MAX_COMPARE_PAPERS} studies at a time`)
      return
    }
    setCompareIds(nextIds)
  }

  const clearCompare = () => setCompareIds([])

  const setPage = (next) => {
    const target = typeof next === 'function' ? next(page) : next
    setPageDirection(target >= page ? 1 : -1)
    setPageState(target)
  }

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
    if ((key === 'track' || key === 'query' || key === 'savedOnly') && !value) {
      const paramKey = key === 'savedOnly' ? 'saved' : key
      if (searchParams.has(paramKey)) {
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete(paramKey)
        setSearchParams(nextParams, { replace: true })
      }
    }
  }
  const clearFilters = () => {
    setPage(1)
    setFilters({
      query: '', track: '', program_id: '', specialization_id: '', year: '', department: '',
      thesis_category: '', adviser: '', savedOnly: false,
    })
    if (searchParams.has('query') || searchParams.has('track') || searchParams.has('saved')) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('query')
      nextParams.delete('track')
      nextParams.delete('saved')
      setSearchParams(nextParams, { replace: true })
    }
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
    isLoading,
    papers,
    departments,
    years,
    advisers,
    trackLabels,
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
    pageDirection,
    setPage,
    paginated,
    pageSize: ARCHIVE_PAGE_SIZE,
    sortBy,
    setSortBy,
    sortOptions: SORT_OPTIONS,
    savedIds,
    savedSet,
    savedPapers,
    toggleSaved,
    compareIds,
    comparePapers,
    toggleCompare,
    clearCompare,
    ...trackOptions,
    ...programOptions,
  }
}
