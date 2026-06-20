'use client'
import { useState, useEffect } from 'react'
import { Zap, Wrench, Play, RefreshCw, Check, Copy, Terminal } from 'lucide-react'
import clsx from 'clsx'
import GlassCard from '@/components/GlassCard'
import { fetchApiKeys, fetchMcpTools, type McpServerStatus } from '@/lib/api'
import { getGatewayBase } from '@/lib/config'
import { TrySection, type GatewayKey } from '@/components/TryApi'

function mcpCurl(tool: string, args: string): string {
  let compact = args.trim() || '{}'
  try { compact = JSON.stringify(JSON.parse(compact)) } catch {}
  return `curl -X POST ${getGatewayBase()}/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${tool}","arguments":${compact}}}'`
}

function McpCurlCopy({ tool, args }: { tool: string; args: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const text = mcpCurl(tool, args)
    try {
      if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text) }
      else {
        const ta = document.createElement('textarea')
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
      }
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <button onClick={copy} className="flex items-center gap-1 text-[10px] t3 hover:t1 transition-colors">
      {copied ? <><Check size={10}/>Copied</> : <><Copy size={10}/>Copy</>}
    </button>
  )
}

function McpPlayground() {
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [discovering, setDiscovering] = useState(true)
  const [tool, setTool] = useState('')
  const [args, setArgs] = useState('{}')
  const [result, setResult] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [running, setRunning] = useState(false)

  const discover = async () => {
    setDiscovering(true)
    setStatuses(await fetchMcpTools())
    setDiscovering(false)
  }
  useEffect(() => { discover() }, [])

  const allTools = statuses.flatMap(s =>
    s.status === 'online' ? s.tools.map(t => ({ ...t, server: s.name })) : [])

  const selectTool = (name: string) => {
    setTool(name)
    setResult(null)
    if (name.endsWith('__echo')) setArgs('{ "text": "hello from the playground" }')
    else if (name.endsWith('__add')) setArgs('{ "a": 2, "b": 40 }')
    else setArgs('{}')
  }

  const run = async () => {
    setRunning(true); setResult(null); setIsError(false)
    try {
      const parsed = args.trim() ? JSON.parse(args) : {}
      const r = await fetch(`${getGatewayBase()}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
          params: { name: tool, arguments: parsed },
        }),
      })
      const d = await r.json()
      if (d.error) {
        setIsError(true)
        setResult(d.error.message ?? JSON.stringify(d.error))
      } else {
        const content = d.result?.content
        setResult(Array.isArray(content)
          ? content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
          : JSON.stringify(d.result, null, 2))
      }
    } catch (e: any) {
      setIsError(true)
      setResult(e?.message ?? 'Request failed — check the arguments JSON')
    }
    setRunning(false)
  }

  return (
    <GlassCard title="MCP tools" subtitle="Call tools through the unified /mcp endpoint — guardrails and content shield apply"
      action={
        <button onClick={discover}
          className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors">
          <RefreshCw size={11} className={discovering ? 'animate-spin' : ''}/> Refresh
        </button>
      }>
      {allTools.length === 0 ? (
        <div className="text-xs t4 py-6 text-center">
          {discovering ? 'Discovering tools…' : 'No MCP tools available — register a server on the MCP Servers page.'}
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_1fr] gap-5">
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {allTools.map(t => (
              <button key={t.name} onClick={() => selectTool(t.name)}
                className={clsx('w-full text-left px-3 py-2 rounded-xl border transition-all',
                  tool === t.name ? 'border-indigo-500/40 bg-indigo-500/10' : 'bd hover:bg-[var(--glass-hover)]')}>
                <div className="flex items-center gap-2">
                  <Wrench size={11} className={tool === t.name ? 'text-indigo-400' : 't4'}/>
                  <code className="text-[11px] font-mono t1">{t.name}</code>
                </div>
                {t.description && <div className="text-[10px] t4 mt-0.5 ml-5 line-clamp-2">{t.description}</div>}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] t3 font-semibold uppercase tracking-wide block mb-1.5">Arguments (JSON)</label>
              <textarea value={args} onChange={e => setArgs(e.target.value)} rows={6}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono resize-y"/>
            </div>
            {tool && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] t3 font-semibold uppercase tracking-wide flex items-center gap-1"><Terminal size={10}/> curl</label>
                  <McpCurlCopy tool={tool} args={args}/>
                </div>
                <pre className="glass-input rounded-xl px-3 py-2.5 text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed">{mcpCurl(tool, args)}</pre>
              </div>
            )}
            <button onClick={run} disabled={!tool || running}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/30 transition-all disabled:opacity-40">
              <Play size={12}/>
              {running ? 'Calling…' : tool ? `Call ${tool}` : 'Select a tool'}
            </button>
            {result !== null && (
              <div className={clsx('p-3 rounded-xl text-xs font-mono whitespace-pre-wrap break-all',
                isError ? 'banner-block text-red-400' : 'banner-info t1')}>
                {result}
              </div>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

export default function PlaygroundPage() {
  const [keys, setKeys] = useState<GatewayKey[]>([])
  const [tab, setTab] = useState<'llm' | 'mcp'>('llm')

  useEffect(() => {
    fetchApiKeys().then(data => setKeys(data as GatewayKey[])).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Playground</h1>
        <p className="text-sm t3 mt-1">Send live requests through the gateway and inspect responses</p>
      </div>

      <div className="glass rounded-2xl p-1.5 flex gap-0.5 w-fit">
        {([['llm', 'LLM API', Zap], ['mcp', 'MCP tools', Wrench]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-150',
              tab === id
                ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30'
                : 't3 hover:t2 hover:bg-white/5'
            )}>
            <Icon size={12}/>{label}
          </button>
        ))}
      </div>

      {tab === 'llm' ? <TrySection keys={keys}/> : <McpPlayground/>}
    </div>
  )
}
