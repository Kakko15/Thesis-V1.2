import { Search, X } from 'lucide-react'
import { Select } from '../../components/ui/Input'
import { cn } from '../../lib/utils'

// The Select primitive is a form field first, so its trigger carries `w-full`.
// Here the selects are chips that should size to their own label, and a
// full-width flex item forces every one of them onto its own line: measured
// 2026-09-14, four filters stacked into four rows of empty space above the
// results even though the row was already `flex-wrap`. `w-auto` is what makes
// the row a row -- tailwind-merge drops the primitive's `w-full` for it.
const FILTER_CHIP = 'h-9 w-auto max-w-[14rem] rounded-full px-3.5 text-xs font-medium shadow-2xs'
const FILTER_CHIP_IDLE =
  'border-forest-900/15 bg-white/80 hover:border-forest-900/30 '
  + 'dark:border-white/15 dark:bg-forest-950/70'
// A filter that is set has to be distinguishable from one that is not without
// reading it: "All years" and "2025" otherwise render identically, so the only
// signal that the result count dropped is the chip row further down.
const FILTER_CHIP_SET =
  'border-forest-700/45 bg-forest-800/[0.07] font-semibold text-forest-900 '
  + 'hover:border-forest-700/60 dark:border-forest-300/45 dark:bg-forest-300/15 dark:text-forest-50'

function filterChip(isSet) {
  return cn(FILTER_CHIP, isSet ? FILTER_CHIP_SET : FILTER_CHIP_IDLE)
}

// Plural reads better on a filter over a set than the singular option labels
// in THESIS_CATEGORIES; the values are the same two the API accepts.
const CATEGORY_TABS = [
  { value: '', label: 'All' },
  { value: 'student', label: 'Student Theses' },
  { value: 'faculty', label: 'Faculty Research' },
]

function CategoryTabs({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter by thesis category"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-forest-900/10 bg-forest-900/[0.04] p-1 shadow-2xs dark:border-white/10 dark:bg-white/[0.04]"
    >
      {CATEGORY_TABS.map((tab) => (
        <button
          key={tab.value || 'all'}
          type="button"
          role="radio"
          aria-checked={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
            value === tab.value
              ? 'bg-forest-800 font-bold text-white shadow-2xs dark:bg-forest-400 dark:text-forest-950'
              : 'text-ink-muted hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// Each chip names the dimension it came from. Without it a removed chip is
// guesswork once two filters read as bare codes ("BSCS", "DM", "2025"), and
// the remove button announced the raw state key ("Remove program_id filter").
function activeFilterChips({ filters, setFilter, programs, specializations }) {
  const chips = []
  const push = (key, dimension, label) => {
    chips.push({ key, dimension, label, onRemove: () => setFilter(key, '') })
  }

  if (filters.query) push('query', 'Search', `“${filters.query}”`)
  if (filters.thesis_category) {
    const tab = CATEGORY_TABS.find((item) => item.value === filters.thesis_category)
    push('thesis_category', 'Category', tab?.label || filters.thesis_category)
  }
  if (filters.program_id) {
    const program = programs.find((item) => item.id === filters.program_id)
    push('program_id', 'Program', program?.code || filters.program_id)
  }
  if (filters.specialization_id) {
    const specialization = specializations.find((item) => item.id === filters.specialization_id)
    push('specialization_id', 'Specialization', specialization?.code || filters.specialization_id)
  }
  if (filters.track) push('track', 'Track', filters.track)
  if (filters.department) push('department', 'Department', filters.department)
  if (filters.year) push('year', 'Year', String(filters.year))

  return chips
}

function ActiveFilterChips({ filters, setFilter, clearFilters, programs = [], specializations = [] }) {
  const chips = activeFilterChips({ filters, setFilter, programs, specializations })
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-forest-900/10 pt-3 dark:border-white/10">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Active
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-forest-900/15 bg-forest-900/[0.06] py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-ink dark:border-white/15 dark:bg-white/[0.06]"
        >
          <span className="text-ink-faint">{chip.dimension}</span>
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="flex h-4 w-4 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-forest-900/15 hover:text-ink dark:hover:bg-white/15"
            aria-label={`Remove ${chip.dimension.toLowerCase()} filter`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clearFilters}
        className="ml-1 rounded-full px-2 py-0.5 text-xs font-semibold text-forest-700 transition-colors hover:bg-forest-900/[0.06] hover:text-forest-900 dark:text-forest-300 dark:hover:bg-white/10 dark:hover:text-forest-100"
      >
        Clear all
      </button>
    </div>
  )
}

export function ArchiveFiltersBar({
  filters,
  setFilter,
  clearFilters,
  programs = [],
  specializations = [],
  activeTracks = [],
  trackLabel = 'track',
  departments = [],
  years = [],
  isSuperadmin = false,
  sortBy = 'newest',
  setSortBy,
  sortOptions = [],
}) {
  return (
    <div className="glass space-y-3 rounded-[1.75rem] border border-forest-900/10 p-4 shadow-xs dark:border-white/10">
      {/* Search, then the one filter worth a permanent one-tap control. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted opacity-60"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Search the thesis archive"
            placeholder="Search titles, authors, abstracts…"
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
            className="h-11 w-full rounded-full border border-forest-900/15 bg-white/90 pl-11 pr-10 text-sm font-medium text-ink placeholder:text-ink-muted/60 shadow-2xs outline-none transition-all focus:border-forest-600 focus:shadow-xs dark:border-white/15 dark:bg-forest-950/70"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => setFilter('query', '')}
              aria-label="Clear search query"
              className="absolute right-3.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <CategoryTabs
          value={filters.thesis_category}
          onChange={(value) => setFilter('thesis_category', value)}
        />
      </div>

      {/* Scope filters inline, sort anchored to the trailing edge. */}
      <div className="flex flex-wrap items-center gap-2">
        {programs.length > 0 ? (
          <Select
            value={filters.program_id}
            onChange={(e) => setFilter('program_id', e.target.value)}
            className={filterChip(Boolean(filters.program_id))}
            aria-label="Filter by academic program"
            title={programs.find((program) => program.id === filters.program_id)?.name}
          >
            <option value="">All programs</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>{program.code} — {program.name}</option>
            ))}
          </Select>
        ) : activeTracks.length > 0 ? (
          <Select
            value={filters.track}
            onChange={(e) => setFilter('track', e.target.value)}
            className={filterChip(Boolean(filters.track))}
            aria-label={`Filter by ${trackLabel}`}
            title={filters.track || undefined}
          >
            <option value="">All {trackLabel}s</option>
            {activeTracks.map((track) => (
              <option key={track} value={track}>{track}</option>
            ))}
          </Select>
        ) : null}

        {specializations.length > 0 && (
          <Select
            value={filters.specialization_id}
            onChange={(e) => setFilter('specialization_id', e.target.value)}
            className={filterChip(Boolean(filters.specialization_id))}
            aria-label="Filter by academic specialization"
            title={specializations.find((item) => item.id === filters.specialization_id)?.name}
          >
            <option value="">All specializations</option>
            {specializations.map((specialization) => (
              <option key={specialization.id} value={specialization.id}>
                {specialization.code} — {specialization.name}
              </option>
            ))}
          </Select>
        )}

        {isSuperadmin && (
          <Select
            value={filters.department}
            onChange={(e) => setFilter('department', e.target.value)}
            className={filterChip(Boolean(filters.department))}
            aria-label="Filter by department"
            title={filters.department || undefined}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.name}>{department.name}</option>
            ))}
          </Select>
        )}

        <Select
          value={filters.year}
          onChange={(e) => setFilter('year', e.target.value)}
          className={filterChip(Boolean(filters.year))}
          aria-label="Filter by year"
        >
          <option value="">All years</option>
          {years.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </Select>

        {/* SORT_OPTIONS labels already carry their own "Sort:" prefix, so the
            trigger stays self-describing without a decorative icon. */}
        <Select
          value={sortBy}
          onChange={(e) => setSortBy?.(e.target.value)}
          className={cn(FILTER_CHIP, FILTER_CHIP_IDLE, 'sm:ml-auto')}
          aria-label="Sort theses by"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>

      <ActiveFilterChips
        filters={filters}
        setFilter={setFilter}
        clearFilters={clearFilters}
        programs={programs}
        specializations={specializations}
      />
    </div>
  )
}
