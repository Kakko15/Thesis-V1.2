import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts'
import { BarChart3 } from 'lucide-react'

import { GlassCard } from '../../components/ui/GlassCard'

/**
 * The two Recharts panels on the admin overview, split into their own chunk.
 *
 * Recharts is ~382 kB raw / ~109 kB gzipped and was bundled into
 * AdminOverview's chunk, so the whole admin landing page waited on a charting
 * library before it could paint a single statistic. The parent lazy-loads this
 * behind a Suspense boundary whose fallback matches these card heights, so the
 * layout does not shift when the charts arrive.
 *
 * The colours and tooltip live here rather than in the parent because nothing
 * outside these panels uses them.
 */

const CHART_COLORS = ['#046a38', '#f2a900', '#10b96c', '#d22630', '#059656']

// The parent mirrors these panels' height in its own CHART_PANEL_HEIGHT rather
// than importing one from here. A static import of any binding in this module
// would pull the Recharts chunk into the parent's, undoing the split.

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong rounded-xl px-3.5 py-2 text-xs">
      <div className="font-bold">{label ?? payload[0].name}</div>
      <div className="opacity-70">{payload[0].value} theses</div>
    </div>
  )
}

export default function OverviewCharts({ trackData, yearData }) {
  return (
    <>
      <GlassCard className="p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
          <BarChart3 size={13} /> Theses per track
        </div>
        {trackData.length === 0 ? (
          <p className="py-14 text-center text-sm text-ink-faint">No data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={trackData} dataKey="value" nameKey="name"
                innerRadius={58} outerRadius={92} paddingAngle={4} strokeWidth={0}
              >
                {trackData.map((entry, i) => (
                  <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
          {trackData.map((t, i) => (
            <div key={t.name} className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              {t.name} ({t.value})
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
          <BarChart3 size={13} /> Theses per year
        </div>
        {yearData.length === 0 ? (
          <p className="py-14 text-center text-sm text-ink-faint">No data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={yearData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, opacity: 0.6 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, opacity: 0.6 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(4,106,56,0.06)' }} />
              <Bar dataKey="value" fill="#046a38" radius={[8, 8, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassCard>
    </>
  )
}
