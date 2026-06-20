'use client'
import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, RadialBarChart, RadialBar, Legend,
} from 'recharts'
import { Cpu, Hash, DollarSign, Clock } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchBreakdown, fetchAnalyticsSummary } from '@/lib/api'
import clsx from 'clsx'

function fmt$(n: number) { return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}` }
function fmtN(n: number) { return n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

const COLORS = ['#6366f1', '#22d3ee', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color ?? p.fill }} />
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function ModelsPage() {
  const { from, to } = useDateRange()
  const [summary, setSummary]   = useState<any>(null)
  const [models, setModels]     = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchAnalyticsSummary(from, to),
      fetchBreakdown(from, to, 'model'),
    ]).then(([s, m]) => { setSummary(s); setModels(m); setLoading(false) })
  }, [from, to])

  const totalReqs = models.reduce((a, m) => a + m.request_count, 0)
  const topModel = models[0]
  const avgLat = models.length > 0
    ? Math.round(models.reduce((a, m) => a + m.avg_latency_ms * m.request_count, 0) / Math.max(totalReqs, 1))
    : 0

  const cards = [
    { label: 'Active models',  value: String(models.length),                              sub: 'with traffic',       color: 'text-indigo-400', glow: 'rgba(99,102,241,0.12)',  icon: <Cpu size={15}/> },
    { label: 'Top model',      value: topModel?.key ?? '—',                               sub: topModel ? `${fmtN(topModel.request_count)} reqs` : '', color: 'text-cyan-400', glow: 'rgba(34,211,238,0.12)', icon: <Hash size={15}/> },
    { label: 'Avg latency',    value: summary ? `${Math.round(summary.avg_latency_ms)}ms` : '—', sub: 'across all models', color: 'text-amber-400', glow: 'rgba(245,158,11,0.12)', icon: <Clock size={15}/> },
    { label: 'Total cost',     value: summary ? fmt$(summary.total_cost_usd) : '—',       sub: `${fmtN(summary?.total_tokens ?? 0)} tokens`, color: 'text-purple-400', glow: 'rgba(168,85,247,0.12)', icon: <DollarSign size={15}/> },
  ]

  const reqBarData  = models.map((m, i) => ({ name: m.key, Requests: m.request_count, fill: COLORS[i % COLORS.length] }))
  const tokBarData  = models.map((m, i) => ({ name: m.key, Tokens: m.total_tokens, fill: COLORS[i % COLORS.length] }))
  const latBarData  = models.map((m, i) => ({ name: m.key, 'Avg latency': Math.round(m.avg_latency_ms), fill: COLORS[i % COLORS.length] }))

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

      {/* Requests + tokens side by side */}
      <div className="grid xl:grid-cols-2 gap-4">
        <GlassCard title="Requests by model" subtitle="Total request volume">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={reqBarData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" horizontal={false}/>
              <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtN}/>
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={140}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="Requests" radius={[0, 4, 4, 0]} barSize={14}>
                {reqBarData.map((d, i) => <Cell key={i} fill={d.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard title="Token usage by model" subtitle="Prompt + completion">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={tokBarData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--bd)" horizontal={false}/>
              <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtN}/>
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={140}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="Tokens" radius={[0, 4, 4, 0]} barSize={14}>
                {tokBarData.map((d, i) => <Cell key={i} fill={d.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* Latency by model */}
      <GlassCard title="Avg latency by model" subtitle="End-to-end milliseconds">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={latBarData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--bd)" horizontal={false}/>
            <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`}/>
            <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={140}/>
            <Tooltip content={<Tip/>}/>
            <Bar dataKey="Avg latency" radius={[0, 4, 4, 0]} barSize={12}>
              {latBarData.map((d, i) => <Cell key={i} fill={d.fill}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Full table */}
      <GlassCard title="Model detail" subtitle="All metrics per model" noPad>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b bd text-[10px] uppercase tracking-wider t3 font-medium">
            <span>Model</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Error %</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Avg lat</span>
            <span className="text-right">Share</span>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center text-sm t3 animate-pulse">Loading…</div>
          ) : models.map((row, i) => {
            const errPct = row.request_count > 0 ? (row.error_count / row.request_count * 100).toFixed(1) : '0'
            const share = totalReqs > 0 ? (row.request_count / totalReqs * 100).toFixed(1) : '0'
            return (
              <div key={i} className="row-hover grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b bd last:border-0 text-xs items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }}/>
                  <span className="t1 font-medium truncate">{row.key}</span>
                </div>
                <span className="t2 text-right">{fmtN(row.request_count)}</span>
                <span className={clsx('text-right', Number(errPct) > 5 ? 'text-red-400' : 't3')}>{errPct}%</span>
                <span className="t2 text-right">{fmtN(row.total_tokens)}</span>
                <span className="t2 text-right">{fmt$(row.cost_usd)}</span>
                <span className={clsx('text-right', row.avg_latency_ms > 4000 ? 'text-amber-400' : 't2')}>{Math.round(row.avg_latency_ms)}ms</span>
                <div className="flex items-center gap-1.5 justify-end">
                  <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${share}%`, background: COLORS[i % COLORS.length] }}/>
                  </div>
                  <span className="t3 text-[10px]">{share}%</span>
                </div>
              </div>
            )
          })}
      </GlassCard>
    </div>
  )
}
