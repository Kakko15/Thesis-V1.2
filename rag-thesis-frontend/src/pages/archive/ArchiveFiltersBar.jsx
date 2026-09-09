import { Search, X, SlidersHorizontal } from 'lucide-react'
import { Select } from '../../components/ui/Input'
import { THESIS_CATEGORIES, thesisCategoryLabel } from '../../lib/catalog'
import { cn } from '../../lib/utils'

function ActiveFilterChips({
  filters,
  setFilter,
  clearFilters,
  programs = [],
  specializations = [],
}) {
  const activeChips = []

  if (filters.query) {
    activeChips.push({
      key: 'query',
      label: `"${filters.query}"`,
      onRemove: () => setFilter('query', ''),
    })
  }
  if (filters.thesis_category) {
    activeChips.push({
      key: 'thesis_category',
      label: thesisCategoryLabel(filters.thesis_category),
      onRemove: () => setFilter('thesis_category', ''),
    })
  }
  if (filters.program_id) {
    const prog = programs.find((p) => p.id === filters.program_id)
    activeChips.push({
      key: 'program_id',
      label: prog?.code || filters.program_id,
      onRemove: () => setFilter('program_id', ''),
    })
  }
  if (filters.specialization_id) {
    const spec = specializations.find((s) => s.id === filters.specialization_id)
    activeChips.push({
      key: 'specialization_id',
      label: spec?.code || filters.specialization_id,
      onRemove: () => setFilter('specialization_id', ''),
    })
  }
  if (filters.track) {
    activeChips.push({
      key: 'track',
      label: filters.track,
      onRemove: () => setFilter('track', ''),
    })
  }
  if (filters.department) {
    activeChips.push({
      key: 'department',
      label: filters.department,
      onRemove: () => setFilter('department', ''),
    })
  }
  if (filters.year) {
    activeChips.push({
      key: 'year',
      label: String(filters.year),
      onRemove: () => setFilter('year', ''),
    })
  }

  if (activeChips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Active:
      </span>
      {activeChips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-forest-900/15 bg-forest-900/[0.06] px-2.5 py-0.5 text-xs font-medium text-ink transition-colors dark:border-white/15 dark:bg-white/[0.06]"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors hover:bg-forest-900/15 hover:text-ink dark:hover:bg-white/15"
            aria-label={`Remove ${chip.key} filter`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clearFilters}
        className="ml-1 text-xs font-semibold text-forest-700 hover:text-forest-900 hover:underline dark:text-forest-300 dark:hover:text-forest-100"
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
    <div className="glass space-y-3.5 rounded-[1.75rem] border border-forest-900/10 p-4 shadow-xs dark:border-white/10">
      {/* Top row: Google Search Bar & Quick Category Chips */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Google capsule search input */}
        <div className="relative flex-1">
          <Search
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted opacity-60"
            aria-hidden="true"
          />
          <input
            type="text"
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

        {/* Google Quick Category Pills */}
        <div
          role="radiogroup"
          aria-label="Filter research category"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-forest-900/10 bg-forest-900/[0.04] p-1 shadow-2xs dark:border-white/10 dark:bg-white/[0.04]"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!filters.thesis_category}
            onClick={() => setFilter('thesis_category', '')}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
              !filters.thesis_category
                ? 'bg-forest-800 font-bold text-white shadow-2xs dark:bg-forest-400 dark:text-forest-950'
                : 'text-ink-muted hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10',
            )}
          >
            All
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filters.thesis_category === 'student'}
            onClick={() => setFilter('thesis_category', 'student')}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
              filters.thesis_category === 'student'
                ? 'bg-forest-800 font-bold text-white shadow-2xs dark:bg-forest-400 dark:text-forest-950'
                : 'text-ink-muted hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10',
            )}
          >
            Student Theses
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filters.thesis_category === 'faculty'}
            onClick={() => setFilter('thesis_category', 'faculty')}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
              filters.thesis_category === 'faculty'
                ? 'bg-forest-800 font-bold text-white shadow-2xs dark:bg-forest-400 dark:text-forest-950'
                : 'text-ink-muted hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10',
            )}
          >
            Faculty Research
          </button>
        </div>
      </div>

      {/* Second row: Google Filter Chips and Sorting controls */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {/* Academic Program / Track */}
        {programs.length > 0 ? (
          <Select
            value={filters.program_id}
            onChange={(e) => setFilter('program_id', e.target.value)}
            className="h-9 min-w-36 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
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
            className="h-9 min-w-36 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
            aria-label={`Filter by ${trackLabel}`}
            title={filters.track || undefined}
          >
            <option value="">All {trackLabel}s</option>
            {activeTracks.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        ) : null}

        {/* Specialization */}
        {specializations.length > 0 && (
          <Select
            value={filters.specialization_id}
            onChange={(e) => setFilter('specialization_id', e.target.value)}
            className="h-9 min-w-36 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
            aria-label="Filter by academic specialization"
            title={specializations.find((specialization) => specialization.id === filters.specialization_id)?.name}
          >
            <option value="">All specializations</option>
            {specializations.map((specialization) => (
              <option key={specialization.id} value={specialization.id}>{specialization.code} — {specialization.name}</option>
            ))}
          </Select>
        )}

        {/* Department (superadmin) */}
        {isSuperadmin && (
          <Select
            value={filters.department}
            onChange={(e) => setFilter('department', e.target.value)}
            className="h-9 min-w-32 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
            aria-label="Filter by department"
            title={filters.department || undefined}
          >
            <option value="">All depts</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </Select>
        )}

        {/* Category Combobox */}
        <Select
          value={filters.thesis_category}
          onChange={(e) => setFilter('thesis_category', e.target.value)}
          className="h-9 min-w-36 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
          aria-label="Filter by thesis category"
        >
          <option value="">All categories</option>
          {THESIS_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </Select>

        {/* Publication Year */}
        <Select
          value={filters.year}
          onChange={(e) => setFilter('year', e.target.value)}
          className="h-9 min-w-28 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
          aria-label="Filter by year"
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>

        {/* Google Sort Control */}
        <div className="ml-auto flex items-center gap-1.5">
          <SlidersHorizontal size={14} className="text-ink-muted opacity-60" aria-hidden="true" />
          <Select
            value={sortBy}
            onChange={(e) => setSortBy?.(e.target.value)}
            className="h-9 min-w-40 rounded-full border-forest-900/15 bg-white/80 px-3.5 text-xs font-medium shadow-2xs hover:border-forest-900/30 dark:border-white/15 dark:bg-forest-950/70"
            aria-label="Sort theses by"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Active Filter Chips with Google Dismiss buttons */}
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
