'use client'
import { useCallback, useEffect, useRef, useState, DragEvent } from 'react'
import ReactFlow, {
  Background, Handle, Position, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  ArrowLeft, Save, CheckCircle2, Plus, Minus, Maximize2, Sparkles, X, Trash2, GitBranch, Gauge, DollarSign, Hash,
  ShieldAlert, Lock, Plug, Monitor, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, Wrench,
} from 'lucide-react'
import clsx from 'clsx'
import Link from 'next/link'
import {
  fetchMcpConfig, fetchMcpTools, fetchGuardrailsConfig, fetchContentShieldConfig,
  type McpServerEntry, type GuardrailApiRule, type ContentShieldApiRule,
} from '@/lib/api'
import { McpIcon } from '@/components/Sidebar'

/* ─── Types & persistence ────────────────────────────────────────────────── */

export interface McpRouteConfig {
  id: string; name: string; enabled: boolean
  nodes: Node[]; edges: Edge[]
}

export const LS_MCP_ROUTES = 'ai-gateway:mcp-routes'

// Synchronous fallback (used for first paint and SSR-safety). Real source
// of truth is the gateway under /config/mcp-routes — fetched on mount by
// the canvas; saves go through PUT (issue #20).
export function loadMcpRoutes(): McpRouteConfig[] {
  if (typeof window === 'undefined') return []
  try {
    const s = localStorage.getItem(LS_MCP_ROUTES)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

export function saveMcpRoutes(routes: McpRouteConfig[]) {
  // Persist server-side for cross-browser sync + actual gateway visibility.
  try {
    const base = typeof window === 'undefined'
      ? 'http://localhost:4891'
      : (window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:4891`)
    fetch(`${base}/config/mcp-routes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routes),
    }).catch(() => {})
  } catch {}
  try { localStorage.removeItem(LS_MCP_ROUTES) } catch {}
}

/* ─── Edge styling — colored + glow per source handle ─────────────────────── */

function edgeColor(sourceHandle?: string | null): string {
  if (sourceHandle === 'true' || sourceHandle === 'pass') return '#10b981'
  if (sourceHandle === 'false') return '#ef4444'
  if (sourceHandle === 'limited' || sourceHandle === 'exceeded') return '#f59e0b'
  if (sourceHandle?.startsWith('out__')) return '#10b981'
  return '#6366f1'
}

export function styleEdge(e: Edge): Edge {
  const color = edgeColor(e.sourceHandle)
  return {
    ...e,
    animated: true,
    style: {
      stroke: color,
      strokeWidth: 2,
      filter: `drop-shadow(0 0 6px ${color}aa)`,
    },
  }
}

/* ─── Node data factories ────────────────────────────────────────────────── */

const mkCondition = () => ({ field: 'tool', op: 'equals', value: '' })
const mkRateLimit = () => ({ requests: 60, window: 'minute' })
const mkCostLimit = () => ({ usd: 10, period: 'day' })
const mkQuota     = () => ({ requests: 1000, period: 'day' })
const mkResponse  = (type: 'success' | 'error') => ({ type })

/* ─── Nodes ──────────────────────────────────────────────────────────────── */

function McpRequestNode({ selected }: NodeProps) {
  return (
    <div className={clsx('px-3.5 py-3 rounded-2xl min-w-[180px]', selected && 'outline outline-2 outline-indigo-400 outline-offset-2')}
      style={{ background:'rgba(99,102,241,0.10)', backdropFilter:'blur(16px)', border:'1px solid rgba(99,102,241,0.30)' }}>
      <Handle type="source" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-indigo-400"/>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.35)' }}>
          <Monitor size={13} className="text-indigo-400"/>
        </div>
        <div>
          <div className="text-[11px] font-bold text-indigo-300 leading-tight">Tool Call</div>
          <div className="text-[9px] t4">Incoming MCP request</div>
        </div>
      </div>
    </div>
  )
}

function ConditionNode({ data, selected }: NodeProps) {
  const fieldLabel = { tool: 'tool name', server: 'server', arguments: 'arguments' }[data.field as string] ?? data.field
  return (
    <div className={clsx('rounded-2xl min-w-[210px] overflow-hidden', selected && 'outline outline-2 outline-purple-400 outline-offset-2')}
      style={{ background:'rgba(168,85,247,0.10)', backdropFilter:'blur(16px)', border:'1px solid rgba(168,85,247,0.28)' }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3 !bg-purple-400"/>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor:'rgba(168,85,247,0.2)' }}>
        <GitBranch size={12} className="text-purple-400"/>
        <span className="text-[11px] font-bold text-purple-300">IF / Condition</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[10px] t2 font-mono truncate">
          {fieldLabel} {data.op} {data.value ? `"${data.value}"` : '…'}
        </div>
      </div>
      <div className="border-t" style={{ borderColor:'rgba(168,85,247,0.15)' }}>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b" style={{ borderColor:'rgba(168,85,247,0.1)' }}>
          <span className="text-[9px] font-bold text-emerald-400">TRUE</span>
          <div className="w-2 h-2 rounded-full bg-emerald-400"/>
        </div>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5">
          <span className="text-[9px] font-bold text-red-400">FALSE</span>
          <div className="w-2 h-2 rounded-full bg-red-400"/>
        </div>
        <Handle type="source" id="true"  position={Position.Right} className="!border-0 !w-3 !h-3 !bg-emerald-400" style={{ top:'62%' }}/>
        <Handle type="source" id="false" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-red-400"     style={{ top:'84%' }}/>
      </div>
    </div>
  )
}

function RateLimitNode({ data, selected }: NodeProps) {
  return (
    <div className={clsx('rounded-2xl min-w-[200px] overflow-hidden', selected && 'outline outline-2 outline-cyan-400 outline-offset-2')}
      style={{ background:'rgba(34,211,238,0.08)', backdropFilter:'blur(16px)', border:'1px solid rgba(34,211,238,0.25)' }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3 !bg-cyan-400"/>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor:'rgba(34,211,238,0.18)' }}>
        <Gauge size={12} className="text-cyan-400"/>
        <span className="text-[11px] font-bold text-cyan-300">Rate Limit</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[10px] t2">{data.requests} requests / {data.window}</div>
      </div>
      <div className="border-t" style={{ borderColor:'rgba(34,211,238,0.12)' }}>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b" style={{ borderColor:'rgba(34,211,238,0.08)' }}>
          <span className="text-[9px] font-bold text-emerald-400">PASS</span>
          <div className="w-2 h-2 rounded-full bg-emerald-400"/>
        </div>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5">
          <span className="text-[9px] font-bold text-amber-400">LIMITED</span>
          <div className="w-2 h-2 rounded-full bg-amber-400"/>
        </div>
        <Handle type="source" id="pass"    position={Position.Right} className="!border-0 !w-3 !h-3 !bg-emerald-400" style={{ top:'62%' }}/>
        <Handle type="source" id="limited" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-amber-400"   style={{ top:'84%' }}/>
      </div>
    </div>
  )
}

function CostLimitNode({ data, selected }: NodeProps) {
  return (
    <div className={clsx('rounded-2xl min-w-[200px] overflow-hidden', selected && 'outline outline-2 outline-amber-400 outline-offset-2')}
      style={{ background:'rgba(245,158,11,0.08)', backdropFilter:'blur(16px)', border:'1px solid rgba(245,158,11,0.25)' }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3 !bg-amber-400"/>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor:'rgba(245,158,11,0.18)' }}>
        <DollarSign size={12} className="text-amber-400"/>
        <span className="text-[11px] font-bold text-amber-300">Cost Limit</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[10px] t2">${'{'}data.usd{'}'} / {'{'}data.period{'}'}</div>
      </div>
      <div className="border-t" style={{ borderColor:'rgba(245,158,11,0.12)' }}>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b" style={{ borderColor:'rgba(245,158,11,0.08)' }}>
          <span className="text-[9px] font-bold text-emerald-400">PASS</span>
          <div className="w-2 h-2 rounded-full bg-emerald-400"/>
        </div>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5">
          <span className="text-[9px] font-bold text-amber-400">EXCEEDED</span>
          <div className="w-2 h-2 rounded-full bg-amber-400"/>
        </div>
        <Handle type="source" id="pass"     position={Position.Right} className="!border-0 !w-3 !h-3 !bg-emerald-400" style={{ top:'62%' }}/>
        <Handle type="source" id="exceeded" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-amber-400"   style={{ top:'84%' }}/>
      </div>
    </div>
  )
}

function QuotaNode({ data, selected }: NodeProps) {
  return (
    <div className={clsx('rounded-2xl min-w-[200px] overflow-hidden', selected && 'outline outline-2 outline-violet-400 outline-offset-2')}
      style={{ background:'rgba(167,139,250,0.08)', backdropFilter:'blur(16px)', border:'1px solid rgba(167,139,250,0.25)' }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3 !bg-violet-400"/>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor:'rgba(167,139,250,0.18)' }}>
        <Hash size={12} className="text-violet-400"/>
        <span className="text-[11px] font-bold text-violet-300">Request Limit</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[10px] t2">{'{'}data.requests{'}'} requests / {'{'}data.period{'}'}</div>
      </div>
      <div className="border-t" style={{ borderColor:'rgba(167,139,250,0.12)' }}>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b" style={{ borderColor:'rgba(167,139,250,0.08)' }}>
          <span className="text-[9px] font-bold text-emerald-400">PASS</span>
          <div className="w-2 h-2 rounded-full bg-emerald-400"/>
        </div>
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5">
          <span className="text-[9px] font-bold text-amber-400">EXCEEDED</span>
          <div className="w-2 h-2 rounded-full bg-amber-400"/>
        </div>
        <Handle type="source" id="pass"     position={Position.Right} className="!border-0 !w-3 !h-3 !bg-emerald-400" style={{ top:'62%' }}/>
        <Handle type="source" id="exceeded" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-amber-400"   style={{ top:'84%' }}/>
      </div>
    </div>
  )
}

function GuardrailNode({ data, selected }: NodeProps) {
  const isBlock = data.action === 'block'
  const color = isBlock ? '#ef4444' : '#f59e0b'
  return (
    <div className={clsx('rounded-2xl min-w-[200px] overflow-hidden', selected && 'outline outline-2 outline-offset-2')}
      style={{ background: isBlock ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)', backdropFilter:'blur(16px)',
        border:`1px solid ${color}48`, outlineColor: color }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3" style={{ background: color }}/>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <ShieldAlert size={12} style={{ color }}/>
        <span className="text-[11px] font-bold flex-1" style={{ color }}>Guardrail</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
          style={{ background:`${color}20`, color, border:`1px solid ${color}40` }}>
          {isBlock ? 'BLOCK' : 'FLAG'}
        </span>
      </div>
      <div className="px-3 pb-2 text-[10px] t2 truncate">{data.label || 'Unnamed rule'}</div>
      <Handle type="source" position={Position.Right} className="!border-0 !w-3 !h-3" style={{ background: color }}/>
    </div>
  )
}

function ShieldNode({ data, selected }: NodeProps) {
  return (
    <div className={clsx('px-3 py-2.5 rounded-2xl min-w-[190px]', selected && 'outline outline-2 outline-indigo-400 outline-offset-2')}
      style={{ background:'rgba(99,102,241,0.10)', backdropFilter:'blur(16px)', border:'1px solid rgba(99,102,241,0.28)' }}>
      <Handle type="target" position={Position.Left}  className="!border-0 !w-3 !h-3 !bg-indigo-400"/>
      <Handle type="source" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-indigo-400"/>
      <div className="flex items-center gap-2 mb-1">
        <Lock size={11} className="text-indigo-400"/>
        <span className="text-[11px] font-bold text-indigo-300">Content Shield</span>
      </div>
      <div className="text-[10px] t2 truncate">{data.label || 'Unnamed pattern'}</div>
      <div className="text-[9px] t4 mt-0.5">→ <span className="font-mono text-indigo-300">{data.replacement || '[REDACTED]'}</span></div>
    </div>
  )
}

const SRV_HEADER_H = 47
const SRV_ROW_H = 26

function McpServerNode({ data, selected }: NodeProps) {
  const isAll = data.serverId === '*'
  const tools: string[] = isAll ? [] : (data.tools ?? [])
  const rows: { id: string; label: string }[] = tools.length > 0
    ? tools.map(t => ({ id: t, label: t }))
    : [{ id: 'all', label: 'All tools' }]
  return (
    <div className={clsx('rounded-2xl min-w-[200px] overflow-visible relative', selected && 'outline outline-2 outline-emerald-400 outline-offset-2')}
      style={{ background:'rgba(16,185,129,0.08)', backdropFilter:'blur(16px)', border:'1px solid rgba(16,185,129,0.28)' }}>
      <div className="flex items-center gap-2 px-3 border-b" style={{ height: SRV_HEADER_H, borderColor:'rgba(16,185,129,0.18)' }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background:'rgba(16,185,129,0.18)', border:'1px solid rgba(16,185,129,0.32)' }}>
          <Plug size={11} className="text-emerald-400"/>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-emerald-300 leading-tight truncate">{isAll ? 'MCP' : (data.name || 'MCP Server')}</div>
          <div className="text-[9px] t4 truncate">{isAll ? 'All registered servers' : (data.url || '').replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center gap-1.5 px-3 border-b last:border-0"
          style={{ height: SRV_ROW_H, borderColor:'rgba(16,185,129,0.10)' }}>
          <Wrench size={8} className="text-emerald-400/60 flex-shrink-0"/>
          <span className="text-[9px] font-mono t2 truncate">{r.label}</span>
        </div>
      ))}
      {rows.map((r, i) => {
        const top = SRV_HEADER_H + i * SRV_ROW_H + SRV_ROW_H / 2
        return (
          <span key={r.id}>
            <Handle type="target" id={`in__${r.id}`}  position={Position.Left}
              className="!border-0 !w-2.5 !h-2.5 !bg-emerald-400" style={{ top }}/>
            <Handle type="source" id={`out__${r.id}`} position={Position.Right}
              className="!border-0 !w-2.5 !h-2.5 !bg-emerald-400" style={{ top }}/>
          </span>
        )
      })}
    </div>
  )
}

function ResponseNode({ data, selected }: NodeProps) {
  const ok = data.type !== 'error'
  const color = ok ? '#10b981' : '#ef4444'
  return (
    <div className={clsx('px-3.5 py-3 rounded-2xl min-w-[160px]', selected && 'outline outline-2 outline-offset-2')}
      style={{ background:`${color}14`, backdropFilter:'blur(16px)', border:`1px solid ${color}45`, outlineColor: color }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3" style={{ background: color }}/>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle size={13} style={{ color }}/> : <AlertCircle size={13} style={{ color }}/>}
        <div>
          <div className="text-[11px] font-bold leading-tight" style={{ color }}>{ok ? 'Response' : 'Error response'}</div>
          <div className="text-[9px] t4">{ok ? 'Tool result to client' : 'JSON-RPC error'}</div>
        </div>
      </div>
    </div>
  )
}

const nodeTypes = {
  mcpRequest: McpRequestNode, condition: ConditionNode, rateLimit: RateLimitNode,
  costLimit: CostLimitNode, quota: QuotaNode,
  guardrail: GuardrailNode, contentShield: ShieldNode, mcpServer: McpServerNode,
  response: ResponseNode,
}

/* ─── Panel helpers ──────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-[10px] t3 font-medium uppercase tracking-wide block">{label}</label>{children}</div>
}

function PanelWrap({ title, color, onClose, onDelete, children }: any) {
  return (
    <div className="absolute right-3 top-3 bottom-3 w-72 dark-panel rounded-2xl z-20 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b bd flex-shrink-0">
        <span className="w-2 h-2 rounded-full" style={{ background: color }}/>
        <span className="text-xs font-semibold t1 flex-1">{title}</span>
        {onDelete && (
          <button onClick={onDelete} className="t4 hover:text-red-400 transition-colors"><Trash2 size={12}/></button>
        )}
        <button onClick={onClose} className="t3 hover:t1 transition-colors"><X size={13}/></button>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1">{children}</div>
    </div>
  )
}

function NodePanel({ node, servers, onChange, onDelete, onClose }: {
  node: Node; servers: McpServerEntry[]
  onChange: (id: string, data: any) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const d = node.data
  const set = (patch: any) => onChange(node.id, { ...d, ...patch })
  const del = node.type === 'mcpRequest' ? undefined : () => { onDelete(node.id); onClose() }

  if (node.type === 'condition') return (
    <PanelWrap title="IF / Condition" color="#a855f7" onClose={onClose} onDelete={del}>
      <Field label="Match on">
        <select value={d.field} onChange={e => set({ field: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="tool">Tool name</option>
          <option value="server">Server</option>
          <option value="arguments">Arguments (text)</option>
        </select>
      </Field>
      <Field label="Operator">
        <select value={d.op} onChange={e => set({ op: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="equals">equals</option>
          <option value="contains">contains</option>
          <option value="matches">matches regex</option>
        </select>
      </Field>
      <Field label="Value">
        <input value={d.value} onChange={e => set({ value: e.target.value })}
          placeholder={d.field === 'tool' ? 'e.g. test__echo' : 'value'}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"/>
      </Field>
      <p className="text-[9px] t4 leading-relaxed">TRUE follows the green handle, FALSE the red one.</p>
    </PanelWrap>
  )

  if (node.type === 'rateLimit') return (
    <PanelWrap title="Rate Limit" color="#22d3ee" onClose={onClose} onDelete={del}>
      <Field label="Max requests">
        <input type="number" min={1} value={d.requests}
          onChange={e => set({ requests: parseInt(e.target.value) || 1 })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs"/>
      </Field>
      <Field label="Per">
        <select value={d.window} onChange={e => set({ window: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="minute">minute</option>
          <option value="hour">hour</option>
          <option value="day">day</option>
        </select>
      </Field>
      <p className="text-[9px] t4 leading-relaxed">Calls over the limit follow the LIMITED handle.</p>
    </PanelWrap>
  )

  if (node.type === 'costLimit') return (
    <PanelWrap title="Cost Limit" color="#f59e0b" onClose={onClose} onDelete={del}>
      <Field label="Max spend (USD)">
        <input type="number" min={0} step="0.01" value={d.usd}
          onChange={e => set({ usd: parseFloat(e.target.value) || 0 })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs"/>
      </Field>
      <Field label="Per">
        <select value={d.period} onChange={e => set({ period: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="day">day</option>
          <option value="week">week</option>
          <option value="month">month</option>
        </select>
      </Field>
      <p className="text-[9px] t4 leading-relaxed">Calls past the spend limit follow the EXCEEDED handle.</p>
    </PanelWrap>
  )

  if (node.type === 'quota') return (
    <PanelWrap title="Request Limit" color="#a78bfa" onClose={onClose} onDelete={del}>
      <Field label="Max requests">
        <input type="number" min={1} value={d.requests}
          onChange={e => set({ requests: parseInt(e.target.value) || 1 })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs"/>
      </Field>
      <Field label="Per">
        <select value={d.period} onChange={e => set({ period: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="day">day</option>
          <option value="week">week</option>
          <option value="month">month</option>
        </select>
      </Field>
      <p className="text-[9px] t4 leading-relaxed">Calls past the quota follow the EXCEEDED handle.</p>
    </PanelWrap>
  )

  if (node.type === 'guardrail') return (
    <PanelWrap title="Guardrail" color={d.action === 'block' ? '#ef4444' : '#f59e0b'} onClose={onClose} onDelete={del}>
      <Field label="Rule label">
        <input value={d.label} onChange={e => set({ label: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs"/>
      </Field>
      <Field label="Action">
        <select value={d.action} onChange={e => set({ action: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="flag">flag</option>
          <option value="block">block</option>
        </select>
      </Field>
      <p className="text-[9px] t4 leading-relaxed">Rules are managed on the Guardrails page — the gateway enforces them on every /mcp tool call.</p>
    </PanelWrap>
  )

  if (node.type === 'contentShield') return (
    <PanelWrap title="Content Shield" color="#818cf8" onClose={onClose} onDelete={del}>
      <Field label="Pattern label">
        <input value={d.label} onChange={e => set({ label: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs"/>
      </Field>
      <Field label="Replacement">
        <input value={d.replacement} onChange={e => set({ replacement: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"/>
      </Field>
      <p className="text-[9px] t4 leading-relaxed">Patterns are managed on the Content Shield page — arguments and results are scanned by the gateway.</p>
    </PanelWrap>
  )

  if (node.type === 'mcpServer') return (
    <PanelWrap title="MCP Server" color="#10b981" onClose={onClose} onDelete={del}>
      {d.serverId === '*' ? (
        <p className="text-[10px] t3 leading-relaxed">
          Routes to <strong>all registered MCP servers</strong> — tool names are namespaced
          <code className="font-mono"> server__tool</code>.
        </p>
      ) : (
        <>
          <Field label="Server">
            <select value={d.serverId}
              onChange={e => {
                const s = servers.find(x => x.id === e.target.value)
                if (s) set({ serverId: s.id, name: s.name, url: s.url })
              }}
              className="glass-input w-full rounded-xl px-3 py-2 text-xs">
              {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {(d.tools ?? []).length > 0 && (
            <Field label={`Tools (${d.tools.length})`}>
              <div className="space-y-1">
                {d.tools.map((t: string) => (
                  <div key={t} className="text-[10px] font-mono t2 px-2 py-1 rounded-lg bg-emerald-500/5 border border-emerald-500/15">{t}</div>
                ))}
              </div>
            </Field>
          )}
        </>
      )}
      <p className="text-[9px] t4 leading-relaxed">Each tool row has its own input/output dots — wire individual tools through guardrails or shields.</p>
    </PanelWrap>
  )

  if (node.type === 'response') return (
    <PanelWrap title="Response" color={d.type === 'error' ? '#ef4444' : '#10b981'} onClose={onClose} onDelete={del}>
      <Field label="Type">
        <select value={d.type} onChange={e => set({ type: e.target.value })}
          className="glass-input w-full rounded-xl px-3 py-2 text-xs">
          <option value="success">success</option>
          <option value="error">error</option>
        </select>
      </Field>
    </PanelWrap>
  )

  return (
    <PanelWrap title="Tool Call" color="#6366f1" onClose={onClose}>
      <p className="text-[10px] t3 leading-relaxed">
        Entry point — every tool call arriving at the unified /mcp endpoint starts here.
      </p>
    </PanelWrap>
  )
}

/* ─── Palette item ───────────────────────────────────────────────────────── */

function PaletteItem({ nodeType, data, label, icon, bg, border, onAdd, onDragStart }: any) {
  return (
    <button draggable onDragStart={e => onDragStart(e, nodeType, data)} onClick={onAdd}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-all cursor-grab active:cursor-grabbing hover:scale-[1.01] mb-1 select-none"
      style={{ background: bg, border }}>
      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">{icon}</div>
      <span className="t1 font-medium truncate flex-1 text-left">{label}</span>
      <Plus size={10} className="ml-auto t3 flex-shrink-0"/>
    </button>
  )
}

/* ─── Auto layout (Sugiyama / barycenter — same as LLM canvas) ───────────── */
function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes
  const H_GAP = 270, V_GAP = 155
  const out = new Map<string, string[]>()
  const inn = new Map<string, string[]>()
  for (const n of nodes) { out.set(n.id, []); inn.set(n.id, []) }
  for (const e of edges) {
    if (out.has(e.source) && inn.has(e.target)) {
      out.get(e.source)!.push(e.target)
      inn.get(e.target)!.push(e.source)
    }
  }
  const inDeg = new Map<string, number>()
  for (const n of nodes) inDeg.set(n.id, 0)
  for (const e of edges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  const levels = new Map<string, number>()
  const q = nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0).map(n => n.id)
  for (const id of q) levels.set(id, 0)
  const bfs = [...q]
  while (bfs.length) {
    const id = bfs.shift()!
    for (const next of (out.get(id) ?? [])) {
      const l = (levels.get(id) ?? 0) + 1
      if (!levels.has(next) || levels.get(next)! < l) { levels.set(next, l); bfs.push(next) }
    }
  }
  for (const n of nodes) if (!levels.has(n.id)) levels.set(n.id, 0)
  const byLevel = new Map<number, string[]>()
  for (const [id, l] of levels) {
    if (!byLevel.has(l)) byLevel.set(l, [])
    byLevel.get(l)!.push(id)
  }
  const sortedLvls = [...byLevel.keys()].sort((a, b) => a - b)
  const order = new Map<string, number>()
  for (const [, ids] of byLevel) ids.forEach((id, i) => order.set(id, i))
  for (let pass = 0; pass < 3; pass++) {
    for (const lvl of sortedLvls) {
      const ids = byLevel.get(lvl)!
      const bc = ids.map(id => {
        const ps = inn.get(id) ?? []
        return ps.length ? ps.reduce((s, p) => s + (order.get(p) ?? 0), 0) / ps.length : (order.get(id) ?? 0)
      })
      ids.sort((a, b) => bc[ids.indexOf(a)] - bc[ids.indexOf(b)])
      ids.forEach((id, i) => order.set(id, i)); byLevel.set(lvl, ids)
    }
    for (const lvl of [...sortedLvls].reverse()) {
      const ids = byLevel.get(lvl)!
      const bc = ids.map(id => {
        const ss = out.get(id) ?? []
        return ss.length ? ss.reduce((s, c) => s + (order.get(c) ?? 0), 0) / ss.length : (order.get(id) ?? 0)
      })
      ids.sort((a, b) => bc[ids.indexOf(a)] - bc[ids.indexOf(b)])
      ids.forEach((id, i) => order.set(id, i)); byLevel.set(lvl, ids)
    }
  }
  const posMap = new Map<string, { x: number; y: number }>()
  for (const [lvl, ids] of byLevel)
    ids.forEach((id, i) => posMap.set(id, { x: lvl * H_GAP + 40, y: (i - (ids.length - 1) / 2) * V_GAP + 300 }))
  return nodes.map(n => ({ ...n, position: posMap.get(n.id) ?? n.position }))
}

/* ─── Canvas ─────────────────────────────────────────────────────────────── */

export default function McpRoutingCanvas({ routeId, onBack }: { routeId: string; onBack: () => void }) {
  const [routes, setRoutes] = useState<McpRouteConfig[]>([])
  const route = routes.find(r => r.id === routeId)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [routeName, setRouteName] = useState('')
  const [selected, setSelected] = useState<Node | null>(null)
  const [saved, setSaved] = useState(false)

  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [serverTools, setServerTools] = useState<Record<string, { name: string; description?: string }[]>>({})
  const [guardrails, setGuardrails] = useState<GuardrailApiRule[]>([])
  const [shields, setShields] = useState<ContentShieldApiRule[]>([])
  const [guardrailsOpen, setGuardrailsOpen] = useState(false)
  const [shieldsOpen, setShieldsOpen] = useState(false)

  const rfInstance = useRef<ReactFlowInstance | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const all = loadMcpRoutes()
    setRoutes(all)
    const r = all.find(x => x.id === routeId)
    if (r) {
      setNodes(r.nodes ?? [])
      setEdges((r.edges ?? []).map(styleEdge))
      setRouteName(r.name)
    }
    Promise.all([fetchMcpConfig(), fetchGuardrailsConfig(), fetchContentShieldConfig()])
      .then(([srv, g, s]) => {
        setServers(srv.filter(x => x.enabled))
        setGuardrails((g ?? []).filter(r => r.enabled && r.action !== 'off'))
        setShields((s ?? []).filter(r => r.enabled))
      })
    fetchMcpTools().then(statuses => {
      const map: Record<string, { name: string; description?: string }[]> = {}
      for (const st of statuses) {
        if (st.status === 'online') {
          map[st.id] = st.tools.map(t => ({
            name: t.name.includes('__') ? t.name.split('__').slice(1).join('__') : t.name,
            description: t.description,
          }))
        }
      }
      setServerTools(map)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  const onConnect = useCallback((c: Connection) => {
    setEdges(eds => addEdge(styleEdge({ ...c, id: `e-${Date.now()}` } as Edge), eds))
  }, [setEdges])

  const updateNodeData = (id: string, data: any) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data } : n))
    setSelected(s => s && s.id === id ? { ...s, data } : s)
  }

  const deleteNode = (id: string) => {
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.source !== id && e.target !== id))
  }

  const addAt = (type: string, data: any, pos?: { x: number; y: number }) => {
    const id = `${type}-${Date.now()}`
    const position = pos ?? { x: 280 + Math.random() * 120, y: 140 + Math.random() * 160 }
    setNodes(ns => [...ns, { id, type, data, position }])
  }

  const onPaletteDragStart = (e: DragEvent, nodeType: string, data: any) => {
    e.dataTransfer.setData('application/mcpflow', JSON.stringify({ nodeType, data }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onCanvasDrop = (e: DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/mcpflow')
    if (!raw || !rfInstance.current) return
    const { nodeType, data } = JSON.parse(raw)
    const pos = rfInstance.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addAt(nodeType, data, pos)
  }

  const save = () => {
    const updated = routes.map(r => r.id === routeId
      ? { ...r, name: routeName.trim() || r.name, nodes, edges }
      : r)
    setRoutes(updated)
    saveMcpRoutes(updated)
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  if (!route) return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="glass rounded-2xl px-8 py-6 t2 text-sm">Route not found</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 80px)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium glass glass-hover transition-all">
          <ArrowLeft size={13}/> Routes
        </button>
        <McpIcon size={15} className="text-indigo-400"/>
        <input value={routeName} onChange={e => setRouteName(e.target.value)}
          className="glass-input rounded-xl px-3 py-2 text-sm font-semibold w-64"/>
        <div className="flex-1"/>
        <button onClick={() => {
            setNodes(ns => autoLayout(ns, edges))
            setTimeout(() => rfInstance.current?.fitView({ duration: 400, padding: 0.3, maxZoom: 1 }), 50)
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium glass glass-hover transition-all t2 hover:t1">
          <Sparkles size={13}/> Beautify
        </button>
        <button onClick={save}
          className={clsx('flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300',
            saved ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                  : 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25')}>
          {saved ? <><CheckCircle2 size={13}/>Saved</> : <><Save size={13}/>Save</>}
        </button>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Palette */}
        <div className="glass rounded-2xl p-3 w-52 flex-shrink-0 flex flex-col overflow-y-auto">
          <div className="text-[10px] t3 uppercase tracking-wider font-medium px-1 mb-1.5">Logic</div>
          <PaletteItem nodeType="condition" data={mkCondition()} label="IF / Condition"
            icon={<GitBranch size={12} className="text-purple-400"/>}
            bg="rgba(168,85,247,0.10)" border="1px solid rgba(168,85,247,0.25)"
            onAdd={() => addAt('condition', mkCondition())} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="response" data={mkResponse('success')} label="Response (success)"
            icon={<CheckCircle size={12} className="text-emerald-400"/>}
            bg="rgba(16,185,129,0.08)" border="1px solid rgba(16,185,129,0.2)"
            onAdd={() => addAt('response', mkResponse('success'))} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="response" data={mkResponse('error')} label="Response (error)"
            icon={<AlertCircle size={12} className="text-red-400"/>}
            bg="rgba(239,68,68,0.08)" border="1px solid rgba(239,68,68,0.2)"
            onAdd={() => addAt('response', mkResponse('error'))} onDragStart={onPaletteDragStart}/>

          <div className="border-t bd pt-2 mt-1 mb-2">
            <div className="text-[10px] t3 uppercase tracking-wider font-medium px-1 mb-1.5">Filters</div>
          </div>
          <PaletteItem nodeType="rateLimit" data={mkRateLimit()} label="Rate limit"
            icon={<Gauge size={12} className="text-cyan-400"/>}
            bg="rgba(34,211,238,0.08)" border="1px solid rgba(34,211,238,0.22)"
            onAdd={() => addAt('rateLimit', mkRateLimit())} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="costLimit" data={mkCostLimit()} label="Cost limit"
            icon={<DollarSign size={12} className="text-amber-400"/>}
            bg="rgba(245,158,11,0.08)" border="1px solid rgba(245,158,11,0.22)"
            onAdd={() => addAt('costLimit', mkCostLimit())} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="quota" data={mkQuota()} label="Request limit"
            icon={<Hash size={12} className="text-violet-400"/>}
            bg="rgba(167,139,250,0.08)" border="1px solid rgba(167,139,250,0.22)"
            onAdd={() => addAt('quota', mkQuota())} onDragStart={onPaletteDragStart}/>
          {guardrails.length === 0 && shields.length === 0 && (
            <div className="text-[9px] t4 italic px-1 mb-2 leading-relaxed">No rules configured — add them in Guardrails &amp; Content Shield first.</div>
          )}
          {guardrails.length > 0 && (
            <>
              <button onClick={() => setGuardrailsOpen(o => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs glass hover:bg-white/5 transition-all mb-1 select-none"
                style={{ border:'1px solid rgba(239,68,68,0.2)', background:'rgba(239,68,68,0.06)' }}>
                <ShieldAlert size={11} className="text-red-400 flex-shrink-0"/>
                <span className="t1 font-medium flex-1 text-left">Guardrails</span>
                <span className="text-[9px] t4">{guardrails.length}</span>
                {guardrailsOpen ? <ChevronUp size={10} className="t4"/> : <ChevronDown size={10} className="t4"/>}
              </button>
              {guardrailsOpen && guardrails.map(g => (
                <PaletteItem key={g.id} nodeType="guardrail" data={{ label: g.label, action: g.action }}
                  label={g.label}
                  icon={<ShieldAlert size={12} className="text-red-400"/>}
                  bg="rgba(239,68,68,0.08)" border="1px solid rgba(239,68,68,0.2)"
                  onAdd={() => addAt('guardrail', { label: g.label, action: g.action })}
                  onDragStart={onPaletteDragStart}/>
              ))}
            </>
          )}
          {shields.length > 0 && (
            <>
              <button onClick={() => setShieldsOpen(o => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs glass hover:bg-white/5 transition-all mb-1 select-none"
                style={{ border:'1px solid rgba(99,102,241,0.2)', background:'rgba(99,102,241,0.06)' }}>
                <Lock size={11} className="text-indigo-400 flex-shrink-0"/>
                <span className="t1 font-medium flex-1 text-left">Content Shield</span>
                <span className="text-[9px] t4">{shields.length}</span>
                {shieldsOpen ? <ChevronUp size={10} className="t4"/> : <ChevronDown size={10} className="t4"/>}
              </button>
              {shieldsOpen && shields.map(s => (
                <PaletteItem key={s.id} nodeType="contentShield"
                  data={{ label: s.label, replacement: s.replacement || '[REDACTED]' }}
                  label={s.label}
                  icon={<Lock size={12} className="text-indigo-400"/>}
                  bg="rgba(99,102,241,0.08)" border="1px solid rgba(99,102,241,0.2)"
                  onAdd={() => addAt('contentShield', { label: s.label, replacement: s.replacement || '[REDACTED]' })}
                  onDragStart={onPaletteDragStart}/>
              ))}
            </>
          )}

          <div className="border-t bd pt-2 mt-1 mb-2">
            <div className="text-[10px] t3 uppercase tracking-wider font-medium px-1 mb-1.5">MCP Servers</div>
          </div>
          <PaletteItem nodeType="mcpServer"
            data={{ serverId: '*', name: 'MCP', url: '', tools: [] }}
            label="MCP — all tools"
            icon={<Plug size={12} className="text-emerald-400"/>}
            bg="rgba(16,185,129,0.10)" border="1px solid rgba(16,185,129,0.28)"
            onAdd={() => addAt('mcpServer', { serverId: '*', name: 'MCP', url: '', tools: [] })}
            onDragStart={onPaletteDragStart}/>
          {servers.length > 0 ? servers.map(s => {
            const tools = (serverTools[s.id] ?? []).map(t => t.name)
            const data = { serverId: s.id, name: s.name, url: s.url, tools }
            return (
              <PaletteItem key={s.id} nodeType="mcpServer" data={data}
                label={tools.length > 0 ? `${s.name} · ${tools.length} tools` : s.name}
                icon={<Plug size={12} className="text-emerald-400"/>}
                bg="rgba(16,185,129,0.08)" border="1px solid rgba(16,185,129,0.22)"
                onAdd={() => addAt('mcpServer', data)}
                onDragStart={onPaletteDragStart}/>
            )
          }) : (
            <div className="px-1.5 py-2">
              <div className="text-[10px] t4 leading-relaxed mb-1.5">No MCP servers registered.</div>
              <Link href="/mcp" className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium">
                Register a server →
              </Link>
            </div>
          )}
        </div>

        {/* Canvas */}
        <div ref={canvasRef} onDrop={onCanvasDrop} onDragOver={e => e.preventDefault()}
          className="flex-1 relative rounded-2xl overflow-hidden glass min-h-0">
          <div className="absolute right-3 top-3 z-20 flex gap-1.5">
            <button onClick={() => rfInstance.current?.zoomOut({ duration: 200 })}
              className="glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center t2 hover:t1 transition-all"><Minus size={13}/></button>
            <button onClick={() => rfInstance.current?.zoomIn({ duration: 200 })}
              className="glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center t2 hover:t1 transition-all"><Plus size={13}/></button>
            <button onClick={() => rfInstance.current?.fitView({ duration: 300, padding: 0.3, maxZoom: 1 })}
              className="glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center t2 hover:t1 transition-all"><Maximize2 size={12}/></button>
          </div>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={inst => { rfInstance.current = inst }}
            onNodeClick={(_, n) => setSelected(n)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            deleteKeyCode="Delete"
            fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} proOptions={{ hideAttribution: true }}>
            <Background gap={24} size={1} color="var(--bd)"/>
          </ReactFlow>
          {selected && (
            <NodePanel node={selected} servers={servers}
              onChange={updateNodeData} onDelete={deleteNode}
              onClose={() => setSelected(null)}/>
          )}
        </div>
      </div>
    </div>
  )
}
