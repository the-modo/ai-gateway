'use client'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid,
} from 'recharts'
import { Wrench, Clock, AlertTriangle, Zap } from 'lucide-react'
import clsx from 'clsx'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchLogs, bestInterval } from '@/lib/api'

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }}/>
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

const Empty = ({ height = 220 }: { height?: number }) => (
  <div className="flex items-center justify-center text-xs t4" style={{ height }}>
    No MCP tool calls yet — register a server on the MCP page and send a call
  </div>
)

interface McpLog {
  ts: number; model: string; status: number; latency_ms: number; error?: string | null
}

export default function McpAnalyticsPage() {
  const range = useDateRange()
  const [logs, setLogs] = useState<McpLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchLogs({
      from: range.from, to: range.to,
      provider: 'mcp',
      sort_by: 'ts', sort_dir: 'asc',
      page: 1, per_page: 1000,
    }).then(res => {
      setLogs(res.items ?? [])
      setLoading(false)
    })
  }, [range])

  const total = logs.length
  const errors = logs.filter(l => l.status >= 400).length
  const blocked = logs.filter(l => (l.error ?? '').toLowerCase().includes('block')).length
  const avgLatency = total > 0 ? Math.round(logs.reduce((s, l) => s + l.latency_ms, 0) / total) : 0

  // Timeline buckets
  const interval = bestInterval(range.from, range.to)
  const buckets = new Map<number, { calls: number; errors: number }>()
  for (const l of logs) {
    const b = Math.floor(l.ts / interval) * interval
    const cur = buckets.get(b) ?? { calls: 0, errors: 0 }
    cur.calls += 1
    if (l.status >= 400) cur.errors += 1
    buckets.set(b, cur)
  }
  const timeline = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, v]) => ({
      time: new Date(b).toLocaleString('en', interval >= 86_400_000
        ? { month: 'short', day: 'numeric' }
        : { hour: '2-digit', minute: '2-digit' }),
      Calls: v.calls,
      Errors: v.errors,
    }))

  // Per-tool breakdown
  const byTool = new Map<string, { calls: number; errors: number; latency: number }>()
  for (const l of logs) {
    const cur = byTool.get(l.model) ?? { calls: 0, errors: 0, latency: 0 }
    cur.calls += 1
    cur.latency += l.latency_ms
    if (l.status >= 400) cur.errors += 1
    byTool.set(l.model, cur)
  }
  const toolData = [...byTool.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 10)
    .map(([tool, v]) => ({ name: tool, Calls: v.calls, 'Avg ms': Math.round(v.latency / v.calls) }))

  const cards = [
    { label: 'Tool calls',   value: loading ? '—' : total.toLocaleString(),       icon: <Wrench size={16}/>,        cls: 'text-indigo-400',  glow: 'rgba(99,102,241,0.15)' },
    { label: 'Avg latency',  value: loading ? '—' : `${avgLatency} ms`,           icon: <Clock size={16}/>,         cls: 'text-cyan-400',    glow: 'rgba(34,211,238,0.15)' },
    { label: 'Errors',       value: loading ? '—' : errors.toLocaleString(),      icon: <AlertTriangle size={16}/>, cls: 'text-amber-400',   glow: 'rgba(245,158,11,0.15)' },
    { label: 'Blocked',      value: loading ? '—' : blocked.toLocaleString(),     icon: <Zap size={16}/>,           cls: 'text-red-400',     glow: 'rgba(239,68,68,0.15)' },
  ]

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="glass rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs t3 font-medium">{c.label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: c.glow }}>
                <span className={c.cls}>{c.icon}</span>
              </div>
            </div>
            <div className={clsx('text-2xl font-bold', loading ? 't4 animate-pulse' : 't1')}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <GlassCard title="Tool call volume" subtitle="Calls and errors over time">
          {timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timeline} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gMcp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gMcpErr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--bd)" vertical={false}/>
                <XAxis dataKey="time" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
                <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false}/>
                <Tooltip content={<Tip/>}/>
                <Area type="monotone" dataKey="Calls"  stroke="#6366f1" strokeWidth={2} fill="url(#gMcp)"    dot={false}/>
                <Area type="monotone" dataKey="Errors" stroke="#ef4444" strokeWidth={2} fill="url(#gMcpErr)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty/>}
        </GlassCard>

        <GlassCard title="Top tools" subtitle="Most-called tools (server__tool)">
          {toolData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={toolData} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--bd)" horizontal={false}/>
                <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false}/>
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--t2)', fontSize: 10 }} tickLine={false} axisLine={false} width={120}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="Calls" fill="#6366f1" radius={[0, 3, 3, 0]} barSize={12}/>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty/>}
        </GlassCard>
      </div>

      {/* Per-tool table */}
      <GlassCard title="Tool performance" subtitle="Per-tool call count, error rate and latency" noPad>
        {byTool.size === 0 ? (
          <div className="p-5"><Empty height={80}/></div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bd text-left">
                <th className="px-5 py-3 t3 font-medium">Tool</th>
                <th className="px-5 py-3 t3 font-medium text-right">Calls</th>
                <th className="px-5 py-3 t3 font-medium text-right">Errors</th>
                <th className="px-5 py-3 t3 font-medium text-right">Error rate</th>
                <th className="px-5 py-3 t3 font-medium text-right">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {[...byTool.entries()].sort((a, b) => b[1].calls - a[1].calls).map(([tool, v]) => (
                <tr key={tool} className="border-b bd last:border-0 row-hover">
                  <td className="px-5 py-3 font-mono text-indigo-300">{tool}</td>
                  <td className="px-5 py-3 text-right t1">{v.calls.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right t2">{v.errors}</td>
                  <td className={clsx('px-5 py-3 text-right', v.errors > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                    {((v.errors / v.calls) * 100).toFixed(1)}%
                  </td>
                  <td className="px-5 py-3 text-right t2">{Math.round(v.latency / v.calls)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  )
}
