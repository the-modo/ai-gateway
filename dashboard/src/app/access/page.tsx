'use client'
import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  KeyRound, Plus, Copy, Check, Eye, EyeOff, Trash2, Clock,
  DollarSign, Zap, Shield, Activity, Globe, RefreshCw,
  AlertTriangle, Code2, Play, Terminal, FileText,
} from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import clsx from 'clsx'
import { getGatewayBase } from '@/lib/config'
import { fetchApiKeys, createApiKey, updateApiKey, deleteApiKey } from '@/lib/api'

/* vendor → models mapping — uses provider/model format */
const VENDOR_MODELS: Record<string, string[]> = {
  openai:    ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-3.5-turbo', 'openai/o1', 'openai/o3-mini'],
  anthropic: ['anthropic/claude-opus-4-7', 'anthropic/claude-sonnet-4-6', 'anthropic/claude-haiku-4-5'],
  gemini:    ['gemini/gemini-2.0-flash', 'gemini/gemini-1.5-pro', 'gemini/gemini-1.5-flash'],
}

const ALL_MODELS = Object.values(VENDOR_MODELS).flat()

/* ─── Canvas route loader ────────────────────────────────────────────────── */
interface CanvasRoute { id: string; label: string; enabled: boolean; isDefault: boolean; models: string[]; nodes: any[]; edges: any[] }

function loadCanvasRoutes(): CanvasRoute[] {
  if (typeof window === 'undefined') return []
  try {
    const s = localStorage.getItem('ai-gateway:routes')
    if (!s) return []
    return (JSON.parse(s) as any[]).map(r => {
      const vendorIds: string[] = (r.nodes ?? [])
        .filter((n: any) => n.type === 'provider')
        .map((n: any) => n.data?.vendorId as string)
        .filter(Boolean)
      const models = [...new Set(vendorIds.flatMap(v => VENDOR_MODELS[v] ?? []))]
      return {
        id:        r.id,
        label:     r.name ?? r.id,
        enabled:   r.enabled ?? true,
        isDefault: r.isDefault ?? false,
        models:    models.length > 0 ? models : ALL_MODELS,
        nodes:     r.nodes ?? [],
        edges:     r.edges ?? [],
      } satisfies CanvasRoute
    })
  } catch { return [] }
}

/* ─── Types ──────────────────────────────────────────────────────────────── */
type KeyStatus  = 'active' | 'expired' | 'revoked'
type RateWindow = 'minute' | 'hour' | 'day'
type SpendPeriod= 'day' | 'week' | 'month'
type Lifetime   = '24h' | '7d' | '30d' | '90d' | '1y' | 'never'

interface GatewayKey {
  id: string; name: string; description: string
  key: string; created: number; expiresAt: number | null
  rateEnabled: boolean; rateRequests: number; rateWindow: RateWindow
  spendEnabled: boolean; spendCapUsd: number; spendPeriod: SpendPeriod; spendUsed: number
  allowedModels: string[] | 'all'; allowedRoutes: string[] | 'all'; allowedMcpRoutes?: string[] | 'all'; allowedIPs: string[]
  totalRequests: number; totalSpendUsd: number; lastUsedAt: number | null
  status: KeyStatus
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const rnd = (chars: string, n: number) =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
const genKey  = () => `sk-gw-${rnd('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 48)}`
const mask    = (k: string) => `${k.slice(0, 10)}••••${k.slice(-4)}`
const fmt$    = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
const fmtAgo  = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`
}
const fmtExpiry = (ts: number | null) => {
  if (!ts) return 'Never'; const d = new Date(ts)
  return d < new Date() ? 'Expired' : d.toLocaleDateString()
}
const lifetimeToMs = (l: Lifetime): number | null => ({
  '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000,
  '90d': 7_776_000_000, '1y': 31_536_000_000, 'never': null,
}[l])


/* ─── Route SVG builder ──────────────────────────────────────────────────── */
function buildRouteSvg(nodes: any[], edges: any[]): string {
  if (!nodes || nodes.length === 0) return '<p style="color:#9ca3af;font-size:12px;font-style:italic">No diagram available.</p>'
  const NW: Record<string, number> = { request: 180, condition: 230, provider: 200, response: 160 }
  const NH: Record<string, number> = { request: 56, condition: 90, provider: 68, response: 56 }
  const COLORS: Record<string, { bg: string; border: string; text: string }> = {
    request:            { bg: '#eef2ff', border: '#818cf8', text: '#3730a3' },
    condition:          { bg: '#faf5ff', border: '#c084fc', text: '#6b21a8' },
    response:           { bg: '#ecfdf5', border: '#34d399', text: '#065f46' },
    'p:openai':         { bg: '#eff6ff', border: '#60a5fa', text: '#1e40af' },
    'p:anthropic':      { bg: '#fef3c7', border: '#fbbf24', text: '#92400e' },
    'p:gemini':         { bg: '#f0fdf4', border: '#4ade80', text: '#14532d' },
    'p:default':        { bg: '#f5f5f5', border: '#9ca3af', text: '#374151' },
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + (NW[n.type] ?? 180))
    maxY = Math.max(maxY, n.position.y + (NH[n.type] ?? 56))
  }
  const PAD = 28, rawW = maxX - minX + PAD * 2, rawH = maxY - minY + PAD * 2
  const scale = Math.min(1.0, 760 / rawW)
  const svgW = (rawW * scale).toFixed(1), svgH = (rawH * scale).toFixed(1)
  const tx = (x: number) => ((x - minX + PAD) * scale).toFixed(1)
  const ty = (y: number) => ((y - minY + PAD) * scale).toFixed(1)
  const ts = (v: number) => (v * scale).toFixed(1)
  const FL = Math.min(12, 11 * scale).toFixed(1), FS = Math.min(10, 9 * scale).toFixed(1)
  const R = (8 * scale).toFixed(1)
  let edgesSvg = ''
  for (const e of edges) {
    const sn = nodes.find((n: any) => n.id === e.source)
    const tn = nodes.find((n: any) => n.id === e.target)
    if (!sn || !tn) continue
    const sh = NH[sn.type] ?? 56, thv = NH[tn.type] ?? 56
    let x1 = parseFloat(tx(sn.position.x + (NW[sn.type] ?? 180)))
    let y1 = parseFloat(ty(sn.position.y + sh / 2))
    if (sn.type === 'condition') {
      if (e.sourceHandle === 'true')  y1 = parseFloat(ty(sn.position.y + sh * 0.71))
      if (e.sourceHandle === 'false') y1 = parseFloat(ty(sn.position.y + sh * 0.87))
    }
    const x2 = parseFloat(tx(tn.position.x)), y2 = parseFloat(ty(tn.position.y + thv / 2))
    const cx1 = x1 + (x2 - x1) * 0.4, cx2 = x2 - (x2 - x1) * 0.4
    const col = e.sourceHandle === 'true' ? '#10b981' : e.sourceHandle === 'false' ? '#ef4444' : '#6366f1'
    const mid = e.sourceHandle === 'true' ? 'arrT' : e.sourceHandle === 'false' ? 'arrF' : 'arrD'
    const dash = e.sourceHandle === 'false' ? `stroke-dasharray="${ts(5)},${ts(3)}"` : ''
    edgesSvg += `<path d="M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="${ts(1.8)}" ${dash} marker-end="url(#${mid})"/>`
    if (e.sourceHandle === 'true' || e.sourceHandle === 'false') {
      const lbl = e.sourceHandle === 'true' ? 'TRUE' : 'FALSE'
      const mx = ((x1 + x2) / 2).toFixed(1), my = ((y1 + y2) / 2 - parseFloat(ts(8))).toFixed(1)
      edgesSvg += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="${FS}" font-weight="800" fill="${col}">${lbl}</text>`
    }
  }
  let nodesSvg = ''
  for (const n of nodes) {
    const w = parseFloat(ts(NW[n.type] ?? 180)), h = parseFloat(ts(NH[n.type] ?? 56))
    const x = parseFloat(tx(n.position.x)), y = parseFloat(ty(n.position.y))
    let ck = n.type as string
    if (n.type === 'provider') ck = `p:${n.data?.vendorId ?? 'default'}`
    let colors = COLORS[ck] ?? COLORS['p:default']
    if (n.type === 'response' && n.data?.type === 'error') colors = { bg: '#fef2f2', border: '#f87171', text: '#991b1b' }
    nodesSvg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${R}" fill="${colors.bg}" stroke="${colors.border}" stroke-width="${ts(1.5)}"/>`
    let main = '', sub = ''
    if (n.type === 'request')   { main = 'Request'; sub = n.data?.description || '' }
    if (n.type === 'response')  { main = n.data?.type === 'success' ? '✓ Response' : '✕ Error' }
    if (n.type === 'condition') { main = 'IF Condition'; const c = n.data?.conditions?.[0]; sub = c ? (c.value ? `model starts_with "${c.value}"` : '') : '' }
    if (n.type === 'provider')  { const v = n.data?.vendorId ?? 'provider'; main = v.charAt(0).toUpperCase() + v.slice(1); sub = n.data?.name ?? '' }
    const cx = (x + w / 2).toFixed(1)
    if (sub) {
      nodesSvg += `<text x="${cx}" y="${(y + h / 2 - parseFloat(FL) * 0.55).toFixed(1)}" text-anchor="middle" font-size="${FL}" font-weight="700" fill="${colors.text}">${main}</text>`
      nodesSvg += `<text x="${cx}" y="${(y + h / 2 + parseFloat(FL) * 0.95).toFixed(1)}" text-anchor="middle" font-size="${FS}" fill="${colors.text}aa">${sub.length > 26 ? sub.slice(0, 26) + '…' : sub}</text>`
    } else {
      nodesSvg += `<text x="${cx}" y="${(y + h / 2 + parseFloat(FL) * 0.4).toFixed(1)}" text-anchor="middle" font-size="${FL}" font-weight="700" fill="${colors.text}">${main}</text>`
    }
  }
  return `<svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;border-radius:8px;background:#f9fafb;padding:4px;box-sizing:border-box">
    <defs>
      <marker id="arrD" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#6366f1"/></marker>
      <marker id="arrT" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#10b981"/></marker>
      <marker id="arrF" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#ef4444"/></marker>
    </defs>${edgesSvg}${nodesSvg}</svg>`
}

/* ─── PDF generator ──────────────────────────────────────────────────────── */
function buildPrintHtml(
  keyName: string,
  exampleKey: string,
  rules: CanvasRoute[],
  mcpRouteName: string | null = null,
): string {
  const routeSection = rules.length > 0
    ? rules.map(r => `
  <div style="margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="width:8px;height:8px;border-radius:50%;background:${r.enabled ? '#10b981' : '#9ca3af'};flex-shrink:0;display:inline-block"></span>
      <span style="font-weight:700;font-size:15px;color:#111827">${r.label}</span>
      ${r.isDefault ? '<span class="tag">default</span>' : ''}
    </div>
    ${buildRouteSvg(r.nodes, r.edges)}
  </div>`).join('<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>')
    : '<p style="opacity:.5;font-size:12px">No routes assigned — contact your administrator.</p>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Modo AI Gateway — ${keyName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 820px; margin: 0 auto; padding: 48px 40px; color: #111827; font-size: 13px; line-height: 1.65; }
  h1 { font-size: 26px; font-weight: 800; color: #4338ca; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 32px; border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; }
  h2 { font-size: 16px; font-weight: 700; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 32px 0 12px; }
  p { color: #374151; margin: 8px 0; }
  code { background: #f3f4f6; color: #4f46e5; padding: 1px 6px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace; font-size: 11px; }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; font-family: 'SF Mono', Consolas, monospace; font-size: 11px; overflow-x: auto; margin: 10px 0; line-height: 1.5; color: #374151; white-space: pre; }
  pre code { background: none; padding: 0; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
  thead th { text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; padding: 0 14px 8px 0; border-bottom: 1px solid #e5e7eb; }
  tbody td { padding: 8px 14px 8px 0; border-bottom: 1px solid #f3f4f6; color: #374151; vertical-align: top; }
  ul { padding-left: 18px; margin: 8px 0; }
  li { color: #374151; margin: 3px 0; }
  .key-badge { background: #ede9fe; color: #4338ca; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; font-family: monospace; word-break: break-all; }
  .tag { background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .print-btn { position: fixed; top: 16px; right: 16px; background: #4f46e5; color: white; border: none; padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(79,70,229,.3); }
  .print-btn:hover { background: #4338ca; }
  @media print { .print-btn { display: none; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Save as PDF</button>

<h1>Modo AI Gateway</h1>
<div class="meta">
  Developer Documentation &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString()}
  &nbsp;·&nbsp; Key: <span class="key-badge">${keyName}</span>
</div>

<h2>Overview</h2>
<p>Your Modo AI Gateway provides a unified, OpenAI-compatible API that routes requests to multiple AI providers with automatic fallback, caching, and rate limiting. Drop it into any OpenAI SDK by setting <code>baseURL</code>.</p>
<ul>
  <li><strong>Base URL:</strong> <code>${getGatewayBase()}</code></li>
  <li><strong>API Version:</strong> <code>/v1</code></li>
  <li><strong>Compatibility:</strong> OpenAI Chat Completions API</li>
</ul>

<h2>Authentication</h2>
<p>Include your API key in every request as a Bearer token:</p>
<pre>Authorization: Bearer ${exampleKey}</pre>

<h2>Routing Diagram</h2>
${routeSection}
<p style="font-size:11px;color:#6b7280;margin-top:8px">Configure routing logic in the <strong>Routing</strong> canvas of the Modo AI Gateway dashboard.</p>

${mcpRouteName ? `<h2>MCP Access</h2>
<p>This key has access to: <strong>${mcpRouteName}</strong></p>
<p>Connect any MCP client (Streamable HTTP) to the unified endpoint:</p>
<pre>${getGatewayBase()}/mcp</pre>
<p style="font-size:11px;color:#6b7280">Tools are namespaced <code>server__tool</code>. Every call passes the gateway's guardrails and content shield.</p>` : ''}

<h2>Example Request</h2>
<pre>curl -X POST "${getGatewayBase()}/v1/chat/completions" \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Hello!" }
    ]
  }'</pre>

<p style="margin-top:40px;font-size:11px;color:#9ca3af">Generated by Modo AI Gateway Access · ${new Date().toISOString().split('T')[0]}</p>
</body>
</html>`
}

/* ─── Micro components ───────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={clsx('relative w-9 h-[20px] rounded-full flex-shrink-0 transition-all duration-300',
        checked ? 'bg-indigo-500' : 'bg-[var(--glass-border)]')}>
      <span className={clsx('absolute top-[2px] w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300',
        checked ? 'left-[19px]' : 'left-[2px]')}/>
    </button>
  )
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

function StatusBadge({ status }: { status: KeyStatus }) {
  const map = {
    active:  'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20',
    expired: 'text-amber-400 bg-amber-500/10 ring-amber-500/20',
    revoked: 'text-red-400 bg-red-500/10 ring-red-500/20',
  }
  return <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-medium ring-1', map[status])}>{status}</span>
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={clsx('px-3 py-1 rounded-lg text-xs transition-all',
        active ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30' : 'glass t3 hover:t2')}>
      {children}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   KEYS SECTION
═══════════════════════════════════════════════════════════════════════════ */
function KeysSection({ keys, setKeys, canvasRoutes, keysLoading }: { keys: GatewayKey[]; setKeys: React.Dispatch<React.SetStateAction<GatewayKey[]>>; canvasRoutes: CanvasRoute[]; keysLoading: boolean }) {
  const [showCreate, setShowCreate]   = useState(false)
  const [revealed, setRevealed]       = useState<Set<string>>(new Set())
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [confirmId, setConfirmId]     = useState<string | null>(null)
  const [confirmType, setConfirmType] = useState<'revoke' | 'delete' | null>(null)

  const [newName, setNewName]               = useState('')
  const [newDesc, setNewDesc]               = useState('')
  const [newLifetime, setNewLifetime]       = useState<Lifetime>('30d')
  const [newRateEnabled, setNewRateEnabled] = useState(true)
  const [newRate, setNewRate]               = useState(60)
  const [newRateWin, setNewRateWin]         = useState<RateWindow>('minute')
  const [newSpendEnabled, setNewSpendEnabled] = useState(false)
  const [newSpendCap, setNewSpendCap]       = useState(100)
  const [newSpendPeriod, setNewSpendPeriod] = useState<SpendPeriod>('month')
  const [newIPs, setNewIPs]                 = useState('')
  const [newRouteId,    setNewRouteId]      = useState<string>('')
  const [newMcpRouteId, setNewMcpRouteId]    = useState<string>('')
  const [mcpRoutes, setMcpRoutes]            = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    try {
      const s = localStorage.getItem('ai-gateway:mcp-routes')
      if (s) setMcpRoutes((JSON.parse(s) as any[]).map(r => ({ id: r.id, name: r.name })))
    } catch {}
  }, [])

  const totalActive = keys.filter(k => k.status === 'active').length
  const totalSpend  = keys.reduce((a, k) => a + k.totalSpendUsd, 0)
  const totalReqs   = keys.reduce((a, k) => a + k.totalRequests, 0)

  const createKey = () => {
    if (!newName.trim()) return
    const dur = lifetimeToMs(newLifetime)
    const k: GatewayKey = {
      id: `k${Date.now()}`, name: newName.trim(), description: newDesc.trim(),
      key: genKey(), created: Date.now(), expiresAt: dur ? Date.now() + dur : null,
      rateEnabled: newRateEnabled, rateRequests: newRate, rateWindow: newRateWin,
      spendEnabled: newSpendEnabled, spendCapUsd: newSpendCap, spendPeriod: newSpendPeriod, spendUsed: 0,
      allowedModels: 'all',
      allowedRoutes: newRouteId ? [newRouteId] : 'all',
      allowedMcpRoutes: newMcpRouteId ? [newMcpRouteId] : 'all',
      allowedIPs: newIPs.split(',').map(s => s.trim()).filter(Boolean),
      totalRequests: 0, totalSpendUsd: 0, lastUsedAt: null, status: 'active',
    }
    setKeys(prev => [k, ...prev])
    createApiKey(k).catch(() => {})
    setNewName(''); setNewDesc(''); setNewIPs(''); setShowCreate(false)
    setNewRouteId('')
  }

  const requestConfirm = (id: string, type: 'revoke' | 'delete') => {
    setConfirmId(id); setConfirmType(type)
    setTimeout(() => { setConfirmId(null); setConfirmType(null) }, 3000)
  }

  const revokeKey = (id: string) => {
    const k = keys.find(x => x.id === id)
    if (!k) return
    const updated = { ...k, status: 'revoked' as const }
    setKeys(prev => prev.map(x => x.id === id ? updated : x))
    updateApiKey(id, updated).catch(() => {})
    setConfirmId(null); setConfirmType(null)
  }

  const deleteKey = (id: string) => {
    setKeys(prev => prev.filter(x => x.id !== id))
    deleteApiKey(id).catch(() => {})
    setConfirmId(null); setConfirmType(null)
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label:'Active keys',    value:String(totalActive),             sub:`${keys.length} total`,           color:'text-indigo-400', glow:'rgba(99,102,241,0.12)',  icon:<KeyRound size={14}/> },
          { label:'Total requests', value:totalReqs.toLocaleString(),      sub:'all time',                       color:'text-cyan-400',   glow:'rgba(34,211,238,0.12)',  icon:<Activity size={14}/> },
          { label:'Total spend',    value:fmt$(totalSpend),                sub:'across all keys',                color:'text-emerald-400',glow:'rgba(16,185,129,0.12)', icon:<DollarSign size={14}/> },
          { label:'Rate limited',   value:String(keys.filter(k=>k.rateEnabled && k.status==='active').length), sub:'keys with limits', color:'text-amber-400', glow:'rgba(245,158,11,0.12)', icon:<Shield size={14}/> },
        ].map(s => (
          <div key={s.label} className="glass rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs t3">{s.label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: s.glow }}>
                <span className={s.color}>{s.icon}</span>
              </div>
            </div>
            <div className="text-xl font-bold t1">{s.value}</div>
            <div className="text-[10px] t3">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Keys table */}
      <GlassCard title="API Keys" subtitle="Gateway access keys with rate limits, spend caps, and TTL auto-revoke"
        action={
          <button onClick={() => setShowCreate(o => !o)}
            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-xs">
            <Plus size={12}/> New key
          </button>
        } noPad>

        {showCreate && (
          <div className="px-5 py-4 border-b bd bg-white/[0.02] space-y-4">
            <div className="text-xs font-semibold t1">Create new key</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] t3 block mb-1.5">Key name <span className="text-red-400">*</span></label>
                <input className="glass-input w-full rounded-xl px-3 py-2 text-xs"
                  placeholder="e.g. Production Backend" value={newName} onChange={e => setNewName(e.target.value)}/>
              </div>
              <div>
                <label className="text-[10px] t3 block mb-1.5">Description</label>
                <input className="glass-input w-full rounded-xl px-3 py-2 text-xs"
                  placeholder="Optional note" value={newDesc} onChange={e => setNewDesc(e.target.value)}/>
              </div>
            </div>

            {/* Lifetime */}
            <div>
              <label className="text-[10px] t3 block mb-1.5 flex items-center gap-1"><Clock size={10}/>Key lifetime (auto-revoked on expiry)</label>
              <div className="flex flex-wrap gap-1.5">
                {(['24h','7d','30d','90d','1y','never'] as Lifetime[]).map(l => (
                  <ModeBtn key={l} active={newLifetime === l} onClick={() => setNewLifetime(l)}>
                    {l === 'never' ? 'Never expires' : l}
                  </ModeBtn>
                ))}
              </div>
            </div>

            {/* Rate + Spend */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-xl px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium t2 flex items-center gap-1.5"><Zap size={11} className="text-amber-400"/>Rate limiting</span>
                  <Toggle checked={newRateEnabled} onChange={setNewRateEnabled}/>
                </div>
                {newRateEnabled && (
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} value={newRate} onChange={e => setNewRate(+e.target.value)}
                      className="glass-input w-20 rounded-lg px-2 py-1.5 text-xs text-center"/>
                    <span className="text-[10px] t3">requests per</span>
                    <select value={newRateWin} onChange={e => setNewRateWin(e.target.value as RateWindow)}
                      className="glass-input rounded-lg px-2 py-1.5 text-xs">
                      <option value="minute">minute</option>
                      <option value="hour">hour</option>
                      <option value="day">day</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="glass rounded-xl px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium t2 flex items-center gap-1.5"><DollarSign size={11} className="text-emerald-400"/>Spend cap</span>
                  <Toggle checked={newSpendEnabled} onChange={setNewSpendEnabled}/>
                </div>
                {newSpendEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] t3">$</span>
                    <input type="number" min={1} value={newSpendCap} onChange={e => setNewSpendCap(+e.target.value)}
                      className="glass-input w-20 rounded-lg px-2 py-1.5 text-xs text-center"/>
                    <span className="text-[10px] t3">per</span>
                    <select value={newSpendPeriod} onChange={e => setNewSpendPeriod(e.target.value as SpendPeriod)}
                      className="glass-input rounded-lg px-2 py-1.5 text-xs">
                      <option value="day">day</option>
                      <option value="week">week</option>
                      <option value="month">month</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* IP allowlist */}
            <div>
              <label className="text-[10px] t3 block mb-1.5 flex items-center gap-1">
                <Globe size={10}/>IP allowlist <span className="t4 ml-1">(comma-separated CIDRs; empty = allow all)</span>
              </label>
              <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"
                placeholder="192.168.1.0/24, 10.0.0.1" value={newIPs} onChange={e => setNewIPs(e.target.value)}/>
            </div>

            {/* Route */}
            <div>
              <label className="text-[10px] t3 block mb-1.5">Route</label>
              {canvasRoutes.length === 0
                ? <p className="text-[10px] t4">No routes found — visit the Routing page to create routes.</p>
                : <select value={newRouteId} onChange={e => setNewRouteId(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs">
                    <option value="">Default route</option>
                    {canvasRoutes.filter(r => !r.isDefault).map(r => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
              }
            </div>

            {/* MCP route */}
            <div>
              <label className="text-[10px] t3 block mb-1.5">MCP route access</label>
              {mcpRoutes.length === 0
                ? <p className="text-[10px] t4">No MCP routes found — create them on the Routing page.</p>
                : <select value={newMcpRouteId} onChange={e => setNewMcpRouteId(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs">
                    <option value="">All MCP routes</option>
                    {mcpRoutes.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
              }
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="glass px-3 py-1.5 rounded-xl text-xs t2 hover:t1 transition-colors">Cancel</button>
              <button onClick={createKey} disabled={!newName.trim()}
                className="bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 rounded-xl px-4 py-1.5 text-xs font-medium hover:bg-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                Generate key
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
        <div className="grid grid-cols-[minmax(140px,260px)_160px_120px_130px_90px_80px_72px] gap-3 px-5 py-2.5 border-b bd text-[10px] uppercase tracking-wider t3 font-medium min-w-[880px]">
          <span>Name</span><span>Key</span><span>Rate limit</span><span>Spend cap</span><span>Usage</span><span>Expires</span><span>Status</span>
        </div>

        {keysLoading && (
          <div className="flex items-center justify-center py-16 t4 text-xs gap-2">
            <RefreshCw size={13} className="animate-spin text-indigo-400"/>Loading keys…
          </div>
        )}

        {!keysLoading && keys.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 t4">
            <KeyRound size={28} className="mb-3 opacity-30"/>
            <div className="text-sm font-medium t3 mb-1">No API keys yet</div>
            <div className="text-xs t4 mb-4">Create a key to start authenticating requests</div>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
              <Plus size={12}/> Create first key
            </button>
          </div>
        )}

        {keys.map(k => {
          const isExpanded = expandedKey === k.id
          const spendPct = k.spendEnabled && k.spendCapUsd > 0 ? (k.spendUsed / k.spendCapUsd) * 100 : null
          return (
            <div key={k.id}>
              <div onClick={() => setExpandedKey(isExpanded ? null : k.id)}
                className={clsx('row-hover grid grid-cols-[minmax(140px,260px)_160px_120px_130px_90px_80px_72px] gap-3 px-5 py-3 border-b bd last:border-0 text-xs items-center cursor-pointer min-w-[880px]',
                  k.status !== 'active' && 'opacity-50')}>
                <div>
                  <div className="font-medium t1 text-[11px]">{k.name}</div>
                  <div className="text-[9px] t4 mt-0.5">{k.description}</div>
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-[10px] t2 truncate">
                    {revealed.has(k.id) ? k.key.slice(0, 20) + '…' : mask(k.key)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <button onClick={e => { e.stopPropagation(); setRevealed(s => { const n = new Set(s); n.has(k.id) ? n.delete(k.id) : n.add(k.id); return n }) }}
                      className="t4 hover:t1 transition-colors flex-shrink-0">
                      {revealed.has(k.id) ? <EyeOff size={9}/> : <Eye size={9}/>}
                    </button>
                    <span onClick={e => e.stopPropagation()}><CopyBtn text={k.key}/></span>
                  </div>
                </div>
                <span className="t2 text-[11px]">
                  {k.rateEnabled ? `${k.rateRequests}/${k.rateWindow}` : <span className="t4">Unlimited</span>}
                </span>
                <div>
                  {k.spendEnabled
                    ? <><span className="t2">{fmt$(k.spendUsed)} / {fmt$(k.spendCapUsd)}</span>
                        <div className="mt-1 h-1 rounded-full bg-[var(--glass-border)] overflow-hidden w-24">
                          <div className={clsx('h-full rounded-full transition-all', (spendPct ?? 0) > 90 ? 'bg-red-400' : 'bg-emerald-400')}
                            style={{ width:`${Math.min(100, spendPct ?? 0)}%` }}/>
                        </div></>
                    : <span className="t4">Unlimited</span>}
                </div>
                <div>
                  <div className="t2">{k.totalRequests.toLocaleString()} reqs</div>
                  <div className="text-[9px] t4">{fmt$(k.totalSpendUsd)}</div>
                </div>
                <span className={clsx('text-[11px]', k.expiresAt && k.expiresAt < Date.now() ? 'text-red-400' : 't2')}>
                  {fmtExpiry(k.expiresAt)}
                </span>
                <StatusBadge status={k.status}/>
              </div>
              {isExpanded && (
                <div className="px-5 py-3 bg-white/[0.02] border-b bd grid grid-cols-3 gap-4 text-[11px]">
                  <div className="space-y-1.5">
                    <div className="text-[10px] t4 uppercase tracking-wide font-medium">Details</div>
                    {[['Created', fmtAgo(k.created)], ['Last used', k.lastUsedAt ? fmtAgo(k.lastUsedAt) : 'Never'], ['Key ID', k.id]].map(([l,v]) => (
                      <div key={l} className="flex justify-between"><span className="t3">{l}</span><span className="t1 font-mono text-[10px]">{v}</span></div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[10px] t4 uppercase tracking-wide font-medium">Access control</div>
                    <div className="flex justify-between"><span className="t3">Routes</span><span className="t1">{Array.isArray(k.allowedRoutes) ? `${k.allowedRoutes.length} selected` : 'All'}</span></div>
                    <div className="flex justify-between"><span className="t3">MCP routes</span><span className="t1">{Array.isArray(k.allowedMcpRoutes) ? `${k.allowedMcpRoutes.length} selected` : 'All'}</span></div>
                    <div className="flex justify-between"><span className="t3">Models</span><span className="t1">{Array.isArray(k.allowedModels) ? `${k.allowedModels.length} selected` : 'All'}</span></div>
                    <div className="flex justify-between"><span className="t3">IP allowlist</span><span className="t1">{k.allowedIPs.length > 0 ? k.allowedIPs.join(', ') : 'Any IP'}</span></div>
                  </div>
                  <div className="flex items-start justify-end gap-2 flex-wrap">
                    <CopyBtn text={k.key} className="glass px-2.5 py-1 rounded-lg hover:t1"/>
                    <button onClick={() => openKeyDocs(k, canvasRoutes)} title="Download developer documentation for this key"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-indigo-400 bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20 transition-all">
                      <FileText size={10}/> Download Docs
                    </button>
                    {k.status === 'active' && (
                      confirmId === k.id && confirmType === 'revoke'
                        ? <button onClick={() => revokeKey(k.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-white bg-red-500/70 ring-1 ring-red-500/50 transition-all">
                            <AlertTriangle size={10}/> Confirm revoke?
                          </button>
                        : <button onClick={() => requestConfirm(k.id, 'revoke')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-red-400 bg-red-500/10 ring-1 ring-red-500/20 hover:bg-red-500/20 transition-all">
                            <Trash2 size={10}/> Revoke
                          </button>
                    )}
                    {k.status !== 'active' && (
                      confirmId === k.id && confirmType === 'delete'
                        ? <button onClick={() => deleteKey(k.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-white bg-red-500/70 ring-1 ring-red-500/50 transition-all">
                            <AlertTriangle size={10}/> Confirm delete?
                          </button>
                        : <button onClick={() => requestConfirm(k.id, 'delete')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-red-400 bg-red-500/10 ring-1 ring-red-500/20 hover:bg-red-500/20 transition-all">
                            <Trash2 size={10}/> Delete
                          </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        </div>{/* /overflow-x-auto */}
      </GlassCard>
    </div>
  )
}

/* ─── Per-key doc PDF helper ─────────────────────────────────────────────── */
function openKeyDocs(k: GatewayKey, canvasRoutes: CanvasRoute[]) {
  // Exactly one diagram: the key's assigned route, or the default route.
  const assigned = k.allowedRoutes === 'all'
    ? (canvasRoutes.find(r => r.isDefault) ?? canvasRoutes[0])
    : canvasRoutes.find(r => (k.allowedRoutes as string[]).includes(r.id))
  let mcpRouteName: string | null = null
  if (Array.isArray(k.allowedMcpRoutes) && k.allowedMcpRoutes.length > 0) {
    try {
      const s = localStorage.getItem('ai-gateway:mcp-routes')
      const all = s ? (JSON.parse(s) as any[]) : []
      mcpRouteName = all.find(r => r.id === k.allowedMcpRoutes![0])?.name ?? k.allowedMcpRoutes[0]
    } catch { mcpRouteName = k.allowedMcpRoutes[0] }
  } else if (k.allowedMcpRoutes === 'all' || k.allowedMcpRoutes === undefined) {
    mcpRouteName = 'All MCP routes'
  }
  const win = window.open('', '_blank', 'width=960,height=760')
  if (!win) return
  win.document.write(buildPrintHtml(k.name, k.key, assigned ? [assigned] : [], mcpRouteName))
  win.document.close()
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRY THE API SECTION
═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════════════════════ */
export default function AccessPage() {
  const [keys, setKeys]           = useState<GatewayKey[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [canvasRoutes, setCanvasRoutes] = useState<CanvasRoute[]>([])

  useEffect(() => {
    setCanvasRoutes(loadCanvasRoutes())
    fetchApiKeys().then(data => {
      setKeys(data as GatewayKey[])
      setKeysLoading(false)
    }).catch(() => setKeysLoading(false))
    const interval = setInterval(() => {
      setKeys(prev => prev.map(k => ({
        ...k,
        status: (k.status === 'active' && k.expiresAt && k.expiresAt < Date.now()) ? 'expired' : k.status,
      })))
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Access</h1>
        <p className="text-sm t3 mt-1">API keys, rate limits, spend caps, and auto-generated docs</p>
      </div>

      <KeysSection keys={keys} setKeys={setKeys} canvasRoutes={canvasRoutes} keysLoading={keysLoading}/>
    </div>
  )
}
