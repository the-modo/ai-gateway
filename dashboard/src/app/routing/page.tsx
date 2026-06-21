'use client'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import {
  Plus, Trash2, KeyRound,
  GitBranch, ChevronRight, X, ShieldAlert, Lock,
  Plug, Gauge,
} from 'lucide-react'
import clsx from 'clsx'
import { VENDORS } from '@/lib/vendors'
import { McpIcon } from '@/components/Sidebar'
import { fetchRoutes, saveRoutes as saveRoutesApi, fetchMcpRoutes, saveMcpRoutes as saveMcpRoutesApi } from '@/lib/api'

/* ─── Dynamic canvas import ──────────────────────────────────────────────── */
const McpRoutingCanvas = dynamic(() => import('@/components/McpRoutingCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[calc(100vh-80px)]">
      <div className="glass rounded-2xl px-8 py-6 t2 text-sm">Loading canvas…</div>
    </div>
  ),
})

const RoutingCanvas = dynamic(() => import('@/components/RoutingCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[calc(100vh-80px)]">
      <div className="glass rounded-2xl px-8 py-6 t2 text-sm">Loading canvas…</div>
    </div>
  ),
})

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface RouteNode { id: string; type: string; data: any; position: { x: number; y: number } }
interface RouteConfig {
  id: string; name: string; enabled: boolean; isDefault: boolean
  nodes: RouteNode[]; edges: any[]
}

/* ─── Storage helpers ────────────────────────────────────────────────────── */
const LS_ROUTES = 'ai-gateway:routes'
const LS_KEYS   = 'ai-gateway:api-keys'

const SEED_ROUTE: RouteConfig = {
  id: 'default', name: 'Default Route', enabled: true, isDefault: true,
  nodes: [
    { id: 'req-d', type: 'request',  position: { x: 40,  y: 200 }, data: { description: 'All incoming traffic' } },
    { id: 'cnd-d', type: 'condition', position: { x: 260, y: 155 }, data: { combine: 'OR', conditions: [
      { id: 'c1', expr: 'payload.getProvider()', op: 'equals', value: 'openai' },
    ]} },
    { id: 'oai-d', type: 'provider', position: { x: 555, y: 60  }, data: { vendorId: 'openai',    name: 'openai-primary',    weight: 100, modelExpr: 'payload.getModel()' } },
    { id: 'ant-d', type: 'provider', position: { x: 555, y: 290 }, data: { vendorId: 'anthropic', name: 'anthropic-primary', weight: 100, modelExpr: 'payload.getModel()' } },
    { id: 'res-d', type: 'response', position: { x: 840, y: 200 }, data: { type: 'success', headers: [], payload: [] } },
  ],
  edges: [
    { id: 'e1', source: 'req-d', target: 'cnd-d' },
    { id: 'e2', source: 'cnd-d', target: 'oai-d', sourceHandle: 'true' },
    { id: 'e3', source: 'cnd-d', target: 'ant-d', sourceHandle: 'false' },
    { id: 'e4', source: 'oai-d', target: 'res-d' },
    { id: 'e5', source: 'ant-d', target: 'res-d' },
  ],
}

// Server-backed (issue #20). Falls back to the localStorage seed on first
// load so users with existing routes still see them; on the next save the
// blob lands on the gateway and the LS copy goes stale.
async function loadRoutes(): Promise<RouteConfig[]> {
  const server = await fetchRoutes()
  if (Array.isArray(server) && server.length > 0) return server
  if (typeof window !== 'undefined') {
    try {
      const s = localStorage.getItem(LS_ROUTES)
      if (s) {
        const local = JSON.parse(s) as RouteConfig[]
        if (Array.isArray(local) && local.length > 0) {
          // Migrate the local-only routes up to the gateway, then keep them.
          await saveRoutesApi(local)
          return local
        }
      }
    } catch {}
  }
  return [SEED_ROUTE]
}

async function saveRoutes(routes: RouteConfig[]) {
  await saveRoutesApi(routes)
  // Drop the stale LS copy so we never silently fall back to it again.
  try { localStorage.removeItem(LS_ROUTES) } catch {}
}

/* ─── MCP route storage ──────────────────────────────────────────────────── */
interface McpRouteConfig { id: string; name: string; enabled: boolean; nodes: any[]; edges: any[] }
const LS_MCP_ROUTES = 'ai-gateway:mcp-routes'

const SEED_MCP_ROUTE: McpRouteConfig = {
  id: 'mcp-default', name: 'Default MCP Route', enabled: true,
  nodes: [
    { id: 'mreq-d', type: 'mcpRequest', position: { x: 40,  y: 200 }, data: {} },
    { id: 'mall-d', type: 'mcpServer',  position: { x: 330, y: 185 }, data: { serverId: '*', name: 'MCP', url: '', tools: [] } },
    { id: 'mres-d', type: 'response',   position: { x: 640, y: 200 }, data: { type: 'success' } },
  ],
  edges: [
    { id: 'me1', source: 'mreq-d', target: 'mall-d', targetHandle: 'in__all',  animated: true, style: { strokeWidth: 1.8 } },
    { id: 'me2', source: 'mall-d', sourceHandle: 'out__all', target: 'mres-d', animated: true, style: { strokeWidth: 1.8 } },
  ],
}

async function loadMcpRoutesLS(): Promise<McpRouteConfig[]> {
  const server = await fetchMcpRoutes()
  if (Array.isArray(server) && server.length > 0) return server
  if (typeof window !== 'undefined') {
    try {
      const s = localStorage.getItem(LS_MCP_ROUTES)
      if (s) {
        const local = JSON.parse(s) as McpRouteConfig[]
        if (Array.isArray(local) && local.length > 0) {
          await saveMcpRoutesApi(local)
          return local
        }
      }
    } catch {}
  }
  return [SEED_MCP_ROUTE]
}
async function saveMcpRoutesLS(routes: McpRouteConfig[]) {
  await saveMcpRoutesApi(routes)
  try { localStorage.removeItem(LS_MCP_ROUTES) } catch {}
}

function loadKeyCounts(): Map<string, number> {
  if (typeof window === 'undefined') return new Map()
  try {
    const s = localStorage.getItem(LS_KEYS)
    if (!s) return new Map()
    const keys = JSON.parse(s) as any[]
    const counts = new Map<string, number>()
    for (const k of keys) {
      if (k.allowedRoutes === 'all') continue
      const routes = Array.isArray(k.allowedRoutes) ? k.allowedRoutes : [k.allowedRoutes]
      for (const rid of routes) {
        counts.set(rid, (counts.get(rid) ?? 0) + 1)
      }
    }
    return counts
  } catch { return new Map() }
}

/* ─── Route card ─────────────────────────────────────────────────────────── */
function RouteCard({ route, keyCount, onClick, onDelete }: {
  route: RouteConfig; keyCount: number
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const providerNodes  = route.nodes.filter(n => n.type === 'provider')
  const conditionNodes = route.nodes.filter(n => n.type === 'condition')
  const guardrailNodes = route.nodes.filter(n => n.type === 'guardrail')
  const shieldNodes    = route.nodes.filter(n => n.type === 'contentShield')

  return (
    <div
      onClick={onClick}
      className="relative rounded-2xl p-5 cursor-pointer group transition-all duration-300 overflow-hidden select-none"
      style={{
        background: 'linear-gradient(145deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 60%, rgba(99,102,241,0.04) 100%)',
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.15)',
      }}>

      {/* Hover shimmer overlay */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
        style={{ background: 'linear-gradient(145deg, rgba(99,102,241,0.07) 0%, rgba(34,211,238,0.04) 100%)' }}/>

      {/* Content */}
      <div className="relative">
        {/* Title row */}
        <div className="flex items-center gap-2.5 mb-3">
          <span className="font-semibold t1 flex-1 text-sm leading-tight">{route.name}</span>
          {route.isDefault && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
              style={{ background:'rgba(99,102,241,0.15)', color:'#a5b4fc', border:'1px solid rgba(99,102,241,0.25)' }}>
              default
            </span>
          )}
          <ChevronRight size={14} className="t4 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all duration-200 flex-shrink-0"/>
        </div>

        {/* Provider badges */}
        {providerNodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {providerNodes.slice(0, 5).map(n => {
              const vendor = VENDORS.find(v => v.id === n.data?.vendorId)
              if (!vendor) return null
              return (
                <div key={n.id} className="flex items-center gap-1 px-2 py-1 rounded-xl text-[9px] font-medium"
                  style={{ background: vendor.bg, border: `1px solid ${vendor.ring}`, color: vendor.color }}>
                  <img src={vendor.icon} alt={vendor.name} width={10} height={10} className="object-contain flex-shrink-0"/>
                  {vendor.name}
                </div>
              )
            })}
            {providerNodes.length > 5 && (
              <div className="flex items-center px-2 py-1 rounded-xl text-[9px] t4"
                style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
                +{providerNodes.length - 5}
              </div>
            )}
          </div>
        )}

        {/* Guardrail / Content Shield badges */}
        {(guardrailNodes.length > 0 || shieldNodes.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {guardrailNodes.map(n => (
              <div key={n.id} className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-medium"
                style={{ background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171' }}>
                <ShieldAlert size={8}/>{n.data?.label || 'Guardrail'}
              </div>
            ))}
            {shieldNodes.map(n => (
              <div key={n.id} className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-medium"
                style={{ background:'rgba(99,102,241,0.10)', border:'1px solid rgba(99,102,241,0.22)', color:'#a5b4fc' }}>
                <Lock size={8}/>{n.data?.label || 'Content Shield'}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 text-[10px] t3 mb-4">
          <span className="flex items-center gap-1"><KeyRound size={9}/>{keyCount} key{keyCount !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1"><GitBranch size={9}/>{providerNodes.length} provider{providerNodes.length !== 1 ? 's' : ''}</span>
          {conditionNodes.length > 0 && (
            <span className="flex items-center gap-1"><GitBranch size={9}/>{conditionNodes.length} condition{conditionNodes.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Bottom bar — only shown for non-default routes (delete button) */}
        {!route.isDefault && (
          <div className="flex items-center justify-end pt-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <button
              onClick={e => { e.stopPropagation(); onDelete(e) }}
              className="p-1.5 rounded-lg t4 hover:text-red-400 hover:bg-red-500/10 transition-all">
              <Trash2 size={11}/>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── MCP routing section ────────────────────────────────────────────────── */
function McpRouteCard({ route, onClick, onDelete }: {
  route: McpRouteConfig
  onClick: () => void
  onDelete: () => void
}) {
  const count = (t: string) => route.nodes.filter((n: any) => n.type === t).length
  const servers = route.nodes.filter((n: any) => n.type === 'mcpServer')
  const conditions = count('condition')
  const rateLimits = count('rateLimit')
  const guards = count('guardrail')
  const shields = count('contentShield')

  return (
    <div onClick={onClick}
      className="relative rounded-2xl p-5 cursor-pointer group transition-all duration-300 overflow-hidden select-none"
      style={{
        background: 'linear-gradient(145deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 60%, rgba(16,185,129,0.04) 100%)',
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.15)',
      }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
        style={{ background: 'linear-gradient(145deg, rgba(16,185,129,0.06) 0%, rgba(99,102,241,0.04) 100%)' }}/>
      <div className="relative">
        <div className="flex items-center gap-2.5 mb-3">
          <McpIcon size={13} className="text-indigo-400 flex-shrink-0"/>
          <span className="font-semibold t1 flex-1 text-sm leading-tight">{route.name}</span>
          <ChevronRight size={14} className="t4 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all duration-200 flex-shrink-0"/>
        </div>

        {servers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {servers.slice(0, 4).map((n: any) => (
              <div key={n.id} className="flex items-center gap-1 px-2 py-1 rounded-xl text-[9px] font-medium"
                style={{ background:'rgba(16,185,129,0.10)', border:'1px solid rgba(16,185,129,0.25)', color:'#34d399' }}>
                <Plug size={9}/>{n.data?.name ?? 'Server'}{n.data?.tool ? ` · ${n.data.tool}` : ''}
              </div>
            ))}
            {servers.length > 4 && (
              <div className="flex items-center px-2 py-1 rounded-xl text-[9px] t4"
                style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
                +{servers.length - 4}
              </div>
            )}
          </div>
        )}

        {(guards > 0 || shields > 0 || rateLimits > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {rateLimits > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-medium"
                style={{ background:'rgba(34,211,238,0.10)', border:'1px solid rgba(34,211,238,0.22)', color:'#22d3ee' }}>
                <Gauge size={8}/>{rateLimits} rate limit{rateLimits !== 1 ? 's' : ''}
              </div>
            )}
            {guards > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-medium"
                style={{ background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171' }}>
                <ShieldAlert size={8}/>{guards} guardrail{guards !== 1 ? 's' : ''}
              </div>
            )}
            {shields > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-medium"
                style={{ background:'rgba(99,102,241,0.10)', border:'1px solid rgba(99,102,241,0.22)', color:'#a5b4fc' }}>
                <Lock size={8}/>{shields} shield{shields !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 text-[10px] t3 mb-1">
          <span className="flex items-center gap-1"><Plug size={9}/>{servers.length} server{servers.length !== 1 ? 's' : ''}</span>
          {conditions > 0 && (
            <span className="flex items-center gap-1"><GitBranch size={9}/>{conditions} condition{conditions !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="flex items-center justify-end pt-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1.5 rounded-lg t4 hover:text-red-400 hover:bg-red-500/10 transition-all">
            <Trash2 size={11}/>
          </button>
        </div>
      </div>
    </div>
  )
}

function McpRoutingSection({ onEdit, onNew }: { onEdit: (id: string) => void; onNew: () => void }) {
  const [routes, setRoutes] = useState<McpRouteConfig[]>([])
  useEffect(() => {
    (async () => {
      let r = await loadMcpRoutesLS()
      // Migrate the old seeded default (rate-limit demo) to the canonical
      // request → MCP all tools → response shape.
      const def = r.find(x => x.id === 'mcp-default')
      if (def && !def.nodes.some((n: any) => n.type === 'mcpServer')) {
        r = r.map(x => x.id === 'mcp-default' ? SEED_MCP_ROUTE : x)
        await saveMcpRoutesLS(r)
      }
      setRoutes(r)
    })()
  }, [])

  const deleteRoute = async (id: string) => {
    const updated = routes.filter(r => r.id !== id)
    setRoutes(updated)
    await saveMcpRoutesLS(updated)
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold t1 flex items-center gap-2">
            <McpIcon size={15} className="text-indigo-400"/> MCP Routing
          </h2>
          <p className="text-xs t3 mt-0.5">
            Per-tool flows for the unified /mcp endpoint — conditions, rate limits, guardrails and servers
          </p>
        </div>
        <button onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
          <Plus size={14}/> New MCP route
        </button>
      </div>

      {routes.length === 0 ? (
        <div className="glass rounded-2xl py-12 flex flex-col items-center justify-center">
          <McpIcon size={26} className="t4 mb-3"/>
          <div className="text-sm font-medium t2 mb-1">No MCP routes yet</div>
          <div className="text-xs t4 mb-4">Design how tool calls flow through conditions, rate limits and servers</div>
          <button onClick={onNew}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
            <Plus size={13}/> New MCP route
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {routes.map(r => (
            <McpRouteCard key={r.id} route={r}
              onClick={() => onEdit(r.id)}
              onDelete={() => deleteRoute(r.id)}/>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── List view ──────────────────────────────────────────────────────────── */
function RouteListPage({ onEdit, onNewRoute, onEditMcp, onNewMcpRoute }: { onEdit: (id: string) => void; onNewRoute: (name: string) => void; onEditMcp: (id: string) => void; onNewMcpRoute: () => void }) {
  const [routes, setRoutes]               = useState<RouteConfig[]>([])
  const [keyCounts, setKeyCounts]         = useState<Map<string, number>>(new Map())
  const [showNameModal, setShowNameModal] = useState(false)
  const [newRouteName, setNewRouteName]   = useState('')

  useEffect(() => {
    (async () => {
      setRoutes(await loadRoutes())
      setKeyCounts(loadKeyCounts())
    })()
  }, [])

  const persist = async (updated: RouteConfig[]) => { setRoutes(updated); await saveRoutes(updated) }
  const deleteRoute = (id: string) => { void persist(routes.filter(r => r.id !== id)) }

  const handleNewRouteSubmit = () => {
    const name = newRouteName.trim() || `Route ${routes.filter(r => !r.isDefault).length + 1}`
    setShowNameModal(false); setNewRouteName('')
    onNewRoute(name)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Routing</h1>
        <p className="text-sm t3 mt-1">Visual flows for LLM traffic and MCP tool calls</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold t1 flex items-center gap-2">
            <GitBranch size={15} className="text-indigo-400"/> LLM Routing
          </h2>
          <p className="text-xs t3 mt-0.5">
            {routes.length} route{routes.length !== 1 ? 's' : ''} — conditions, providers, guardrails and fallback for /v1 traffic
          </p>
        </div>
        <button onClick={() => { setNewRouteName(''); setShowNameModal(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
          <Plus size={14}/> New route
        </button>
      </div>

      {routes.length === 0 ? (
        <div className="glass rounded-2xl py-20 flex flex-col items-center justify-center">
          <GitBranch size={32} className="t4 mb-4"/>
          <div className="text-sm font-medium t2 mb-1">No routes configured</div>
          <div className="text-xs t4 mb-4">Create your first route to start routing traffic</div>
          <button onClick={() => { setNewRouteName(''); setShowNameModal(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 transition-all">
            <Plus size={13}/> New route
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {routes.map(route => (
            <RouteCard
              key={route.id}
              route={route}
              keyCount={keyCounts.get(route.id) ?? 0}
              onClick={() => onEdit(route.id)}
              onDelete={e => { e.stopPropagation(); deleteRoute(route.id) }}
            />
          ))}
        </div>
      )}

      {/* MCP routing */}
      <McpRoutingSection onEdit={onEditMcp} onNew={onNewMcpRoute}/>

      {/* New route name modal */}
      {showNameModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNameModal(false)}/>
          <div className="relative w-full max-w-sm glass rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
            <div className="flex items-center gap-3 px-5 py-4 border-b bd">
              <GitBranch size={14} className="text-indigo-400"/>
              <span className="text-sm font-semibold t1">New route</span>
              <button onClick={() => setShowNameModal(false)} className="ml-auto t3 hover:t1 transition-colors"><X size={14}/></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[10px] t3 font-medium uppercase tracking-wide block mb-1.5">Route name</label>
                <input
                  autoFocus
                  value={newRouteName}
                  onChange={e => setNewRouteName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleNewRouteSubmit()}
                  placeholder={`Route ${routes.filter(r => !r.isDefault).length + 1}`}
                  className="glass-input w-full rounded-xl px-3 py-2 text-sm"/>
              </div>
              <button onClick={handleNewRouteSubmit}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/30 transition-all">
                <Plus size={13}/> Create route
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function RoutingPage() {
  const [view, setView]               = useState<'list' | 'canvas' | 'mcpCanvas'>('list')
  const [canvasRouteId, setCanvasRouteId] = useState<string>('default')
  const [mcpRouteId, setMcpRouteId]   = useState<string>('')

  const handleEditMcp = (id: string) => {
    setMcpRouteId(id)
    setView('mcpCanvas')
  }

  const handleNewMcpRoute = async () => {
    const routes = await loadMcpRoutesLS()
    const id = `mcp-route-${Date.now()}`
    routes.push({
      id, name: `MCP Route ${routes.length + 1}`, enabled: true,
      nodes: [
        { id: `req-${id}`, type: 'mcpRequest', position: { x: 40,  y: 220 }, data: {} },
        { id: `res-${id}`, type: 'response',   position: { x: 700, y: 220 }, data: { type: 'success' } },
      ],
      edges: [],
    })
    await saveMcpRoutesLS(routes)
    setMcpRouteId(id)
    setView('mcpCanvas')
  }

  const handleEdit = (id: string) => {
    setCanvasRouteId(id)
    setView('canvas')
  }

  const handleNewRoute = async (name: string) => {
    const routes = await loadRoutes()
    const id  = `route-${Date.now()}`
    const newRoute: RouteConfig = {
      id, name, enabled: true, isDefault: false,
      nodes: [
        { id: `req-${id}`, type: 'request',  position: { x: 40,  y: 200 }, data: { description: '' } },
        { id: `res-${id}`, type: 'response', position: { x: 600, y: 200 }, data: { type: 'success', headers: [], payload: [] } },
      ],
      edges: [],
    }
    await saveRoutes([...routes, newRoute])
    setCanvasRouteId(id)
    setView('canvas')
  }

  if (view === 'canvas') {
    return (
      <RoutingCanvas
        initialRouteId={canvasRouteId}
        onBack={() => setView('list')}
      />
    )
  }

  if (view === 'mcpCanvas') {
    return (
      <McpRoutingCanvas
        routeId={mcpRouteId}
        onBack={() => setView('list')}
      />
    )
  }

  return (
    <RouteListPage
      onEdit={handleEdit}
      onNewRoute={handleNewRoute}
      onEditMcp={handleEditMcp}
      onNewMcpRoute={handleNewMcpRoute}
    />
  )
}
