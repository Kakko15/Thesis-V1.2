import { useQuery } from '@tanstack/react-query'
import { BookMarked, GitBranch, Landmark, MessageSquareText } from 'lucide-react'
import { getPublicSummary } from '../../api'
import { AnimatedCounter, Reveal } from '../../components/ui/Motion'

/** Live archive numbers that distinguish unavailable data from genuine zeroes. */
const RETRY_UNAVAILABLE_STATS_MS = 5_000

export function StatsStrip() {
  const { data, isError, isPending, isFetching, refetch } = useQuery({
    queryKey: ['public-summary'],
    queryFn: getPublicSummary,
    retry: false,
    refetchInterval: (query) => (
      query.state.status === 'error' ? RETRY_UNAVAILABLE_STATS_MS : false
    ),
  })
  const stats = [
    { label: 'Theses indexed', value: data?.total_papers ?? 0, icon: BookMarked },
    { label: 'Academic tracks', value: data?.total_tracks ?? 0, icon: GitBranch },
    { label: 'Questions answered', value: data?.total_queries ?? 0, icon: MessageSquareText },
    {
      label: 'Years of research',
      value: data?.year_range ? Math.max(1, data.year_range.to - data.year_range.from + 1) : 0,
      icon: Landmark,
    },
  ]

  return (
    <section className="relative px-6 py-14">
      <Reveal>
        <div className="glass mx-auto grid max-w-5xl grid-cols-2 gap-y-8 rounded-[2rem] px-4 py-9 lg:grid-cols-4 lg:divide-x lg:divide-forest-900/10 lg:gap-y-0 dark:lg:divide-white/10">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex flex-col items-center gap-1.5 px-4 text-center">
              <Icon size={20} className="mb-1 text-gold-400" />
              <span className="font-display text-3xl font-extrabold sm:text-4xl">
                {isPending || (isError && !data) ? '—' : <AnimatedCounter value={value} />}
              </span>
              <span className="text-xs font-medium uppercase tracking-wider opacity-55">{label}</span>
            </div>
          ))}
        </div>
        {isError && !data && (
          <div className="mt-4 flex items-center justify-center gap-2 text-center text-xs font-medium opacity-60">
            <span>Statistics temporarily unavailable. Reconnecting automatically.</span>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="font-semibold text-forest-700 underline underline-offset-2 disabled:cursor-wait disabled:opacity-50 dark:text-gold-300"
            >
              {isFetching ? 'Retrying…' : 'Retry now'}
            </button>
          </div>
        )}
      </Reveal>
    </section>
  )
}
