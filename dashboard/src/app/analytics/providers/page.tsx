'use client'
import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, AreaChart, Area, Legend,
} from 'recharts'
import { Zap, AlertTriangle, Clock, Server } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchBreakdown, fetchAnalyticsSummary, fetchTimeseries, bestInterval } from '@/lib/api'
import clsx from 'clsx'

function fmtN(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmt$(n: number) { return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}` }
function fmtBucket(ms: number, span: number) {
  const d = new Date(ms)
  return span <= 86_400_000
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const PROVIDER_COLORS: Record<string, string> = {
  'openai-primary':     '#10a37f',
  'anthropic-primary':  '#c96442',
  'gemini-primary':     '#4285f4',
}
const FALLBACK_COLORS = ['#6366f1', '#a855f7', '#22d3ee', '#f59e0b']

function provColor(name: string, i: number) {
  return PROVIDER_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color ?? p.fill }} />
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{
            p.name.includes('latency') ? `${p.value}ms` : p.value?.toLocaleString()
          }</span>
        </div>
      ))}
    </div>
  )
}

export default function ProvidersPage() {
  const { from, to } = useDateRange()
  const [summary, setSummary]     = useState<any>(null)
  const [providers, setProviders] = useState<any[]>([])
  const [tsPoints, setTsPoints]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchAnalyticsSummary(from, to),
      fetchBreakdown(from, to, 'provider'),
      fetchTimeseries(from, to, bestInterval(from, to)),
    ]).then(([s, p, ts]) => { setSummary(s); setProviders(p); setTsPoints(ts); setLoading(false) })
  }, [from, to])

  const span = to - from
  const totalReqs = providers.reduce((a, p) => a + p.request_count, 0)
  const avgErrPct = providers.length > 0
    ? (providers.reduce((a, p) => a + (p.request_count > 0 ? p.error_count / p.request_count : 0), 0) / providers.length * 100).toFixed(1)
    : '0'

  const cards = [
    { label: 'Active providers', value: String(providers.length),                              sub: 'serving traffic',         color: 'text-indigo-400', glow: 'rgba(99,102,241,0.12)', icon: <Server size={15}/> },
    { label: 'Total requests',   value: fmtN(totalReqs),                                       sub: 'across all providers',    color: 'text-cyan-400',   glow: 'rgba(34,211,238,0.12)', icon: <Zap size={15}/> },
    { label: 'Avg latency',      value: summary ? `${Math.round(summary.avg_latency_ms)}ms` : '—', sub: 'mean end-to-end',     color: 'text-amber-400',  glow: 'rgba(245,158,11,0.12)', icon: <Clock size={15}/> },
    { label: 'Avg error rate',   value: `${avgErrPct}%`,                                       sub: 'across providers',        color: 'text-red-400',    glow: 'rgba(239,68,68,0.12)',  icon: <AlertTriangle size={15}/> },
  ]

  const reqBarData = providers.map((p, i) => ({ name: p.key, Requests: p.request_count, Errors: p.error_count, fill: provColor(p.key, i) }))
  const latBarData = providers.map((p, i) => ({ name: p.key, 'Avg latency': Math.round(p.avg_latency_ms), fill: provColor(p.key, i) }))

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

      {/* Requests & errors by provider */}
      <div className="grid xl:grid-cols-2 gap-4">
        <GlassCard title="Requests by provider" subtitle="Success vs errors">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={reqBarData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" vertical={false}/>
              <XAxis dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtN}/>
              <Tooltip content={<Tip/>}/>
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--t2)' }}/>
              <Bar dataKey="Requests" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={32}>
                {reqBarData.map((d, i) => <Cell key={i} fill={d.fill}/>)}
              </Bar>
              <Bar dataKey="Errors" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={32}/>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard title="Latency by provider" subtitle="Average end-to-end ms">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={latBarData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" horizontal={false}/>
              <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`}/>
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={110}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="Avg latency" radius={[0, 4, 4, 0]} barSize={18}>
                {latBarData.map((d, i) => <Cell key={i} fill={d.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* Provider health table */}
      <GlassCard title="Provider health" subtitle="Detailed breakdown" noPad>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-2 px-5 py-3 border-b bd text-[10px] uppercase tracking-wider t3 font-medium">
            <span>Provider</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Errors</span>
            <span className="text-right">Error %</span>
            <span className="text-right">Avg lat</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Status</span>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center text-sm t3 animate-pulse">Loading…</div>
          ) : providers.map((row, i) => {
            const errPct = row.request_count > 0 ? (row.error_count / row.request_count * 100) : 0
            const healthy = errPct < 5
            const color = provColor(row.key, i)
            return (
              <div key={i} className="row-hover grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-2 px-5 py-3 border-b bd last:border-0 text-xs items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }}/>
                  <span className="t1 font-medium">{row.key}</span>
                </div>
                <span className="t2 text-right">{fmtN(row.request_count)}</span>
                <span className={clsx('text-right', row.error_count > 0 ? 'text-red-400' : 't3')}>{fmtN(row.error_count)}</span>
                <span className={clsx('text-right', errPct > 5 ? 'text-red-400' : errPct > 2 ? 'text-amber-400' : 't3')}>{errPct.toFixed(1)}%</span>
                <span className={clsx('text-right', row.avg_latency_ms > 4000 ? 'text-amber-400' : 't2')}>{Math.round(row.avg_latency_ms)}ms</span>
                <span className="t2 text-right">{fmt$(row.cost_usd)}</span>
                <div className="flex justify-end">
                  <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-medium ring-1',
                    healthy ? 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20'
                            : 'text-amber-400 bg-amber-500/10 ring-amber-500/20')}>
                    {healthy ? 'Healthy' : 'Degraded'}
                  </span>
                </div>
              </div>
            )
          })}
      </GlassCard>
    </div>
  )
}
