'use client'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, LineChart, Line, Legend,
} from 'recharts'
import { Database, Zap, TrendingUp, DollarSign } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchAnalyticsSummary, fetchTimeseries, fetchBreakdown, bestInterval } from '@/lib/api'
import clsx from 'clsx'

function fmt$(n: number) { return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}` }
function fmtN(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmtBucket(ms: number, span: number) {
  const d = new Date(ms)
  return span <= 86_400_000
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const COLORS = ['#22d3ee', '#6366f1', '#a855f7', '#10b981', '#f59e0b']

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{
            p.name === 'Hit rate' ? `${p.value.toFixed(1)}%` : p.value?.toLocaleString()
          }</span>
        </div>
      ))}
    </div>
  )
}

export default function CachePage() {
  const { from, to } = useDateRange()
  const [summary, setSummary]   = useState<any>(null)
  const [tsPoints, setTsPoints] = useState<any[]>([])
  const [byModel, setByModel]   = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchAnalyticsSummary(from, to),
      fetchTimeseries(from, to, bestInterval(from, to)),
      fetchBreakdown(from, to, 'model'),
    ]).then(([s, ts, br]) => {
      setSummary(s); setTsPoints(ts); setByModel(br); setLoading(false)
    })
  }, [from, to])

  const span = to - from
  const totalReqs  = summary?.total_requests ?? 0
  const cacheHits  = summary?.cache_hits ?? 0
  const cacheMisses = totalReqs - cacheHits
  const hitRate    = totalReqs > 0 ? (cacheHits / totalReqs * 100) : 0

  // Estimate savings: cached requests avg ~3ms vs ~1600ms, so saved latency
  const avgLatency   = summary?.avg_latency_ms ?? 1600
  const savedLatency = cacheHits * (avgLatency - 3)  // ms saved total

  // Estimate cost savings: cached requests avoid paying for tokens
  const avgCostPerReq = totalReqs > 0 && summary?.total_cost_usd > 0
    ? summary.total_cost_usd / (totalReqs - cacheHits || 1)
    : 0
  const savedCost = cacheHits * avgCostPerReq

  const tsData = tsPoints.map(p => ({
    t: fmtBucket(p.bucket, span),
    Hits: p.cache_hits,
    Misses: p.request_count - p.cache_hits,
    'Hit rate': p.request_count > 0 ? (p.cache_hits / p.request_count * 100) : 0,
  }))

  const cards = [
    { label: 'Cache hit rate', value: `${hitRate.toFixed(1)}%`,          sub: `of ${fmtN(totalReqs)} requests`, color: 'text-cyan-400',   glow: 'rgba(34,211,238,0.12)', icon: <Database size={15}/> },
    { label: 'Total hits',     value: fmtN(cacheHits),                   sub: 'served from cache',              color: 'text-emerald-400', glow: 'rgba(16,185,129,0.12)', icon: <Zap size={15}/> },
    { label: 'Saved latency',  value: savedLatency > 1e6 ? `${(savedLatency/1e6).toFixed(1)}s` : `${Math.round(savedLatency/1000)}s`, sub: 'total latency saved', color: 'text-indigo-400', glow: 'rgba(99,102,241,0.12)', icon: <TrendingUp size={15}/> },
    { label: 'Saved cost',     value: fmt$(savedCost),                   sub: 'estimated token cost avoided',   color: 'text-purple-400', glow: 'rgba(168,85,247,0.12)', icon: <DollarSign size={15}/> },
  ]

  // Per-model cache efficiency (approximate from breakdown: we don't have per-model cache_hits
  // so we estimate from the overall ratio applied to each model's request count)
  const modelCacheData = byModel.map((m, i) => ({
    name: m.key,
    Requests: m.request_count,
    'Est. Hits': Math.round(m.request_count * (hitRate / 100)),
    fill: COLORS[i % COLORS.length],
  }))

  return (
    <div className="space-y-5">
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

      {/* Hit rate over time */}
      <GlassCard title="Cache hit rate over time" subtitle="% of requests served from cache">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={tsData} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--bd)" vertical={false}/>
            <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)}%`} domain={[0, 100]}/>
            <Tooltip content={<Tip/>}/>
            <Line type="monotone" dataKey="Hit rate" stroke="#22d3ee" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/>
          </LineChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Hits vs misses stacked */}
      <GlassCard title="Cache hits vs misses" subtitle="Volume breakdown over time">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={tsData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gHit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4}/><stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/></linearGradient>
              <linearGradient id="gMiss" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
            </defs>
            <CartesianGrid stroke="var(--bd)" vertical={false}/>
            <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
            <Tooltip content={<Tip/>}/>
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--t2)' }}/>
            <Area type="monotone" dataKey="Hits"   stroke="#22d3ee" strokeWidth={2} fill="url(#gHit)"  dot={false} stackId="c"/>
            <Area type="monotone" dataKey="Misses" stroke="#6366f1" strokeWidth={1.5} fill="url(#gMiss)" dot={false} stackId="c"/>
          </AreaChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Per-model estimated cache hits */}
      <GlassCard title="Cache efficiency by model" subtitle="Estimated hits per model based on overall hit rate" noPad>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bd text-[10px] uppercase tracking-wider t3 font-medium">
            <span>Model</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Est. hits</span>
            <span className="text-right">Est. hit rate</span>
            <span className="text-right">Est. savings</span>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center text-sm t3 animate-pulse">Loading…</div>
          ) : byModel.map((row, i) => {
            const estHits    = Math.round(row.request_count * (hitRate / 100))
            const estSavings = estHits * avgCostPerReq
            return (
              <div key={i} className="row-hover grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bd last:border-0 text-xs items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }}/>
                  <span className="t1 font-medium truncate">{row.key}</span>
                </div>
                <span className="t2 text-right">{fmtN(row.request_count)}</span>
                <span className="text-cyan-400 text-right font-medium">{fmtN(estHits)}</span>
                <div className="flex items-center gap-2 justify-end">
                  <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-400" style={{ width: `${hitRate}%` }}/>
                  </div>
                  <span className="t2 w-10 text-right">{hitRate.toFixed(1)}%</span>
                </div>
                <span className="text-emerald-400 text-right">{fmt$(estSavings)}</span>
              </div>
            )
          })}
      </GlassCard>
    </div>
  )
}
