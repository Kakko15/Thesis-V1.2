import { useQuery } from '@tanstack/react-query'
import { getTracks } from '../../api'
import { MarqueeRow } from '../../components/ui/Motion'
import { cn } from '../../lib/utils'

const FALLBACK_TRACKS = [
  'Data Mining',
  'Web Development',
  'Network Security',
  'Intelligent Systems',
  'Information Management',
]

const RETRY_UNAVAILABLE_TRACKS_MS = 5_000

function TrackChip({ track, gold = false }) {
  return (
    <div className="glass flex items-center gap-2.5 rounded-full px-6 py-3 text-sm font-semibold">
      <span className={cn('h-2 w-2 rounded-full', gold ? 'bg-forest-500' : 'bg-gold-400')} />
      {track}
    </div>
  )
}

/** Dual counter-scrolling rows of live academic tracks. */
export function TracksMarquee() {
  const { data: tracks } = useQuery({
    queryKey: ['tracks'],
    queryFn: getTracks,
    retry: false,
    refetchInterval: (query) => (
      query.state.status === 'error' ? RETRY_UNAVAILABLE_TRACKS_MS : false
    ),
  })
  const items = tracks?.length ? tracks : FALLBACK_TRACKS

  return (
    <section id="tracks" className="relative scroll-mt-24 overflow-hidden py-16">
      <p className="mb-8 text-center text-xs font-bold uppercase tracking-[0.2em] opacity-45">
        Spanning every CCSICT research track
      </p>
      <MarqueeRow items={items} render={(track) => <TrackChip track={track} />} />
      <MarqueeRow
        reverse
        slow
        items={[...items].reverse()}
        render={(track) => <TrackChip track={track} gold />}
        className="mt-4"
      />
    </section>
  )
}
