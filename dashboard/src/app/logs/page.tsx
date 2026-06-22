'use client'
import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, ChevronDown, ChevronRight, ChevronUp, Trash2, ArrowUpDown } from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import DateRangePicker from '@/components/DateRangePicker'
import { fetchLogs, fetchLogDetail, deleteLogs, presetRange, type Preset } from '@/lib/api'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogRow {
  id: string; ts: number; model: string; provider: string
  status: number; latency_ms: number
  prompt_tokens: number; completion_tokens: number; total_tokens: number
  cost_usd: number; cached: boolean; stream: boolean; error?: string; flags?: string | null
}
interface LogDetail extends LogRow {
  prompt_tokens: number; completion_tokens: number
  request_body?: string; response_body?: string
}

type SortCol = 'ts' | 'model' | 'provider' | 'status' | 'latency_ms' | 'prompt_tokens' | 'completion_tokens' | 'total_tokens' | 'cost_usd' | 'cached'
type SortDir = 'asc' | 'desc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<number | string, string> = {
  200: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20',
  429: 'text-amber-400  bg-amber-500/10  ring-amber-500/20',
  502: 'text-red-400    bg-red-500/10    ring-red-500/20',
}
function statusColor(s: number) {
  if (s < 400) return STATUS_COLOR[200]
  if (s === 429) return STATUS_COLOR[429]
  return STATUS_COLOR[502]
}
function fmt$(n: number) { return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}` }

// ─── Sort header ──────────────────────────────────────────────────────────────

function ColHead({ col, label, sortBy, sortDir, onSort, className }: {
  col: SortCol; label: string; sortBy: SortCol; sortDir: SortDir
  onSort: (c: SortCol) => void; className?: string
}) {
  const active = sortBy === col
  return (
    <button onClick={() => onSort(col)}
      className={clsx(
        'flex items-center gap-1 uppercase tracking-wider font-medium transition-colors whitespace-nowrap',
        active ? 'text-indigo-400' : 't3 hover:t2', className,
      )}>
      {label}
      {active
        ? sortDir === 'desc' ? <ChevronDown size={10}/> : <ChevronUp size={10}/>
        : <ArrowUpDown size={9} className="opacity-30"/>}
    </button>
  )
}

// ─── Body block ───────────────────────────────────────────────────────────────

function BodyBlock({ label, body }: { label: string; body?: string }) {
  let pretty = body ?? ''
  try { pretty = JSON.stringify(JSON.parse(pretty), null, 2) } catch {}
  return (
    <div>
      <div className="t3 mb-1 text-[10px] uppercase tracking-wider">{label}</div>
      {body
        ? <pre className="glass rounded-lg p-3 text-[10px] t2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">{pretty}</pre>
        : <div className="glass rounded-lg px-3 py-2 text-[10px] t4 italic">
            Not captured — enable <code className="font-mono">log_bodies = true</code> in Settings → Request Logging
          </div>
      }
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ id }: { id: string }) {
  const [detail, setDetail] = useState<LogDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLogDetail(id).then(d => { setDetail(d); setLoading(false) })
  }, [id])

  if (loading) return <div className="px-5 py-4 bg-white/[0.02] border-b bd text-xs t3 animate-pulse">Loading…</div>
  if (!detail)  return <div className="px-5 py-4 bg-white/[0.02] border-b bd text-xs t3">Detail unavailable</div>

  const fields = [
    ['Timestamp',         new Date(detail.ts).toLocaleString()],
    ['Prompt tokens',     detail.prompt_tokens.toLocaleString()],
    ['Completion tokens', detail.completion_tokens.toLocaleString()],
    ['Total tokens',      detail.total_tokens.toLocaleString()],
    ['Cost',              fmt$(detail.cost_usd)],
    ['Cached',            detail.cached ? 'Yes' : 'No'],
    ['Streaming',         detail.stream ? 'Yes' : 'No'],
    ...(detail.error ? [['Error', detail.error]] : []),
  ]

  const flagChips = (detail.flags ?? '').split(',').filter(Boolean).map(f => {
    const [kind, ...rest] = f.split(':')
    return kind === 'guardrail'
      ? { label: 'Guardrail', sub: `flagged — ${rest.join(':')}`, color: '#f59e0b' }
      : { label: 'Content Shield', sub: rest.join(':') || 'applied', color: '#818cf8' }
  })

  const traceSteps: { label: string; sub: string; color: string }[] = [
    { label: 'Request', sub: detail.model, color: '#6366f1' },
    ...flagChips,
    ...(detail.error && detail.error.toLowerCase().includes('guardrail')
      ? [{ label: 'Guardrail', sub: 'blocked', color: '#ef4444' }]
      : detail.error && detail.error.toLowerCase().includes('shield')
      ? [{ label: 'Content Shield', sub: 'blocked', color: '#ef4444' }]
      : []),
    ...(detail.cached
      ? [{ label: 'Cache', sub: 'hit — provider skipped', color: '#22d3ee' }]
      : detail.provider && detail.provider !== 'cache'
      ? [{ label: detail.provider === 'mcp' ? 'MCP server' : 'Provider', sub: detail.provider === 'mcp' ? detail.model : detail.provider, color: '#f59e0b' }]
      : []),
    { label: 'Response', sub: `HTTP ${detail.status}`, color: detail.status < 400 ? '#10b981' : '#ef4444' },
  ]

  return (
    <div className="px-5 py-4 bg-white/[0.02] border-b bd text-xs space-y-4">
      {/* Route trace */}
      <div>
        <div className="t3 mb-1.5 text-[10px] uppercase tracking-wider">Trace</div>
        <div className="flex items-center gap-2 flex-wrap">
          {traceSteps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <span className="t4">→</span>}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border"
                style={{ borderColor: `${s.color}40`, background: `${s.color}12` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }}/>
                <span className="font-medium t1 text-[10px]">{s.label}</span>
                <span className="t4 text-[9px] font-mono">{s.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {fields.map(([k, v]) => (
          <div key={k}>
            <div className="t3 mb-0.5">{k}</div>
            <div className="t1 font-medium break-all">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <BodyBlock label="Request body"  body={detail.request_body}/>
        <BodyBlock label="Response body" body={detail.response_body}/>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// checkbox | expand | id | model | provider | status | latency | tokens | cost | cache
const GRID = 'grid-cols-[24px_20px_252px_112px_1fr_130px_58px_72px_66px_66px_66px_78px_52px]'

export default function LogsPage() {
  const [preset, setPreset]           = useState<Preset>('7d')
  const [range, setRange]             = useState(() => presetRange('7d'))
  const [search, setSearch]           = useState('')
  const [debouncedSearch, setDebounced] = useState('')
  const [statusFlt, setStatus]        = useState('')
  const [tab, setTab]                 = useState<'requests' | 'mcp'>('requests')
  const [modelFlt, setModel]          = useState('')
  const [sortBy, setSortBy]           = useState<SortCol>('ts')
  const [sortDir, setSortDir]         = useState<SortDir>('desc')
  const [page, setPage]               = useState(1)
  const [logs, setLogs]               = useState<LogRow[]>([])
  const [total, setTotal]             = useState(0)
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [confirmDelSel, setConfirmDelSel] = useState(false)
  const PER_PAGE = 50

  // Debounce search input — reset page on new term
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchLogs({
      from: range.from, to: range.to,
      provider: tab === 'mcp' ? 'mcp' : undefined,
      exclude_provider: tab === 'requests' ? 'mcp' : undefined,
      model: modelFlt || undefined,
      status: statusFlt ? Number(statusFlt) : undefined,
      search: debouncedSearch || undefined,
      sort_by: sortBy, sort_dir: sortDir,
      page, per_page: PER_PAGE,
    })
    setLogs(res.items ?? [])
    setTotal(res.total ?? 0)
    setLoading(false)
  }, [range, modelFlt, statusFlt, debouncedSearch, sortBy, sortDir, page, tab])

  useEffect(() => { load() }, [load])

  // Clear selection when filters change
  useEffect(() => { setSelected(new Set()) }, [page, range, modelFlt, statusFlt, debouncedSearch, tab])

  const handlePreset = (p: Preset, r: { from: number; to: number }) => {
    setPreset(p); setRange(r); setPage(1)
  }

  const handleSort = (col: SortCol) => {
    if (col === sortBy) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(col); setSortDir('desc')
    }
    setPage(1)
  }

  // Results are already filtered server-side; no client-side pass needed
  const visible = logs

  const allPageSelected = visible.length > 0 && visible.every(l => selected.has(l.id))
  const someSelected = selected.size > 0

  const toggleAll = () => {
    if (allPageSelected) {
      const next = new Set(selected)
      visible.forEach(l => next.delete(l.id))
      setSelected(next)
    } else {
      const next = new Set(selected)
      visible.forEach(l => next.add(l.id))
      setSelected(next)
    }
  }

  const toggleRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  const handleDeleteSelected = async () => {
    await deleteLogs([...selected])
    setSelected(new Set())
    setConfirmDelSel(false)
    load()
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Request Logs</h1>
          <p className="text-sm t3 mt-1">Per-request audit trail — latency, cost, tokens &amp; body capture</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker preset={preset} onChange={handlePreset}/>
          <button onClick={load}
            className="glass glass-hover rounded-xl px-3 py-2 text-xs t2 flex items-center gap-1.5 transition-all">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''}/> Refresh
          </button>

          {/* Delete — only active when rows are selected */}
          {someSelected && (
            confirmDelSel ? (
              <div className="flex items-center gap-2 glass rounded-xl px-3 py-2">
                <span className="text-xs text-red-400">Delete {selected.size} log{selected.size !== 1 ? 's' : ''}?</span>
                <button onClick={handleDeleteSelected} className="text-xs text-red-400 font-medium hover:text-red-300 transition-colors">Yes, delete</button>
                <button onClick={() => setConfirmDelSel(false)} className="text-xs t3 hover:t2 transition-colors">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelSel(true)}
                className="glass glass-hover rounded-xl px-3 py-2 text-xs text-red-400 flex items-center gap-1.5 transition-all ring-1 ring-red-500/30">
                <Trash2 size={12}/> Delete ({selected.size})
              </button>
            )
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="glass rounded-2xl p-1.5 flex gap-0.5 w-fit">
        {([['requests', 'Requests'], ['mcp', 'MCP Logs']] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setPage(1) }}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-150',
              tab === id
                ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30'
                : 't3 hover:t2 hover:bg-white/5'
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 t3"/>
          <input className="glass-input w-full rounded-xl px-8 py-2 text-xs"
            placeholder="Search model, provider, ID, or body…"
            value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <select className="glass-input rounded-xl px-3 py-2 text-xs appearance-none cursor-pointer"
          value={statusFlt} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="200">2xx Success</option>
          <option value="400">4xx / 5xx Errors</option>
        </select>
        <input className="glass-input rounded-xl px-3 py-2 text-xs w-44"
          placeholder="Filter by model…"
          value={modelFlt} onChange={e => { setModel(e.target.value); setPage(1) }}/>
      </div>

      {/* Table */}
      <GlassCard noPad>
        <div className="overflow-x-auto">
          {/* Header row */}
          <div className={clsx('grid gap-2 px-5 py-3 border-b bd min-w-[1260px] text-[10px]', GRID)}>
            {/* Select-all checkbox */}
            <div className="flex items-center">
              <input type="checkbox"
                checked={allPageSelected}
                onChange={toggleAll}
                className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
              />
            </div>
            <span/>
            <span className="t3 font-medium flex items-center">Request ID</span>
            <ColHead col="ts"           label="Time"        sortBy={sortBy} sortDir={sortDir} onSort={handleSort}/>
            <ColHead col="model"        label="Model"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort}/>
            <ColHead col="provider"     label="Provider"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort}/>
            <ColHead col="status"       label="Status"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort}/>
            <ColHead col="latency_ms"   label="Latency"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="justify-end"/>
            <ColHead col="prompt_tokens"     label="Req tok"  sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="justify-end"/>
            <ColHead col="completion_tokens" label="Resp tok" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="justify-end"/>
            <ColHead col="total_tokens"      label="Total"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="justify-end"/>
            <ColHead col="cost_usd"     label="Cost"        sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="justify-end"/>
            <ColHead col="cached"       label="Cache"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort}/>
          </div>

          {/* Rows */}
          {loading ? (
            <div className="min-w-[1260px]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 mx-5 my-1 glass rounded-lg animate-pulse opacity-30"/>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="min-w-[1260px] py-16"/>
          ) : visible.map(log => (
            <div key={log.id} className="min-w-[1260px]">
              <div
                className={clsx(
                  'row-hover grid gap-2 px-5 py-2.5 border-b bd last:border-0 cursor-pointer transition-colors text-xs items-center',
                  GRID,
                  selected.has(log.id) && 'bg-indigo-500/5',
                )}
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              >
                {/* Row checkbox */}
                <div className="flex items-center" onClick={e => toggleRow(log.id, e)}>
                  <input type="checkbox"
                    checked={selected.has(log.id)}
                    onChange={() => {}}
                    className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                  />
                </div>
                <span className="t4">
                  {expanded === log.id ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                </span>
                <span className="font-mono t2 text-[10px] break-all">{log.id}</span>
                <span className="t3 text-[10px] leading-tight">
                  {new Date(log.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                  {new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="t1 truncate">{log.model}</span>
                <span className="t2 truncate">{log.provider}</span>
                <span className={clsx('px-1.5 py-0.5 rounded-full text-[10px] font-medium ring-1 w-fit', statusColor(log.status))}>
                  {log.status}
                </span>
                <span className={clsx('text-right', log.latency_ms > 2000 ? 'text-amber-400' : 't2')}>{log.latency_ms}ms</span>
                <span className="t3 text-right">{(log.prompt_tokens ?? 0).toLocaleString()}</span>
                <span className="t3 text-right">{(log.completion_tokens ?? 0).toLocaleString()}</span>
                <span className="t2 text-right">{log.total_tokens.toLocaleString()}</span>
                <span className="t2 text-right">{fmt$(log.cost_usd)}</span>
                <span className={log.cached ? 'text-cyan-400 text-[10px]' : 't4 text-[10px]'}>
                  {log.cached ? '✓ hit' : 'miss'}
                </span>
              </div>
              {expanded === log.id && <DetailPanel id={log.id}/>}
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs t3 flex-wrap gap-2">
        <span>
          {total.toLocaleString()} entries · page {page} of {totalPages} · {PER_PAGE} per page
          {someSelected && <span className="text-indigo-400 ml-2">· {selected.size} selected</span>}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="glass glass-hover rounded-lg px-3 py-1.5 t2 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              ← Prev
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="glass glass-hover rounded-lg px-3 py-1.5 t2 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
