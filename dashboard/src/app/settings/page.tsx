'use client'
import { useState, useEffect } from 'react'
import { Database, Save, Eye, EyeOff, CheckCircle2, RefreshCw, HardDrive, Activity, Sun, Moon, Server, Palette, ScrollText, Copy, Check, DownloadCloud, ExternalLink, UploadCloud } from 'lucide-react'
import { McpIcon } from '@/components/Sidebar'
import { getGatewayBase } from '@/lib/config'
import GlassCard from '@/components/GlassCard'
import { fetchStorageStatus, fetchStorageConfig, updateStorageConfig, fetchCacheConfig, updateCacheConfig, fetchUpdateStatus, type UpdateStatus } from '@/lib/api'
import { useTheme, useFontSize, type FontSize } from '@/components/ThemeProvider'
import clsx from 'clsx'

/* ─── Toggle ─────────────────────────────────────────────────────────────── */
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

/* ─── Text input ─────────────────────────────────────────────────────────── */
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

/* Clipboard with insecure-context fallback */
async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { theme, toggle } = useTheme()
  const { fontSize, setFontSize } = useFontSize()
  const [saved,          setSaved]          = useState(false)
  const [cacheEnabled,   setCacheEnabled]   = useState(true)
  const [cacheTtl,       setCacheTtl]       = useState('3600')
  const [cacheMax,       setCacheMax]       = useState('10000')
  const [dbUrl,          setDbUrl]          = useState('sqlite://./gateway.db')
  const [storageStatus,  setStorageStatus]  = useState<any>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [logBodies,      setLogBodiesState] = useState(false)
  const [logBodiesLoading, setLogBodiesLoading] = useState(false)
  const [port,           setPort]           = useState('4891')
  const [globalTimeout,  setGlobalTimeout]  = useState('30000')
  const [logLevel,       setLogLevel]       = useState('info')
  const [metricsPort,    setMetricsPort]    = useState('9090')

  const [cacheLoading, setCacheLoading] = useState(false)
  const [mcpCopied, setMcpCopied] = useState(false)
  const [updStatus, setUpdStatus] = useState<UpdateStatus | null>(null)
  const [updChecking, setUpdChecking] = useState(false)
  const checkUpdates = async (force: boolean) => {
    setUpdChecking(true)
    setUpdStatus(await fetchUpdateStatus(force))
    setUpdChecking(false)
  }
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const handlePackageUpload = async (file: File) => {
    setUploading(true); setUploadMsg(null)
    try {
      const r = await fetch(`${getGatewayBase()}/updates/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
      })
      const d = await r.json()
      if (r.ok && d.staged) {
        setUploadMsg(`Staged ${d.staged.file} · ${(d.staged.size_bytes / 1_048_576).toFixed(1)} MB · sha256 ${d.staged.sha256.slice(0, 12)}…`)
        checkUpdates(false)
      } else {
        setUploadMsg(d.error ?? 'Upload failed')
      }
    } catch (e: any) { setUploadMsg(e?.message ?? 'Upload failed') }
    setUploading(false)
  }
  const mcpEndpoint = `${getGatewayBase()}/mcp`
  const copyMcpEndpoint = async () => {
    if (await copyText(mcpEndpoint)) { setMcpCopied(true); setTimeout(() => setMcpCopied(false), 1500) }
  }

  // Semantic cache
  const [semEnabled,   setSemEnabled]   = useState(true)
  const [semThreshold, setSemThreshold] = useState(0.85)
  const [semTtl,       setSemTtl]       = useState('3600')
  const [semMax,       setSemMax]       = useState('10000')
  const [semEntries,   setSemEntries]   = useState(0)
  const [semLoading,   setSemLoading]   = useState(false)
  const [semSaved,     setSemSaved]     = useState(false)

  const applySemConfig = (sem: any) => {
    if (!sem) return
    setSemEnabled(sem.enabled ?? true)
    setSemThreshold(sem.threshold ?? 0.85)
    setSemTtl(String(sem.ttl_seconds ?? 3600))
    setSemMax(String(sem.max_entries ?? 10000))
    setSemEntries(sem.entry_count ?? 0)
  }

  const handleSemToggle = async (val: boolean) => {
    setSemLoading(true)
    const result = await updateCacheConfig({ semantic: { enabled: val } })
    if (result?.semantic) applySemConfig(result.semantic)
    setSemLoading(false)
  }

  const handleSemSave = async () => {
    setSemLoading(true)
    const result = await updateCacheConfig({
      semantic: {
        threshold: semThreshold,
        ttl_seconds: parseInt(semTtl) || 3600,
        max_entries: parseInt(semMax) || 10000,
      },
    })
    if (result?.semantic) applySemConfig(result.semantic)
    setSemLoading(false)
    setSemSaved(true); setTimeout(() => setSemSaved(false), 2000)
  }

  const loadStorageStatus = async () => {
    setStorageLoading(true)
    const s = await fetchStorageStatus()
    setStorageStatus(s)
    setStorageLoading(false)
  }

  const handleLogBodiesToggle = async (val: boolean) => {
    setLogBodiesLoading(true)
    const result = await updateStorageConfig({ log_bodies: val })
    if (result) setLogBodiesState(result.log_bodies ?? val)
    setLogBodiesLoading(false)
  }

  const handleCacheToggle = async (val: boolean) => {
    setCacheLoading(true)
    const result = await updateCacheConfig({ enabled: val })
    if (result !== null) setCacheEnabled(result.enabled ?? val)
    setCacheLoading(false)
  }

  useEffect(() => {
    checkUpdates(false)
    loadStorageStatus()
    fetchStorageConfig().then(cfg => { if (cfg) setLogBodiesState(cfg.log_bodies ?? false) })
    fetchCacheConfig().then(cfg => {
      if (cfg) {
        setCacheEnabled(cfg.enabled ?? true)
        applySemConfig(cfg.semantic)
      }
    })
  }, [])

  const [saveError, setSaveError] = useState(false)
  const handleSave = async () => {
    setSaveError(false)
    // Persist the settings that have runtime config endpoints. (Server-level
    // fields such as port/log level require a restart and have no live endpoint.)
    const results = await Promise.all([
      updateCacheConfig({ enabled: cacheEnabled }),
      updateStorageConfig({ log_bodies: logBodies }),
    ])
    if (results.every(r => r !== null)) {
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } else {
      setSaveError(true); setTimeout(() => setSaveError(false), 3000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Settings</h1>
          <p className="text-sm t3 mt-1">Server, cache, storage and appearance</p>
        </div>
        <button onClick={handleSave}
          className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300',
            saved ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                  : saveError ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                  : 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25')}>
          {saved ? <><CheckCircle2 size={14}/>Saved</>
            : saveError ? <><Save size={14}/>Save failed</>
            : <><Save size={14}/>Save changes</>}
        </button>
      </div>

      {/* Server */}
      <GlassCard title="Server" subtitle="Host, port, and global defaults" icon={<Server size={15} className="text-indigo-400"/>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Port"                        value={port}          onChange={setPort}          placeholder="4891"/>
          <Input label="Global timeout (ms)"         value={globalTimeout} onChange={setGlobalTimeout} placeholder="30000"/>
          <div>
            <label className="text-xs t3 block mb-1.5">Log level</label>
            <select className="glass-input w-full rounded-xl px-3 py-2 text-sm" value={logLevel} onChange={e => setLogLevel(e.target.value)}>
              {['trace','debug','info','warn','error'].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <Input label="Metrics port (Prometheus)"   value={metricsPort}   onChange={setMetricsPort}   placeholder="9090"/>
        </div>
      </GlassCard>

      {/* Appearance */}
      <GlassCard title="Appearance" subtitle="Theme and display preferences" icon={<Palette size={15} className="text-cyan-400"/>}>
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm t1 font-medium">Theme</div>
              <div className="text-xs t3 mt-0.5">Switch between dark and light mode</div>
            </div>
            <div className="flex items-center gap-3">
              <Moon size={14} className="t3"/>
              <Toggle checked={theme === 'light'} onChange={toggle}/>
              <Sun size={14} className="text-amber-400"/>
            </div>
          </div>

          <div className="pt-4 border-t bd">
            <div className="text-sm t1 font-medium mb-1">Font size</div>
            <div className="text-xs t3 mb-3">Adjust the density of UI text</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'sm', label: 'Compact',     hint: 'Smaller text, more density' },
                { value: 'md', label: 'Medium',      hint: 'Balanced readability' },
                { value: 'lg', label: 'Comfortable', hint: 'Larger text, easier reading' },
              ] as { value: FontSize; label: string; hint: string }[]).map(opt => (
                <button key={opt.value}
                  onClick={() => setFontSize(opt.value)}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-center transition-all ring-1',
                    fontSize === opt.value
                      ? 'bg-indigo-500/15 ring-indigo-500/30 text-indigo-300'
                      : 'glass ring-transparent t3 hover:ring-white/10'
                  )}>
                  <span className={clsx('font-medium text-sm', fontSize === opt.value ? 'text-indigo-300' : 't2')}>{opt.label}</span>
                  <span className="text-[10px] t3">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Cache */}
      <GlassCard title="Cache" subtitle="Exact-match and semantic response caching" icon={<Database size={15} className="text-emerald-400"/>}>
        <div className="flex items-center justify-between mb-4 pb-3 border-b bd">
          <div className="flex items-center gap-2 text-sm t2">
            <Database size={14} className="text-cyan-400"/> Exact-match cache
            {cacheLoading && <span className="text-[10px] text-indigo-400 ml-1">Saving…</span>}
          </div>
          <Toggle checked={cacheEnabled} onChange={handleCacheToggle}/>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <Input label="TTL (seconds)"  value={cacheTtl} onChange={setCacheTtl} placeholder="3600"/>
          <Input label="Max entries"    value={cacheMax} onChange={setCacheMax} placeholder="10000"/>
        </div>
        {/* Semantic cache */}
        <div className="pt-4 mt-4 border-t bd">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-sm t2">
              <Activity size={14} className="text-indigo-400"/> Semantic cache
              {semLoading && <span className="text-[10px] text-indigo-400 ml-1">Saving…</span>}
              {semSaved && <span className="text-[10px] text-emerald-400 ml-1">Saved</span>}
            </div>
            <Toggle checked={semEnabled} onChange={handleSemToggle}/>
          </div>
          <p className="text-[10px] t4 mb-4">
            Local embeddings (256-dim feature hashing) match paraphrased prompts by cosine similarity —
            scoped to identical model, conversation context and sampling params, so similar questions in
            different contexts never cross-match. {semEntries > 0 && `${semEntries} entries cached.`}
          </p>

          <div className={clsx('space-y-4', !semEnabled && 'opacity-50 pointer-events-none')}>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs t3">Similarity threshold</label>
                <span className="text-xs font-mono t1">{semThreshold.toFixed(2)}</span>
              </div>
              <input type="range" min={0.5} max={0.99} step={0.01}
                value={semThreshold}
                onChange={e => setSemThreshold(parseFloat(e.target.value))}
                className="w-full accent-indigo-500"/>
              <div className="flex justify-between text-[9px] t4 mt-0.5">
                <span>0.50 — loose (more hits, riskier)</span>
                <span>0.99 — strict (near-exact only)</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="TTL (seconds)" value={semTtl} onChange={setSemTtl} placeholder="3600"/>
              <Input label="Max entries"   value={semMax} onChange={setSemMax} placeholder="10000"/>
            </div>
            <button onClick={handleSemSave}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
              <Save size={12}/> Apply semantic settings
            </button>
          </div>
        </div>
      </GlassCard>

      {/* MCP */}
      <GlassCard title="Gateway MCP endpoint" subtitle="Point any MCP client at this Streamable HTTP URL"
        icon={<McpIcon size={15} className="text-indigo-400"/>}>
        <div className="flex items-center gap-2">
          <code className="glass-input flex-1 rounded-xl px-3 py-2 text-xs font-mono">{mcpEndpoint}</code>
          <button onClick={copyMcpEndpoint}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
            {mcpCopied ? <Check size={12}/> : <Copy size={12}/>}
            {mcpCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-[10px] t4 mt-2">
          Tools from registered servers are namespaced <code className="font-mono">server__tool</code>.
          Manage servers on the MCP page.
        </p>
      </GlassCard>

      {/* Updates */}
      <GlassCard title="Updates" subtitle="Release channel — checks the update server for new gateway versions"
        icon={<DownloadCloud size={15} className="text-cyan-400"/>}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="text-sm t1">
              Current version: <span className="font-mono font-semibold">v{updStatus?.current_version ?? '…'}</span>
              {updStatus?.latest_version && !updStatus.update_available && (
                <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">Up to date</span>
              )}
            </div>
            {updStatus?.error && (
              <div className="text-[10px] t4">{updStatus.error}</div>
            )}
          </div>
          <button onClick={() => checkUpdates(true)} disabled={updChecking}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
            <RefreshCw size={12} className={updChecking ? 'animate-spin' : ''}/>
            {updChecking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {/* Air-gapped: stage a release package manually */}
        <div className="mt-4 pt-4 border-t bd">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs t2 font-medium flex items-center gap-1.5">
                <UploadCloud size={12} className="text-cyan-400"/> Air-gapped update
              </div>
              <p className="text-[10px] t4 mt-0.5">
                Upload a release package (.zip) to stage it on the gateway host — no internet required.
                Applying the staged package remains a manual operator step.
              </p>
              {uploadMsg && <p className="text-[10px] text-emerald-400 mt-1">{uploadMsg}</p>}
              {(updStatus as any)?.staged && !uploadMsg && (
                <p className="text-[10px] t3 mt-1 font-mono">
                  Staged: {(updStatus as any).staged.file} · {(((updStatus as any).staged.size_bytes) / 1_048_576).toFixed(1)} MB
                  {(updStatus as any).staged.version ? ` · v${(updStatus as any).staged.version}` : ''}
                </p>
              )}
            </div>
            <label className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30 hover:bg-cyan-500/20 transition-all cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <UploadCloud size={12}/>
              {uploading ? 'Uploading…' : 'Upload package'}
              <input type="file" accept=".zip" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePackageUpload(f); e.target.value = '' }}/>
            </label>
          </div>
        </div>

        {updStatus?.update_available && (
          <div className="banner-info mt-4 p-4 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
              <DownloadCloud size={14}/>
              Update available — v{updStatus.latest_version}
            </div>
            {updStatus.notes && <p className="text-xs t2 leading-relaxed">{updStatus.notes}</p>}
            <div className="flex items-center gap-3 text-[10px] t4">
              {updStatus.published_at && <span>Published {new Date(updStatus.published_at).toLocaleDateString()}</span>}
              {updStatus.url && (
                <a href={updStatus.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium">
                  Release notes <ExternalLink size={9}/>
                </a>
              )}
            </div>
          </div>
        )}
      </GlassCard>

      {/* Request Logging */}
      <GlassCard title="Request Logging" subtitle="What gets captured per request and how long it is kept" icon={<ScrollText size={15} className="text-amber-400"/>}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm t1 font-medium">Log request &amp; response bodies</div>
              <div className="text-xs t3 mt-0.5">
                Store full JSON payload in each log entry (increases DB size)
                {logBodiesLoading && <span className="ml-2 text-indigo-400">Saving…</span>}
              </div>
            </div>
            <Toggle checked={logBodies} onChange={handleLogBodiesToggle}/>
          </div>
          <div className="pt-3 border-t bd">
            <div className="text-xs t2 mb-2 font-medium">Retention period</div>
            <div className="flex items-center gap-3">
              <input type="number" min="0" defaultValue="30"
                className="glass-input rounded-xl px-3 py-2 text-sm w-24"/>
              <span className="text-xs t3">days &nbsp;·&nbsp; 0 = keep forever · requires gateway restart</span>
            </div>
          </div>
          <div className="px-3 py-2.5 rounded-xl text-[10px] t3"
            style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.15)' }}>
            Body logging takes effect immediately without a restart. Retention period requires setting
            <span className="text-indigo-400 font-mono mx-1">retention_days</span> in
            <code className="font-mono text-indigo-400 mx-1">gateway.toml → [storage]</code> and restarting.
          </div>
        </div>
      </GlassCard>

      {/* Storage */}
      <GlassCard title="Storage" subtitle="Request logging and analytics database" icon={<HardDrive size={15} className="text-indigo-400"/>}>
        <div className="mb-4">
          <label className="text-xs t3 block mb-2">Database backend</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'SQLite (default)', value: 'sqlite',   hint: 'Zero-config, single file — great for self-hosted' },
              { label: 'PostgreSQL',        value: 'postgres', hint: 'Recommended for production / multi-instance' },
            ].map(opt => {
              const active = dbUrl.startsWith(opt.value)
              return (
                <button key={opt.value}
                  onClick={() => setDbUrl(opt.value === 'sqlite' ? 'sqlite://./gateway.db' : 'postgres://user:pass@localhost/gateway')}
                  className={clsx(
                    'flex flex-col items-start gap-1 px-3 py-3 rounded-xl text-left transition-all ring-1',
                    active ? 'bg-indigo-500/10 ring-indigo-500/30 text-indigo-300'
                           : 'glass ring-transparent t3 hover:ring-white/10'
                  )}>
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <HardDrive size={11}/> {opt.label}
                  </div>
                  <div className="text-[10px] t4">{opt.hint}</div>
                </button>
              )
            })}
          </div>
        </div>

        <Input
          label="Database URL" value={dbUrl} onChange={setDbUrl}
          placeholder="sqlite://./gateway.db"
          hint='SQLite: "sqlite://./gateway.db" · PostgreSQL: "postgres://user:pass@host/db"'/>

        <div className="mt-4 pt-4 border-t bd">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs t2">
              <Activity size={12} className="text-indigo-400"/> Storage status
            </div>
            <button onClick={loadStorageStatus}
              className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
              <RefreshCw size={10} className={storageLoading ? 'animate-spin' : ''}/> Refresh
            </button>
          </div>
          {storageStatus ? (
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {[
                ['Backend',        storageStatus.backend],
                ['Total requests', storageStatus.total_requests?.toLocaleString() ?? '0'],
                ['DB size',        storageStatus.db_size_bytes != null
                  ? `${(storageStatus.db_size_bytes / 1024).toFixed(0)} KB` : 'N/A'],
                ['URL',            storageStatus.database_url_masked ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="glass rounded-lg px-3 py-2">
                  <div className="t4 mb-0.5">{k}</div>
                  <div className="t1 font-medium font-mono truncate">{v}</div>
                </div>
              ))}
            </div>
          ) : storageLoading ? (
            <div className="text-[10px] t3 animate-pulse py-2">Loading status…</div>
          ) : (
            <div className="text-[10px] t4 py-2">Gateway offline — start the gateway to see storage status</div>
          )}
        </div>
      </GlassCard>
    </div>
  )
}
