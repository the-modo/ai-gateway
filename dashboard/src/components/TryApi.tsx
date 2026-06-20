'use client'
import { useState, useMemo, useCallback } from 'react'
import { KeyRound, Play, Terminal, Check, Copy, RefreshCw, FileText, Zap, Code2, Clock, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { getGatewayBase } from '@/lib/config'

export interface GatewayKey {
  id: string
  name: string
  key: string
  status: string
  [k: string]: any
}

function copyTextSafe(text: string) {
  try {
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text); return }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch {}
}

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { copyTextSafe(text); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
      className={clsx('flex items-center gap-1 text-[10px] transition-colors', copied ? 'text-emerald-400' : 't3 hover:t1', className)}>
      {copied ? <><Check size={10}/>Copied</> : <><Copy size={10}/>Copy</>}
    </button>
  )
}

const DEFAULT_REQUEST_BODY = JSON.stringify({
  model: 'openai/gpt-4o',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello! What can you help me with?' },
  ],
}, null, 2)

export function TrySection({ keys }: { keys: GatewayKey[] }) {
  const activeKeys = keys.filter(k => k.status === 'active')
  const [selectedKeyId, setSelectedKeyId] = useState(activeKeys[0]?.id ?? '')
  const selectedKeyObj = useMemo(
    () => activeKeys.find(k => k.id === selectedKeyId) ?? activeKeys[0] ?? null,
    [selectedKeyId, keys],
  )
  const keyToUse = selectedKeyObj?.key ?? 'sk-gw-your-key-here'

  const [body, setBody]               = useState(DEFAULT_REQUEST_BODY)
  const [extraHeaders, setExtraHeaders] = useState('')
  const [response, setResponse]       = useState<any>(null)
  const [loading, setLoading]         = useState(false)
  const [latency, setLatency]         = useState<number | null>(null)
  const [error, setError]             = useState<string | null>(null)

  const curlCmd = useMemo(() => {
    const extra = extraHeaders.trim()
      ? extraHeaders.split('\n').filter(Boolean).map(h => `  -H "${h.trim()}" \\`).join('\n') + '\n'
      : ''
    return `curl -X POST "${getGatewayBase()}/v1/chat/completions" \\\n  -H "Authorization: Bearer ${keyToUse}" \\\n  -H "Content-Type: application/json" \\\n${extra}  -d '${body}'`
  }, [keyToUse, extraHeaders, body])

  const sendRequest = useCallback(async () => {
    setLoading(true); setError(null); setResponse(null); setLatency(null)
    const t0 = Date.now()
    try {
      const parsed = JSON.parse(body)
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keyToUse}` }
      extraHeaders.split('\n').forEach(line => {
        const idx = line.indexOf(':')
        if (idx > 0) hdrs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      })
      const res = await fetch(`${getGatewayBase()}/v1/chat/completions`, { method: 'POST', headers: hdrs, body: JSON.stringify(parsed) })
      const ms = Date.now() - t0; setLatency(ms)
      const data = await res.json()
      if (!res.ok) setError(`HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`)
      else setResponse(data)
    } catch (e: any) {
      setLatency(Date.now() - t0)
      if (e instanceof SyntaxError) setError('Invalid JSON in request body')
      else setError(`Network error: ${e.message} — is the gateway running?`)
    } finally { setLoading(false) }
  }, [body, extraHeaders, keyToUse])

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold t1">Try the API</h2>
          <p className="text-xs t3 mt-0.5">Send a request — OpenAI-compatible spec</p>
        </div>
        {activeKeys.length > 0 && (
          <div className="glass rounded-xl px-3 py-2 flex items-center gap-2 min-w-[220px]">
            <KeyRound size={11} className="text-indigo-400 flex-shrink-0"/>
            <select value={selectedKeyId} onChange={e => setSelectedKeyId(e.target.value)}
              className="glass-input rounded-lg px-2 py-1 text-xs flex-1">
              {activeKeys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-4">
        {/* Left: body + extra headers + send */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] t2 font-semibold uppercase tracking-wide">Request body</label>
              <span className="text-[9px] t4 font-mono">POST /v1/chat/completions</span>
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={18}
              className="w-full rounded-xl px-3 py-2.5 text-xs font-mono resize-y leading-relaxed transition-all min-h-[200px]"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--input-bdr)',
                color: 'var(--t1)',
                outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--input-focus)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--input-ring)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-bdr)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
          <div>
            <label className="text-[10px] t2 font-semibold uppercase tracking-wide block mb-1.5">
              Extra headers <span className="t4 normal-case font-normal">(optional, one per line)</span>
            </label>
            <textarea value={extraHeaders} onChange={e => setExtraHeaders(e.target.value)} rows={3}
              className="w-full rounded-xl px-3 py-2 text-xs font-mono resize-y transition-all"
              placeholder="x-custom-header: value"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--input-bdr)',
                color: 'var(--t1)',
                outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--input-focus)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--input-ring)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-bdr)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
          <button onClick={sendRequest} disabled={loading}
            className={clsx('flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all',
              loading ? 'cursor-not-allowed'
                      : 'hover:brightness-110 active:scale-[0.98]')}
            style={{
              background: loading ? 'rgba(99,102,241,0.12)' : 'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(99,102,241,0.25) 100%)',
              border: '1px solid rgba(99,102,241,0.5)',
              color: loading ? 'rgba(165,180,252,0.6)' : '#a5b4fc',
              boxShadow: loading ? 'none' : '0 2px 12px rgba(99,102,241,0.2)',
            }}>
            {loading ? <><RefreshCw size={14} className="animate-spin"/>Sending…</> : <><Play size={14}/>Send request</>}
          </button>
        </div>

        {/* Right: curl preview + response */}
        <div className="flex flex-col gap-3">
          <div className="glass rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b bd">
              <div className="flex items-center gap-1.5">
                <Code2 size={11} className="t3"/>
                <span className="text-[10px] t3 font-medium">curl</span>
              </div>
              <CopyBtn text={curlCmd}/>
            </div>
            <pre className="px-4 py-3 text-[10px] font-mono t2 overflow-x-auto leading-relaxed whitespace-pre max-h-36 overflow-y-auto" suppressHydrationWarning>{curlCmd}</pre>
          </div>

          <div className="glass rounded-xl overflow-hidden flex-1">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bd">
              <span className="text-[10px] t3 font-medium">Response</span>
              {latency !== null && (
                <>
                  <span className={clsx('text-[10px] px-2 py-0.5 rounded-full',
                    error ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10')}>
                    {error ? 'Error' : '200 OK'}
                  </span>
                  <span className="text-[10px] t3">{latency}ms</span>
                  {response?.model && <span className="text-[10px] t4 font-mono ml-1">{response.model}</span>}
                </>
              )}
            </div>
            <div className="min-h-[200px] px-4 py-3">
              {!response && !error && !loading && (
                <div className="flex flex-col items-center justify-center h-40 t4">
                  <Terminal size={20} className="mb-2"/>
                  <span className="text-xs">Hit "Send request" to see the response</span>
                </div>
              )}
              {loading && (
                <div className="flex flex-col items-center justify-center h-40 t3">
                  <RefreshCw size={18} className="animate-spin mb-2 text-indigo-400"/>
                  <span className="text-xs">Waiting for response…</span>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 text-[11px]">
                  <AlertTriangle size={11} className="text-amber-400 mt-0.5 flex-shrink-0"/>
                  <pre className="t2 whitespace-pre-wrap break-all">{error}</pre>
                </div>
              )}
              {response && (
                <div className="space-y-2">
                  {response.choices?.[0]?.message?.content && (
                    <div className="glass rounded-lg px-3 py-2 text-[11px] t1 leading-relaxed">
                      {response.choices[0].message.content}
                    </div>
                  )}
                  <pre className="text-[10px] font-mono t2 overflow-x-auto max-h-44 overflow-y-auto">
                    {JSON.stringify(response, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


