'use client'
import { useState, useEffect } from 'react'
import {
  Plus, Trash2, RefreshCw, CheckCircle2, Plug,
  Wrench, AlertCircle, Play, FlaskConical,
  Sparkles,
} from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import {
  fetchMcpConfig, updateMcpConfig, fetchMcpTools,
  type McpServerEntry, type McpServerStatus,
} from '@/lib/api'
import { getGatewayBase } from '@/lib/config'
import clsx from 'clsx'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={clsx('relative w-10 h-[22px] rounded-full flex-shrink-0 transition-all duration-300',
        checked ? 'bg-indigo-500' : 'bg-[var(--glass-border)]')}>
      <span className={clsx('absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300',
        checked ? 'left-[22px]' : 'left-[3px]')}/>
    </button>
  )
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server'

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function McpPage() {
  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Add form
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newAuth, setNewAuth] = useState('')

  // Playground
  const [pgTool, setPgTool] = useState('')
  const [pgArgs, setPgArgs] = useState('{}')
  const [pgResult, setPgResult] = useState<string | null>(null)
  const [pgError, setPgError] = useState(false)
  const [pgRunning, setPgRunning] = useState(false)

  const endpoint = `${getGatewayBase()}/mcp`
  const testUrl = `${getGatewayBase()}/mcp-test`
  const hasTestServer = servers.some(s => s.url.endsWith('/mcp-test'))

  useEffect(() => {
    fetchMcpConfig().then(s => {
      setServers(s)
      setLoading(false)
      if (s.length > 0) discover()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (next: McpServerEntry[]) => {
    setServers(next)
    setSaving(true)
    const ok = await updateMcpConfig(next)
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  const addServer = () => {
    if (!newName.trim() || !newUrl.trim()) return
    save([...servers, {
      id: slug(newName), name: newName.trim(), url: newUrl.trim(),
      auth_header: newAuth.trim(), enabled: true,
    }])
    setNewName(''); setNewUrl(''); setNewAuth('')
  }

  const addTestServer = async () => {
    // The gateway calls itself over loopback — keep it on the host interface.
    const internalUrl = testUrl.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4891')
    await save([...servers, {
      id: 'test', name: 'Test MCP Server', url: internalUrl,
      auth_header: '', enabled: true,
    }])
    discover()
  }

  const discover = async () => {
    setDiscovering(true)
    setStatuses(await fetchMcpTools())
    setDiscovering(false)
  }

  const allTools = statuses.flatMap(s =>
    s.status === 'online' ? s.tools.map(t => ({ ...t, server: s.name })) : [])

  const runTool = async () => {
    setPgRunning(true); setPgResult(null); setPgError(false)
    try {
      const args = pgArgs.trim() ? JSON.parse(pgArgs) : {}
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
          params: { name: pgTool, arguments: args },
        }),
      })
      const d = await r.json()
      if (d.error) {
        setPgError(true)
        setPgResult(d.error.message ?? JSON.stringify(d.error))
      } else {
        const content = d.result?.content
        const text = Array.isArray(content)
          ? content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
          : JSON.stringify(d.result, null, 2)
        setPgResult(text)
      }
    } catch (e: any) {
      setPgError(true)
      setPgResult(e?.message ?? 'Request failed — check the arguments JSON')
    }
    setPgRunning(false)
  }

  const selectTool = (name: string) => {
    setPgTool(name)
    setPgResult(null)
    if (name.endsWith('__echo')) setPgArgs('{ "text": "hello from the gateway" }')
    else if (name.endsWith('__add')) setPgArgs('{ "a": 2, "b": 40 }')
    else setPgArgs('{}')
  }

  const statusFor = (id: string) => statuses.find(s => s.id === id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold gradient-text">MCP</h1>
          <p className="text-sm t3 mt-1">
            Register upstream MCP servers and expose them through one unified gateway endpoint
          </p>
        </div>
        <button onClick={discover} disabled={discovering}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
          <RefreshCw size={14} className={discovering ? 'animate-spin' : ''}/>
          {discovering ? 'Discovering…' : 'Discover tools'}
        </button>
      </div>

      {/* Registered servers */}
      <GlassCard title="Upstream MCP servers"
        subtitle={`${servers.length} registered`}
        action={saving ? <span className="text-indigo-400">Saving…</span>
          : saved ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12}/>Saved</span>
          : null}>
        {loading ? (
          <div className="text-xs t4 py-4">Loading…</div>
        ) : servers.length === 0 ? (
          <div className="flex items-center justify-between py-3 px-1">
            <div className="text-xs t4">
              No MCP servers registered yet — try the built-in test server to see how it works.
            </div>
            <button onClick={addTestServer}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-all flex-shrink-0">
              <FlaskConical size={12}/> Add test server
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((s, i) => {
              const st = statusFor(s.id)
              return (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl border bd">
                  <Plug size={16} className={s.enabled ? 'text-indigo-400' : 't4'}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium t1">{s.name}</span>
                      <span className="text-[9px] t4 font-mono">{s.id}</span>
                      {st && s.enabled && (
                        <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                          st.status === 'online' ? 'bg-emerald-500/15 text-emerald-400'
                          : st.status === 'error' ? 'bg-red-500/15 text-red-400'
                          : 'bg-zinc-500/15 t4')}>
                          {st.status === 'online' ? `online · ${st.tools.length} tools` : st.status}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] t4 font-mono truncate mt-0.5">{s.url}</div>
                    {st?.status === 'error' && s.enabled && (
                      <div className="flex items-center gap-1 text-[10px] text-red-400 mt-1">
                        <AlertCircle size={10}/> {st.error}
                      </div>
                    )}
                  </div>
                  <Toggle checked={s.enabled}
                    onChange={v => save(servers.map((x, j) => j === i ? { ...x, enabled: v } : x))}/>
                  <button onClick={() => save(servers.filter((_, j) => j !== i))}
                    className="t4 hover:text-red-400 transition-colors">
                    <Trash2 size={14}/>
                  </button>
                </div>
              )
            })}
            {!hasTestServer && (
              <button onClick={addTestServer}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25 hover:bg-emerald-500/20 transition-all">
                <FlaskConical size={11}/> Add built-in test server
              </button>
            )}
          </div>
        )}

        {/* Add server */}
        <div className="mt-4 pt-4 border-t bd">
          <div className="text-xs t3 mb-3 font-medium">Add server</div>
          <div className="grid grid-cols-[1fr_2fr_2fr_auto] gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name"
              className="glass-input rounded-xl px-3 py-2 text-xs"/>
            <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://host/mcp (Streamable HTTP)"
              className="glass-input rounded-xl px-3 py-2 text-xs font-mono"/>
            <input value={newAuth} onChange={e => setNewAuth(e.target.value)} placeholder="Authorization header (optional, e.g. Bearer …)"
              className="glass-input rounded-xl px-3 py-2 text-xs font-mono"/>
            <button onClick={addServer} disabled={!newName.trim() || !newUrl.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all disabled:opacity-40">
              <Plus size={12}/> Add
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Tool playground */}
      {allTools.length > 0 && (
        <GlassCard title="Tool playground"
          subtitle="Call any discovered tool through the unified /mcp endpoint — exactly what an MCP client does"
          icon={<Sparkles size={15} className="text-cyan-400"/>}>
          <div className="grid grid-cols-[1fr_1fr] gap-5">
            {/* Left: tool list */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {allTools.map(t => (
                <button key={t.name} onClick={() => selectTool(t.name)}
                  className={clsx('w-full text-left px-3 py-2 rounded-xl border transition-all',
                    pgTool === t.name
                      ? 'border-indigo-500/40 bg-indigo-500/10'
                      : 'bd hover:bg-[var(--glass-hover)]')}>
                  <div className="flex items-center gap-2">
                    <Wrench size={11} className={pgTool === t.name ? 'text-indigo-400' : 't4'}/>
                    <code className="text-[11px] font-mono t1">{t.name}</code>
                  </div>
                  {t.description && <div className="text-[10px] t4 mt-0.5 ml-5 line-clamp-2">{t.description}</div>}
                </button>
              ))}
            </div>

            {/* Right: args + run + result */}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] t3 font-semibold uppercase tracking-wide block mb-1.5">Arguments (JSON)</label>
                <textarea value={pgArgs} onChange={e => setPgArgs(e.target.value)} rows={4}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono resize-none"/>
              </div>
              <button onClick={runTool} disabled={!pgTool || pgRunning}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/30 transition-all disabled:opacity-40">
                <Play size={12}/>
                {pgRunning ? 'Calling…' : pgTool ? `Call ${pgTool}` : 'Select a tool'}
              </button>
              {pgResult !== null && (
                <div className={clsx('p-3 rounded-xl text-xs font-mono whitespace-pre-wrap break-all',
                  pgError ? 'banner-block text-red-400' : 'banner-info t1')}>
                  {pgResult}
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      )}

    </div>
  )
}
