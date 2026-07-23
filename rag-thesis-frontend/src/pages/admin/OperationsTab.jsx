import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, Server } from 'lucide-react'
import { toast } from 'sonner'
import {
  acknowledgeOperationalAlert,
  apiErrorMessage,
  getIngestionWorkers,
  getOperationalAlerts,
  getOperationalJobs,
  getOperationsSummary,
  getRetentionReport,
} from '../../api'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { GlassCard } from '../../components/ui/GlassCard'
import { Skeleton } from '../../components/ui/Skeleton'

function Metric({ icon: Icon, label, value, tone = 'text-forest-500' }) {
  return (
    <GlassCard className="p-5">
      <Icon size={18} className={tone} />
      <div className="mt-3 font-display text-2xl font-extrabold">{value ?? '—'}</div>
      <div className="text-[0.68rem] font-bold uppercase tracking-wider opacity-50">{label}</div>
    </GlassCard>
  )
}

function localTime(value) {
  return value ? new Date(value).toLocaleString() : 'Never'
}

function alertTone(alert) {
  if (alert.status === 'resolved') return 'forest'
  if (alert.status === 'acknowledged') return 'neutral'
  return alert.severity === 'critical' ? 'flame' : 'gold'
}

export default function OperationsTab() {
  const queryClient = useQueryClient()
  const summary = useQuery({ queryKey: ['operations-summary'], queryFn: getOperationsSummary, refetchInterval: 30_000 })
  const workers = useQuery({ queryKey: ['operations-workers'], queryFn: getIngestionWorkers, refetchInterval: 30_000 })
  const jobs = useQuery({ queryKey: ['operations-jobs'], queryFn: () => getOperationalJobs(100), refetchInterval: 15_000 })
  const alerts = useQuery({ queryKey: ['operations-alerts'], queryFn: () => getOperationalAlerts(100), refetchInterval: 30_000 })
  const retention = useQuery({ queryKey: ['retention-report'], queryFn: getRetentionReport })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['operations-summary'] }),
    queryClient.invalidateQueries({ queryKey: ['operations-workers'] }),
    queryClient.invalidateQueries({ queryKey: ['operations-jobs'] }),
    queryClient.invalidateQueries({ queryKey: ['operations-alerts'] }),
    queryClient.invalidateQueries({ queryKey: ['retention-report'] }),
  ])
  const acknowledge = async (id) => {
    try {
      await acknowledgeOperationalAlert(id)
      toast.success('Operational alert acknowledged')
      await queryClient.invalidateQueries({ queryKey: ['operations-alerts'] })
    } catch (error) {
      toast.error('Could not acknowledge alert', { description: apiErrorMessage(error) })
    }
  }
  if ([summary, workers, jobs, alerts].some((query) => query.isLoading)) {
    return <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-52" /><Skeleton className="h-52" /></div>
  }
  const loadError = [summary, workers, jobs, alerts].find((query) => query.isError)?.error
  if (loadError) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertTriangle className="mx-auto text-flame-500" />
        <p className="mt-3 text-sm">{apiErrorMessage(loadError, 'Operations data is unavailable. Confirm the operations migration is applied.')}</p>
        <Button className="mt-4" variant="secondary" onClick={refresh}><RefreshCw size={15} /> Retry</Button>
      </GlassCard>
    )
  }
  const report = retention.data || {}
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="font-display text-xl font-extrabold">Ingestion operations</h2><p className="text-xs opacity-55">Sanitized worker, queue, alert, and retention health.</p></div>
        <Button variant="secondary" size="sm" onClick={refresh}><RefreshCw size={14} /> Refresh</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Server} label="Healthy workers" value={summary.data?.healthy_workers} />
        <Metric icon={Clock3} label="Queued jobs" value={summary.data?.queued_jobs} tone="text-gold-500" />
        <Metric icon={Database} label="Pending cleanup" value={summary.data?.pending_cleanups} />
        <Metric icon={AlertTriangle} label="Failed jobs" value={summary.data?.failed_jobs} tone="text-flame-500" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <GlassCard className="overflow-hidden">
          <div className="border-b border-forest-900/10 p-5 dark:border-white/10"><h3 className="font-bold">Workers</h3></div>
          <div className="divide-y divide-forest-900/10 dark:divide-white/10">
            {(workers.data || []).map((worker) => (
              <div key={worker.worker_id} className="flex items-center justify-between gap-4 p-4 text-xs">
                <div><div className="font-mono font-semibold">{worker.worker_id}</div><div className="opacity-50">Last seen {localTime(worker.last_seen_at)}</div></div>
                <div className="flex gap-2"><Badge tone={worker.state === 'degraded' ? 'flame' : 'forest'}>{worker.state}</Badge><Badge tone="neutral">Scanner: {worker.scanner_status}</Badge></div>
              </div>
            ))}
            {!workers.data?.length && <p className="p-5 text-sm opacity-55">No worker has registered yet.</p>}
          </div>
        </GlassCard>
        <GlassCard className="overflow-hidden">
          <div className="border-b border-forest-900/10 p-5 dark:border-white/10"><h3 className="font-bold">Operational alerts</h3></div>
          <div className="max-h-80 divide-y divide-forest-900/10 overflow-auto dark:divide-white/10">
            {(alerts.data || []).map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-4 p-4 text-xs">
                <div><div className="font-semibold">{alert.alert_type.replaceAll('_', ' ')}</div><div className="opacity-50">{localTime(alert.last_seen_at)} · {alert.occurrence_count} occurrence(s)</div></div>
                <div className="flex items-center gap-2"><Badge tone={alertTone(alert)}>{alert.status}</Badge>{alert.status === 'open' && <Button size="sm" variant="ghost" onClick={() => acknowledge(alert.id)}>Acknowledge</Button>}</div>
              </div>
            ))}
            {!alerts.data?.length && <p className="p-5 text-sm opacity-55">No operational alerts.</p>}
          </div>
        </GlassCard>
      </div>
      <GlassCard className="p-5">
        <div className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 text-forest-500" /><div><h3 className="font-bold">Retention dry run</h3><p className="mt-1 text-xs opacity-55">No records were deleted. The counts below are records currently eligible under the approved retention windows.</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge tone="neutral">Eligible job events: {report.upload_job_events ?? 0}</Badge><Badge tone="neutral">Eligible resolved alerts: {report.resolved_operational_alerts ?? 0}</Badge><Badge tone="neutral">Eligible security events: {report.security_audit_events ?? 0}</Badge></div></div></div>
      </GlassCard>
      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 p-5 dark:border-white/10"><h3 className="font-bold">Recent durable jobs</h3></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-forest-900/5 uppercase tracking-wider opacity-60 dark:bg-white/5"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempt</th><th className="px-4 py-3">Updated</th></tr></thead><tbody>{(jobs.data || []).map((job) => <tr key={job.id} className="border-t border-forest-900/10 dark:border-white/10"><td className="px-4 py-3 font-mono">{job.id.slice(0, 8)}</td><td className="px-4 py-3">{job.department}</td><td className="px-4 py-3"><Badge tone={job.status === 'failed' ? 'flame' : job.status === 'completed' ? 'forest' : 'neutral'}>{job.status}</Badge></td><td className="px-4 py-3">{job.attempt_count}/{job.max_attempts}</td><td className="px-4 py-3">{localTime(job.updated_at)}</td></tr>)}</tbody></table></div>
      </GlassCard>
    </div>
  )
}
