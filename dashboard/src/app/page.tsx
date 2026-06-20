'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid,
} from 'recharts'
import {
  Zap, Clock, Database, DollarSign, ArrowUpRight,
  Shield, Cpu, BarChart2,
} from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import {
  fetchAnalyticsSummary, fetchTimeseries, fetchBreakdown,
  fetchHealth, fetchStorageStatus, fetchModels,
  presetRange, bestInterval,
} from '@/lib/api'

// ─── Tooltip ─────────────────────────────────────────────────────────────────

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }}/>
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtN(n: number) { return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : n.toString() }
function fmt$(n: number) { return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}` }
function fmtTime(bucket: number) {
  return new Date(bucket).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

// ─── Accent map ───────────────────────────────────────────────────────────────

const accentClasses: Record<string, { glow: string; icon: string }> = {
  blue:    { glow: 'rgba(99,102,241,0.15)',  icon: 'text-indigo-400' },
  cyan:    { glow: 'rgba(34,211,238,0.15)',  icon: 'text-cyan-400'   },
  emerald: { glow: 'rgba(16,185,129,0.15)',  icon: 'text-emerald-400'},
  purple:  { glow: 'rgba(168,85,247,0.15)',  icon: 'text-purple-400' },
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const Empty = ({ height = 220 }: { height?: number }) => (
  <div className="flex items-center justify-center text-xs t4" style={{ height }}>
    No data yet — send some requests to see live metrics
  </div>
)

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [summary,         setSummary]         = useState<any>(null)
  const [timeseries,      setTimeseries]      = useState<any[]>([])
  const [providerBd,      setProviderBd]      = useState<any[]>([])
  const [health,          setHealth]          = useState<any>(null)
  const [storageStatus,   setStorageStatus]   = useState<any>(null)
  const [models,          setModels]          = useState<any[]>([])

  useEffect(() => {
    const { from, to } = presetRange('24h')
    const interval = bestInterval(from, to)
    Promise.all([
      fetchAnalyticsSummary(from, to),
      fetchTimeseries(from, to, interval),
      fetchBreakdown(from, to, 'provider'),
      fetchHealth(),
      fetchStorageStatus(),
      fetchModels(),
    ]).then(([s, ts, bd, h, st, m]) => {
      setSummary(s)
      setTimeseries(ts ?? [])
      setProviderBd(bd ?? [])
      setHealth(h)
      setStorageStatus(st)
      setModels(m?.data ?? [])
    })
  }, [])

  // ── Chart data ──────────────────────────────────────────────────────────────

  const reqData = timeseries.map(pt => ({
    time:     fmtTime(pt.bucket),
    Requests: pt.request_count,
    Cached:   pt.cache_hits,
  }))

  const latData = providerBd
    .filter(p => p.request_count > 0)
    .map(p => ({
      name: p.key.replace(/-primary$/, ''),
      'Avg ms': Math.round(p.avg_latency_ms),
    }))

  // ── Stat cards ──────────────────────────────────────────────────────────────

  const stats = [
    {
      label: 'Requests today',
      value: summary != null ? fmtN(summary.total_requests) : '—',
      delta: summary != null
        ? `${((summary.error_requests / Math.max(summary.total_requests, 1)) * 100).toFixed(1)}% errors`
        : 'loading…',
      icon: <Zap size={16}/>, accent: 'blue', href: '/analytics/requests',
    },
    {
      label: 'Gateway latency',
      value: summary != null ? `${Math.round(summary.avg_latency_ms)} ms` : '—',
      delta: 'avg end-to-end',
      icon: <Clock size={16}/>, accent: 'cyan', href: '/analytics/requests',
    },
    {
      label: 'Cache hit rate',
      value: summary != null && summary.total_requests > 0
        ? `${((summary.cache_hits / summary.total_requests) * 100).toFixed(1)}%`
        : '—',
      delta: summary != null ? `${fmtN(summary.cache_hits)} hits` : 'loading…',
      icon: <Database size={16}/>, accent: 'emerald', href: '/analytics/cache',
    },
    {
      label: 'Cost today',
      value: summary != null ? fmt$(summary.total_cost_usd) : '—',
      delta: summary != null ? `${fmtN(summary.total_tokens)} tokens` : 'loading…',
      icon: <DollarSign size={16}/>, accent: 'purple', href: '/analytics/cost',
    },
  ]

  // ── System health items ─────────────────────────────────────────────────────

  const isOnline  = health?.status === 'ok'
  const dbBackend = storageStatus?.backend ?? '—'
  const dbRows    = storageStatus != null ? fmtN(storageStatus.total_requests) : '—'

  const healthItems = [
    {
      label: 'Gateway status',
      value: health == null ? 'Checking…' : isOnline ? 'Online' : 'Degraded',
      color: health == null ? 'text-t3' : isOnline ? 'text-emerald-400' : 'text-red-400',
      icon: <Shield size={13}/>,
    },
    {
      label: 'Success rate',
      value: summary != null && summary.total_requests > 0
        ? `${((summary.success_requests / summary.total_requests) * 100).toFixed(1)}%`
        : '—',
      color: 'text-emerald-400',
      icon: <Zap size={13}/>,
    },
    {
      label: 'Avg latency',
      value: summary != null ? `${Math.round(summary.avg_latency_ms)} ms` : '—',
      color: 'text-cyan-400',
      icon: <Clock size={13}/>,
    },
    {
      label: 'Storage',
      value: storageStatus != null ? `${dbBackend} · ${dbRows} rows` : '—',
      color: 'text-purple-400',
      icon: <Database size={13}/>,
    },
  ]

  // All unique providers: those in breakdown + configured ones not yet seen
  const activeProviderKeys = new Set(providerBd.map((p: any) => p.key))
  const configuredProviders: string[] = Array.from(
    new Set(models.map((m: any) => m.owned_by as string))
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Overview</h1>
        <p className="text-sm t3 mt-1">Real-time gateway performance &amp; usage</p>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(card => {
          const { glow, icon: iconCls } = accentClasses[card.accent]
          return (
            <Link key={card.label} href={card.href}
              className="glass glass-hover rounded-2xl p-5 flex flex-col gap-3 group transition-all cursor-pointer">
              <div className="flex items-center justify-between">
                <span className="text-xs t3 font-medium">{card.label}</span>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: glow }}>
                  <span className={iconCls}>{card.icon}</span>
                </div>
              </div>
              <div className="text-2xl font-bold t1">{card.value}</div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] t3">{card.delta}</span>
                <ArrowUpRight size={12} className="t4 group-hover:text-indigo-400 transition-colors"/>
              </div>
            </Link>
          )
        })}
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Request volume — real timeseries */}
        <GlassCard className="xl:col-span-2" title="Request volume" subtitle="Last 24 hours"
          action={
            <Link href="/analytics" className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs transition-colors">
              <BarChart2 size={12}/> Full analytics
            </Link>
          }>
          {reqData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={reqData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gCache" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--bd)" vertical={false}/>
                <XAxis dataKey="time" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval={3}/>
                <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Area type="monotone" dataKey="Requests" stroke="#6366f1" strokeWidth={2} fill="url(#gReq)"   dot={false}/>
                <Area type="monotone" dataKey="Cached"   stroke="#22d3ee" strokeWidth={2} fill="url(#gCache)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty/>
          )}
        </GlassCard>

        {/* Provider latency — real breakdown avg */}
        <GlassCard title="Provider latency" subtitle="Avg response time (ms)"
          action={
            <Link href="/providers" className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs transition-colors">
              <Cpu size={12}/> All providers
            </Link>
          }>
          {latData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={latData} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--bd)" horizontal={false}/>
                <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 11 }} tickLine={false} axisLine={false} width={72}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="Avg ms" fill="#6366f1" radius={[0, 3, 3, 0]} barSize={12}/>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty/>
          )}
        </GlassCard>
      </div>

      {/* ── System health — full width, real data ──────────────────────────── */}
      <GlassCard title="System health"
        action={
          <Link href="/providers" className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs transition-colors">
            <Shield size={12}/> View providers
          </Link>
        }>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Health metrics */}
          <div className="space-y-0">
            {healthItems.map(item => (
              <div key={item.label} className="flex items-center justify-between py-2.5 border-b bd last:border-0">
                <div className="flex items-center gap-2 t3 text-xs">
                  <span className={item.color}>{item.icon}</span>
                  {item.label}
                </div>
                <span className={`text-xs font-semibold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* Provider health — from real breakdown + models */}
          <div>
            <div className="text-xs t3 mb-3">Active providers</div>
            {configuredProviders.length > 0 ? (
              configuredProviders.map(providerName => {
                const bd = providerBd.find((p: any) => p.key === providerName)
                const hasRequests = activeProviderKeys.has(providerName)
                return (
                  <div key={providerName} className="flex items-center gap-2 mb-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasRequests ? 'bg-emerald-400' : 'bg-zinc-500'}`}/>
                    <span className="text-xs t2 flex-1 truncate">{providerName}</span>
                    {bd ? (
                      <>
                        <span className="text-[10px] t3">{fmtN(bd.request_count)} reqs</span>
                        <span className="text-[10px] text-emerald-400 ml-2">{Math.round(bd.avg_latency_ms)}ms avg</span>
                      </>
                    ) : (
                      <span className="text-[10px] t4">no traffic</span>
                    )}
                  </div>
                )
              })
            ) : (
              <div className="text-xs t4">No providers configured</div>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
