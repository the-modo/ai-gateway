'use client'
import { useState, useMemo, useEffect } from 'react'
import {
  Lock, ShieldCheck, Save, CheckCircle2,
  CreditCard, Mail, Phone, Key, Fingerprint, Building2,
  Hash, Globe, FileCode2, Plus, X, ChevronDown, ChevronUp,
  Flag, Info, FlaskConical, AlertTriangle,
  ArrowRight, ChevronRight,
} from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { fetchLogs, updateContentShieldConfig, type ContentShieldApiRule } from '@/lib/api'
import clsx from 'clsx'

/* ─── Types ──────────────────────────────────────────────────────────────── */
type Replacement = '[REDACTED]' | 'XXX' | '***' | string

interface Pattern {
  id: string; label: string; description: string; example: string
  icon: React.ElementType; color: string; glow: string; framework: string
  replacement: Replacement
}
interface CustomPattern {
  id: string; label: string; regex: string; replacement: Replacement
}

/* ─── Built-in patterns ──────────────────────────────────────────────────── */
const DEFAULT_PATTERNS: Pattern[] = [
  { id:'cc',      label:'Credit Card Numbers',     description:'Visa, Mastercard, Amex, Discover card numbers',   example:'4532 1234 5678 9010',   icon:CreditCard,  color:'text-red-400',    glow:'rgba(239,68,68,0.15)',   framework:'PCI DSS', replacement:'[REDACTED]'     },
  { id:'ssn',     label:'Social Security Numbers', description:'US SSN — XXX-XX-XXXX format',                    example:'078-05-1120',           icon:Fingerprint, color:'text-red-400',    glow:'rgba(239,68,68,0.15)',   framework:'PII',     replacement:'[REDACTED]'     },
  { id:'email',   label:'Email Addresses',         description:'RFC 5322 email addresses',                       example:'user@example.com',      icon:Mail,        color:'text-amber-400',  glow:'rgba(245,158,11,0.15)',  framework:'GDPR',    replacement:'[EMAIL]'        },
  { id:'phone',   label:'Phone Numbers',           description:'US and international phone formats',             example:'+1 (555) 867-5309',     icon:Phone,       color:'text-amber-400',  glow:'rgba(245,158,11,0.15)',  framework:'GDPR',    replacement:'[PHONE]'        },
  { id:'apikey',  label:'API Keys & Secrets',      description:'sk-, ghp_, xoxb-, token= patterns',             example:'sk-proj-AbCdEfGh…',     icon:Key,         color:'text-purple-400', glow:'rgba(168,85,247,0.15)', framework:'Secrets', replacement:'[SECRET]'       },
  { id:'aws',     label:'AWS Credentials',         description:'AWS access key IDs and secret access keys',     example:'AKIAIOSFODNN7EXAMPLE',  icon:Building2,   color:'text-orange-400', glow:'rgba(249,115,22,0.15)', framework:'Secrets', replacement:'[AWS_KEY]'      },
  { id:'privkey', label:'Private Keys',            description:'PEM-encoded RSA / EC / Ed25519 private keys',   example:'-----BEGIN RSA PRIVATE', icon:FileCode2,  color:'text-red-400',    glow:'rgba(239,68,68,0.15)',   framework:'Secrets', replacement:'[PRIVATE_KEY]'  },
  { id:'iban',    label:'IBAN / Bank Accounts',    description:'International bank account numbers',            example:'GB82 WEST 1234 5698…',  icon:Hash,        color:'text-cyan-400',   glow:'rgba(34,211,238,0.15)', framework:'PCI DSS', replacement:'[BANK_ACCOUNT]' },
  { id:'passport',label:'Passport Numbers',        description:'US and EU passport number formats',             example:'US 123456789',          icon:Globe,       color:'text-indigo-400', glow:'rgba(99,102,241,0.15)', framework:'PII',     replacement:'[PASSPORT]'     },
  { id:'health',  label:'Health Record IDs',       description:'NPI numbers and medical record number patterns',example:'NPI: 1234567890',      icon:Hash,        color:'text-emerald-400',glow:'rgba(16,185,129,0.15)', framework:'HIPAA',   replacement:'[HEALTH_ID]'    },
]

const REPLACEMENT_OPTIONS: Replacement[] = ['[REDACTED]', 'XXX', '***']

/* ─── Regex definitions for each built-in pattern ────────────────────────── */
const PATTERN_REGEXES: Record<string, RegExp> = {
  cc:       /\b(?:4[0-9]{3}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}|5[1-5][0-9]{2}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}|3[47][0-9]{2}[\s\-]?[0-9]{6}[\s\-]?[0-9]{5})\b/g,
  ssn:      /\b\d{3}-\d{2}-\d{4}\b/g,
  email:    /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
  phone:    /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  apikey:   /\b(?:sk-proj-[a-zA-Z0-9_\-]{16,}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xoxb-[a-zA-Z0-9\-]{40,})\b/g,
  aws:      /\bAKIA[0-9A-Z]{16}\b/g,
  privkey:  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  iban:     /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/g,
  passport: /\b[A-Z]{1,2}\s?\d{7,9}\b/g,
  health:   /\b(?:NPI:\s*\d{10}|MRN[:\s]+\d{6,10})\b/g,
}

/* ─── Shield engine (pure, runs in browser) ──────────────────────────────── */
interface ShieldMatch {
  patternId: string; label: string
  replacement: Replacement; value: string; start: number; end: number
}
type OutputSegment =
  | { kind: 'text';   value: string }
  | { kind: 'redact'; replacement: string; original: string; label: string }

function runShield(
  text: string,
  patterns: Pattern[],
  customs: CustomPattern[],
): { matches: ShieldMatch[]; segments: OutputSegment[] } {
  if (!text.trim()) return { matches: [], segments: [{ kind: 'text', value: text }] }

  const raw: ShieldMatch[] = []

  for (const p of patterns) {
    const src = PATTERN_REGEXES[p.id]
    if (!src) continue
    const re = new RegExp(src.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null)
      raw.push({ patternId: p.id, label: p.label, replacement: p.replacement, value: m[0], start: m.index, end: m.index + m[0].length })
  }

  for (const c of customs) {
    try {
      const re = new RegExp(c.regex, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null)
        raw.push({ patternId: c.id, label: c.label, replacement: c.replacement, value: m[0], start: m.index, end: m.index + m[0].length })
    } catch { /* invalid regex */ }
  }

  const matches: ShieldMatch[] = []
  raw.sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const m of raw) {
    if (m.start >= cursor) { matches.push(m); cursor = m.end }
  }

  const segments: OutputSegment[] = []
  let pos = 0
  for (const m of matches) {
    if (m.start > pos) segments.push({ kind: 'text', value: text.slice(pos, m.start) })
    segments.push({ kind: 'redact', replacement: m.replacement, original: m.value, label: m.label })
    pos = m.end
  }
  if (pos < text.length) segments.push({ kind: 'text', value: text.slice(pos) })

  return { matches, segments }
}

/* ─── Tester component ───────────────────────────────────────────────────── */
const EXAMPLE_PROMPTS = [
  { label: 'Credit card leak', text: 'Please charge $49.99 to my Visa card 4532 1234 5678 9010 expiry 12/26 CVV 123.' },
  { label: 'API key exposure', text: 'Here is my OpenAI key: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdef. Can you debug this code?' },
  { label: 'PII in prompt',   text: 'My SSN is 078-05-1120 and you can reach me at john.doe@example.com or +1 (555) 867-5309.' },
  { label: 'AWS credentials', text: 'Use access key AKIAIOSFODNN7EXAMPLE and secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.' },
]

function benchMicroCS(run: () => void): number {
  const N = 30
  const t0 = performance.now()
  for (let i = 0; i < N; i++) run()
  return ((performance.now() - t0) / N) * 1000
}

const BENCH_SAMPLE_CS = 'Contact jane.doe@example.com or +1 (415) 555-0123, card 4111-1111-1111-1111, SSN 123-45-6789, key sk-proj-abcdefghijklmnop1234. '.repeat(4)

/** Mirrors the gateway's built-in patterns so timings reflect real cost. */
const BUILTIN_REGEX_CS: Record<string, string> = {
  cc: '\\b(?:4[0-9]{3}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}|5[1-5][0-9]{2}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4})\\b',
  ssn: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
  email: '\\b[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}\\b',
  phone: '(?:\\+?1[.\\-\\s]?)?\\(?[2-9]\\d{2}\\)?[.\\-\\s]?\\d{3}[.\\-\\s]?\\d{4}\\b',
  apikey: '\\b(?:sk-proj-[a-zA-Z0-9_\\-]{16,}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})\\b',
  aws: '\\bAKIA[0-9A-Z]{16}\\b',
  privkey: '-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----',
  iban: '\\b[A-Z]{2}\\d{2}[A-Z0-9]{4}\\d{7}[A-Z0-9]{0,16}\\b',
  passport: '\\b[A-Z]{1,2}\\s?\\d{7,9}\\b',
  health: '\\b(?:NPI:\\s*\\d{10}|MRN[:\\s]+\\d{6,10})\\b',
}

function benchPattern(regex: string): number {
  let re: RegExp | null = null
  try { re = new RegExp(regex, 'g') } catch {}
  return benchMicroCS(() => { if (re) { re.lastIndex = 0; re.test(BENCH_SAMPLE_CS) } })
}

function TimingBadge({ us }: { us?: number }) {
  if (us === undefined) return null
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20 flex-shrink-0"
      title="Measured matching cost per ~500-char payload">
      ~{us < 1 ? us.toFixed(1) : Math.round(us)}µs
    </span>
  )
}

function RuleTester({ patterns, customs }: { patterns: Pattern[]; customs: CustomPattern[] }) {
  const [input, setInput] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const allSelectable = [
    ...patterns.map(p => ({ id: p.id, label: p.label })),
    ...customs.map(c => ({ id: `custom-${c.id}`, label: c.label })),
  ]
  const isActive = (id: string) => selectedIds.size === 0 || selectedIds.has(id)
  const togglePattern = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const activePatterns = patterns.filter(p => isActive(p.id))
  const activeCustoms  = customs.filter(c => isActive(`custom-${c.id}`))

  const { matches, segments } = useMemo(
    () => runShield(input, activePatterns, activeCustoms),
    [input, patterns, customs, selectedIds]
  )

  const hasInput = input.trim().length > 0

  return (
    <GlassCard
      title="Live Rule Tester"
      subtitle="Paste text to preview how active patterns would redact sensitive data"
      action={<FlaskConical size={14} className="text-violet-400"/>}>

      <div className="mb-4">
        <div className="text-[10px] t3 mb-1.5">
          Test against: {selectedIds.size === 0 ? 'all patterns' : `${selectedIds.size} selected`}
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())} className="ml-2 text-indigo-400 hover:text-indigo-300">clear</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allSelectable.map(r => {
            const on = selectedIds.has(r.id)
            return (
              <button key={r.id} onClick={() => togglePattern(r.id)}
                className={clsx('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all',
                  on ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                     : 't3 ring-1 ring-[var(--bd)] hover:bg-[var(--glass-hover)]')}>
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] t4">Try:</span>
          {EXAMPLE_PROMPTS.map(ex => (
            <button key={ex.label} onClick={() => setInput(ex.text)}
              className="px-2 py-0.5 rounded-md text-[10px] glass t3 hover:text-violet-300 transition-colors">
              {ex.label}
            </button>
          ))}
        </div>
        {hasInput && (
          <button onClick={() => setInput('')}
            className="ml-auto text-[10px] t4 hover:t2 flex items-center gap-1 transition-colors">
            <X size={10}/> Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider t3 font-medium px-1">Input</div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Paste text to test…"
            className="glass-input w-full rounded-xl px-4 py-3 text-xs font-mono leading-relaxed resize-none h-44 placeholder:t4"
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider t3 font-medium px-1">
            After Redaction
            {hasInput && matches.length === 0 && (
              <span className="ml-2 text-emerald-400 normal-case font-normal">✓ no sensitive data found</span>
            )}
          </div>

          {!hasInput ? (
            <div className="h-44 glass rounded-xl flex items-center justify-center">
              <span className="text-[11px] t4">Output will appear here</span>
            </div>
          ) : (
            <div className="h-44 glass rounded-xl px-4 py-3 overflow-auto text-xs font-mono leading-relaxed">
              {segments.map((seg, i) => {
                if (seg.kind === 'text')   return <span key={i} className="t2">{seg.value}</span>
                if (seg.kind === 'redact') return (
                  <span key={i} title={`Redacted by: ${seg.label} (was: ${seg.original})`}
                    className="bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 rounded px-0.5">
                    {seg.replacement}
                  </span>
                )
                return null
              })}
            </div>
          )}
        </div>
      </div>

      {hasInput && matches.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider t3 font-medium px-1">
            {matches.length} match{matches.length > 1 ? 'es' : ''} — redacted
          </div>
          <div className="space-y-1">
            {matches.map((m, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-xl ring-1 text-[11px] bg-indigo-500/10 ring-indigo-500/20">
                <span className="text-[9px] font-bold text-indigo-400 flex-shrink-0">Aa→</span>
                <span className="t2 flex-shrink-0">{m.label}</span>
                <ArrowRight size={10} className="t4 flex-shrink-0"/>
                <span className="font-mono t3 truncate">{m.value}</span>
                <ArrowRight size={10} className="t4 flex-shrink-0"/>
                <span className="font-mono text-indigo-300 flex-shrink-0">{m.replacement}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

const FRAMEWORK_COLORS: Record<string, string> = {
  'PCI DSS':'text-red-400 bg-red-500/10 ring-red-500/20',
  'PII':    'text-amber-400 bg-amber-500/10 ring-amber-500/20',
  'GDPR':   'text-blue-400 bg-blue-500/10 ring-blue-500/20',
  'Secrets':'text-purple-400 bg-purple-500/10 ring-purple-500/20',
  'HIPAA':  'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20',
  'Custom': 'text-indigo-400 bg-indigo-500/10 ring-indigo-500/20',
}

type MockDetection = { id: string; timeAgo: string; type: string; pattern: string; action: string; model: string; replacement: string; preview: string; matched: string; promptTokens: number; cost: number }

function fmt$(n: number) { return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}` }

function ReplacementPicker({ replacement, onChange }: { replacement: Replacement; onChange: (r: Replacement) => void }) {
  const [customRep, setCustomRep] = useState('')
  const isCustom = !REPLACEMENT_OPTIONS.includes(replacement)
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[9px] t4 flex-shrink-0">Replace with</span>
      {REPLACEMENT_OPTIONS.map(r => (
        <button key={r} onClick={() => onChange(r)}
          className={clsx('px-2 py-0.5 rounded-lg text-[9px] font-mono transition-all',
            replacement === r && !isCustom ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30' : 'glass t4 hover:t2')}>
          {r}
        </button>
      ))}
      <input
        className={clsx('glass-input rounded-lg px-2 py-0.5 text-[9px] font-mono w-20 transition-all',
          isCustom ? 'ring-1 ring-indigo-500/30' : '')}
        placeholder="custom…"
        value={isCustom ? replacement : customRep}
        onChange={e => { setCustomRep(e.target.value); if (e.target.value) onChange(e.target.value) }}
      />
    </div>
  )
}

function PatternRow({ p, onReplacement }: {
  p: Pattern; onReplacement: (r: Replacement) => void
}) {
  const us = useMemo(() => benchPattern(BUILTIN_REGEX_CS[p.id] ?? ''), [p.id])
  const [showDetail, setShowDetail] = useState(false)
  const Icon = p.icon
  return (
    <div className="border-b bd last:border-0">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: p.glow }}>
            <Icon size={11} className={p.color}/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium t1">{p.label}</span>
              <TimingBadge us={us}/>
              <button onClick={() => setShowDetail(d => !d)} className="t4 hover:t2 transition-colors">
                {showDetail ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
              </button>
            </div>
            {showDetail && (
              <div className="text-[10px] t4 mt-0.5 space-y-0.5">
                <div>{p.description}</div>
                <div>e.g. <span className="font-mono text-indigo-300">{p.example}</span></div>
              </div>
            )}
            {!showDetail && <div className="text-[10px] t4 truncate">{p.description}</div>}
          </div>
        </div>
        <span className={clsx('px-2 py-0.5 rounded-full text-[9px] font-medium ring-1 flex-shrink-0',
          FRAMEWORK_COLORS[p.framework])}>
          {p.framework}
        </span>
        <ReplacementPicker replacement={p.replacement} onChange={onReplacement}/>
      </div>
    </div>
  )
}

function DetectionDetail({ ev }: { ev: MockDetection }) {
  return (
    <div className="px-5 py-4 bg-white/[0.02] border-b bd text-xs space-y-3">
      <div className="grid grid-cols-4 gap-4">
        {[
          ['Request ID',      ev.id],
          ['Model',           ev.model],
          ['Direction',       ev.type],
          ['Pattern matched', ev.pattern],
          ['Action taken',    ev.action],
          ['Replacement',     ev.replacement],
          ['Prompt tokens',   ev.promptTokens.toLocaleString()],
          ['Cost',            fmt$(ev.cost)],
          ['Time',            ev.timeAgo],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="t4 text-[10px] mb-0.5">{k}</div>
            <div className="t1 font-medium break-all text-[11px]">{v}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="t4 text-[10px] mb-1">Content preview (matched value highlighted)</div>
        <div className="glass rounded-lg px-3 py-2 text-[11px] t2 leading-relaxed">
          {ev.preview.replace(ev.matched.slice(0, 12), `⟨${ev.matched.slice(0, 20)}…⟩`)}
        </div>
      </div>
    </div>
  )
}

const MOCK_DETECTIONS: MockDetection[] = [
  { id:'a1b2c3d4e5f6', timeAgo:'1m ago',  type:'request',  pattern:'Credit Card Numbers', action:'blocked', model:'gpt-4o',           replacement:'[REDACTED]', preview:'Please process payment for card 4532 1234 5678 9010 expiry 12/26', matched:'4532 1234 5678 9010', promptTokens:48,  cost:0.00024 },
  { id:'f7a8b9c0d1e2', timeAgo:'3m ago',  type:'request',  pattern:'API Keys & Secrets',  action:'blocked', model:'claude-sonnet-4-6', replacement:'[SECRET]',   preview:'My API key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWx, please debug this', matched:'sk-proj-AbCdEfGhIj…', promptTokens:62, cost:0.00062 },
  { id:'e3f4a5b6c7d8', timeAgo:'7m ago',  type:'response', pattern:'Email Addresses',     action:'flagged', model:'gemini-2.0-flash',  replacement:'[EMAIL]',    preview:'You can contact the team at john.doe@internal.acme.com for support', matched:'john.doe@internal.acme.com', promptTokens:35, cost:0.00015 },
  { id:'e9f0a1b2c3d4', timeAgo:'20m ago', type:'request',  pattern:'Email Addresses',     action:'flagged', model:'gpt-4o-mini',       replacement:'[EMAIL]',    preview:'Draft a follow-up email to sarah.jones@company.org about the project', matched:'sarah.jones@company.org', promptTokens:29, cost:0.00008 },
  { id:'c5d6e7f8a9b0', timeAgo:'1h ago',  type:'response', pattern:'AWS Credentials',     action:'blocked', model:'gpt-4o',            replacement:'[AWS_KEY]',  preview:'Use AKIAIOSFODNN7EXAMPLE with secret wJalrXUtnFEMI/K7MDENG/bPxRfiCY', matched:'AKIAIOSFODNN7EXAMPLE', promptTokens:54, cost:0.00027 },
]

/* ─── Storage key ────────────────────────────────────────────────────────── */
const LS_SHIELD = 'ai-gateway:content-shield'

export default function ContentShieldClient() {
  const [patterns, setPatterns]   = useState<Pattern[]>(DEFAULT_PATTERNS)
  const [customs, setCustoms]     = useState<CustomPattern[]>([])
  const [saved, setSaved]         = useState(false)
  const [expandedDetection, setExpandedDetection] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [addOpen, setAddOpen]     = useState(false)
  const [newLabel, setNewLabel]   = useState('')
  const [newRegex, setNewRegex]   = useState('')
  const [newRep, setNewRep]       = useState<Replacement>('[REDACTED]')
  const [loaded, setLoaded]       = useState(false)

  /* Load from localStorage once — runs only on client (ssr:false guarantees this) */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SHIELD)
      if (raw) {
        const d = JSON.parse(raw)
        if (Array.isArray(d.patterns)) {
          setPatterns(DEFAULT_PATTERNS.map(def => {
            const s = d.patterns.find((p: any) => p.id === def.id)
            return s ? { ...def, replacement: s.replacement || def.replacement } : def
          }))
        }
        if (Array.isArray(d.customs)) setCustoms(
          (d.customs as any[]).map(c => ({ id: c.id, label: c.label, regex: c.regex ?? '', replacement: c.replacement ?? '[REDACTED]' }))
        )
      }
    } catch {
      /* corrupted localStorage — start fresh with defaults */
    }
    setLoaded(true)
  }, [])

  /* Persist to localStorage (skip until initial load is done) */
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(LS_SHIELD, JSON.stringify({
        patterns: patterns.map(({ icon: _icon, ...rest }) => rest),
        customs,
      }))
    } catch {}
  }, [patterns, customs, loaded])

  const frameworks = [...new Set(patterns.map(p => p.framework))]

  const setPReplacement = (id: string, r: Replacement) => setPatterns(ps => ps.map(p => p.id === id ? { ...p, replacement: r } : p))

  const handleSave = async () => {
    setSaving(true); setSaveError(false)
    const rules: ContentShieldApiRule[] = [
      ...patterns.map(p => ({
        id: p.id,
        label: p.label,
        pattern: '',   // backend uses built-in regex for known IDs
        action: 'redact',
        replacement: p.replacement,
        scope: 'both',
        enabled: true,
      })),
      ...customs.map(c => ({
        id: c.id,
        label: c.label,
        pattern: c.regex,
        action: 'redact',
        replacement: c.replacement,
        scope: 'both',
        enabled: true,
      })),
    ]
    const ok = await updateContentShieldConfig(rules)
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { setSaveError(true); setTimeout(() => setSaveError(false), 3000) }
  }

  const [customSearch, setCustomSearch] = useState('')
  const [customPage, setCustomPage] = useState(1)
  const CUSTOM_PAGE_SIZE = 8
  const filteredCustoms = customs.filter(c =>
    !customSearch.trim() ||
    c.label.toLowerCase().includes(customSearch.toLowerCase()) ||
    c.regex.toLowerCase().includes(customSearch.toLowerCase()))
  const customPages = Math.max(1, Math.ceil(filteredCustoms.length / CUSTOM_PAGE_SIZE))
  const pagedCustoms = filteredCustoms.slice((customPage - 1) * CUSTOM_PAGE_SIZE, customPage * CUSTOM_PAGE_SIZE)
  useEffect(() => { setCustomPage(1) }, [customSearch])

  const addCustom = () => {
    if (!newLabel.trim() || !newRegex.trim()) return
    setCustoms(cs => [...cs, { id:`cp-${Date.now()}`, label:newLabel.trim(), regex:newRegex.trim(), replacement:newRep }])
    setNewLabel(''); setNewRegex(''); setNewRep('[REDACTED]'); setAddOpen(false)
  }

  // Live stats from request logs (last 7 days).
  const [liveStats, setLiveStats] = useState<{ detections: number; blocked: number } | null>(null)
  useEffect(() => {
    const now = Date.now()
    fetchLogs({ from: now - 7 * 86_400_000, to: now, page: 1, per_page: 1000, sort_by: 'ts', sort_dir: 'desc' })
      .then(res => {
        const items: any[] = res.items ?? []
        setLiveStats({
          detections: items.filter(i => (i.flags ?? '').includes('shield:')).length,
          blocked: items.filter(i => (i.error ?? '').toLowerCase().includes('content shield')).length,
        })
      })
  }, [])

  const totalPatterns = patterns.length + customs.length
  const statItems = [
    { label:'Patterns configured', value:String(totalPatterns), sub:`${customs.length} custom`,                                  color:'text-indigo-400',  glow:'rgba(99,102,241,0.12)',  iconName:'lock'   as const },
    { label:'Detections (7d)',      value: liveStats ? String(liveStats.detections) : '…', sub:'matched & redacted in transit',  color:'text-amber-400',   glow:'rgba(245,158,11,0.12)', iconName:'flag'   as const },
    { label:'Blocked (7d)',         value: liveStats ? String(liveStats.blocked) : '…',    sub:'requests rejected',              color:'text-indigo-400',  glow:'rgba(99,102,241,0.12)', iconName:'shield' as const },
    { label:'Frameworks covered',   value:String(frameworks.length), sub:frameworks.join(' · ') || 'none',                       color:'text-emerald-400', glow:'rgba(16,185,129,0.12)', iconName:'shield' as const },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Content Shield</h1>
          <p className="text-sm t3 mt-1">Scans prompts and responses for sensitive data — PII, secrets, financial records, and custom patterns</p>
        </div>
        <button onClick={handleSave} disabled={saving || !loaded}
          className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 flex-shrink-0',
            saveError ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
            : saved    ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                       : 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed')}>
          {saveError ? <><AlertTriangle size={14}/>Gateway offline</>
           : saved    ? <><CheckCircle2 size={14}/>Applied to gateway</>
           : saving   ? <><Save size={14}/>Applying…</>
                      : <><Save size={14}/>Save & apply</>}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statItems.map(s => (
          <div key={s.label} className="glass rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs t3">{s.label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: s.glow }}>
                {s.iconName === 'lock'   && <Lock      size={14} className={s.color}/>}
                {s.iconName === 'flag'   && <Flag      size={14} className={s.color}/>}
                {s.iconName === 'shield' && <ShieldCheck size={14} className={s.color}/>}
              </div>
            </div>
            <div className="text-lg font-bold t1 truncate">{s.value}</div>
            <div className="text-[10px] t3">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Detection patterns */}
      <GlassCard title="Detection patterns" subtitle="Configure the replacement token used when each pattern is detected in a route" noPad>
        <div>
          {patterns.map(p => (
            <PatternRow key={p.id} p={p}
              onReplacement={r => setPReplacement(p.id, r)}
            />
          ))}
        </div>
      </GlassCard>

      {/* Custom patterns */}
      <GlassCard title="Custom patterns" subtitle="Regex-based rules for domain-specific sensitive data" noPad
        action={
          <button onClick={() => setAddOpen(o => !o)}
            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-xs">
            <Plus size={12}/> Add pattern
          </button>
        }>
        {customs.length > 0 && (
          <div className="px-5 py-2.5 border-b bd">
            <input className="glass-input w-full rounded-xl px-3 py-1.5 text-xs"
              placeholder="Search custom patterns by name or regex…"
              value={customSearch} onChange={e => setCustomSearch(e.target.value)}/>
          </div>
        )}
        {addOpen && (
          <div className="px-5 py-4 border-b bd space-y-3 bg-white/[0.02]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] t3 block mb-1.5">Pattern name</label>
                <input className="glass-input w-full rounded-xl px-3 py-2 text-xs"
                  placeholder="e.g. Internal employee ID"
                  value={newLabel} onChange={e => setNewLabel(e.target.value)}/>
              </div>
              <div>
                <label className="text-[10px] t3 block mb-1.5">Regex</label>
                <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono"
                  placeholder="EMP-\d{6}"
                  value={newRegex} onChange={e => setNewRegex(e.target.value)}/>
              </div>
            </div>
            <div>
              <label className="text-[10px] t3 block mb-1.5">Replacement token</label>
              <ReplacementPicker replacement={newRep} onChange={setNewRep}/>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAddOpen(false)} className="glass glass-hover rounded-xl px-3 py-1.5 text-xs t2">Cancel</button>
              <button onClick={addCustom} disabled={!newLabel.trim() || !newRegex.trim()}
                className="bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 rounded-xl px-3 py-1.5 text-xs font-medium hover:bg-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                Add pattern
              </button>
            </div>
          </div>
        )}
        {customs.length === 0 && !addOpen ? (
          <div className="px-5 py-8 text-center">
            <FileCode2 size={24} className="t4 mx-auto mb-2"/>
            <div className="text-xs t3">No custom patterns yet</div>
            <div className="text-[10px] t4 mt-1">Add regex rules for domain-specific sensitive data</div>
          </div>
        ) : pagedCustoms.map(c => (
          <div key={c.id} className="flex items-start gap-3 px-5 py-3.5 border-b bd last:border-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium t1">{c.label}</span>
                <span className={clsx('px-2 py-0.5 rounded-full text-[9px] font-medium ring-1', FRAMEWORK_COLORS['Custom'])}>Custom</span>
                <TimingBadge us={benchPattern(c.regex)}/>
              </div>
              <div className="text-[10px] font-mono t4 mb-1.5">{c.regex}</div>
              <ReplacementPicker replacement={c.replacement}
                onChange={r => setCustoms(cs => cs.map(x => x.id === c.id ? { ...x, replacement: r } : x))}/>
            </div>
            <button onClick={() => setCustoms(cs => cs.filter(x => x.id !== c.id))} className="t4 hover:text-red-400 transition-colors flex-shrink-0">
              <X size={12}/>
            </button>
          </div>
        ))}
        {customs.length > 0 && filteredCustoms.length === 0 && (
          <div className="px-5 py-6 text-center text-xs t4">No patterns match “{customSearch}”</div>
        )}
        {customPages > 1 && (
          <div className="flex items-center justify-between px-5 py-2.5 border-t bd text-[10px] t3">
            <span>{filteredCustoms.length} pattern{filteredCustoms.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button disabled={customPage <= 1} onClick={() => setCustomPage(p => p - 1)}
                className="px-2 py-1 rounded-lg glass glass-hover disabled:opacity-30">Prev</button>
              <span>{customPage} / {customPages}</span>
              <button disabled={customPage >= customPages} onClick={() => setCustomPage(p => p + 1)}
                className="px-2 py-1 rounded-lg glass glass-hover disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Live rule tester */}
      <RuleTester patterns={patterns} customs={customs}/>

    </div>
  )
}
