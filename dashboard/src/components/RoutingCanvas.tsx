'use client'
import { useCallback, useState, useRef, useEffect, useMemo, DragEvent, createContext, useContext } from 'react'
import ReactFlow, {
  Background, MiniMap,
  addEdge, useNodesState, useEdgesState,
  Node, Edge, Connection, Handle, Position,
  BackgroundVariant, MarkerType, NodeProps,
  useReactFlow, ReactFlowProvider,
  getSmoothStepPath, EdgeLabelRenderer, EdgeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import Link from 'next/link'
import { VENDORS } from '@/lib/vendors'
import {
  Plus, Save, Trash2, X, CheckCircle2, Zap,
  AlertCircle, GitBranch, Code2, ChevronDown, ChevronUp,
  Minus, Maximize2, Minimize2, RefreshCw, DollarSign, Gauge, ArrowLeft,
  Play, AlertTriangle, ShieldAlert, Lock, Sparkles, Activity,
} from 'lucide-react'
import clsx from 'clsx'
import { getGatewayBase } from '@/lib/config'
import type { GuardrailApiRule, ContentShieldApiRule, GatewayProviderInfo } from '@/lib/api'

/* ─── Interfaces ─────────────────────────────────────────────────────────── */
interface RequestData  { description: string }
interface ProviderData { vendorId: string; name: string; weight: number; modelExpr?: string; timeout?: number; isFallback?: boolean }
interface ResponseData {
  type: 'success' | 'error'
  headers?: Array<{ key: string; value: string }>
  payload?: Array<{ key: string; value: string }>
}
interface ConditionItem { id: string; kind?: 'expr' | 'rate' | 'spend' | 'requests'; expr: string; op: string; value: string }
interface ConditionData { conditions: ConditionItem[]; combine: 'AND' | 'OR' }
interface GuardrailData { label: string; keywords: string; pattern: string; action: 'flag' | 'block' }
interface ContentShieldData { label: string; patternId: string; regex: string; replacement: string }
interface RouteConfig   { id: string; name: string; enabled: boolean; isDefault: boolean; nodes: Node[]; edges: Edge[] }
interface TraceEntry {
  nodeId: string; nodeType: string; label: string
  before: string; after: string
  outcome: 'entry' | 'routed-true' | 'routed-false' | 'passed' | 'blocked' | 'applied' | 'sent' | 'received'
  detail?: string
}

/* ─── Operators ──────────────────────────────────────────────────────────── */
const ALL_OPS = [
  'starts_with','ends_with','contains','equals','not_equals',
  'regex','in','greater_than','less_than','gte','lte',
  'is_true','is_false','size_gt','size_lt',
]
const OP_LABELS: Record<string,string> = {
  equals:'= equals', not_equals:'≠ not equals', starts_with:'starts_with', ends_with:'ends_with',
  contains:'contains', regex:'~ regex', in:'in list', greater_than:'> greater than',
  less_than:'< less than', gte:'≥ gte', lte:'≤ lte', is_true:'= true', is_false:'= false',
  size_gt:'size > n', size_lt:'size < n',
}
const QUICK_TEMPLATES = [
  { label: 'getProvider() = "openai"',      expr: 'payload.getProvider()',   op: 'equals',        value: 'openai'     },
  { label: 'getProvider() = "anthropic"',   expr: 'payload.getProvider()',   op: 'equals',        value: 'anthropic'  },
  { label: 'getProvider() = "gemini"',      expr: 'payload.getProvider()',   op: 'equals',        value: 'gemini'     },
  { label: 'model startswith "openai/"',    expr: 'payload.model',           op: 'starts_with',   value: 'openai/'    },
  { label: 'model startswith "anthropic/"', expr: 'payload.model',           op: 'starts_with',   value: 'anthropic/' },
  { label: 'stream = true',                 expr: 'payload.stream',          op: 'is_true',       value: ''           },
  { label: 'messages.length > 10',          expr: 'payload.messages.length', op: 'greater_than',  value: '10'         },
  { label: 'rpm_used > 80',                 expr: 'request.rpm_used',        op: 'greater_than',  value: '80'         },
]

const EXPR_SUGGESTIONS = [
  'payload', 'payload.model', 'payload.getProvider()', 'payload.getModel()',
  'payload.messages', 'payload.messages.length', 'payload.stream',
  'payload.temperature', 'payload.max_tokens', 'payload.top_p',
  'headers.authorization', 'headers.x-api-key',
  'request.rpm_used', 'request.spend_usd', 'request.total_count',
]

const MODEL_EXPR_SUGGESTIONS = [
  'payload.getModel()', 'payload.model',
]

function conditionLabel(c: ConditionItem) {
  if (c.kind === 'rate')     return `RPM used > ${c.value || '?'}`
  if (c.kind === 'spend')    return `Spend > $${c.value || '?'}`
  if (c.kind === 'requests') return `Total requests > ${c.value || '?'}`
  const opMap: Record<string,string> = {
    starts_with:'startswith', ends_with:'endswith', not_equals:'≠',
    greater_than:'>', less_than:'<', gte:'≥', lte:'≤',
    regex:'~', in:'∈', equals:'=', contains:'contains', size_gt:'size>', size_lt:'size<',
  }
  if (c.op === 'is_true')  return `${c.expr || 'expr'} = true`
  if (c.op === 'is_false') return `${c.expr || 'expr'} = false`
  return `${c.expr || 'expr'} ${opMap[c.op] ?? c.op} "${c.value}"`
}

/* ─── Edge helpers ───────────────────────────────────────────────────────── */
const mkEdge = (stroke: string, dash?: string, animated = false) => ({
  type: 'hover' as const, animated,
  style: { stroke, strokeWidth:2, filter:`drop-shadow(0 0 4px ${stroke}55)`, ...(dash ? { strokeDasharray:dash } : {}) },
  markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
})
const primaryEdge  = mkEdge('#6366f1', undefined, true)
const trueEdge     = { ...mkEdge('#10b981',undefined,true),  label:'TRUE',    labelStyle:{fill:'#10b981',fontSize:9,fontWeight:700}, labelBgStyle:{fill:'transparent'} }
const falseEdge    = { ...mkEdge('#ef4444','8 4',true),      label:'FALSE',   labelStyle:{fill:'#ef4444',fontSize:9,fontWeight:700}, labelBgStyle:{fill:'transparent'} }
const fallbackEdge = { ...mkEdge('#f59e0b','6 3',false),     label:'fallback',labelStyle:{fill:'#f59e0b',fontSize:9,fontWeight:600}, labelBgStyle:{fill:'transparent'} }
const vendorEdge   = (id: string) => mkEdge(VENDORS.find(v => v.id === id)?.color ?? '#6366f1')

/* ─── Default route ──────────────────────────────────────────────────────── */
const DEFAULT_NODES: Node[] = [
  { id:'req-d', type:'request',   position:{x:40,y:200},  data:{ description:'All incoming traffic' } },
  { id:'cnd-d', type:'condition', position:{x:260,y:155}, data:{ combine:'OR', conditions:[
    { id:'c1', expr:'payload.getProvider()', op:'equals', value:'openai' },
  ]} },
  { id:'oai-d', type:'provider',  position:{x:555,y:60},  data:{ vendorId:'openai',    name:'openai-primary',    weight:100, modelExpr:'payload.getModel()' } },
  { id:'ant-d', type:'provider',  position:{x:555,y:290}, data:{ vendorId:'anthropic', name:'anthropic-primary', weight:100, modelExpr:'payload.getModel()' } },
  { id:'res-d', type:'response',  position:{x:840,y:200}, data:{ type:'success', headers:[], payload:[] } },
]
const DEFAULT_EDGES: Edge[] = [
  { id:'e1', source:'req-d', target:'cnd-d', ...primaryEdge },
  { id:'e2', source:'cnd-d', target:'oai-d', sourceHandle:'true',  ...trueEdge  },
  { id:'e3', source:'cnd-d', target:'ant-d', sourceHandle:'false', ...falseEdge },
  { id:'e4', source:'oai-d', target:'res-d', ...vendorEdge('openai') },
  { id:'e5', source:'ant-d', target:'res-d', ...vendorEdge('anthropic') },
]
const INITIAL_ROUTES: RouteConfig[] = [
  { id:'default', name:'Default Route', enabled:true, isDefault:true, nodes:DEFAULT_NODES, edges:DEFAULT_EDGES },
]

/* ─── Animation context ──────────────────────────────────────────────────── */
interface TestAnimState { activeId: string | null; phase: 'idle' | 'running' | 'success' | 'error' }
const TestAnimCtx = createContext<TestAnimState>({ activeId: null, phase: 'idle' })

/* ─── Edge insert context ────────────────────────────────────────────────── */
interface EdgeInsertCtxValue {
  onInsert: (edgeId: string, type: string, data: any) => void
  guardrailItems: GuardrailApiRule[]
  shieldItems: ContentShieldApiRule[]
}
const EdgeInsertCtx = createContext<EdgeInsertCtxValue>({ onInsert: () => {}, guardrailItems: [], shieldItems: [] })

/* ─── Hover edge ─────────────────────────────────────────────────────────── */
function HoverEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, labelStyle }: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const ctx = useContext(EdgeInsertCtx)

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  useEffect(() => {
    if (!menuOpen) return
    const close = () => { setMenuOpen(false); setHovered(false) }
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', close) }
  }, [menuOpen])

  const handleInsert = (type: string, data: any) => {
    setMenuOpen(false); setHovered(false)
    ctx.onInsert(id, type, data)
  }

  const showPlus = hovered || menuOpen

  return (
    <>
      <path id={id} d={edgePath} style={style as React.CSSProperties} markerEnd={markerEnd as string} fill="none" className="react-flow__edge-path"/>
      <path d={edgePath} fill="none" strokeOpacity={0} strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { if (!menuOpen) setHovered(false) }}/>

      {label && !showPlus && (
        <EdgeLabelRenderer>
          <div style={{ position:'absolute', transform:`translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents:'none', fontSize:9, fontWeight:700, color:(labelStyle?.fill as string)??(labelStyle?.color as string)??'var(--t3)' }}
            className="nodrag nopan">{label as React.ReactNode}</div>
        </EdgeLabelRenderer>
      )}

      {showPlus && (
        <EdgeLabelRenderer>
          <div style={{ position:'absolute', transform:`translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents:'all', zIndex:100 }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { if (!menuOpen) setHovered(false) }}>

            <button onMouseDown={e => { e.stopPropagation(); if (!menuOpen) setMenuOpen(true) }}
              className="w-5 h-5 rounded-full flex items-center justify-center text-white"
              style={{ background:'#6366f1', boxShadow:'0 0 8px rgba(99,102,241,0.6)' }}>
              <Plus size={9}/>
            </button>

            {menuOpen && (
              <div className="absolute dark-panel rounded-xl overflow-hidden shadow-2xl min-w-[200px]"
                style={{ top:'calc(100% + 6px)', left:'50%', transform:'translateX(-50%)' }}
                onMouseDown={e => e.stopPropagation()}>
                <div className="px-3 py-2 border-b bd text-[10px] t3 font-medium">Insert node</div>
                <button onMouseDown={() => handleInsert('condition', { combine:'OR', conditions:[] })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs t2 hover:bg-white/5 transition-colors">
                  <GitBranch size={11} className="text-purple-400"/><span>IF Condition</span>
                </button>
                {ctx.guardrailItems.length > 0 && <>
                  <div className="px-3 py-1.5 text-[9px] t4 border-t bd font-medium uppercase tracking-wide">Guardrails</div>
                  {ctx.guardrailItems.map(g => (
                    <button key={g.id} onMouseDown={() => handleInsert('guardrail', {
                      label:g.label, keywords:(g.keywords??[]).join('\n'), pattern:(g.patterns??[])[0]??'', action:g.action
                    })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs t2 hover:bg-white/5 transition-colors">
                      <ShieldAlert size={11} className="text-red-400"/>
                      <span className="truncate flex-1 text-left">{g.label}</span>
                    </button>
                  ))}
                </>}
                {ctx.shieldItems.length > 0 && <>
                  <div className="px-3 py-1.5 text-[9px] t4 border-t bd font-medium uppercase tracking-wide">Content Shield</div>
                  {ctx.shieldItems.map(s => (
                    <button key={s.id} onMouseDown={() => handleInsert('contentShield', {
                      label:s.label, patternId:s.pattern===''?s.id:'', regex:s.pattern||'', replacement:s.replacement||'[REDACTED]'
                    })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs t2 hover:bg-white/5 transition-colors">
                      <Lock size={11} className="text-indigo-400"/>
                      <span className="truncate flex-1 text-left">{s.label}</span>
                    </button>
                  ))}
                </>}
                {ctx.guardrailItems.length === 0 && ctx.shieldItems.length === 0 && (
                  <div className="px-3 py-3 text-[10px] t4 italic">No rules configured — add them in Guardrails / Content Shield first.</div>
                )}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

function resolveExpr(expr: string, body: any): any {
  const t = expr.trim()
  if (t === 'payload.getProvider()') { const m = body?.model ?? ''; return m.includes('/') ? m.split('/')[0] : m }
  if (t === 'payload.getModel()')    { const m = body?.model ?? ''; return m.includes('/') ? m.split('/').slice(1).join('/') : m }
  const ctx: Record<string, any> = { payload: body, headers: {}, request: {} }
  let val: any = ctx
  for (const part of t.split('.')) { if (val == null) return undefined; val = val[part] }
  return val
}
function evalOp(val: any, op: string, target: string): boolean {
  const s = String(val ?? ''); const n = parseFloat(s); const t = parseFloat(target)
  switch (op) {
    case 'equals':       return s === target
    case 'not_equals':   return s !== target
    case 'starts_with':  return s.startsWith(target)
    case 'ends_with':    return s.endsWith(target)
    case 'contains':     return s.includes(target)
    case 'greater_than': return !isNaN(n) && n > t
    case 'less_than':    return !isNaN(n) && n < t
    case 'gte':          return !isNaN(n) && n >= t
    case 'lte':          return !isNaN(n) && n <= t
    case 'is_true':      return !!val
    case 'is_false':     return !val
    case 'regex':        try { return new RegExp(target).test(s) } catch { return false }
    case 'in':           return target.split(',').map(x => x.trim()).includes(s)
    case 'size_gt':      return Array.isArray(val) && val.length > t
    case 'size_lt':      return Array.isArray(val) && val.length < t
    default:             return false
  }
}
function evalCondition(cond: { conditions: any[]; combine: string }, body: any): boolean {
  const items = cond.conditions ?? []
  if (items.length === 0) return true
  const results = items.map((c: any) => evalOp(resolveExpr(c.expr, body), c.op, c.value ?? ''))
  return cond.combine === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

/* ─── Vendor icon ────────────────────────────────────────────────────────── */
function VendorIcon({ icon, name, size=16 }: { icon:string; name:string; size?:number }) {
  const [err, setErr] = useState(false)
  if (err) return null
  return <img src={icon} alt={name} width={size} height={size} className="object-contain flex-shrink-0" onError={() => setErr(true)}/>
}

/* ─── Node: Request ──────────────────────────────────────────────────────── */
function RequestNode({ id, data, selected }: NodeProps<RequestData>) {
  const { activeId } = useContext(TestAnimCtx)
  const isActive = activeId === id
  const glowStyle: React.CSSProperties = isActive
    ? { boxShadow:'0 0 0 2px rgba(99,102,241,0.7), 0 0 28px rgba(99,102,241,0.55), 0 0 56px rgba(99,102,241,0.25)', transform:'scale(1.04)' }
    : {}
  return (
    <div className={clsx('px-4 py-3 rounded-2xl min-w-[180px] canvas-node-anim', selected && 'outline outline-2 outline-indigo-400 outline-offset-2')}
      style={{ background:'rgba(99,102,241,0.12)', backdropFilter:'blur(16px)', border:'1px solid rgba(99,102,241,0.28)', ...glowStyle }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.35)' }}>
          <Zap size={13} className="text-indigo-400"/>
        </div>
        <div>
          <div className="text-[11px] font-bold text-indigo-300 leading-tight">Request</div>
          <div className="text-[9px] text-indigo-400/60">Incoming traffic</div>
        </div>
      </div>
      {data.description && <div className="text-[9px] mt-1 px-1" style={{ color:'var(--t3)' }}>{data.description}</div>}
      <Handle type="source" position={Position.Right} className="!bg-indigo-400 !border-0 !w-3 !h-3"/>
    </div>
  )
}

/* ─── Node: Provider ─────────────────────────────────────────────────────── */
function ProviderNode({ id, data, selected }: NodeProps<ProviderData>) {
  const v = VENDORS.find(x => x.id === data.vendorId)
  const { activeId } = useContext(TestAnimCtx)
  if (!v) return null
  const isActive  = activeId === id
  const isFallback = data.isFallback === true
  // Fallback providers wear an amber ring so they're visually distinct from
  // primaries on the canvas — and the engine knows the same thing from
  // data.isFallback when /config/routes is PUT.
  const fallbackRing = isFallback ? '#f59e0b' : v.ring
  const glowStyle: React.CSSProperties = isActive
    ? { boxShadow:`0 0 0 2px ${v.color}bb, 0 0 28px ${v.color}88, 0 0 56px ${v.color}44`, transform:'scale(1.04)' }
    : isFallback
      ? { boxShadow:`0 0 0 1px rgba(245,158,11,0.55), inset 0 0 0 1px rgba(245,158,11,0.25)` }
      : {}
  return (
    <div className={clsx('px-3 py-3 rounded-2xl min-w-[200px] canvas-node-anim', selected && 'outline outline-2 outline-offset-2')}
      style={{ background:v.bg, backdropFilter:'blur(16px)', border:`1px solid ${fallbackRing}`, outlineColor:v.color, ...glowStyle }}>
      <Handle type="target" position={Position.Left}  className="!border-0 !w-3 !h-3" style={{ background:v.color }}/>
      <Handle type="source" position={Position.Right} className="!border-0 !w-3 !h-3" style={{ background:v.color }}/>
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background:`${v.color}22`, border:`1px solid ${v.ring}` }}>
          <VendorIcon icon={v.icon} name={v.name} size={18}/>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="text-[11px] font-semibold leading-tight truncate" style={{ color:v.color }}>{v.name}</div>
            {isFallback && (
              <span className="text-[8px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded"
                style={{ background:'rgba(245,158,11,0.18)', color:'#fbbf24', border:'1px solid rgba(245,158,11,0.4)' }}>
                Fallback
              </span>
            )}
          </div>
          <div className="text-[9px] truncate" style={{ color:'var(--t3)' }}>{data.name}</div>
        </div>
        <div className="text-[10px] font-bold font-mono flex-shrink-0 px-1.5 py-0.5 rounded-lg"
          style={{ background:`${v.color}20`, color:v.color }}>{data.weight}%</div>
      </div>
      <div className="text-[9px] px-1 font-mono" style={{ color:`${v.color}90` }}>
        model = {data.modelExpr || 'payload.model'}
      </div>
    </div>
  )
}

/* ─── Node: Condition ────────────────────────────────────────────────────── */
function ConditionNode({ id, data, selected }: NodeProps<ConditionData>) {
  const { setNodes } = useReactFlow()
  const { activeId } = useContext(TestAnimCtx)
  const conds = data.conditions ?? []

  const toggleCombine = (e: React.MouseEvent) => {
    e.stopPropagation()
    setNodes(ns => ns.map(n => n.id === id
      ? { ...n, data: { ...n.data, combine: n.data.combine === 'AND' ? 'OR' : 'AND' } }
      : n
    ))
  }

  const isActive = activeId === id
  const glowStyle: React.CSSProperties = isActive
    ? { boxShadow:'0 0 0 2px rgba(168,85,247,0.7), 0 0 28px rgba(168,85,247,0.55), 0 0 56px rgba(168,85,247,0.25)', transform:'scale(1.04)' }
    : {}

  return (
    <div className={clsx('rounded-2xl min-w-[230px] canvas-node-anim overflow-hidden', selected && 'outline outline-2 outline-purple-400 outline-offset-2')}
      style={{ background:'rgba(168,85,247,0.10)', backdropFilter:'blur(16px)', border:'1px solid rgba(168,85,247,0.28)', ...glowStyle }}>
      <Handle type="target" position={Position.Left} id="in" className="!border-0 !w-3 !h-3 !bg-purple-400"/>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor:'rgba(168,85,247,0.2)' }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background:'rgba(168,85,247,0.2)', border:'1px solid rgba(168,85,247,0.3)' }}>
          <GitBranch size={11} className="text-purple-400"/>
        </div>
        <span className="text-[11px] font-bold text-purple-300 flex-1">IF Condition</span>
        <button onClick={toggleCombine}
          className="text-[9px] px-2 py-0.5 rounded-full font-bold transition-all hover:opacity-70 cursor-pointer select-none nodrag"
          style={{ background:'rgba(168,85,247,0.25)', color:'#c084fc', border:'1px solid rgba(168,85,247,0.35)' }}>
          {data.combine}
        </button>
      </div>
      <div className="px-3 py-2 space-y-1">
        {conds.length === 0
          ? <div className="text-[9px] text-purple-300/50 italic">Click to add conditions…</div>
          : conds.map((c, i) => (
              <div key={c.id}>
                {i > 0 && (
                  <div className="text-[8px] font-bold text-purple-400/70 px-1 py-0.5">{data.combine}</div>
                )}
                <div className="text-[9px] font-mono px-2 py-1 rounded-lg"
                  style={{ background:'rgba(168,85,247,0.12)', color:'#d8b4fe' }}>
                  {conditionLabel(c)}
                </div>
              </div>
            ))
        }
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
      </div>
      <Handle type="source" id="true"  position={Position.Right} className="!border-0 !w-3 !h-3 !bg-emerald-400" style={{ top:'71%' }}/>
      <Handle type="source" id="false" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-red-400"     style={{ top:'87%' }}/>
    </div>
  )
}

/* ─── Node: Response ─────────────────────────────────────────────────────── */
function ResponseNode({ id, data, selected }: NodeProps<ResponseData>) {
  const ok = data.type === 'success'; const c = ok ? '#10b981' : '#ef4444'
  const { activeId } = useContext(TestAnimCtx)
  const hCount = (data.headers ?? []).filter(h => h.key).length
  const pCount = (data.payload ?? []).filter(p => p.key).length
  const isActive = activeId === id
  const glowStyle: React.CSSProperties = isActive
    ? { boxShadow:`0 0 0 2px ${c}bb, 0 0 28px ${c}88, 0 0 56px ${c}44`, transform:'scale(1.04)' }
    : {}
  return (
    <div className={clsx('px-4 py-3 rounded-2xl min-w-[160px] canvas-node-anim', selected && 'outline outline-2 outline-offset-2')}
      style={{ background: ok ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)', backdropFilter:'blur(16px)',
               border:`1px solid ${ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`, outlineColor:c, ...glowStyle }}>
      <Handle type="target" position={Position.Left} className="!border-0 !w-3 !h-3" style={{ background:c }}/>
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                   border:`1px solid ${ok ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}` }}>
          {ok ? <CheckCircle2 size={13} className="text-emerald-400"/> : <AlertCircle size={13} className="text-red-400"/>}
        </div>
        <div>
          <div className="text-[11px] font-bold leading-tight" style={{ color:c }}>{ok ? 'Response' : 'Error'}</div>
          <div className="text-[9px]" style={{ color:'var(--t3)' }}>{ok ? 'Return to client' : 'All providers failed'}</div>
        </div>
      </div>
      {(hCount > 0 || pCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-1 px-1">
          {hCount > 0 && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background:`${c}18`, color:c }}>+{hCount} header{hCount!==1?'s':''}</span>}
          {pCount > 0 && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background:`${c}18`, color:c }}>+{pCount} payload</span>}
        </div>
      )}
    </div>
  )
}

/* ─── Node: Guardrail ────────────────────────────────────────────────────── */
function GuardrailNode({ id, data, selected }: NodeProps<GuardrailData>) {
  const { activeId } = useContext(TestAnimCtx)
  const isBlock = data.action === 'block'
  const color = isBlock ? '#ef4444' : '#f59e0b'
  const bg    = isBlock ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)'
  const bdr   = isBlock ? '1px solid rgba(239,68,68,0.28)' : '1px solid rgba(245,158,11,0.28)'
  const kwCount = (data.keywords || '').split(/[,\n]/).filter(k => k.trim()).length
  const glowStyle: React.CSSProperties = activeId === id
    ? { boxShadow:`0 0 0 2px ${color}bb, 0 0 28px ${color}88, 0 0 56px ${color}44`, transform:'scale(1.04)' }
    : {}
  return (
    <div className={clsx('rounded-2xl min-w-[210px] canvas-node-anim overflow-hidden', selected && 'outline outline-2 outline-offset-2')}
      style={{ background:bg, backdropFilter:'blur(16px)', border:bdr, outlineColor:color, ...glowStyle }}>
      <Handle type="target" position={Position.Left} id="in" className="!border-0 !w-3 !h-3" style={{ background:color }}/>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor:`${color}30` }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background:`${color}22`, border:`1px solid ${color}40` }}>
          <ShieldAlert size={11} style={{ color }}/>
        </div>
        <span className="text-[11px] font-bold flex-1" style={{ color }}>Guardrail</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
          style={{ background:`${color}20`, color, border:`1px solid ${color}40` }}>
          {isBlock ? 'BLOCK' : 'FLAG'}
        </span>
      </div>
      <div className="px-3 py-2 space-y-0.5">
        <div className="text-[10px] font-semibold t2 truncate">{data.label || 'Unnamed rule'}</div>
        <div className="text-[9px] t4">{kwCount > 0 ? `${kwCount} keyword${kwCount!==1?'s':''}` : 'No keywords set'}{data.pattern ? ' + regex' : ''}</div>
      </div>
      {isBlock ? (
        <div className="border-t" style={{ borderColor:'rgba(239,68,68,0.15)' }}>
          <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b" style={{ borderColor:'rgba(239,68,68,0.1)' }}>
            <span className="text-[9px] font-bold text-emerald-400">PASSED</span>
            <div className="w-2 h-2 rounded-full bg-emerald-400"/>
          </div>
          <div className="flex items-center justify-end gap-1.5 px-3 py-1.5">
            <span className="text-[9px] font-bold text-red-400">BLOCKED</span>
            <div className="w-2 h-2 rounded-full bg-red-400"/>
          </div>
          <Handle type="source" id="passed"  position={Position.Right} className="!border-0 !w-3 !h-3 !bg-emerald-400" style={{ top:'71%' }}/>
          <Handle type="source" id="blocked" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-red-400"     style={{ top:'87%' }}/>
        </div>
      ) : (
        <Handle type="source" id="passed" position={Position.Right} className="!border-0 !w-3 !h-3" style={{ background:color }}/>
      )}
    </div>
  )
}

/* ─── Node: Content Shield ───────────────────────────────────────────────── */
function ContentShieldNode({ id, data, selected }: NodeProps<ContentShieldData>) {
  const { activeId } = useContext(TestAnimCtx)
  const glowStyle: React.CSSProperties = activeId === id
    ? { boxShadow:'0 0 0 2px rgba(99,102,241,0.7), 0 0 28px rgba(99,102,241,0.55)', transform:'scale(1.04)' }
    : {}
  return (
    <div className={clsx('px-3 py-2.5 rounded-2xl min-w-[190px] canvas-node-anim', selected && 'outline outline-2 outline-indigo-400 outline-offset-2')}
      style={{ background:'rgba(99,102,241,0.10)', backdropFilter:'blur(16px)', border:'1px solid rgba(99,102,241,0.28)', ...glowStyle }}>
      <Handle type="target" position={Position.Left}  className="!border-0 !w-3 !h-3 !bg-indigo-400"/>
      <Handle type="source" position={Position.Right} className="!border-0 !w-3 !h-3 !bg-indigo-400"/>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.35)' }}>
          <Lock size={11} className="text-indigo-400"/>
        </div>
        <div>
          <div className="text-[11px] font-bold text-indigo-300 leading-tight">Content Shield</div>
          <div className="text-[9px] text-indigo-400/60">Rewrite sensitive data</div>
        </div>
      </div>
      <div className="text-[10px] t2 truncate">{data.label || 'Unnamed pattern'}</div>
      <div className="flex items-center gap-1 mt-0.5 text-[9px] t4">
        <span>→</span>
        <span className="font-mono text-indigo-300">{data.replacement || '[REDACTED]'}</span>
      </div>
    </div>
  )
}

const nodeTypes = { request:RequestNode, provider:ProviderNode, condition:ConditionNode, response:ResponseNode, guardrail:GuardrailNode, contentShield:ContentShieldNode }
const edgeTypes = { hover: HoverEdge }

/* ─── Panel wrapper ──────────────────────────────────────────────────────── */
function PanelWrap({ title, color, children, onClose, onDelete }: any) {
  return (
    <div className="absolute right-3 top-3 bottom-3 w-72 dark-panel rounded-2xl flex flex-col z-20 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b bd flex-shrink-0">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:color }}/>
        <span className="text-sm font-semibold t1 flex-1">{title}</span>
        <button onClick={onClose} className="t3 hover:t1 transition-colors"><X size={14}/></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">{children}</div>
      <div className="px-4 py-3 border-t bd flex-shrink-0">
        <button onClick={onDelete}
          className="flex items-center gap-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors w-full justify-center">
          <Trash2 size={11}/> Remove node
        </button>
      </div>
    </div>
  )
}
function Field({ label, children }: { label:string; children:React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-[10px] t3 font-medium uppercase tracking-wide block">{label}</label>{children}</div>
}

/* ─── Suggest input ──────────────────────────────────────────────────────── */
function SuggestInput({ value, onChange, suggestions, placeholder, mono = true }: {
  value: string; onChange: (v: string) => void
  suggestions: string[]; placeholder?: string; mono?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value).slice(0, 7)
  return (
    <div className="relative">
      <input className={clsx('glass-input w-full rounded-lg px-2 py-1.5 text-xs', mono && 'font-mono')}
        placeholder={placeholder} value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHi(-1) }}
        onFocus={() => { setOpen(true); setHi(-1) }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (!open || !filtered.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, filtered.length - 1)) }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(h - 1, -1)) }
          if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); onChange(filtered[hi]); setOpen(false) }
          if (e.key === 'Escape') setOpen(false)
        }}/>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-0.5 z-[999] rounded-xl overflow-hidden"
          style={{ background:'rgba(8,8,20,0.98)', border:'1px solid rgba(99,102,241,0.3)', boxShadow:'0 8px 24px rgba(0,0,0,0.7)' }}>
          {filtered.map((s, i) => (
            <button key={s} onMouseDown={() => { onChange(s); setOpen(false) }}
              className={clsx('w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors',
                i === hi ? 'bg-indigo-500/20 text-indigo-300' : 't3 hover:bg-white/5 hover:t2')}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Condition panel ────────────────────────────────────────────────────── */
const KIND_META = {
  expr:     { label:'Expression', color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  rate:     { label:'Rate limit',  color:'#f59e0b', bg:'rgba(245,158,11,0.15)'  },
  spend:    { label:'Spend limit', color:'#10b981', bg:'rgba(16,185,129,0.15)'  },
  requests: { label:'Req limit',   color:'#6366f1', bg:'rgba(99,102,241,0.15)'  },
} as const

const KIND_DEFAULTS: Record<string, Partial<ConditionItem>> = {
  expr:     { expr:'payload.model',       op:'starts_with',  value:'' },
  rate:     { expr:'request.rpm_used',    op:'greater_than', value:'100' },
  spend:    { expr:'request.spend_usd',   op:'greater_than', value:'10'  },
  requests: { expr:'request.total_count', op:'greater_than', value:'1000' },
}

function ConditionPanel({ node, onChange, onDelete, onClose }: any) {
  const d: ConditionData = node.data
  const conditions: ConditionItem[] = d.conditions ?? []

  const push = (item: ConditionItem) =>
    onChange(node.id, { ...d, conditions:[...conditions, item] })
  const addCond = () =>
    push({ id:`c-${Date.now()}`, kind:'expr', expr:'payload.model', op:'starts_with', value:'' })
  const removeCond = (id: string) =>
    onChange(node.id, { ...d, conditions:conditions.filter(c => c.id !== id) })
  const updateCond = (id: string, patch: Partial<ConditionItem>) =>
    onChange(node.id, { ...d, conditions:conditions.map(c => c.id===id ? { ...c, ...patch } : c) })
  const switchKind = (id: string, kind: keyof typeof KIND_META) =>
    updateCond(id, { kind, ...KIND_DEFAULTS[kind] })

  return (
    <PanelWrap title="IF Condition" color="#a855f7" onClose={onClose} onDelete={() => { onDelete(node.id); onClose() }}>

      {/* Condition cards */}
      <div className="space-y-3">
        {conditions.map((c, i) => {
          const kind = (c.kind ?? 'expr') as keyof typeof KIND_META
          const meta = KIND_META[kind]
          return (
            <div key={c.id} className="rounded-xl p-3 space-y-2.5"
              style={{ background:'rgba(168,85,247,0.06)', border:'1px solid rgba(168,85,247,0.18)' }}>
              {i > 0 && <div className="text-[8px] font-bold text-purple-400 -mb-1">{d.combine}</div>}

              {/* Type picker + delete */}
              <div className="flex items-center gap-1">
                {(Object.keys(KIND_META) as Array<keyof typeof KIND_META>).map(k => (
                  <button key={k} onClick={() => switchKind(c.id, k)}
                    className="flex-1 py-1 rounded-lg text-[8px] font-semibold transition-all"
                    style={kind === k
                      ? { background:KIND_META[k].bg, color:KIND_META[k].color, border:`1px solid ${KIND_META[k].color}40` }
                      : { background:'rgba(255,255,255,0.04)', color:'var(--t3)', border:'1px solid transparent' }}>
                    {KIND_META[k].label}
                  </button>
                ))}
                <button onClick={() => removeCond(c.id)} className="t4 hover:text-red-400 transition-colors ml-0.5 flex-shrink-0">
                  <X size={10}/>
                </button>
              </div>

              {/* Expression inputs */}
              {kind === 'expr' && (
                <>
                  <div>
                    <label className="text-[9px] t3 mb-1 block">Expression</label>
                    <SuggestInput value={c.expr} onChange={v => updateCond(c.id, { expr:v })}
                      suggestions={EXPR_SUGGESTIONS} placeholder="payload.getProvider()…"/>
                  </div>
                  <div>
                    <label className="text-[9px] t3 mb-1 block">Operator</label>
                    <select className="glass-input w-full rounded-lg px-2 py-1.5 text-xs" value={c.op}
                      onChange={e => updateCond(c.id, { op:e.target.value })}>
                      {ALL_OPS.map(op => <option key={op} value={op}>{OP_LABELS[op]??op}</option>)}
                    </select>
                  </div>
                  {c.op !== 'is_true' && c.op !== 'is_false' && (
                    <div>
                      <label className="text-[9px] t3 mb-1 block">Value</label>
                      <input className="glass-input w-full rounded-lg px-2 py-1.5 text-xs"
                        placeholder="claude-, gpt-4o, true…"
                        value={c.value} onChange={e => updateCond(c.id, { value:e.target.value })}/>
                    </div>
                  )}
                </>
              )}

              {/* Rate limit */}
              {kind === 'rate' && (
                <div className="space-y-1.5">
                  <div className="text-[9px] t3">Trigger when requests per minute exceed:</div>
                  <div className="flex items-center gap-2">
                    <Gauge size={11} className="text-amber-400 flex-shrink-0"/>
                    <input type="number" min={1} value={c.value}
                      onChange={e => updateCond(c.id, { value:e.target.value })}
                      className="glass-input w-20 rounded-lg px-2 py-1.5 text-xs text-center font-bold"
                      style={{ color:'#fbbf24' }}/>
                    <span className="text-[9px] t3">req / min</span>
                  </div>
                </div>
              )}

              {/* Spend limit */}
              {kind === 'spend' && (
                <div className="space-y-1.5">
                  <div className="text-[9px] t3">Trigger when cumulative spend exceeds:</div>
                  <div className="flex items-center gap-2">
                    <DollarSign size={11} className="text-emerald-400 flex-shrink-0"/>
                    <span className="text-[10px] font-bold text-emerald-400">$</span>
                    <input type="number" min={0} step={0.01} value={c.value}
                      onChange={e => updateCond(c.id, { value:e.target.value })}
                      className="glass-input w-20 rounded-lg px-2 py-1.5 text-xs text-center font-bold"
                      style={{ color:'#34d399' }}/>
                    <span className="text-[9px] t3">USD</span>
                  </div>
                </div>
              )}

              {/* Request count limit */}
              {kind === 'requests' && (
                <div className="space-y-1.5">
                  <div className="text-[9px] t3">Trigger when total request count exceeds:</div>
                  <div className="flex items-center gap-2">
                    <Zap size={11} className="text-indigo-400 flex-shrink-0"/>
                    <input type="number" min={1} value={c.value}
                      onChange={e => updateCond(c.id, { value:e.target.value })}
                      className="glass-input w-24 rounded-lg px-2 py-1.5 text-xs text-center font-bold"
                      style={{ color:'#818cf8' }}/>
                    <span className="text-[9px] t3">requests</span>
                  </div>
                </div>
              )}

              {/* Preview */}
              <div className="text-[9px] font-mono px-2 py-1 rounded-lg"
                style={{ background:`${meta.color}18`, color:meta.color }}>
                {conditionLabel(c)}
              </div>
            </div>
          )
        })}
      </div>

      <button onClick={addCond}
        className="w-full py-2 rounded-xl text-xs t2 hover:t1 transition-all glass flex items-center justify-center gap-1.5">
        <Plus size={11}/> Add condition
      </button>

      <div className="glass rounded-xl p-3 space-y-1.5">
        <div className="text-[10px] t3 font-medium mb-1">Output handles</div>
        <div className="flex items-center gap-2 text-[10px]"><div className="w-2 h-2 rounded-full bg-emerald-400"/><span className="text-emerald-400 font-bold">TRUE</span><span className="t3">— condition matched</span></div>
        <div className="flex items-center gap-2 text-[10px]"><div className="w-2 h-2 rounded-full bg-red-400"/><span className="text-red-400 font-bold">FALSE</span><span className="t3">— did not match</span></div>
      </div>
    </PanelWrap>
  )
}

/* ─── Guardrail panel ────────────────────────────────────────────────────── */
function GuardrailPanel({ node, onChange, onDelete, onClose }: any) {
  const d: GuardrailData = node.data
  const isBlock = d.action === 'block'
  const color = isBlock ? '#ef4444' : '#f59e0b'
  return (
    <PanelWrap title="Guardrail" color={color} onClose={onClose} onDelete={() => { onDelete(node.id); onClose() }}>
      <Field label="Rule name">
        <input className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          value={d.label} placeholder="e.g. No violence"
          onChange={e => onChange(node.id, { ...d, label:e.target.value })}/>
      </Field>
      <Field label="Action">
        <div className="flex gap-2">
          {([
            { v:'flag'  as const, label:'Flag',  cls:'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30' },
            { v:'block' as const, label:'Block', cls:'bg-red-500/15 text-red-400 ring-1 ring-red-500/30' },
          ]).map(o => (
            <button key={o.v} onClick={() => onChange(node.id, { ...d, action:o.v })}
              className={clsx('flex-1 py-1.5 rounded-xl text-xs font-medium transition-all',
                d.action===o.v ? o.cls : 'glass t2 hover:t1')}>
              {o.label}
            </button>
          ))}
        </div>
        {isBlock && (
          <p className="text-[9px] t4 mt-1.5">
            Block adds two outputs: <span className="text-emerald-400">PASSED</span> and <span className="text-red-400">BLOCKED</span>. Connect BLOCKED to an error response.
          </p>
        )}
      </Field>
      <Field label="Keywords (one per line)">
        <textarea className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono resize-none" rows={5}
          value={d.keywords} placeholder={'bomb making\nhow to hack\ncredit card number'}
          onChange={e => onChange(node.id, { ...d, keywords:e.target.value })}/>
        <p className="text-[9px] t4 mt-1">Case-insensitive substring match. One keyword or phrase per line.</p>
      </Field>
      <Field label="Regex pattern (optional)">
        <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"
          value={d.pattern} placeholder="\b(bomb|weapon|exploit)\b"
          onChange={e => onChange(node.id, { ...d, pattern:e.target.value })}/>
      </Field>
      <div className="glass rounded-xl px-3 py-2 text-[9px] t4">
        <span className="text-indigo-400 font-medium">Placement:</span> add before a provider node to filter requests; add after a provider to filter responses.
      </div>
    </PanelWrap>
  )
}

/* ─── Content Shield panel ───────────────────────────────────────────────── */
function ContentShieldPanel({ node, onChange, onDelete, onClose }: any) {
  const d: ContentShieldData = node.data
  const presets = [
    { label:'[REDACTED]', value:'[REDACTED]', desc:'fixed label' },
    { label:'X…',         value:'X',          desc:'repeat X per char' },
    { label:'*…',         value:'*',          desc:'repeat * per char' },
  ]
  return (
    <PanelWrap title="Content Shield" color="#818cf8" onClose={onClose} onDelete={() => { onDelete(node.id); onClose() }}>
      <Field label="Node label">
        <input className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          value={d.label} placeholder="e.g. Mask emails"
          onChange={e => onChange(node.id, { ...d, label:e.target.value })}/>
      </Field>
      <Field label="Regex pattern">
        <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"
          value={d.regex} placeholder="\bEMP-\d{6}\b"
          onChange={e => onChange(node.id, { ...d, regex:e.target.value, patternId:'' })}/>
        <p className="text-[9px] t4 mt-1">JavaScript-compatible regex. Matches in all message content will be replaced.</p>
      </Field>
      <Field label="Replace with">
        <div className="flex gap-1.5 mb-2">
          {presets.map(p => (
            <button key={p.value} onClick={() => onChange(node.id, { ...d, replacement:p.value })}
              className={clsx('flex-1 px-2 py-1 rounded-lg text-[10px] font-mono transition-all text-center',
                d.replacement===p.value ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30' : 'glass t4 hover:t2')}>
              {p.label}
            </button>
          ))}
        </div>
        <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"
          value={d.replacement} placeholder="[REDACTED]"
          onChange={e => onChange(node.id, { ...d, replacement:e.target.value })}/>
        <p className="text-[9px] t4 mt-1"><span className="font-mono text-indigo-400">X</span> or <span className="font-mono text-indigo-400">*</span> is repeated to match the length of each matched string.</p>
      </Field>
      <div className="glass rounded-xl px-3 py-2 text-[9px] t4">
        Matched content is replaced before reaching the AI provider. Single output — always passes through (rewritten).
      </div>
    </PanelWrap>
  )
}

/* ─── Test trace panel (centered modal) ─────────────────────────────────── */
const TRACE_TYPE_COLOR: Record<string, string> = {
  request:'#6366f1', condition:'#a855f7', guardrail:'#ef4444',
  contentShield:'#818cf8', provider:'#f59e0b', response:'#10b981',
}

function TraceOutcomeChip({ outcome }: { outcome: TraceEntry['outcome'] }) {
  const map: Record<string, { label:string; cls:string }> = {
    entry:          { label:'entry',    cls:'text-indigo-300  bg-indigo-500/15 ring-indigo-500/25' },
    'routed-true':  { label:'TRUE',     cls:'text-emerald-300 bg-emerald-500/15 ring-emerald-500/25' },
    'routed-false': { label:'FALSE',    cls:'text-red-300     bg-red-500/15     ring-red-500/25' },
    passed:         { label:'passed',   cls:'text-emerald-300 bg-emerald-500/15 ring-emerald-500/25' },
    blocked:        { label:'blocked',  cls:'text-red-300     bg-red-500/15     ring-red-500/25' },
    applied:        { label:'modified', cls:'text-amber-300   bg-amber-500/15   ring-amber-500/25' },
    sent:           { label:'sent',     cls:'text-cyan-300    bg-cyan-500/15    ring-cyan-500/25' },
    received:       { label:'ok',       cls:'text-emerald-300 bg-emerald-500/15 ring-emerald-500/25' },
  }
  const c = map[outcome] ?? map.entry
  return <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ring-1 ${c.cls}`}>{c.label}</span>
}

/* ─── Trace edge arrow (intermediate connection) ─────────────────────────── */
function TraceEdgeArrow({ selected, modified, onClick, label }: { selected: boolean; modified: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} title={label}
      className={clsx(
        'flex flex-col items-center justify-center gap-0.5 mx-0.5 px-2 py-1.5 rounded-lg transition-all duration-150 flex-shrink-0 select-none cursor-pointer',
        selected
          ? 'bg-indigo-500/25 ring-1 ring-indigo-400/60 shadow-[0_0_8px_rgba(99,102,241,0.35)]'
          : 'bg-white/[0.04] ring-1 ring-white/[0.08] hover:bg-white/[0.09] hover:ring-white/[0.18]',
      )}>
      <div className="flex items-center">
        <div className="w-5 h-[2px]" style={{ background: selected ? '#818cf8' : 'rgba(255,255,255,0.20)' }}/>
        <div style={{ width:0, height:0, borderTop:'4px solid transparent', borderBottom:'4px solid transparent', borderLeft:`6px solid ${selected ? '#818cf8' : 'rgba(255,255,255,0.26)'}` }}/>
      </div>
      {modified && <span className="text-[7px] font-bold leading-none text-amber-400">mod</span>}
    </button>
  )
}

function TestTracePanel({ trace, testResult, responseBody, onClose }: {
  trace: TraceEntry[]
  testResult: { ok:boolean; latency:number; error?:string; responseBody?:string } | null
  responseBody?: string
  onClose: () => void
}) {
  // Edge i connects trace[i] → trace[i+1]; last edge (trace.length-2) is Provider→Response
  const lastEdge = Math.max(0, trace.length - 2)
  const [selectedEdge, setSelectedEdge] = useState(lastEdge)

  const edgeSrc    = trace[selectedEdge]
  const edgeTgt    = trace[selectedEdge + 1]
  const srcColor   = TRACE_TYPE_COLOR[edgeSrc?.nodeType ?? ''] ?? '#888'
  const tgtColor   = TRACE_TYPE_COLOR[edgeTgt?.nodeType ?? ''] ?? '#888'
  const isTrailing = selectedEdge === lastEdge
  const modified   = !!(edgeSrc && edgeSrc.before !== edgeSrc.after)

  // What payload to show: for trailing edge show actual API response if available
  const displayPayload = isTrailing
    ? (responseBody ?? edgeSrc?.after ?? '')
    : (edgeSrc?.before ?? '')

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" style={{ pointerEvents:'none' }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" style={{ pointerEvents:'all' }} onClick={onClose}/>
      <div className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ pointerEvents:'all', background:'rgba(8,8,20,0.97)', border:'1px solid rgba(255,255,255,0.12)', backdropFilter:'blur(28px)', maxHeight:'74vh', boxShadow:'0 8px 60px rgba(0,0,0,0.8)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b bd flex-shrink-0">
          <Activity size={13} className="text-indigo-400 flex-shrink-0"/>
          <span className="text-sm font-semibold t1 flex-1">Trace</span>
          {testResult && (
            <div className={clsx('text-[10px] px-2.5 py-1 rounded-full font-semibold ring-1',
              testResult.ok ? 'text-emerald-300 bg-emerald-500/15 ring-emerald-500/25' : 'text-red-300 bg-red-500/15 ring-red-500/25')}>
              {testResult.ok ? `✓ ${testResult.latency}ms` : `✗ ${testResult.error?.slice(0,60) ?? 'error'}`}
            </div>
          )}
          <button onClick={onClose} className="t3 hover:t1 transition-colors ml-1"><X size={14}/></button>
        </div>

        {/* Step rail: Node → arrow → Node → arrow → … → Node */}
        <div className="flex items-center px-4 py-3 border-b bd overflow-x-auto flex-shrink-0">
          {trace.map((e, i) => {
            const c      = TRACE_TYPE_COLOR[e.nodeType] ?? '#888'
            const isLast = i === trace.length - 1
            const edgeSel = selectedEdge === i
            return (
              <div key={i} className="flex items-center flex-shrink-0">
                {/* Node label — clicking selects the arrow leaving this node */}
                <button onClick={() => !isLast && setSelectedEdge(i)}
                  className={clsx('flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg transition-all duration-150 select-none min-w-[56px]',
                    edgeSel ? 'bg-white/[0.07]' : !isLast ? 'hover:bg-white/[0.04]' : '')}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }}/>
                  <span className="text-[9px] font-medium whitespace-nowrap max-w-[64px] truncate text-center leading-tight"
                    style={{ color: edgeSel ? 'var(--t1)' : 'var(--t3)' }} title={e.label}>{e.label}</span>
                  <TraceOutcomeChip outcome={e.outcome}/>
                </button>
                {/* Arrow between this node and the next — not rendered after the last node */}
                {!isLast && (
                  <TraceEdgeArrow
                    selected={edgeSel}
                    modified={e.before !== e.after}
                    onClick={() => setSelectedEdge(i)}
                    label={`Data: ${e.label} → ${trace[i+1]?.label}`}/>
                )}
              </div>
            )
          })}
        </div>

        {/* Detail panel */}
        {edgeSrc && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {/* Flow breadcrumb */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold" style={{ color: srcColor }}>{edgeSrc.label}</span>
              <div className="flex items-center gap-0 mx-1">
                <div className="w-5 h-[1.5px]" style={{ background:'rgba(255,255,255,0.2)' }}/>
                <div style={{ width:0, height:0, borderTop:'3px solid transparent', borderBottom:'3px solid transparent', borderLeft:'5px solid rgba(255,255,255,0.28)' }}/>
              </div>
              {edgeTgt
                ? <span className="text-xs font-semibold" style={{ color: tgtColor }}>{edgeTgt.label}</span>
                : <span className="text-[10px] px-2 py-0.5 rounded-full text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/25 font-semibold">
                    {responseBody ? 'API Response' : 'Pipeline Output'}
                  </span>
              }
              {!isTrailing && modified && (
                <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold ring-1 text-amber-300 bg-amber-500/15 ring-amber-500/25 ml-1">modified</span>
              )}
            </div>

            {edgeSrc.detail && !isTrailing && (
              <div className="text-xs px-3 py-2 rounded-xl t2" style={{ background:`${srcColor}12`, border:`1px solid ${srcColor}25` }}>
                {edgeSrc.detail}
              </div>
            )}

            {/* Payload display */}
            {isTrailing ? (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide mb-1.5 text-emerald-400">
                  {responseBody ? 'API Response body' : 'Final pipeline payload'}
                </div>
                <pre className="text-[10px] font-mono rounded-xl px-3 py-3 max-h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap break-words"
                  style={{ background:'rgba(16,185,129,0.07)', color:'var(--t1)', border:'1px solid rgba(16,185,129,0.22)' }}>
                  {displayPayload || '(no response captured)'}
                </pre>
              </div>
            ) : (
              <div className={clsx('grid gap-4', modified ? 'grid-cols-2' : 'grid-cols-1')}>
                <div>
                  <div className="text-[10px] t4 font-medium uppercase tracking-wide mb-1.5">
                    {modified ? 'Payload entering node' : 'Payload on this connection'}
                  </div>
                  <pre className="text-[10px] font-mono rounded-xl px-3 py-3 max-h-52 overflow-y-auto leading-relaxed whitespace-pre-wrap break-words"
                    style={{ background:'rgba(255,255,255,0.04)', color:'var(--t2)', border:'1px solid rgba(255,255,255,0.08)' }}>
                    {edgeSrc.before}
                  </pre>
                </div>
                {modified && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color:'#fbbf24' }}>
                      Payload leaving node
                    </div>
                    <pre className="text-[10px] font-mono rounded-xl px-3 py-3 max-h-52 overflow-y-auto leading-relaxed whitespace-pre-wrap break-words"
                      style={{ background:'rgba(251,191,36,0.06)', color:'var(--t1)', border:'1px solid rgba(251,191,36,0.22)' }}>
                      {edgeSrc.after}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Config panel ───────────────────────────────────────────────────────── */
function ConfigPanel({ node, onChange, onDelete, onClose }: { node:Node; onChange:(id:string,data:any)=>void; onDelete:(id:string)=>void; onClose:()=>void }) {
  const d = node.data
  if (node.type === 'condition') return <ConditionPanel node={node} onChange={onChange} onDelete={onDelete} onClose={onClose}/>
  if (node.type === 'guardrail') return <GuardrailPanel node={node} onChange={onChange} onDelete={onDelete} onClose={onClose}/>
  if (node.type === 'contentShield') return <ContentShieldPanel node={node} onChange={onChange} onDelete={onDelete} onClose={onClose}/>

  if (node.type === 'request') return (
    <PanelWrap title="Request" color="#6366f1" onClose={onClose} onDelete={() => { onDelete(node.id); onClose() }}>
      <Field label="Description">
        <input className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          value={d.description} placeholder="e.g. All production traffic"
          onChange={e => onChange(node.id, { ...d, description:e.target.value })}/>
      </Field>
    </PanelWrap>
  )

  if (node.type === 'provider') {
    const v = VENDORS.find(x => x.id === d.vendorId)
    return (
      <PanelWrap title={v?.name ?? 'Provider'} color={v?.color ?? '#888'} onClose={onClose} onDelete={() => { onDelete(node.id); onClose() }}>
        <div className="flex items-center gap-3 p-3 rounded-xl glass mb-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background:v?.bg, border:`1px solid ${v?.ring}` }}>
            {v && <VendorIcon icon={v.icon} name={v.name} size={22}/>}
          </div>
          <div><div className="text-sm font-semibold t1">{v?.name}</div><div className="text-[10px] t3">{v?.description}</div></div>
        </div>

        <Field label="Instance name">
          <input className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            value={d.name} onChange={e => onChange(node.id, { ...d, name:e.target.value })}/>
        </Field>

        <Field label="Model expression">
          <SuggestInput value={d.modelExpr ?? 'payload.getModel()'}
            onChange={v => onChange(node.id, { ...d, modelExpr:v })}
            suggestions={MODEL_EXPR_SUGGESTIONS} placeholder="payload.getModel()"/>
          <p className="text-[9px] t4 mt-1">
            <span className="font-mono text-indigo-400">payload.getModel()</span> strips provider prefix, or use <span className="font-mono text-indigo-400">payload.model</span> as-is
          </p>
        </Field>

        <Field label="Weight (weighted routing)">
          <div className="flex items-center gap-3">
            <input type="range" min="0" max="100" value={d.weight} style={{ accentColor:v?.color }}
              onChange={e => onChange(node.id, { ...d, weight:+e.target.value })} className="flex-1"/>
            <span className="text-sm font-mono t1 w-8 text-right">{d.weight}%</span>
          </div>
        </Field>

        <Field label="Timeout (ms)">
          <input type="number" min="0" className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            value={d.timeout ?? ''} placeholder="30000"
            onChange={e => onChange(node.id, { ...d, timeout:+e.target.value||undefined })}/>
        </Field>

        {/* Fallback toggle — flipping this and saving the route makes the
            gateway treat the provider as a backup: it's only tried if every
            primary in the route fails. Wired through /config/routes →
            ProviderRegistry.set_routes at PUT time. */}
        <Field label="Role">
          <div className="flex gap-2">
            <button onClick={() => onChange(node.id, { ...d, isFallback:false })}
              className={clsx('flex-1 py-1.5 rounded-xl text-xs font-medium transition-all',
                !d.isFallback
                  ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                  : 'glass t2 hover:t1')}>
              Primary
            </button>
            <button onClick={() => onChange(node.id, { ...d, isFallback:true })}
              className={clsx('flex-1 py-1.5 rounded-xl text-xs font-medium transition-all',
                d.isFallback
                  ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                  : 'glass t2 hover:t1')}>
              Fallback
            </button>
          </div>
          <p className="text-[9px] t4 mt-1">
            Fallbacks are only tried after every primary in this route fails (5xx or timeout).
          </p>
        </Field>

        <div className="glass rounded-xl px-3 py-2.5 text-[9px] t4">
          Rate limiting and spend limits are enforced via <span className="text-purple-400 font-medium">IF Condition</span> nodes using <span className="font-mono text-amber-400">request.rpm_used</span> and <span className="font-mono text-amber-400">request.spend_usd</span>.
        </div>
      </PanelWrap>
    )
  }

  if (node.type === 'response') {
    const headers = (d.headers ?? []) as Array<{key:string;value:string}>
    const payload = (d.payload ?? []) as Array<{key:string;value:string}>
    const c = d.type==='success' ? '#10b981' : '#ef4444'
    const updH = (h: typeof headers) => onChange(node.id, { ...d, headers:h })
    const updP = (p: typeof payload) => onChange(node.id, { ...d, payload:p })
    const setH = (i:number,k:string,v:string) => updH(headers.map((h,idx) => idx===i?{key:k,value:v}:h))
    const setP = (i:number,k:string,v:string) => updP(payload.map((p,idx) => idx===i?{key:k,value:v}:p))
    return (
      <PanelWrap title="Response" color={c} onClose={onClose} onDelete={() => { onDelete(node.id); onClose() }}>
        <Field label="Type">
          <div className="flex gap-2">
            {(['success','error'] as const).map(t => (
              <button key={t} onClick={() => onChange(node.id, { ...d, type:t })}
                className={clsx('flex-1 py-1.5 rounded-xl text-xs font-medium transition-all',
                  d.type===t ? t==='success' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                    : 'glass t2 hover:t1')}>
                {t==='success' ? '✓ Success' : '✕ Error'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Static response headers">
          <div className="space-y-1.5">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input className="glass-input flex-1 rounded-lg px-2 py-1.5 text-[10px] font-mono min-w-0"
                  placeholder="Header-Name" value={h.key} onChange={e => setH(i,e.target.value,h.value)}/>
                <input className="glass-input flex-1 rounded-lg px-2 py-1.5 text-[10px] min-w-0"
                  placeholder="value" value={h.value} onChange={e => setH(i,h.key,e.target.value)}/>
                <button onClick={() => updH(headers.filter((_,idx)=>idx!==i))} className="t4 hover:text-red-400 transition-colors flex-shrink-0"><X size={10}/></button>
              </div>
            ))}
            <button onClick={() => updH([...headers,{key:'',value:''}])}
              className="w-full py-1.5 rounded-lg glass text-[10px] t3 hover:t2 flex items-center justify-center gap-1 transition-colors">
              <Plus size={9}/> Add header
            </button>
          </div>
        </Field>
        <Field label="Inject payload fields">
          <p className="text-[9px] t4 mb-1.5">Merge static fields into the response JSON</p>
          <div className="space-y-1.5">
            {payload.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input className="glass-input flex-1 rounded-lg px-2 py-1.5 text-[10px] font-mono min-w-0"
                  placeholder="field.path" value={p.key} onChange={e => setP(i,e.target.value,p.value)}/>
                <input className="glass-input flex-1 rounded-lg px-2 py-1.5 text-[10px] min-w-0"
                  placeholder="value" value={p.value} onChange={e => setP(i,p.key,e.target.value)}/>
                <button onClick={() => updP(payload.filter((_,idx)=>idx!==i))} className="t4 hover:text-red-400 transition-colors flex-shrink-0"><X size={10}/></button>
              </div>
            ))}
            <button onClick={() => updP([...payload,{key:'',value:''}])}
              className="w-full py-1.5 rounded-lg glass text-[10px] t3 hover:t2 flex items-center justify-center gap-1 transition-colors">
              <Plus size={9}/> Add payload field
            </button>
          </div>
        </Field>
      </PanelWrap>
    )
  }
  return null
}

/* ─── YAML preview ───────────────────────────────────────────────────────── */
function YamlPreview({ nodes, edges, routeName }: { nodes:Node[]; edges:Edge[]; routeName:string }) {
  const [open, setOpen] = useState(false)
  const yaml = [
    `# Route: ${routeName}`,
    ...nodes.map(n => {
      if (n.type==='condition') {
        const d = n.data as ConditionData
        return `if:\n  combine: ${d.combine}\n  conditions:\n${(d.conditions??[]).map(c =>
          `    - expr: ${c.expr||'expr'}\n      op: ${c.op}${c.value?`\n      value: "${c.value}"`:''}`).join('\n')}`
      }
      if (n.type==='provider') {
        const d = n.data as ProviderData
        return `provider:\n  vendor: ${d.vendorId}\n  name: ${d.name}\n  model: ${d.modelExpr||'payload.model'}${d.timeout?`\n  timeout: ${d.timeout}`:''}`
      }
      return null
    }).filter(Boolean),
  ].join('\n\n')
  return (
    <div className="absolute bottom-4 left-4 z-20" style={{ maxWidth:340 }}>
      <button onClick={() => setOpen(o => !o)}
        className="glass glass-hover rounded-xl px-3 py-2 flex items-center gap-2 text-xs t2 transition-all">
        <Code2 size={12} className="text-indigo-400"/> Rule config
        {open ? <ChevronDown size={11}/> : <ChevronUp size={11}/>}
      </button>
      {open && (
        <div className="glass rounded-xl mt-1 overflow-hidden">
          <pre className="text-[9px] text-indigo-300 font-mono p-3 max-h-56 overflow-y-auto leading-relaxed">{yaml||'# No conditions defined'}</pre>
        </div>
      )}
    </div>
  )
}

/* ─── Palette item ───────────────────────────────────────────────────────── */
function PaletteItem({ nodeType, data, label, icon, bg, border, onAdd, onDragStart }: any) {
  return (
    <button draggable onDragStart={e => onDragStart(e, nodeType, data)} onClick={onAdd}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-all cursor-grab active:cursor-grabbing hover:scale-[1.01] mb-1 select-none"
      style={{ background:bg, border }}>
      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">{icon}</div>
      <span className="t1 font-medium truncate flex-1 text-left">{label}</span>
      <Plus size={10} className="ml-auto t3 flex-shrink-0"/>
    </button>
  )
}

/* ─── Canvas test modal ──────────────────────────────────────────────────── */
const SAMPLE_BODY = JSON.stringify({
  model: 'openai/gpt-4o',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello! What can you help me with?' },
  ],
}, null, 2)

const SAMPLE_HEADERS = 'Authorization: Bearer mock-api-key-for-testing\nContent-Type: application/json'

function CanvasTestModal({ onClose, onSend }: {
  onClose: () => void
  onSend: (body: string, headers: string) => void
}) {
  const [body, setBody]       = useState(SAMPLE_BODY)
  const [headers, setHeaders] = useState(SAMPLE_HEADERS)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative w-full max-w-2xl glass rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 flex flex-col max-h-[85vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b bd flex-shrink-0">
          <Play size={15} className="text-indigo-400"/>
          <div>
            <div className="text-sm font-semibold t1">Test Route</div>
            <div className="text-[10px] t3">Send a live request — watch the animation on the canvas</div>
          </div>
          <button onClick={onClose} className="ml-auto t3 hover:t1 transition-colors"><X size={14}/></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] t3 font-medium uppercase tracking-wide">Headers</label>
              <span className="text-[9px] t4">one per line — Name: Value</span>
            </div>
            <textarea value={headers} onChange={e => setHeaders(e.target.value)} rows={3}
              className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono resize-none"/>
          </div>

          <div>
            <label className="text-[10px] t3 font-medium uppercase tracking-wide block mb-1.5">Request body (JSON)</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
              className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono resize-none leading-relaxed"/>
          </div>

          <button onClick={() => onSend(body, headers)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/30">
            <Play size={13}/>Send request
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Auto layout (Sugiyama / barycenter) ────────────────────────────────── */
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
  // Longest-path leveling
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
  // Barycenter crossing minimization (3 forward+backward passes)
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

/* ─── Default library items (shown when server has no rules configured) ──── */
const DEFAULT_GUARDRAILS: GuardrailApiRule[] = [
  { id:'builtin-prompt-injection', label:'Prompt Injection', keywords:['ignore previous instructions','disregard the above','you are now','act as if','forget your instructions'], patterns:['(?i)(ignore|disregard).{0,30}(instruction|prompt|system)'], action:'block', scope:'request', enabled:true },
  { id:'builtin-profanity', label:'Profanity Filter', keywords:[], patterns:['\\b(fuck|shit|bitch|asshole|bastard)\\b'], action:'flag', scope:'both', enabled:true },
  { id:'builtin-pii', label:'PII Block', keywords:['social security','date of birth','credit card'], patterns:['\\b\\d{3}-\\d{2}-\\d{4}\\b'], action:'block', scope:'both', enabled:true },
]
const DEFAULT_SHIELDS: ContentShieldApiRule[] = [
  { id:'cc',       label:'Credit Card',    pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'ssn',      label:'SSN',            pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'email',    label:'Email Address',  pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'phone',    label:'Phone Number',   pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'apikey',   label:'API Key',        pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'aws',      label:'AWS Key',        pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'privkey',  label:'Private Key',    pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'iban',     label:'IBAN',           pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'passport', label:'Passport Number',pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
  { id:'health',   label:'Health Record',  pattern:'', action:'redact', replacement:'[REDACTED]', scope:'both', enabled:true },
]

/* ─── Route persistence ──────────────────────────────────────────────────── */
const LS_KEY = 'ai-gateway:routes'
function migrateEdges(edges: Edge[], nodes: Node[]): Edge[] {
  return edges.map(e => {
    const src = nodes.find(n => n.id === e.source)
    let style: any
    if (src?.type === 'condition') style = e.sourceHandle === 'true' ? trueEdge : falseEdge
    else if (src?.type === 'provider') style = vendorEdge(src.data.vendorId)
    else style = primaryEdge
    return { ...e, type: 'hover', ...style }
  })
}
// Synchronous seed for the initial render. The canvas re-hydrates from the
// gateway in a useEffect below (issue #20) so the bundle still works before
// the network call settles.
function loadRoutes(): RouteConfig[] {
  if (typeof window === 'undefined') return INITIAL_ROUTES
  try {
    const s = localStorage.getItem(LS_KEY)
    const routes: RouteConfig[] = s ? JSON.parse(s) : INITIAL_ROUTES
    return routes.map(r => ({ ...r, edges: migrateEdges(r.edges, r.nodes) }))
  } catch { return INITIAL_ROUTES }
}

/* ─── Canvas inner ───────────────────────────────────────────────────────── */
function CanvasInner({ initialRouteId, onBack }: { initialRouteId?: string; onBack?: () => void }) {
  const [routes, setRoutes]               = useState<RouteConfig[]>(loadRoutes)
  const [activeRouteId, setActiveRouteId] = useState(initialRouteId ?? 'default')
  const [editingRouteId, setEditingRouteId] = useState<string|null>(null)
  const [newRouteName, setNewRouteName]   = useState('')
  const initRoute = routes.find(r => r.id === (initialRouteId ?? 'default')) ?? routes[0]
  const [nodes, setNodes, onNodesChange]  = useNodesState(initRoute.nodes)
  const [edges, setEdges, onEdgesChange]  = useEdgesState(initRoute.edges)
  const [selectedId, setSelectedId]       = useState<string|null>(null)
  const [saved, setSaved]                 = useState(false)
  const [isDragOver, setIsDragOver]       = useState(false)
  const [libraryGuardrails, setLibraryGuardrails] = useState<GuardrailApiRule[]>(DEFAULT_GUARDRAILS)
  const [libraryShields,    setLibraryShields]    = useState<ContentShieldApiRule[]>(DEFAULT_SHIELDS)
  const [gatewayProviders,  setGatewayProviders]  = useState<GatewayProviderInfo[]>([])
  const [expanded, setExpanded]           = useState(false)
  const [clearConfirm, setClearConfirm]   = useState(false)
  const [showTest, setShowTest]           = useState(false)
  const [animActiveId, setAnimActiveId]   = useState<string | null>(null)
  const [animPhase, setAnimPhase]         = useState<TestAnimState['phase']>('idle')
  const [testResult, setTestResult]       = useState<{ ok: boolean; latency: number; error?: string; responseBody?: string } | null>(null)
  const [testTrace, setTestTrace]         = useState<TraceEntry[]>([])
  const [showTrace, setShowTrace]         = useState(false)
  const [guardrailsOpen, setGuardrailsOpen] = useState(false)
  const [disabledVendorIds, setDisabledVendorIds] = useState<string[]>([])
  useEffect(() => {
    try { setDisabledVendorIds(JSON.parse(localStorage.getItem('gw-disabled-vendors') ?? '[]')) } catch {}
  }, [])
  const [shieldsOpen, setShieldsOpen]       = useState(false)
  const { project, zoomIn, zoomOut, fitView } = useReactFlow()

  const runAnimation = useCallback(async (ns: Node[], es: Edge[], requestBody: string): Promise<TraceEntry[]> => {
    let parsedBody: any = {}
    try { parsedBody = JSON.parse(requestBody) } catch {}
    setAnimPhase('running')
    const visited = new Set<string>()
    const queue: string[] = ns.filter(n => n.type === 'request').map(n => n.id)
    const trace: TraceEntry[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      setAnimActiveId(id)
      await new Promise<void>(r => setTimeout(r, 900))
      const node = ns.find(n => n.id === id)
      const out = es.filter(e => e.source === id)
      const before = JSON.stringify(parsedBody, null, 2)
      if (node?.type === 'request') {
        trace.push({ nodeId:id, nodeType:'request', label:node.data.description||'Request', before, after:before, outcome:'entry', detail:'Incoming request payload' })
        for (const e of out) if (!visited.has(e.target)) queue.push(e.target)
      } else if (node?.type === 'condition') {
        const match = evalCondition(node.data, parsedBody)
        trace.push({ nodeId:id, nodeType:'condition', label:'IF Condition', before, after:before,
          outcome: match ? 'routed-true' : 'routed-false',
          detail: match ? 'Condition matched → routed TRUE' : 'Condition not matched → routed FALSE' })
        const next = out.find(e => e.sourceHandle === (match ? 'true' : 'false'))
        if (next && !visited.has(next.target)) queue.push(next.target)
      } else if (node?.type === 'guardrail') {
        const bodyStr = JSON.stringify(parsedBody).toLowerCase()
        let blocked = false
        if (node.data.keywords) {
          const kws = String(node.data.keywords).split(/[\n,]/).map((k: string) => k.trim()).filter(Boolean)
          blocked = kws.some(kw => bodyStr.includes(kw.toLowerCase()))
        }
        if (!blocked && node.data.pattern) {
          try { blocked = new RegExp(node.data.pattern, 'i').test(JSON.stringify(parsedBody)) } catch {}
        }
        trace.push({ nodeId:id, nodeType:'guardrail', label: node.data.label || 'Guardrail', before, after:before,
          outcome: blocked ? 'blocked' : 'passed',
          detail: blocked ? `Content blocked by rule "${node.data.label || 'Guardrail'}"` : 'Content passed guardrail check' })
        if (node.data.action === 'block') {
          const handle = blocked ? 'blocked' : 'passed'
          const next = out.find(e => e.sourceHandle === handle)
          if (next && !visited.has(next.target)) queue.push(next.target)
        } else {
          for (const e of out) if (!visited.has(e.target)) queue.push(e.target)
        }
      } else if (node?.type === 'contentShield') {
        const BUILTIN: Record<string, string> = {
          cc:'\\b(?:\\d[\\s\\-]?){13,16}\\b', ssn:'\\b\\d{3}-\\d{2}-\\d{4}\\b',
          email:'[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
          phone:'\\b(?:\\+?1[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}\\b',
          apikey:'(?:sk|pk|api|key|secret|token)[_\\-]?[A-Za-z0-9]{20,}',
          aws:'A(?:KIA|SSIA)[A-Z0-9]{16}', privkey:'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',
          iban:'\\b[A-Z]{2}\\d{2}[A-Z0-9]{4,}\\d{7}[A-Z0-9]*\\b',
          passport:'\\b[A-Z]{1,2}\\d{6,9}\\b', health:'\\bMRN[-:]?\\d{6,10}\\b',
        }
        const rawRegex = node.data.regex || (node.data.patternId ? BUILTIN[node.data.patternId] : '') || ''
        let afterBody = parsedBody
        if (rawRegex) {
          try {
            const repl = node.data.replacement || '[REDACTED]'
            const re = new RegExp(rawRegex, 'gi')
            const str = JSON.stringify(parsedBody)
            // Length-matching replacement for single-char fill like X or *
            const replaced = (repl === 'X' || repl === '*')
              ? str.replace(re, m => repl.repeat(m.length))
              : str.replace(re, repl)
            if (replaced !== str) afterBody = JSON.parse(replaced)
          } catch {}
        }
        const after = JSON.stringify(afterBody, null, 2)
        const didChange = after !== before
        trace.push({ nodeId:id, nodeType:'contentShield', label: node.data.label || 'Content Shield', before, after,
          outcome: didChange ? 'applied' : 'passed',
          detail: didChange ? `Matched and replaced with "${node.data.replacement || '[REDACTED]'}"` : 'No matching content found' })
        parsedBody = afterBody
        for (const e of out) if (!visited.has(e.target)) queue.push(e.target)
      } else if (node?.type === 'provider') {
        const vLabel = VENDORS.find(v => v.id === node.data.vendorId)?.name ?? node.data.vendorId ?? 'Provider'
        trace.push({ nodeId:id, nodeType:'provider', label:vLabel, before, after:before, outcome:'sent', detail:`Sending to ${vLabel}` })
        for (const e of out) if (!visited.has(e.target)) queue.push(e.target)
      } else if (node?.type === 'response') {
        trace.push({ nodeId:id, nodeType:'response', label: node.data.type === 'success' ? 'Response' : 'Error Response', before, after:before,
          outcome: node.data.type === 'success' ? 'received' : 'blocked', detail: `Route ended: ${node.data.type}` })
        for (const e of out) if (!visited.has(e.target)) queue.push(e.target)
      } else {
        for (const e of out) if (!visited.has(e.target)) queue.push(e.target)
      }
    }
    setAnimActiveId(null)
    return trace
  }, [])

  const finishAnimation = useCallback((_success: boolean) => {
    setAnimPhase('idle'); setAnimActiveId(null)
  }, [])

  const handleTestSend = useCallback(async (body: string, headers: string) => {
    setShowTest(false)
    setTestResult(null)
    let reqOk = false, latency = 0, errMsg: string | undefined, respBody: string | undefined
    const hdrs: Record<string, string> = {}
    headers.split('\n').forEach(line => {
      const idx = line.indexOf(':')
      if (idx > 0) hdrs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    })
    const t0 = Date.now()
    const doReq = async () => {
      try {
        const res = await fetch(`${getGatewayBase()}/v1/chat/completions`, { method: 'POST', headers: hdrs, body })
        latency = Date.now() - t0
        const data = await res.json()
        if (!res.ok) errMsg = `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`
        else { reqOk = true; respBody = JSON.stringify(data, null, 2) }
      } catch (e: any) {
        latency = Date.now() - t0
        errMsg = `Network error: ${e.message}`
      }
    }
    const [trace] = await Promise.all([runAnimation(nodes, edges, body), doReq()])
    finishAnimation(reqOk)
    setTestResult({ ok: reqOk, latency, error: errMsg, responseBody: respBody })
    if (trace.length > 0) { setTestTrace(trace); setShowTrace(true); setSelectedId(null) }
  }, [nodes, edges, runAnimation, finishAnimation])
  const canvasRef = useRef<HTMLDivElement>(null)
  const idRef     = useRef(200)

  const selectedNode = selectedId ? nodes.find(n => n.id === selectedId) ?? null : null

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key==='Escape') { setExpanded(false); setSelectedId(null); setShowTrace(false) } }
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    if (!clearConfirm) return
    const t = setTimeout(() => setClearConfirm(false), 3000); return () => clearTimeout(t)
  }, [clearConfirm])
  useEffect(() => {
    const merged = routes.map(r =>
      r.id === activeRouteId ? { ...r, nodes:[...nodes], edges:[...edges] } : r
    )
    // Persist server-side so the route survives reload AND is visible to
    // other admins / other browsers (issue #20).
    const base = getGatewayBase()
    fetch(`${base}/config/routes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    }).catch(() => {})
    try { localStorage.removeItem(LS_KEY) } catch {}
  }, [routes, nodes, edges, activeRouteId])

  // Hydrate from the gateway on mount so an admin who edited routes in
  // another browser sees them here.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`${getGatewayBase()}/config/routes`, { cache: 'no-store' })
        if (!r.ok) return
        const remote = await r.json()
        if (cancelled || !Array.isArray(remote) || remote.length === 0) return
        setRoutes(remote.map(rt => ({ ...rt, edges: migrateEdges(rt.edges, rt.nodes) })))
        const active = remote.find((rt: any) => rt.id === activeRouteId) ?? remote[0]
        if (active) {
          setNodes(active.nodes)
          setEdges(migrateEdges(active.edges, active.nodes))
        }
      } catch {}
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const base = getGatewayBase()
    Promise.all([
      fetch(`${base}/config/guardrails`, { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/config/content-shield`, { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/config/providers`, { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([gr, cs, pv]) => {
      const gr2 = (gr?.rules as GuardrailApiRule[] | undefined)?.filter(r => r.enabled !== false)
      if (gr2 && gr2.length > 0) setLibraryGuardrails(gr2)
      const cs2 = (cs?.rules as ContentShieldApiRule[] | undefined)?.filter(r => r.enabled !== false)
      if (cs2 && cs2.length > 0) setLibraryShields(cs2)
      const pv2 = pv?.providers as GatewayProviderInfo[] | undefined
      if (pv2 && pv2.length > 0) setGatewayProviders(pv2)
    })
  }, [])

  const switchRoute = useCallback((id: string) => {
    if (id === activeRouteId) return
    setRoutes(prev => prev.map(r => r.id===activeRouteId ? { ...r, nodes:[...nodes], edges:[...edges] } : r))
    const route = routes.find(r => r.id===id)
    if (!route) return
    setNodes(route.nodes.map(n => ({ ...n }))); setEdges(route.edges.map(e => ({ ...e })))
    setActiveRouteId(id); setSelectedId(null)
  }, [activeRouteId, nodes, edges, routes, setNodes, setEdges])

  const addRoute = useCallback(() => {
    const id = `route-${Date.now()}`
    const num = routes.filter(r => !r.isDefault).length + 1
    const newNodes: Node[] = [
      { id:`req-${id}`, type:'request',  position:{x:40,y:200},  data:{description:''} },
      { id:`res-${id}`, type:'response', position:{x:600,y:200}, data:{type:'success',headers:[],payload:[]} },
    ]
    const savedNodes=[...nodes]; const savedEdges=[...edges]
    setRoutes(prev => [...prev.map(r => r.id===activeRouteId?{...r,nodes:savedNodes,edges:savedEdges}:r),
      { id, name:`Route ${num}`, enabled:true, isDefault:false, nodes:newNodes, edges:[] }])
    setNodes(newNodes); setEdges([]); setActiveRouteId(id); setSelectedId(null)
  }, [activeRouteId, nodes, edges, routes, setNodes, setEdges])

  const deleteRoute = useCallback((id: string) => {
    if (routes.find(r => r.id===id)?.isDefault) return
    const remaining = routes.filter(r => r.id!==id)
    setRoutes(remaining)
    if (activeRouteId===id) {
      const fb = remaining[0]
      setNodes(fb.nodes.map(n=>({...n}))); setEdges(fb.edges.map(e=>({...e})))
      setActiveRouteId(fb.id); setSelectedId(null)
    }
  }, [routes, activeRouteId, setNodes, setEdges])

  const toggleRoute = useCallback((id: string) =>
    setRoutes(prev => prev.map(r => r.id===id ? { ...r, enabled:!r.enabled } : r)), [])
  const toggleDefaultRoute = useCallback(() =>
    setRoutes(prev => prev.map(r => r.isDefault ? { ...r, enabled:!r.enabled } : r)), [])
  const renameRoute = useCallback((id: string, name: string) =>
    { setRoutes(prev => prev.map(r => r.id===id ? { ...r, name } : r)); setEditingRouteId(null) }, [])

  const onConnect = useCallback((conn: Connection) => {
    const src = nodes.find(n => n.id===conn.source)
    let style: any = primaryEdge
    if (src?.type==='condition') style = conn.sourceHandle==='true' ? trueEdge : falseEdge
    else if (src?.type==='provider') style = vendorEdge(src.data.vendorId)
    setEdges(es => addEdge({ ...conn, ...style, id:`e-${Date.now()}` }, es))
  }, [nodes, setEdges])

  const updateNode = (id: string, data: any) =>
    setNodes(ns => ns.map(n => n.id===id ? { ...n, data } : n))

  const deleteNode = (id: string) => {
    setNodes(ns => ns.filter(n => n.id!==id)); setEdges(es => es.filter(e => e.source!==id && e.target!==id))
  }

  const addAt = (type: string, data: any) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    const pos = bounds ? project({ x:bounds.width/2-90, y:bounds.height/2-50 }) : { x:300, y:200 }
    setNodes(ns => [...ns, { id:`${type}-${++idRef.current}`, type, position:pos, data }])
  }
  const onPaletteDragStart = (e: DragEvent<HTMLButtonElement>, nodeType: string, data: any) => {
    e.dataTransfer.setData('rf/node-type', nodeType)
    e.dataTransfer.setData('rf/node-data', JSON.stringify(data))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onCanvasDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragOver(false)
    const nodeType = e.dataTransfer.getData('rf/node-type')
    if (!nodeType) return
    const data = JSON.parse(e.dataTransfer.getData('rf/node-data') || '{}')
    const bounds = canvasRef.current!.getBoundingClientRect()
    const pos = project({ x:e.clientX-bounds.left, y:e.clientY-bounds.top })
    setNodes(ns => [...ns, { id:`${nodeType}-${++idRef.current}`, type:nodeType, position:pos, data }])
  }, [project, setNodes])
  const onCanvasDragOver  = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.dataTransfer.dropEffect='move'; setIsDragOver(true) }, [])
  const onCanvasDragLeave = useCallback(() => setIsDragOver(false), [])

  const getEdgeStyle = useCallback((sourceId: string, sourceHandle?: string | null) => {
    const src = nodes.find(n => n.id === sourceId)
    if (src?.type === 'condition') return sourceHandle === 'true' ? trueEdge : falseEdge
    if (src?.type === 'provider') return vendorEdge(src.data.vendorId)
    return primaryEdge
  }, [nodes])

  const insertNodeOnEdge = useCallback((edgeId: string, type: string, data: any) => {
    const edge = edges.find(e => e.id === edgeId)
    if (!edge) return
    const srcNode = nodes.find(n => n.id === edge.source)
    const tgtNode = nodes.find(n => n.id === edge.target)
    if (!srcNode || !tgtNode) return
    const newPos = { x:(srcNode.position.x+tgtNode.position.x)/2, y:(srcNode.position.y+tgtNode.position.y)/2 }
    const newId = `${type}-${++idRef.current}`
    const newNode: Node = { id:newId, type, position:newPos, data }
    const srcStyle = getEdgeStyle(edge.source, edge.sourceHandle)
    setEdges(es => [
      ...es.filter(e => e.id !== edgeId),
      { id:`e-${Date.now()}-1`, source:edge.source, target:newId, sourceHandle:edge.sourceHandle, ...srcStyle },
      { id:`e-${Date.now()}-2`, source:newId, target:edge.target, ...primaryEdge },
    ])
    setNodes(ns => [...ns, newNode])
  }, [edges, nodes, getEdgeStyle, setEdges, setNodes])

  const handleAutoLayout = useCallback(() => {
    setNodes(ns => autoLayout(ns, edges))
    setTimeout(() => fitView({ duration:400, padding:0.25 }), 50)
  }, [edges, setNodes, fitView])

  const mkCondition = () => ({ combine:'OR' as const, conditions:[] })
  const mkRequest   = () => ({ description:'' })
  const mkResponse  = (type: string) => ({ type, headers:[], payload:[] })
  const mkProvider  = (vendorId: string) => ({ vendorId, name:`${vendorId}-primary`, weight:50, modelExpr:'payload.model' })

  const edgeInsertCtxValue = useMemo(() => ({
    onInsert: insertNodeOnEdge,
    guardrailItems: libraryGuardrails,
    shieldItems: libraryShields,
  }), [insertNodeOnEdge, libraryGuardrails, libraryShields])

  const activeRoute = routes.find(r => r.id===activeRouteId)

  const save = async () => {
    setRoutes(prev => prev.map(r => r.id===activeRouteId ? { ...r, nodes:[...nodes], edges:[...edges] } : r))
    setSaved(true); setTimeout(() => setSaved(false), 2000)

    // Push guardrail nodes from this route to the gateway backend
    const guardrailNodes = nodes.filter(n => n.type === 'guardrail')
    if (guardrailNodes.length > 0) {
      const rules = guardrailNodes.map(n => {
        const hasProviderBefore = edges
          .filter(e => e.target === n.id)
          .some(e => nodes.find(nd => nd.id === e.source)?.type === 'provider')
        return {
          id: n.id,
          label: n.data.label || 'Route Guardrail',
          keywords: (n.data.keywords || '').split(/[\n,]/).map((k: string) => k.trim()).filter(Boolean),
          patterns: n.data.pattern ? [n.data.pattern] : [],
          action: n.data.action || 'block',
          scope: hasProviderBefore ? 'response' : 'request',
          enabled: true,
        }
      })
      fetch(`${getGatewayBase()}/config/guardrails`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ rules }),
      }).catch(() => {})
    }

    // Push content shield nodes from this route to the gateway backend
    const shieldNodes = nodes.filter(n => n.type === 'contentShield')
    if (shieldNodes.length > 0) {
      const rules = shieldNodes.map(n => {
        const hasProviderBefore = edges
          .filter(e => e.target === n.id)
          .some(e => nodes.find(nd => nd.id === e.source)?.type === 'provider')
        return {
          id: n.data.patternId || n.id,
          label: n.data.label || 'Route Shield',
          pattern: n.data.patternId ? '' : (n.data.regex || ''),
          action: 'redact',
          replacement: n.data.replacement || '[REDACTED]',
          scope: hasProviderBefore ? 'response' : 'both',
          enabled: true,
        }
      })
      fetch(`${getGatewayBase()}/config/content-shield`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ rules }),
      }).catch(() => {})
    }
  }

  return (
    <EdgeInsertCtx.Provider value={edgeInsertCtxValue}>
    <TestAnimCtx.Provider value={{ activeId: animActiveId, phase: animPhase }}>
    <div className={clsx('flex flex-col transition-all duration-200', expanded ? 'fixed inset-3 z-[100]' : '')}
      style={expanded ? {} : { height:'calc(100vh - 80px)' }}>
      {expanded && <div className="fixed inset-0 z-[99] bg-black/60 backdrop-blur-sm -m-3" onClick={() => setExpanded(false)}/>}

      {/* Top bar */}
      <div className={clsx('flex items-center gap-3 pb-3 flex-shrink-0', expanded && 'relative z-[101]')}>
        {onBack && (
          <button onClick={onBack}
            className="flex items-center gap-1.5 glass px-3 py-2 rounded-xl text-sm t2 hover:t1 transition-colors flex-shrink-0">
            <ArrowLeft size={13}/> Routes
          </button>
        )}
        <div>
          <h1 className="text-2xl font-bold gradient-text">{onBack ? (activeRoute?.name ?? 'Route') : 'Routing'}</h1>
          <p className="text-xs t3 mt-0.5">{onBack ? 'Canvas editor' : `${routes.filter(r=>r.enabled).length} active routes`}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowTest(true)} title="Send a test request through the canvas"
            className="flex items-center gap-1.5 glass px-3 py-2 rounded-xl text-sm t2 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all">
            <Play size={13}/> Test
          </button>
          <button onClick={handleAutoLayout} title="Auto-arrange nodes with Sugiyama layout"
            className="flex items-center gap-1.5 glass px-3 py-2 rounded-xl text-sm t2 hover:text-purple-300 hover:bg-purple-500/10 transition-all">
            <Sparkles size={13}/> Beautify
          </button>
          <button onClick={() => { if (clearConfirm) { setNodes([]); setEdges([]); setSelectedId(null); setClearConfirm(false) } else setClearConfirm(true) }}
            title="Remove all nodes from this route"
            className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200',
              clearConfirm ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40' : 'glass t2 hover:text-red-400 hover:bg-red-500/10')}>
            <RefreshCw size={13}/>{clearConfirm ? 'Confirm clear' : 'Clear'}
          </button>
          <button onClick={save} title="Save route to local storage and sync rules to gateway"
            className={clsx('flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300',
              saved ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25')}>
            {saved ? <><CheckCircle2 size={13}/>Saved</> : <><Save size={13}/>Save</>}
          </button>
        </div>
      </div>
      {showTest && <CanvasTestModal onClose={() => setShowTest(false)} onSend={handleTestSend}/>}
      {showTrace && testTrace.length > 0 && (
        <TestTracePanel trace={testTrace} testResult={testResult} responseBody={testResult?.responseBody} onClose={() => setShowTrace(false)}/>
      )}

      <div className={clsx('flex gap-3 flex-1 min-h-0', expanded && 'relative z-[101]')}>
        {/* Left sidebar */}
        <div className="glass rounded-2xl p-3 w-52 flex-shrink-0 flex flex-col overflow-y-auto">
          <div className="text-[10px] t3 uppercase tracking-wider font-medium px-1 mb-1.5">Logic</div>
          <PaletteItem nodeType="condition" data={mkCondition()} label="IF / Condition"
            icon={<GitBranch size={12} className="text-purple-400"/>}
            bg="rgba(168,85,247,0.10)" border="1px solid rgba(168,85,247,0.25)"
            onAdd={() => addAt('condition', mkCondition())} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="request" data={mkRequest()} label="Request"
            icon={<Zap size={12} className="text-indigo-400"/>}
            bg="rgba(99,102,241,0.08)" border="1px solid rgba(99,102,241,0.2)"
            onAdd={() => addAt('request', mkRequest())} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="response" data={mkResponse('success')} label="Response (success)"
            icon={<CheckCircle2 size={12} className="text-emerald-400"/>}
            bg="rgba(16,185,129,0.08)" border="1px solid rgba(16,185,129,0.2)"
            onAdd={() => addAt('response', mkResponse('success'))} onDragStart={onPaletteDragStart}/>
          <PaletteItem nodeType="response" data={mkResponse('error')} label="Response (error)"
            icon={<AlertCircle size={12} className="text-red-400"/>}
            bg="rgba(239,68,68,0.08)" border="1px solid rgba(239,68,68,0.2)"
            onAdd={() => addAt('response', mkResponse('error'))} onDragStart={onPaletteDragStart}/>

          <div className="border-t bd pt-2 mt-1 mb-2">
            <div className="text-[10px] t3 uppercase tracking-wider font-medium px-1 mb-1.5">Filters</div>
          </div>
          {libraryGuardrails.length === 0 && libraryShields.length === 0 && (
            <div className="text-[9px] t4 italic px-1 mb-2 leading-relaxed">No rules configured — add them in Guardrails &amp; Content Shield first.</div>
          )}
          {libraryGuardrails.length > 0 && (
            <>
              <button onClick={() => setGuardrailsOpen(o => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs glass hover:bg-white/5 transition-all mb-1 select-none"
                style={{ border:'1px solid rgba(239,68,68,0.2)', background:'rgba(239,68,68,0.06)' }}>
                <ShieldAlert size={11} className="text-red-400 flex-shrink-0"/>
                <span className="t1 font-medium flex-1 text-left">Guardrails</span>
                <span className="text-[9px] t4">{libraryGuardrails.length}</span>
                {guardrailsOpen ? <ChevronUp size={10} className="t4"/> : <ChevronDown size={10} className="t4"/>}
              </button>
              {guardrailsOpen && libraryGuardrails.map(g => (
                <PaletteItem key={g.id} nodeType="guardrail"
                  data={{ label:g.label, keywords:(g.keywords??[]).join('\n'), pattern:(g.patterns??[])[0]??'', action:g.action }}
                  label={g.label}
                  icon={<ShieldAlert size={12} className="text-red-400"/>}
                  bg="rgba(239,68,68,0.08)" border="1px solid rgba(239,68,68,0.2)"
                  onAdd={() => addAt('guardrail', { label:g.label, keywords:(g.keywords??[]).join('\n'), pattern:(g.patterns??[])[0]??'', action:g.action })}
                  onDragStart={onPaletteDragStart}/>
              ))}
            </>
          )}
          {libraryShields.length > 0 && (
            <>
              <button onClick={() => setShieldsOpen(o => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs glass hover:bg-white/5 transition-all mb-1 select-none"
                style={{ border:'1px solid rgba(99,102,241,0.2)', background:'rgba(99,102,241,0.06)' }}>
                <Lock size={11} className="text-indigo-400 flex-shrink-0"/>
                <span className="t1 font-medium flex-1 text-left">Content Shield</span>
                <span className="text-[9px] t4">{libraryShields.length}</span>
                {shieldsOpen ? <ChevronUp size={10} className="t4"/> : <ChevronDown size={10} className="t4"/>}
              </button>
              {shieldsOpen && libraryShields.map(s => (
                <PaletteItem key={s.id} nodeType="contentShield"
                  data={{ label:s.label, patternId:s.pattern===''?s.id:'', regex:s.pattern||'', replacement:s.replacement||'[REDACTED]' }}
                  label={s.label}
                  icon={<Lock size={12} className="text-indigo-400"/>}
                  bg="rgba(99,102,241,0.08)" border="1px solid rgba(99,102,241,0.2)"
                  onAdd={() => addAt('contentShield', { label:s.label, patternId:s.pattern===''?s.id:'', regex:s.pattern||'', replacement:s.replacement||'[REDACTED]' })}
                  onDragStart={onPaletteDragStart}/>
              ))}
            </>
          )}

          <div className="border-t bd pt-2 mt-1 mb-2">
            <div className="text-[10px] t3 uppercase tracking-wider font-medium px-1 mb-1.5">Providers</div>
          </div>
          {(() => {
            // Only providers actually configured on the gateway — and not
            // disabled on the Providers page — can be added
            const visible = gatewayProviders.filter(
              p => !disabledVendorIds.includes(p.is_mock ? 'mock' : p.kind))
            if (gatewayProviders.length > 0 && visible.length === 0) {
              return (
                <div className="px-1.5 py-2">
                  <div className="text-[10px] t4 leading-relaxed mb-1.5">
                    No providers are configured for routing.
                  </div>
                  <Link href="/providers"
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium">
                    Configure providers →
                  </Link>
                </div>
              )
            }
            if (visible.length > 0) {
              return visible.map(p => {
                const vendorId = p.is_mock ? 'mock' : p.kind
                const v = VENDORS.find(x => x.id === vendorId) ?? VENDORS.find(x => x.id === 'mock')!
                const data = { vendorId: p.kind, name: p.name, weight: 50, modelExpr: 'payload.model' }
                return (
                  <PaletteItem key={p.name} nodeType="provider" data={data} label={p.name}
                    icon={<VendorIcon icon={v.icon} name={v.name} size={14}/>}
                    bg={v.bg} border={`1px solid ${v.ring}`}
                    onAdd={() => addAt('provider', data)} onDragStart={onPaletteDragStart}/>
                )
              })
            }
            // Gateway unreachable — fall back to the full vendor catalog
            return VENDORS.map(v => (
              <PaletteItem key={v.id} nodeType="provider" data={mkProvider(v.id)} label={v.name}
                icon={<VendorIcon icon={v.icon} name={v.name} size={14}/>}
                bg={v.bg} border={`1px solid ${v.ring}`}
                onAdd={() => addAt('provider', mkProvider(v.id))} onDragStart={onPaletteDragStart}/>
            ))
          })()}

        </div>

        {/* Canvas */}
        <div ref={canvasRef} onDrop={onCanvasDrop} onDragOver={onCanvasDragOver} onDragLeave={onCanvasDragLeave}
          className={clsx('flex-1 relative rounded-2xl overflow-hidden glass min-h-0 transition-all duration-150', isDragOver && 'ring-2 ring-indigo-400/50')}>
          {isDragOver && (
            <div className="absolute inset-0 z-30 pointer-events-none rounded-2xl"
              style={{ background:'rgba(99,102,241,0.04)', border:'2px dashed rgba(99,102,241,0.3)' }}>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="glass rounded-xl px-4 py-2 text-xs text-indigo-400 font-medium">Drop to add node</div>
              </div>
            </div>
          )}
          <div className="absolute right-3 top-3 z-20 flex gap-1.5">
            <button onClick={() => zoomOut({duration:200})} className="glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center t2 hover:t1 transition-all"><Minus size={13}/></button>
            <button onClick={() => zoomIn({duration:200})}  className="glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center t2 hover:t1 transition-all"><Plus  size={13}/></button>
            <button onClick={() => fitView({duration:300,padding:0.3})} className="glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center t2 hover:t1 transition-all"><Maximize2 size={12}/></button>
            <button onClick={() => setExpanded(e => !e)}
              className={clsx('glass glass-hover w-8 h-8 rounded-xl flex items-center justify-center transition-all', expanded?'text-indigo-400':'t2 hover:t1')}>
              {expanded ? <Minimize2 size={12}/> : <Maximize2 size={12} className="rotate-45"/>}
            </button>
          </div>
          <div className="absolute left-3 top-3 z-20">
            <div className="glass rounded-xl px-3 py-1.5 flex items-center gap-2 text-[10px]">
              <div className={clsx('w-1.5 h-1.5 rounded-full', activeRoute?.enabled?'bg-emerald-400':'bg-amber-400')}/>
              <span className="t1 font-medium">{activeRoute?.name}</span>
              {activeRoute?.isDefault && <span className="t4">default</span>}
              {!activeRoute?.enabled && <span className="text-amber-400">disabled</span>}
            </div>
          </div>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_,n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView fitViewOptions={{ padding:0.3 }}
            deleteKeyCode="Delete"
            proOptions={{ hideAttribution:true }}>
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--bd)"/>
            <MiniMap
              style={{ background:'var(--glass-bg)', border:'1px solid var(--glass-border)', borderRadius:12 }}
              nodeColor={n => { if (n.type==='request') return '#6366f1'; if (n.type==='condition') return '#a855f7'; if (n.type==='response') return n.data.type==='success'?'#10b981':'#ef4444'; return VENDORS.find(v=>v.id===n.data.vendorId)?.color??'#888' }}
              maskColor="rgba(0,0,0,0.25)"/>
          </ReactFlow>
          {selectedNode && <ConfigPanel node={selectedNode} onChange={updateNode} onDelete={deleteNode} onClose={() => setSelectedId(null)}/>}
          {testResult && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 glass rounded-2xl px-5 py-3 flex items-center gap-3 shadow-2xl ring-1 ring-white/10 w-max max-w-[85%]">
              {testResult.ok
                ? <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0"/>
                : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0"/>}
              <div className="min-w-0">
                <div className="text-xs font-semibold t1">{testResult.ok ? 'Request succeeded' : 'Request failed'}</div>
                <div className="text-[10px] t3 truncate">{testResult.latency}ms{testResult.error ? ` — ${testResult.error.slice(0, 80)}` : ''}</div>
              </div>
              <button onClick={() => setTestResult(null)} className="ml-2 t4 hover:t1 transition-colors flex-shrink-0"><X size={11}/></button>
            </div>
          )}
        </div>
      </div>
    </div>
    </TestAnimCtx.Provider>
    </EdgeInsertCtx.Provider>
  )
}

export default function RoutingCanvas({ initialRouteId, onBack }: { initialRouteId?: string; onBack?: () => void }) {
  return <ReactFlowProvider><CanvasInner initialRouteId={initialRouteId} onBack={onBack}/></ReactFlowProvider>
}
