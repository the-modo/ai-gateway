'use client'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { DollarSign, TrendingUp, Hash, Layers } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchAnalyticsSummary, fetchTimeseries, fetchBreakdown, bestInterval } from '@/lib/api'
import clsx from 'clsx'

function fmt$(n: number) { return n < 0.001 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}` }
function fmtN(n: number) { return n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmtBucket(ms: number, span: number) {
  const d = new Date(ms)
  return span <= 86_400_000
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const COLORS = ['#a855f7', '#6366f1', '#22d3ee', '#10b981', '#f59e0b', '#ef4444']

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
            p.name.toLowerCase().includes('cost') || p.name === 'Cost'
              ? fmt$(p.value)
              : p.value?.toLocaleString()
          }</span>
        </div>
      ))}
    </div>
  )
}

export default function CostPage() {
  const { from, to } = useDateRange()
  const [summary, setSummary]     = useState<any>(null)
  const [tsPoints, setTsPoints]   = useState<any[]>([])
  const [byModel, setByModel]     = useState<any[]>([])
  const [loading, setLoading]     = useState(true)

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
  const tsData = tsPoints.map(p => ({
    t: fmtBucket(p.bucket, span),
    Cost: p.cost_usd,
    Tokens: p.total_tokens,
  }))

  const totalCost = summary?.total_cost_usd ?? 0
  const avgCost = summary?.total_requests > 0 ? totalCost / summary.total_requests : 0
  const topModel = [...byModel].sort((a, b) => b.cost_usd - a.cost_usd)[0]

  const cards = [
    { label: 'Total cost',        value: fmt$(totalCost),                   sub: 'in period',                  color: 'text-purple-400', glow: 'rgba(168,85,247,0.12)', icon: <DollarSign size={15}/> },
    { label: 'Avg cost / request',value: fmt$(avgCost),                     sub: 'mean per call',              color: 'text-indigo-400', glow: 'rgba(99,102,241,0.12)', icon: <TrendingUp size={15}/> },
    { label: 'Total tokens',      value: fmtN(summary?.total_tokens ?? 0),  sub: 'prompt + completion',        color: 'text-cyan-400',   glow: 'rgba(34,211,238,0.12)', icon: <Hash size={15}/> },
    { label: 'Top cost model',    value: topModel?.key ?? '—',              sub: topModel ? fmt$(topModel.cost_usd) : '', color: 'text-amber-400', glow: 'rgba(245,158,11,0.12)', icon: <Layers size={15}/> },
  ]

  const barData = [...byModel].sort((a, b) => b.cost_usd - a.cost_usd)
    .map(r => ({ name: r.key, Cost: r.cost_usd, Tokens: r.total_tokens }))
  const totalForPct = byModel.reduce((a, r) => a + r.cost_usd, 0)

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
            <div className={clsx('text-2xl font-bold truncate', loading ? 't4 animate-pulse' : 't1')}>{c.value}</div>
            <div className="text-[11px] t3">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Cost over time */}
      <GlassCard title="Cost over time" subtitle={`Total: ${fmt$(totalCost)}`}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={tsData} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--bd)" vertical={false}/>
            <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(2)}`}/>
            <Tooltip content={<Tip/>}/>
            <Area type="monotone" dataKey="Cost" stroke="#a855f7" strokeWidth={2} fill="url(#gCost)" dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Cost by model */}
      <div className="grid xl:grid-cols-2 gap-4">
        <GlassCard title="Cost by model" subtitle="Total spend breakdown">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" horizontal={false}/>
              <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(2)}`}/>
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={130}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="Cost" radius={[0, 4, 4, 0]} barSize={14}>
                {barData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        {/* Token usage by model */}
        <GlassCard title="Token usage by model" subtitle="Prompt + completion tokens">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" horizontal={false}/>
              <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => fmtN(v)}/>
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={130}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="Tokens" radius={[0, 4, 4, 0]} barSize={14}>
                {barData.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* Breakdown table */}
      <GlassCard title="Cost breakdown" subtitle="Per-model detailed view" noPad>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bd text-[10px] uppercase tracking-wider t3 font-medium">
            <span>Model</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Total cost</span>
            <span className="text-right">Avg cost</span>
            <span className="text-right">Cost share</span>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center text-sm t3 animate-pulse">Loading…</div>
          ) : [...byModel].sort((a, b) => b.cost_usd - a.cost_usd).map((row, i) => {
            const pct = totalForPct > 0 ? (row.cost_usd / totalForPct * 100).toFixed(1) : '0'
            const avg = row.request_count > 0 ? row.cost_usd / row.request_count : 0
            return (
              <div key={i} className="row-hover grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bd last:border-0 text-xs items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }}/>
                  <span className="t1 font-medium truncate">{row.key}</span>
                </div>
                <span className="t2 text-right">{fmtN(row.request_count)}</span>
                <span className="t2 text-right">{fmtN(row.total_tokens)}</span>
                <span className="t1 font-medium text-right">{fmt$(row.cost_usd)}</span>
                <span className="t2 text-right">{fmt$(avg)}</span>
                <div className="flex items-center gap-2 justify-end">
                  <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }}/>
                  </div>
                  <span className="t3 w-8 text-right">{pct}%</span>
                </div>
              </div>
            )
          })}
      </GlassCard>
    </div>
  )
}
