'use client'
import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts'
import { Zap, Clock, DollarSign, Database, TrendingUp } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchAnalyticsSummary, fetchTimeseries, fetchBreakdown, bestInterval } from '@/lib/api'
import clsx from 'clsx'

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{typeof p.value === 'number' && p.name === 'Cost'
            ? `$${p.value.toFixed(4)}` : p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function fmtBucket(ms: number, span: number) {
  const d = new Date(ms)
  if (span <= 3_600_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (span <= 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function fmt$(n: number) { return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}` }
function fmtN(n: number) { return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

export default function AnalyticsOverview() {
  const { from, to } = useDateRange()
  const [summary, setSummary]     = useState<any>(null)
  const [tsPoints, setTsPoints]   = useState<any[]>([])
  const [breakdown, setBreakdown] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    const interval = bestInterval(from, to)
    Promise.all([
      fetchAnalyticsSummary(from, to),
      fetchTimeseries(from, to, interval),
      fetchBreakdown(from, to, 'model'),
    ]).then(([s, ts, br]) => {
      setSummary(s); setTsPoints(ts); setBreakdown(br); setLoading(false)
    })
  }, [from, to])

  const span = to - from
  const tsData = tsPoints.map(p => ({
    t: fmtBucket(p.bucket, span),
    Requests: p.request_count,
    Errors: p.error_count,
    Cost: p.cost_usd,
    Tokens: p.total_tokens,
  }))

  const errorPct = summary?.total_requests > 0
    ? ((summary.error_requests / summary.total_requests) * 100).toFixed(1) : '0.0'
  const cachePct = summary?.total_requests > 0
    ? ((summary.cache_hits / summary.total_requests) * 100).toFixed(1) : '0.0'

  const cards = [
    { label: 'Total requests',  value: summary ? fmtN(summary.total_requests) : '—',           sub: `${errorPct}% error rate`,         color: 'text-indigo-400', glow: 'rgba(99,102,241,0.12)',  icon: <Zap size={15}/> },
    { label: 'Avg latency',     value: summary ? `${Math.round(summary.avg_latency_ms)}ms` : '—', sub: 'mean end-to-end',               color: 'text-cyan-400',   glow: 'rgba(34,211,238,0.12)',  icon: <Clock size={15}/> },
    { label: 'Total cost',      value: summary ? fmt$(summary.total_cost_usd) : '—',             sub: `${fmtN(summary?.total_tokens ?? 0)} tokens`, color: 'text-purple-400', glow: 'rgba(168,85,247,0.12)', icon: <DollarSign size={15}/> },
    { label: 'Cache hit rate',  value: summary ? `${cachePct}%` : '—',                           sub: `${fmtN(summary?.cache_hits ?? 0)} hits`,    color: 'text-emerald-400', glow: 'rgba(16,185,129,0.12)', icon: <Database size={15}/> },
  ]

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="glass rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs t3">{c.label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: c.glow }}>
                <span className={c.color}>{c.icon}</span>
              </div>
            </div>
            <div className={clsx('text-2xl font-bold', loading ? 't4 animate-pulse' : 't1')}>{c.value}</div>
            <div className="text-[11px] t3">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid xl:grid-cols-3 gap-4">
        <GlassCard className="xl:col-span-2" title="Request volume" subtitle="Requests & errors over time">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={tsData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.35}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid stroke="var(--bd)" vertical={false}/>
              <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
              <Tooltip content={<Tip/>}/>
              <Area type="monotone" dataKey="Requests" stroke="#6366f1" strokeWidth={2} fill="url(#gR)" dot={false}/>
              <Area type="monotone" dataKey="Errors"   stroke="#ef4444" strokeWidth={1.5} fill="url(#gE)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard title="Cost over time" subtitle={fmt$(tsPoints.reduce((a, p) => a + p.cost_usd, 0))}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tsData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" vertical={false}/>
              <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(2)}`}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="Cost" fill="#a855f7" radius={[3, 3, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* Model breakdown */}
      <GlassCard title="Top models" subtitle="Requests by model" noPad>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bd text-[10px] uppercase tracking-wider t3 font-medium">
            <span>Model</span><span className="text-right">Requests</span><span className="text-right">Errors</span>
            <span className="text-right">Tokens</span><span className="text-right">Cost</span><span className="text-right">Avg lat</span>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center text-sm t3 animate-pulse">Loading…</div>
          ) : breakdown.map((row, i) => (
            <div key={i} className="row-hover grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bd last:border-0 text-xs items-center">
              <span className="t1 font-medium truncate">{row.key}</span>
              <span className="t2 text-right">{fmtN(row.request_count)}</span>
              <span className={clsx('text-right', row.error_count > 0 ? 'text-red-400' : 't3')}>{row.error_count > 0 ? fmtN(row.error_count) : '—'}</span>
              <span className="t2 text-right">{fmtN(row.total_tokens)}</span>
              <span className="t2 text-right">{fmt$(row.cost_usd)}</span>
              <span className={clsx('text-right', row.avg_latency_ms > 3000 ? 'text-amber-400' : 't2')}>{Math.round(row.avg_latency_ms)}ms</span>
            </div>
          ))}
      </GlassCard>
    </div>
  )
}
