import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  BookMarked, GitBranch, CalendarRange, Layers, MessageSquareText,
  ShieldCheck, UploadCloud, ArrowRight, Library, Sparkles, Fingerprint,
} from 'lucide-react'
import { listPapers } from '../api'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton } from '../components/ui/Skeleton'
import { Badge } from '../components/ui/Badge'
import { PageTransition, AnimatedCounter, staggerContainer, staggerItem } from '../components/ui/Motion'
import { Button } from '../components/ui/Button'
import { MfaEnrollDialog } from '../components/MfaEnrollDialog'
import { formatDate } from '../lib/utils'

function StatTile({ icon: Icon, label, value, suffix = '' }) {
  return (
    <motion.div variants={staggerItem}>
      <GlassCard hover className="relative overflow-hidden p-6">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gold-400/10 blur-2xl" />
        <Icon size={20} className="mb-3 text-gold-400" />
        <div className="font-display text-3xl font-extrabold">
          <AnimatedCounter value={value} suffix={suffix} />
        </div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-wider opacity-55">{label}</div>
      </GlassCard>
    </motion.div>
  )
}

function QuickAction({ icon: Icon, title, text, onClick, tone = 'forest' }) {
  return (
    <GlassCard hover className="group cursor-pointer p-6" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div
          className={
            tone === 'gold'
              ? 'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/25'
              : 'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25'
          }
        >
          <Icon size={20} className={tone === 'gold' ? 'text-forest-950' : 'text-gold-300'} />
        </div>
        <ArrowRight size={17} className="opacity-30 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-80" />
      </div>
      <h3 className="font-display mt-4 text-base font-bold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed opacity-60">{text}</p>
    </GlassCard>
  )
}

function SecurityCard() {
  const [open, setOpen] = useState(false)
  const { data, refetch } = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => (await supabase.auth.mfa.listFactors()).data,
  })
  const enabled = !!data?.totp?.some((f) => f.status === 'verified')

  return (
    <>
      <GlassCard className="p-6">
        <div className="flex items-start justify-between">
          <div
            className={
              enabled
                ? 'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25'
                : 'flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-900/8 dark:bg-white/8'
            }
          >
            <Fingerprint size={20} className={enabled ? 'text-gold-300' : 'opacity-50'} />
          </div>
          <span
            className={
              enabled
                ? 'inline-flex items-center gap-1.5 rounded-full bg-forest-500/12 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-forest-600 dark:text-forest-300'
                : 'inline-flex items-center gap-1.5 rounded-full bg-forest-900/8 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider opacity-60 dark:bg-white/8'
            }
          >
            <span className={enabled ? 'h-1.5 w-1.5 rounded-full bg-forest-500' : 'h-1.5 w-1.5 rounded-full bg-forest-900/30 dark:bg-white/30'} />
            {enabled ? '2FA on' : '2FA off'}
          </span>
        </div>
        <h3 className="font-display mt-4 text-base font-bold">Account security</h3>
        <p className="mt-1 text-xs leading-relaxed opacity-60">
          {enabled
            ? 'Sign-ins require your authenticator code. Manage or disable it here.'
            : 'Protect your account with an authenticator app — takes about a minute.'}
        </p>
        <Button
          variant={enabled ? 'outline' : 'primary'}
          size="sm"
          className="mt-4 w-full"
          onClick={() => setOpen(true)}
        >
          {enabled ? 'Manage 2FA' : 'Enable 2FA'}
        </Button>
      </GlassCard>
      <MfaEnrollDialog open={open} onClose={() => setOpen(false)} onChanged={refetch} />
    </>
  )
}

export default function Dashboard() {
  const { displayName, role, department, canScan, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { data: papers, isLoading } = useQuery({ queryKey: ['papers'], queryFn: () => listPapers() })

  const stats = useMemo(() => {
    const list = papers || []
    const tracks = new Set(list.map((p) => p.track).filter(Boolean))
    const years = list.map((p) => p.year).filter(Boolean)
    const chunks = list.reduce((acc, p) => acc + (p.chunk_count || 0), 0)
    return {
      total: list.length,
      tracks: tracks.size,
      span: years.length ? Math.max(...years) - Math.min(...years) + 1 : 0,
      chunks,
    }
  }, [papers])

  const recent = (papers || []).slice(0, 5)
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gold-500 dark:text-gold-300">{greeting},</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {displayName}
          </h1>
          <p className="mt-1 text-sm font-semibold text-forest-600 dark:text-gold-400 capitalize">
            {role === 'superadmin' ? 'Super Admin at System' : <>{role === 'admin' ? 'Administrator' : role} at {department || 'Unassigned'}</>}
          </p>
          <p className="mt-1.5 text-sm opacity-55">
            {role === 'admin'
              ? 'Manage the archive, monitor usage, and validate research novelty.'
              : role === 'faculty'
                ? 'Validate topic novelty and explore accumulated research.'
                : 'Explore the thesis archive with AI-powered semantic search.'}
          </p>
        </div>
        <Button variant="gold" onClick={() => navigate('/chat')}>
          <Sparkles size={16} /> Ask the archive
        </Button>
      </div>

      {/* Stats bento */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <StatTile icon={BookMarked} label="Theses indexed" value={stats.total} />
            <StatTile icon={GitBranch} label="Academic tracks" value={stats.tracks} />
            <StatTile icon={CalendarRange} label="Years covered" value={stats.span} />
            <StatTile icon={Layers} label="Semantic chunks" value={stats.chunks} />
          </>
        )}
      </motion.div>

      {/* Quick actions + recent papers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <QuickAction
            icon={MessageSquareText}
            title="AI Chat"
            text="Ask natural-language questions and receive citation-backed answers."
            onClick={() => navigate('/chat')}
          />
          <QuickAction
            icon={Library}
            title="Browse archive"
            text="Explore thesis metadata by track, year, and author."
            onClick={() => navigate('/archive')}
          />
          {canScan && (
            <QuickAction
              icon={ShieldCheck}
              title="Novelty check"
              text="Scan a proposal against the archive at the 85% duplication threshold."
              tone="gold"
              onClick={() => navigate('/novelty')}
            />
          )}
          {isAdmin && (
            <QuickAction
              icon={UploadCloud}
              title="Upload thesis"
              text="Digitize and index a new manuscript into the vector archive."
              tone="gold"
              onClick={() => navigate('/upload')}
            />
          )}
          <SecurityCard />
        </div>

        {/* Recent additions */}
        <GlassCard className="p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Recently indexed</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/archive')}>
              View all <ArrowRight size={14} />
            </Button>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : recent.length === 0 ? (
            <p className="py-10 text-center text-sm opacity-50">
              The archive is empty. {isAdmin ? 'Upload the first thesis to begin.' : 'Check back soon.'}
            </p>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-2.5">
              {recent.map((p) => (
                <motion.div
                  key={p.id}
                  variants={staggerItem}
                  className="glass flex items-center gap-4 rounded-2xl p-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-600/12 dark:bg-forest-400/12">
                    <BookMarked size={16} className="text-forest-600 dark:text-forest-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.title}</div>
                    <div className="mt-0.5 truncate text-xs opacity-55">
                      {p.authors || 'Unknown authors'}{p.year ? ` · ${p.year}` : ''}
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    {p.track && <Badge tone="forest">{p.track}</Badge>}
                    <span className="text-xs opacity-40">{formatDate(p.created_at)}</span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </GlassCard>
      </div>
    </PageTransition>
  )
}
