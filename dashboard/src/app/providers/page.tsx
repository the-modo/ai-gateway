'use client'
import { useState, useEffect } from 'react'
import {
  Key, Shield, Gauge, Hash, Plus, X,
  Eye, EyeOff, CheckCircle2, ExternalLink, CheckCheck, AlertCircle,
  ChevronDown, ChevronUp, Zap, Box, RefreshCw, Save, Trash2,
} from 'lucide-react'
import { VENDORS, type VendorMeta } from '@/lib/vendors'
import { fetchModelsConfig, updateModelsConfig, fetchGatewayProviders, type ModelPricingEntry, type GatewayProviderInfo } from '@/lib/api'
import clsx from 'clsx'

// ─── Toggle ───────────────────────────────────────────────────────────────────

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

// ─── Text input ───────────────────────────────────────────────────────────────

function Input({ label, value, onChange, type = 'text', placeholder = '', hint, disabled }: any) {
  const [show, setShow] = useState(false)
  const isSecret = type === 'password'
  return (
    <div className="space-y-1.5">
      {label && <label className="text-xs t3 block">{label}</label>}
      <div className="relative">
        <input
          type={isSecret && !show ? 'password' : 'text'}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} disabled={disabled}
          className={clsx('glass-input w-full rounded-xl px-3 py-2 text-sm', disabled && 'opacity-50 cursor-not-allowed')}
          style={{ paddingRight: isSecret ? '2rem' : undefined }}/>
        {isSecret && (
          <button onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 t3 hover:t1 transition-colors">
            {show ? <EyeOff size={13}/> : <Eye size={13}/>}
          </button>
        )}
      </div>
      {hint && <p className="text-[10px] t4">{hint}</p>}
    </div>
  )
}

// ─── Number input ─────────────────────────────────────────────────────────────

function NumInput({ label, value, onChange, placeholder = '', min = 0, hint }: any) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-xs t3 block">{label}</label>}
      <input type="number" min={min} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm"/>
      {hint && <p className="text-[10px] t4">{hint}</p>}
    </div>
  )
}

// ─── Vendor icon ──────────────────────────────────────────────────────────────

function VendorIcon({ v, size = 'md' }: { v: VendorMeta; size?: 'sm' | 'md' | 'lg' }) {
  const [err, setErr] = useState(false)
  const dim  = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'
  const px   = size === 'lg' ? 22 : size === 'sm' ? 14 : 18
  const text = size === 'lg' ? 'text-base' : 'text-[10px]'
  return (
    <div className={clsx('rounded-xl flex items-center justify-center font-bold flex-shrink-0', dim)}
      style={{ background: v.bg, boxShadow: `0 0 0 1px ${v.ring}` }}>
      {!err
        ? <img src={v.icon} alt={v.name} width={px} height={px}
            className="object-contain" onError={() => setErr(true)}/>
        : <span className={clsx('font-bold', text)} style={{ color:v.color }}>{v.badge}</span>
      }
    </div>
  )
}

// ─── Inline add-model form ────────────────────────────────────────────────────

function AddModelInline({ provider, onAdd }: { provider: string; onAdd: (m: ModelPricingEntry) => void }) {
  const [show, setShow]     = useState(false)
  const [id, setId]         = useState('')
  const [name, setName]     = useState('')
  const [input, setInput]   = useState('')
  const [output, setOutput] = useState('')

  const reset = () => { setId(''); setName(''); setInput(''); setOutput(''); setShow(false) }

  const handleAdd = () => {
    if (!id.trim()) return
    const fullId = id.trim().includes('/') ? id.trim() : `${provider}/${id.trim()}`
    onAdd({
      id: fullId,
      provider,
      name: name.trim() || id.trim(),
      input_per_1m: parseFloat(input) || 0,
      output_per_1m: parseFloat(output) || 0,
      enabled: true,
      custom: true,
    })
    reset()
  }

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
        <Plus size={9}/> Add model
      </button>
    )
  }

  return (
    <div className="rounded-xl p-3 space-y-2.5"
      style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.15)' }}>
      <div className="text-[9px] t3 font-medium uppercase tracking-wide">New model</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[9px] t4 block">Model ID *</label>
          <input className="glass-input w-full rounded-lg px-2 py-1.5 text-[10px] font-mono"
            placeholder={`${provider}/model-name`}
            value={id} onChange={e => setId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}/>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] t4 block">Display name</label>
          <input className="glass-input w-full rounded-lg px-2 py-1.5 text-[10px]"
            placeholder="My Model"
            value={name} onChange={e => setName(e.target.value)}/>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] t4 block">Input $/1M</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] t4">$</span>
            <input type="number" min={0} step="0.001"
              className="glass-input w-full rounded-lg pl-4 pr-2 py-1.5 text-[10px]"
              placeholder="0.00" value={input} onChange={e => setInput(e.target.value)}/>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] t4 block">Output $/1M</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] t4">$</span>
            <input type="number" min={0} step="0.001"
              className="glass-input w-full rounded-lg pl-4 pr-2 py-1.5 text-[10px]"
              placeholder="0.00" value={output} onChange={e => setOutput(e.target.value)}/>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleAdd} disabled={!id.trim()}
          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-all disabled:opacity-40">
          <Plus size={9}/> Add
        </button>
        <button onClick={reset}
          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg glass t3 hover:t2 transition-all">
          <X size={9}/> Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Provider card ────────────────────────────────────────────────────────────

function disabledVendors(): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('gw-disabled-vendors') ?? '[]') } catch { return [] }
}

type Tab = 'auth' | 'perf' | 'limits' | 'headers' | 'models'
interface HeaderRow { id: string; key: string; value: string }

function ProviderCard({ v, instances, providerModels, onModelsChange, onSaveModels, savingModels, savedModels }: {
  v: VendorMeta
  instances: GatewayProviderInfo[]
  providerModels: ModelPricingEntry[]
  onModelsChange: (updated: ModelPricingEntry[]) => void
  onSaveModels: () => void
  savingModels: boolean
  savedModels: boolean
}) {
  const [apiKey,   setApiKey]   = useState('')
  const [baseUrl,  setBaseUrl]  = useState(v.baseUrl ?? '')
  const [enabled,  setEnabled]  = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [tab,      setTab]      = useState<Tab>('auth')

  // Active = the gateway actually has this provider configured AND not
  // manually disabled by the user (persisted so Routing respects it too).
  useEffect(() => {
    setEnabled(instances.length > 0 && !disabledVendors().includes(v.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances.length])

  const handleEnabledChange = (val: boolean) => {
    setEnabled(val)
    const cur = new Set(disabledVendors())
    if (val) cur.delete(v.id); else cur.add(v.id)
    localStorage.setItem('gw-disabled-vendors', JSON.stringify([...cur]))
  }

  const [timeout,  setTimeout_] = useState('30000')
  const [retries,  setRetries]  = useState('3')
  const [weight,   setWeight]   = useState('100')
  const [priority, setPriority] = useState('1')

  const [rpm,    setRpm]    = useState('')
  const [tpm,    setTpm]    = useState('')
  const [ctxWin, setCtxWin] = useState('')

  const [headers, setHeaders] = useState<HeaderRow[]>(
    v.id === 'azure' ? [{ id:'h1', key:'api-version', value:'2024-02-01' }] : []
  )
  const addHeader    = () => setHeaders(h => [...h, { id:`h-${Date.now()}`, key:'', value:'' }])
  const removeHeader = (id: string) => setHeaders(h => h.filter(x => x.id !== id))
  const updateHeader = (id: string, f: 'key' | 'value', val: string) =>
    setHeaders(h => h.map(x => x.id === id ? { ...x, [f]: val } : x))

  const noKey = !v.envVar
  const configured = instances.length > 0 || apiKey.length > 0

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id:'auth',    label:'Auth',         icon: Key     },
    { id:'models',  label:'Models',       icon: Box     },
    { id:'perf',    label:'Performance',  icon: Gauge   },
    { id:'limits',  label:'Rate Limits',  icon: Shield  },
    { id:'headers', label:'Headers',      icon: Hash    },
  ]

  const updateModel = (localIdx: number, patch: Partial<ModelPricingEntry>) =>
    onModelsChange(providerModels.map((m, i) => i === localIdx ? { ...m, ...patch } : m))

  const deleteModel = (localIdx: number) =>
    onModelsChange(providerModels.filter((_, i) => i !== localIdx))

  return (
    <div className={clsx('glass rounded-2xl overflow-hidden transition-all duration-300',
        enabled ? 'ring-1' : 'opacity-60')}
      style={enabled ? { boxShadow:`0 0 0 1px ${v.ring}40` } as any : {}}>

      <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}>
        <VendorIcon v={v} size="md"/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold t1">{v.name}</span>
            {configured && enabled && <CheckCheck size={12} className="text-emerald-400"/>}
            {!configured && enabled && <AlertCircle size={12} className="text-amber-400"/>}
          </div>
          <div className="text-[10px] t3 truncate">{v.description}</div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {instances.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded"
              style={{ background:`${v.color}15`, color:v.color }}>
              {instances.length} configured
            </span>
          )}
          {providerModels.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded"
              style={{ background:`${v.color}15`, color:v.color }}>
              {providerModels.length} model{providerModels.length !== 1 ? 's' : ''}
            </span>
          )}
          {rpm && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:`${v.color}15`, color:v.color }}>{rpm} rpm</span>}
          <div className={clsx('text-[10px] px-2 py-0.5 rounded-full',
            instances.length > 0 ? 'text-emerald-400 bg-emerald-500/10'
              : enabled ? 'text-amber-400 bg-amber-500/10' : 't4 bg-white/[0.04]')}>
            {instances.length > 0 ? 'Active' : enabled ? 'Needs key' : 'Not configured'}
          </div>
          <Toggle checked={enabled} onChange={handleEnabledChange}/>
          {expanded ? <ChevronUp size={12} className="t3"/> : <ChevronDown size={12} className="t3"/>}
        </div>
      </div>

      {expanded && (
        <>
          <div className="flex border-t border-b bd">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-all',
                  tab === t.id
                    ? 'border-b-2 border-indigo-400 text-indigo-300 -mb-px'
                    : 't3 hover:t2')}>
                <t.icon size={11}/>
                {t.label}
              </button>
            ))}
          </div>

          <div className="px-4 py-4 space-y-4">

            {/* AUTH */}
            {tab === 'auth' && (
              <>
                {instances.length > 0 && (
                  <div>
                    <div className="text-[10px] t3 mb-2 font-medium uppercase tracking-wide">
                      Configured on gateway ({instances.length})
                    </div>
                    <div className="space-y-1.5">
                      {instances.map(inst => (
                        <div key={inst.name} className="px-3 py-2.5 rounded-xl space-y-1.5"
                          style={{ background:`${v.color}0d`, border:`1px solid ${v.ring}` }}>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0"/>
                            <span className="text-xs font-semibold t1 font-mono">{inst.name}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded ml-auto"
                              style={{ background:`${v.color}15`, color:v.color }}>{inst.kind}</span>
                          </div>
                          {inst.base_url && (
                            <div className="text-[9px] t3 font-mono truncate">→ {inst.base_url}</div>
                          )}
                          {inst.models.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {inst.models.map(m => (
                                <span key={m} className="text-[8px] px-1.5 py-0.5 rounded font-mono t3"
                                  style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)' }}>{m}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {noKey ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.2)' }}>
                    <CheckCircle2 size={12} className="text-emerald-400"/>
                    <span className="text-xs text-emerald-400">No API key required</span>
                  </div>
                ) : (
                  <Input
                    label={`API Key${v.envVar ? ` (env: $${v.envVar})` : ''}`}
                    type="password" value={apiKey} onChange={setApiKey}
                    placeholder={v.envVar ?? 'sk-…'}
                    hint="Stored locally in your browser only — never sent to any third party."/>
                )}
                <Input
                  label="Base URL" value={baseUrl} onChange={setBaseUrl}
                  placeholder={v.baseUrl ?? 'https://api.example.com'}
                  hint={v.openAICompat ? 'OpenAI-compatible endpoint — override the default base URL.' : 'Custom endpoint URL.'}/>
                {v.id === 'azure' && (
                  <div className="px-3 py-2.5 rounded-xl space-y-1"
                    style={{ background:'rgba(0,120,212,0.08)', border:'1px solid rgba(0,120,212,0.2)' }}>
                    <div className="text-[10px] text-blue-400 font-medium">Azure endpoint format</div>
                    <div className="text-[9px] font-mono t3">https://{'<resource>'}.openai.azure.com/openai/deployments/{'<deployment>'}</div>
                  </div>
                )}
                {v.id === 'mock' && (
                  <div className="px-3 py-2.5 rounded-xl space-y-1.5"
                    style={{ background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.2)' }}>
                    <div className="text-[10px] text-violet-400 font-medium">Test server details</div>
                    <div className="text-[9px] t3 space-y-0.5">
                      <div>Endpoint: <span className="font-mono text-violet-300">{baseUrl}/v1/chat/completions</span></div>
                      <div>Auth header: <span className="font-mono text-violet-300">Authorization: Bearer mock-api-key-for-testing</span></div>
                      <div className="t4 pt-0.5">The test server echoes requests and returns a synthetic response — useful for testing routing and guardrails without real API keys.</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t bd">
                  <div className="flex items-center gap-1.5">
                    {v.openAICompat && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
                        OpenAI-compatible
                      </span>
                    )}
                  </div>
                  {v.docsUrl && (
                    <a href={v.docsUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
                      Get API key <ExternalLink size={10}/>
                    </a>
                  )}
                </div>
              </>
            )}

            {/* MODELS */}
            {tab === 'models' && v.id === 'mock' ? (
              <div className="space-y-3">
                {instances.length > 0 ? (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_160px_88px_88px] gap-2 px-1 pb-1 text-[9px] uppercase tracking-wider t4 font-medium border-b bd">
                      <span>Model ID</span>
                      <span>Served by</span>
                      <span>In $/1M</span>
                      <span>Out $/1M</span>
                    </div>
                    {instances.flatMap(inst => inst.models.map(m => (
                      <div key={`${inst.name}-${m}`}
                        className="grid grid-cols-[1fr_160px_88px_88px] gap-2 items-center py-1.5 border-b bd last:border-0">
                        <span className="text-[10px] font-mono t1 truncate">{m}</span>
                        <span className="text-[10px] t3 truncate">{inst.name}</span>
                        <span className="text-[10px] text-emerald-400 font-medium">Free</span>
                        <span className="text-[10px] text-emerald-400 font-medium">Free</span>
                      </div>
                    )))}
                    <p className="text-[10px] t4 pt-2">
                      Test models mirror real model IDs so routing, caching, guardrails and analytics behave
                      exactly like production — at zero cost. Token usage is estimated from request content.
                    </p>
                  </div>
                ) : (
                  <div className="text-xs t4 py-3">
                    No test instances configured on the gateway.
                  </div>
                )}
              </div>
            ) : tab === 'models' && (
              <div className="space-y-3">
                {providerModels.length > 0 ? (
                  <div className="space-y-1">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_130px_88px_88px_48px_28px] gap-2 px-1 pb-1 text-[9px] uppercase tracking-wider t4 font-medium border-b bd">
                      <span>Model ID</span>
                      <span>Display name</span>
                      <span>In $/1M</span>
                      <span>Out $/1M</span>
                      <span>On</span>
                      <span/>
                    </div>

                    {providerModels.map((m, localIdx) => (
                      <div key={m.id}
                        className="grid grid-cols-[1fr_130px_88px_88px_48px_28px] gap-2 items-center py-1 border-b bd last:border-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-[10px] font-mono t2 truncate">{m.id}</span>
                          {m.custom && (
                            <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 flex-shrink-0">custom</span>
                          )}
                        </div>
                        <input
                          className="glass-input rounded-lg px-2 py-1 text-[10px] w-full"
                          value={m.name}
                          onChange={e => updateModel(localIdx, { name: e.target.value })}/>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] t4">$</span>
                          <input type="number" min={0} step="0.001"
                            className="glass-input rounded-lg pl-4 pr-1 py-1 text-[10px] w-full"
                            value={m.input_per_1m}
                            onChange={e => updateModel(localIdx, { input_per_1m: parseFloat(e.target.value) || 0 })}/>
                        </div>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] t4">$</span>
                          <input type="number" min={0} step="0.001"
                            className="glass-input rounded-lg pl-4 pr-1 py-1 text-[10px] w-full"
                            value={m.output_per_1m}
                            onChange={e => updateModel(localIdx, { output_per_1m: parseFloat(e.target.value) || 0 })}/>
                        </div>
                        <div className="flex justify-center">
                          <Toggle checked={m.enabled} onChange={val => updateModel(localIdx, { enabled: val })}/>
                        </div>
                        <button onClick={() => deleteModel(localIdx)}
                          className="flex items-center justify-center t4 hover:text-red-400 transition-colors">
                          <Trash2 size={11}/>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] t4 italic text-center py-3">
                    No models configured — add one below
                  </div>
                )}

                <AddModelInline provider={v.id} onAdd={m => onModelsChange([...providerModels, m])}/>

                <div className="flex justify-end pt-1 border-t bd">
                  <button onClick={onSaveModels} disabled={savingModels}
                    className={clsx('flex items-center gap-1 text-[10px] px-3 py-1.5 rounded-lg transition-all',
                      savedModels
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : 'text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20')}>
                    {savedModels
                      ? <><CheckCircle2 size={10}/> Saved</>
                      : savingModels
                        ? <><RefreshCw size={10} className="animate-spin"/> Saving…</>
                        : <><Save size={10}/> Save changes</>}
                  </button>
                </div>
              </div>
            )}

            {/* PERFORMANCE */}
            {tab === 'perf' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <NumInput label="Timeout (ms)" value={timeout} onChange={setTimeout_} placeholder="30000" hint="Request timeout. 0 = no limit."/>
                  <NumInput label="Max Retries"   value={retries} onChange={setRetries}  placeholder="3"     hint="Retry attempts on failure."/>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumInput label="Weight"   value={weight}   onChange={setWeight}   placeholder="100" hint="Relative weight for weighted routing."/>
                  <NumInput label="Priority" value={priority} onChange={setPriority} placeholder="1" min={1} hint="Lower = higher priority in sequential routing."/>
                </div>
                <div className="px-3 py-3 rounded-xl space-y-2"
                  style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.15)' }}>
                  <div className="flex items-center gap-2 text-[10px] text-indigo-400 font-medium">
                    <Zap size={11}/> Effective for routing strategies
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] t3">
                    <div><span className="t2 font-medium">weighted</span> — uses Weight field</div>
                    <div><span className="t2 font-medium">sequential</span> — uses Priority field</div>
                    <div><span className="t2 font-medium">latency</span> — measured live (EMA)</div>
                    <div><span className="t2 font-medium">least_requests</span> — tracks active reqs</div>
                  </div>
                </div>
              </>
            )}

            {/* RATE LIMITS */}
            {tab === 'limits' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <NumInput label="Requests / minute (RPM)" value={rpm} onChange={setRpm}
                    placeholder="∞ (unlimited)" hint="The gateway will skip this provider when the limit is approaching."/>
                  <NumInput label="Tokens / minute (TPM)" value={tpm} onChange={setTpm}
                    placeholder="∞ (unlimited)" hint="Token budget per minute across all requests."/>
                </div>
                <NumInput label="Context window (tokens)" value={ctxWin} onChange={setCtxWin}
                  placeholder="e.g. 128000" hint="Max tokens per request. Used for cost estimation and model selection."/>
                <div className="px-3 py-3 rounded-xl space-y-2"
                  style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.15)' }}>
                  <div className="flex items-center gap-2 text-[10px] text-amber-400 font-medium">
                    <Gauge size={11}/> Rate-limit-aware routing
                  </div>
                  <p className="text-[10px] t3">When <span className="text-indigo-400 font-mono">rate_limit_aware</span> strategy is selected, the gateway tracks usage in real-time and automatically routes away from providers nearing their limits — with no extra latency.</p>
                </div>
                <div>
                  <div className="text-[10px] t3 mb-2 font-medium uppercase tracking-wide">Reference limits (from docs)</div>
                  <div className="space-y-1.5">
                    {[
                      { tier:'Tier 1', rpm:500,    tpm:30_000  },
                      { tier:'Tier 2', rpm:5_000,  tpm:450_000 },
                      { tier:'Tier 4', rpm:10_000, tpm:1_000_000 },
                    ].map(t => (
                      <div key={t.tier} className="flex items-center gap-3 px-3 py-2 rounded-xl glass cursor-pointer hover:ring-1"
                        style={{ '--tw-ring-color': v.ring } as any}
                        onClick={() => { setRpm(String(t.rpm)); setTpm(String(t.tpm)) }}>
                        <span className="text-[10px] font-medium t2 w-12">{t.tier}</span>
                        <span className="text-[10px] t3 flex-1">{t.rpm.toLocaleString()} rpm · {t.tpm.toLocaleString()} tpm</span>
                        <span className="text-[9px] text-indigo-400">Apply →</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* CUSTOM HEADERS */}
            {tab === 'headers' && (
              <>
                <p className="text-[10px] t3">Headers sent with every request to this provider. Useful for Azure API version, custom auth schemes, or org IDs.</p>
                <div className="space-y-2">
                  {headers.map(h => (
                    <div key={h.id} className="flex gap-2 items-start">
                      <input className="glass-input rounded-xl px-3 py-2 text-xs flex-1 font-mono"
                        placeholder="Header-Name" value={h.key}
                        onChange={e => updateHeader(h.id, 'key', e.target.value)}/>
                      <input className="glass-input rounded-xl px-3 py-2 text-xs flex-1 font-mono"
                        placeholder="value" value={h.value}
                        onChange={e => updateHeader(h.id, 'value', e.target.value)}/>
                      <button onClick={() => removeHeader(h.id)}
                        className="t4 hover:text-red-400 transition-colors mt-2.5 flex-shrink-0">
                        <X size={13}/>
                      </button>
                    </div>
                  ))}
                  {headers.length === 0 && (
                    <div className="text-[10px] t4 italic text-center py-2">No custom headers</div>
                  )}
                </div>
                <button onClick={addHeader}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl glass text-xs t2 hover:t1 transition-all">
                  <Plus size={11}/> Add header
                </button>
                <div>
                  <div className="text-[10px] t3 mb-2 font-medium uppercase tracking-wide">Common presets</div>
                  <div className="space-y-1">
                    {[
                      { label:'Azure API version',    key:'api-version',         value:'2024-02-01' },
                      { label:'OpenAI Org ID',         key:'OpenAI-Organization', value:'org-…'      },
                      { label:'Anthropic version',     key:'anthropic-version',   value:'2023-06-01' },
                      { label:'Bedrock region',        key:'x-region',            value:'us-east-1'  },
                    ].map(p => (
                      <button key={p.label}
                        onClick={() => { if (!headers.find(h => h.key === p.key)) setHeaders(h => [...h, { id:`h-${Date.now()}`, key:p.key, value:p.value }]) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl glass text-[10px] t3 hover:t2 transition-all text-left">
                        <Plus size={9} className="text-indigo-400 flex-shrink-0"/>
                        <span className="font-medium t2">{p.label}</span>
                        <span className="font-mono t4 ml-auto">{p.key}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Default model catalog ────────────────────────────────────────────────────

const DEFAULT_MODELS: ModelPricingEntry[] = [
  // OpenAI
  { id:'openai/gpt-4o',              provider:'openai',    name:'GPT-4o',              input_per_1m:2.50,  output_per_1m:10.00, enabled:true, custom:false },
  { id:'openai/gpt-4o-mini',         provider:'openai',    name:'GPT-4o Mini',         input_per_1m:0.15,  output_per_1m:0.60,  enabled:true, custom:false },
  { id:'openai/gpt-4-turbo',         provider:'openai',    name:'GPT-4 Turbo',         input_per_1m:10.00, output_per_1m:30.00, enabled:true, custom:false },
  { id:'openai/gpt-3.5-turbo',       provider:'openai',    name:'GPT-3.5 Turbo',       input_per_1m:0.50,  output_per_1m:1.50,  enabled:true, custom:false },
  { id:'openai/o1',                  provider:'openai',    name:'o1',                  input_per_1m:15.00, output_per_1m:60.00, enabled:true, custom:false },
  { id:'openai/o1-mini',             provider:'openai',    name:'o1-mini',             input_per_1m:3.00,  output_per_1m:12.00, enabled:true, custom:false },
  { id:'openai/o3-mini',             provider:'openai',    name:'o3-mini',             input_per_1m:1.10,  output_per_1m:4.40,  enabled:true, custom:false },
  // Anthropic
  { id:'anthropic/claude-opus-4-7',            provider:'anthropic', name:'Claude Opus 4.7',    input_per_1m:15.00, output_per_1m:75.00,  enabled:true, custom:false },
  { id:'anthropic/claude-sonnet-4-6',          provider:'anthropic', name:'Claude Sonnet 4.6',  input_per_1m:3.00,  output_per_1m:15.00,  enabled:true, custom:false },
  { id:'anthropic/claude-haiku-4-5',           provider:'anthropic', name:'Claude Haiku 4.5',   input_per_1m:0.25,  output_per_1m:1.25,   enabled:true, custom:false },
  { id:'anthropic/claude-3-5-sonnet-20241022', provider:'anthropic', name:'Claude 3.5 Sonnet',  input_per_1m:3.00,  output_per_1m:15.00,  enabled:true, custom:false },
  { id:'anthropic/claude-3-haiku-20240307',    provider:'anthropic', name:'Claude 3 Haiku',     input_per_1m:0.25,  output_per_1m:1.25,   enabled:true, custom:false },
  // Gemini
  { id:'gemini/gemini-2.0-flash',      provider:'gemini', name:'Gemini 2.0 Flash',      input_per_1m:0.10,  output_per_1m:0.40,  enabled:true, custom:false },
  { id:'gemini/gemini-1.5-pro',        provider:'gemini', name:'Gemini 1.5 Pro',        input_per_1m:1.25,  output_per_1m:5.00,  enabled:true, custom:false },
  { id:'gemini/gemini-1.5-flash',      provider:'gemini', name:'Gemini 1.5 Flash',      input_per_1m:0.075, output_per_1m:0.30,  enabled:true, custom:false },
  { id:'gemini/gemini-2.0-flash-lite', provider:'gemini', name:'Gemini 2.0 Flash Lite', input_per_1m:0.075, output_per_1m:0.30,  enabled:true, custom:false },
  // Ollama (free / local)
  { id:'ollama/llama3',    provider:'ollama', name:'Llama 3',    input_per_1m:0, output_per_1m:0, enabled:true, custom:false },
  { id:'ollama/mistral',   provider:'ollama', name:'Mistral',    input_per_1m:0, output_per_1m:0, enabled:true, custom:false },
  { id:'ollama/codellama', provider:'ollama', name:'Code Llama', input_per_1m:0, output_per_1m:0, enabled:true, custom:false },
  { id:'ollama/gemma2',    provider:'ollama', name:'Gemma 2',    input_per_1m:0, output_per_1m:0, enabled:true, custom:false },
  // Mock server (built-in, free)
  { id:'mock/echo-sm', provider:'mock', name:'Echo Small', input_per_1m:0, output_per_1m:0, enabled:true, custom:false },
  { id:'mock/echo-lg', provider:'mock', name:'Echo Large', input_per_1m:0, output_per_1m:0, enabled:true, custom:false },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const [search, setSearch]           = useState('')
  const [allModels, setAllModels]     = useState<ModelPricingEntry[]>([])
  const [gwProviders, setGwProviders] = useState<GatewayProviderInfo[]>([])
  const [savingFor, setSavingFor]     = useState<string | null>(null)
  const [savedFor, setSavedFor]       = useState<string | null>(null)

  useEffect(() => {
    fetchModelsConfig().then(data => {
      if (data.length === 0) {
        setAllModels(DEFAULT_MODELS)
        updateModelsConfig(DEFAULT_MODELS)
      } else {
        setAllModels(data)
      }
    })
    fetchGatewayProviders().then(setGwProviders)
  }, [])

  const instancesFor = (vendorId: string) =>
    vendorId === 'mock'
      ? gwProviders.filter(p => p.is_mock)
      : gwProviders.filter(p => p.kind === vendorId && !p.is_mock)

  const handleModelsChange = (provider: string, updated: ModelPricingEntry[]) => {
    setAllModels(prev => [
      ...prev.filter(m => m.provider !== provider),
      ...updated,
    ])
  }

  const handleSaveModels = async (provider: string, current: ModelPricingEntry[]) => {
    setSavingFor(provider)
    await updateModelsConfig(current)
    setSavingFor(null)
    setSavedFor(provider)
    setTimeout(() => setSavedFor(prev => prev === provider ? null : prev), 2500)
  }

  const filtered = VENDORS
    .filter(v =>
      !search || v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => instancesFor(b.id).length - instancesFor(a.id).length)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Providers</h1>
          <p className="text-sm t3 mt-1">{VENDORS.length} providers · auth, models, performance, rate limits &amp; headers</p>
        </div>
        <input
          className="glass-input rounded-xl px-3 py-2 text-xs w-48"
          placeholder="Search providers…"
          value={search}
          onChange={e => setSearch(e.target.value)}/>
      </div>

      <div className="space-y-2">
        {filtered.map(v => {
          const providerModels = allModels.filter(m => m.provider === v.id)
          const merged = [...allModels.filter(m => m.provider !== v.id), ...providerModels]
          return (
            <ProviderCard
              key={v.id}
              v={v}
              instances={instancesFor(v.id)}
              providerModels={providerModels}
              onModelsChange={updated => handleModelsChange(v.id, updated)}
              onSaveModels={() => handleSaveModels(v.id, merged)}
              savingModels={savingFor === v.id}
              savedModels={savedFor === v.id}
            />
          )
        })}
      </div>
    </div>
  )
}
