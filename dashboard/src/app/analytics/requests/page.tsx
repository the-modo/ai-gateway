'use client'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { Activity, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useDateRange } from '@/lib/analytics-context'
import { fetchAnalyticsSummary, fetchTimeseries, bestInterval } from '@/lib/api'
import clsx from 'clsx'

function fmtBucket(ms: number, span: number) {
  const d = new Date(ms)
  if (span <= 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fmtN(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="t3 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="t2">{p.name}:</span>
          <span className="t1 font-medium">{p.name === 'Error rate' ? `${p.value.toFixed(1)}%` : p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function RequestsPage() {
  const { from, to } = useDateRange()
  const [summary, setSummary]   = useState<any>(null)
  const [tsPoints, setTsPoints] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchAnalyticsSummary(from, to),
      fetchTimeseries(from, to, bestInterval(from, to)),
    ]).then(([s, ts]) => { setSummary(s); setTsPoints(ts); setLoading(false) })
  }, [from, to])

  const span = to - from
  const tsData = tsPoints.map(p => ({
    t: fmtBucket(p.bucket, span),
    Requests: p.request_count,
    Successful: p.request_count - p.error_count,
    Errors: p.error_count,
    'Error rate': p.request_count > 0 ? (p.error_count / p.request_count) * 100 : 0,
  }))

  const errPct = summary?.total_requests > 0
    ? ((summary.error_requests / summary.total_requests) * 100).toFixed(2) : '0.00'
  const successPct = summary?.total_requests > 0
    ? ((summary.success_requests / summary.total_requests) * 100).toFixed(1) : '100.0'

  const cards = [
    { label: 'Total requests',    value: summary ? fmtN(summary.total_requests) : '—',    color: 'text-indigo-400',  glow: 'rgba(99,102,241,0.12)',  icon: <Activity size={15}/>,     sub: 'in period' },
    { label: 'Successful',        value: summary ? fmtN(summary.success_requests) : '—',  color: 'text-emerald-400', glow: 'rgba(16,185,129,0.12)',  icon: <CheckCircle2 size={15}/>, sub: `${successPct}% success rate` },
    { label: 'Errors',            value: summary ? fmtN(summary.error_requests) : '—',    color: 'text-red-400',     glow: 'rgba(239,68,68,0.12)',   icon: <XCircle size={15}/>,     sub: `${errPct}% error rate` },
    { label: 'P50 latency',       value: summary ? `${Math.round(summary.avg_latency_ms)}ms` : '—', color: 'text-amber-400', glow: 'rgba(245,158,11,0.12)', icon: <AlertTriangle size={15}/>, sub: 'avg end-to-end' },
  ]

  return (
    <div className="space-y-5">
      {/* Cards */}
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

      {/* Volume chart */}
      <GlassCard title="Request volume" subtitle="Successful vs failed over time">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={tsData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
              <linearGradient id="gEr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
            </defs>
            <CartesianGrid stroke="var(--bd)" vertical={false}/>
            <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
            <Tooltip content={<Tip/>}/>
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--t2)' }}/>
            <Area type="monotone" dataKey="Successful" stroke="#10b981" strokeWidth={2} fill="url(#gS)" dot={false} stackId="a"/>
            <Area type="monotone" dataKey="Errors"     stroke="#ef4444" strokeWidth={1.5} fill="url(#gEr)" dot={false} stackId="a"/>
          </AreaChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Error rate chart */}
      <GlassCard title="Error rate" subtitle="% of requests that failed">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={tsData} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--bd)" vertical={false}/>
            <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)}%`} domain={[0, 'auto']}/>
            <Tooltip content={<Tip/>}/>
            <Line type="monotone" dataKey="Error rate" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }}/>
          </LineChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Requests per bucket bar */}
      <GlassCard title="Request distribution" subtitle="Requests per time bucket">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={tsData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="var(--bd)" vertical={false}/>
            <XAxis dataKey="t" tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{ fill: 'var(--t3)', fontSize: 10 }} tickLine={false} axisLine={false}/>
            <Tooltip content={<Tip/>}/>
            <Bar dataKey="Successful" stackId="r" fill="#6366f1" radius={[0, 0, 0, 0]}/>
            <Bar dataKey="Errors"     stackId="r" fill="#ef4444" radius={[3, 3, 0, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>
    </div>
  )
}
