'use client'
import { useState, useMemo, useEffect } from 'react'
import {
  ShieldAlert, ShieldCheck, Flag, Ban, Save, CheckCircle2,
  ChevronDown, ChevronUp, ChevronRight, Plus, X, Sword, MessageSquareX,
  Eye, Heart, FlameKindling, Gavel,
  Search, Zap, Info, RotateCcw, AlertTriangle,
} from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import clsx from 'clsx'
import { fetchLogs, updateGuardrailsConfig, type GuardrailApiRule } from '@/lib/api'

/* ─── Types ──────────────────────────────────────────────────────────────── */
type Action = 'off' | 'flag' | 'block'
type Scope  = 'request' | 'response' | 'both'

interface BuiltinCategory {
  id: string; label: string; description: string
  icon: React.ElementType; color: string; glow: string; ring: string
  defaultAction: Action; builtinKeywords: string[]; builtinPatterns: string[]
}
interface CustomRule {
  id: string; label: string; keywords: string[]; pattern: string
}

/* ─── Categories — industry-grade keyword lists ──────────────────────────── */
const CATEGORIES: BuiltinCategory[] = [
  {
    id: 'violence', label: 'Violence & Gore', icon: Sword,
    description: 'Graphic violence, gore, instructions for physical harm, or attack planning',
    color: 'text-red-400', glow: 'rgba(239,68,68,0.12)', ring: 'rgba(239,68,68,0.3)',
    defaultAction: 'block',
    builtinKeywords: [
      'how to make a bomb', 'bomb making instructions', 'build an explosive device',
      'improvised explosive device', 'ied construction', 'pipe bomb instructions',
      'how to make thermite', 'molotov cocktail instructions', 'how to make napalm',
      'pressure cooker bomb', 'fertiliser bomb', 'amfo explosive',
      'convert semi-automatic to automatic', 'ghost gun instructions', '3d print a gun',
      'how to remove serial number from gun', 'untraceable firearm', 'auto sear instructions',
      'buy gun without background check', 'illegal gun modification',
      'how to kill someone', 'murder step by step', 'how to stab without leaving evidence',
      'how to strangle someone', 'poison someone without detection', 'how to make poison',
      'how to hurt someone', 'mass shooting guide', 'attack planning guide',
      'shooting up a school', 'plan a terrorist attack', 'vehicle ramming attack',
      'sniper attack instructions', 'how to get away with murder',
      'detailed torture methods', 'how to dispose of a body', 'body dismemberment',
    ],
    builtinPatterns: [
      '\\b(bomb|explosive|grenade|ied)\\s*(making|build|instructions|guide|tutorial|recipe|construct)\\b',
      '\\b(how to|steps to|guide to|tutorial for)\\s+(kill|murder|assassinate|attack|poison|strangle)\\b',
      '\\b(shoot|attack|target|massacre)\\s+(school|church|mosque|synagogue|crowd|concert|mall)\\b',
      '\\b(convert|modify)\\s+(semi.?auto|firearm|pistol|rifle)\\s+(to|into)\\s+auto\\b',
    ],
  },
  {
    id: 'hate', label: 'Hate Speech', icon: MessageSquareX,
    description: 'Dehumanisation or discrimination based on protected characteristics',
    color: 'text-orange-400', glow: 'rgba(249,115,22,0.12)', ring: 'rgba(249,115,22,0.3)',
    defaultAction: 'block',
    builtinKeywords: [
      'white supremacy', 'white nationalist', 'white genocide conspiracy', 'great replacement',
      'ethnic cleansing', 'racial genocide', 'master race', 'aryan superiority',
      'neo-nazi ideology', 'third reich glorification', 'holocaust denial',
      'fourteen words white', 'heil hitler', 'gas the', 'final solution promotion',
      'racial inferiority', 'racial hierarchy', 'sub-human race', 'inferior race',
      'demographic replacement conspiracy', 'race war now', 'deport all immigrants',
      'religious extermination', 'kill all muslims', 'kill all jews', 'kill all christians',
      'islamic terrorism promotion', 'jewish world conspiracy', 'zionist conspiracy',
      'islamophobic violence', 'antisemitic propaganda',
      'conversion therapy promotion', 'trans people are predators', 'gay grooming conspiracy',
      'lgbt should be illegal', 'kill all gay', 'homosexuality is a disease',
      'eugenics promotion', 'forced sterilisation', 'genocide of disabled',
    ],
    builtinPatterns: [
      '\\b(gas|exterminate|eliminate|cleanse)\\s+(the\\s+)?(jews?|muslims?|blacks?|gays?|immigrants?)\\b',
      '\\b(all|every)\\s+(jews?|muslims?|blacks?|immigrants?)\\s+(should|must|deserve to)\\s+(die|be killed|be deported)\\b',
      '\\b(white|aryan)\\s+(nation|power|pride|supremac)\\b',
    ],
  },
  {
    id: 'sexual', label: 'Explicit Content', icon: Eye,
    description: 'CSAM, non-consensual intimate content, or sexually explicit material',
    color: 'text-pink-400', glow: 'rgba(236,72,153,0.12)', ring: 'rgba(236,72,153,0.3)',
    defaultAction: 'block',
    builtinKeywords: [
      'child sexual abuse material', 'csam', 'child pornography', 'minor sexual content',
      'sexual content involving minors', 'lolicon sexual', 'shotacon sexual',
      'sexualise a child', 'sexual story involving children', 'underage sexual',
      'generate child nude', 'sexual roleplay as minor',
      'non-consensual sexual content', 'rape fantasy story', 'sexual assault story',
      'revenge porn', 'deepfake porn of real person', 'non-consensual intimate images',
      'ncii creation', 'drugged and assaulted story',
      'write sex scene', 'explicit sexual content', 'pornographic story',
      'erotic roleplay', 'sexual solicitation', 'nude image generation',
      'generate nude', 'sexual fantasy story involving real person', 'write erotica about',
    ],
    builtinPatterns: [
      '\\b(child|minor|underage|kid|teen)\\s*(sexual|nude|naked|porn|erotic|explicit)\\b',
      '\\b(sexual|erotic|explicit)\\s*(content|story|scene|roleplay)\\s*(with|involving|about)\\s*(a\\s+)?(child|minor|kid|teen)\\b',
      '\\b(generate|create|write|describe)\\s+(nude|naked|sexual)\\s+(image|photo|picture|scene)\\s+(of|for)\\s+(a\\s+)?(real|actual)\\b',
    ],
  },
  {
    id: 'harassment', label: 'Harassment & Bullying', icon: AlertTriangle,
    description: 'Targeted abuse, threats, doxxing, stalking, or sustained intimidation',
    color: 'text-amber-400', glow: 'rgba(245,158,11,0.12)', ring: 'rgba(245,158,11,0.3)',
    defaultAction: 'flag',
    builtinKeywords: [
      'i will find you', 'i know where you live', 'i know where your kids go to school',
      'death threat', 'i will kill you', 'you will regret this', 'watch your back',
      'i will hurt you', 'make your life hell', 'destroy your life', 'you are dead',
      'find their home address', 'doxxing guide', 'post their personal info',
      'swatting instructions', 'how to swat someone', 'expose personal information',
      'dox someone online', 'find someone real address', 'leak their private info',
      'how to stalk someone online', 'track someone location without knowing',
      'how to follow someone without being noticed', 'spy on ex partner',
      'install tracking app without consent', 'access their messages secretly',
      'how to cyberbully', 'coordinated harassment campaign', 'brigading attack',
      'destroy their reputation online', 'mass report their account', 'cancel campaign',
      'fuck you', 'go fuck yourself', 'motherfucker', 'son of a bitch',
      'piece of shit', 'you piece of shit', 'suck my dick', 'eat shit',
      'stupid bitch', 'dumb bitch', 'shut the fuck up', 'fucking idiot',
      'dumbass', 'jackass', 'asshole', 'screw you', 'kiss my ass',
    ],
    builtinPatterns: [
      '\\b(i will|i\'m going to|gonna)\\s+(kill|hurt|find|destroy|ruin)\\s+(you|him|her|them)\\b',
      '\\b(post|leak|expose|share)\\s+(their|your|his|her)\\s+(address|phone|photos|nudes|info|location)\\b',
      '\\b(how to|guide to)\\s+(stalk|dox|swat|track|harass)\\s+(someone|a person|them)\\b',
    ],
  },
  {
    id: 'self_harm', label: 'Self-harm & Suicide', icon: Heart,
    description: 'Content promoting methods for self-harm or suicide — follows safe messaging guidelines',
    color: 'text-rose-400', glow: 'rgba(251,113,133,0.12)', ring: 'rgba(251,113,133,0.3)',
    defaultAction: 'block',
    builtinKeywords: [
      'how to commit suicide', 'suicide methods', 'painless suicide method',
      'most effective suicide method', 'how to hang yourself', 'hanging method suicide',
      'ways to end my life', 'best method to die', 'lethal dose of pills',
      'how many pills to overdose', 'overdose to die', 'carbon monoxide suicide',
      'jumping suicide method', 'gun to head suicide',
      'how to cut yourself', 'self harm tutorial', 'how to cut deeper',
      'self harm without being noticed', 'how to hide self harm scars',
      'how to start cutting', 'self harm tools', 'razor blade cutting',
      'want to die together', 'suicide pact', 'i will help you die',
      'you should kill yourself', 'kill yourself', 'kys instructions',
      'no one will miss you', 'world is better without you',
      'how to starve yourself effectively', 'tips for anorexia', 'pro ana tips',
      'thinspo', 'pro mia tips', 'how to make yourself throw up',
    ],
    builtinPatterns: [
      '\\b(suicide|self.?harm|self.?injur)\\s*(method|instruction|guide|how|tutorial|step)\\b',
      '\\b(how to|steps to|ways to|best way to)\\s+(kill|harm|hurt|end)\\s+(myself|yourself|oneself|my life|your life)\\b',
      '\\b(lethal|fatal)\\s+(dose|amount|quantity)\\s+(of|for)\\b',
      '\\b(how (many|much))\\s+(pills?|tablets?|mg)\\s+(to|will)\\s+(overdose|kill|die)\\b',
    ],
  },
  {
    id: 'dangerous', label: 'Dangerous Information', icon: FlameKindling,
    description: 'CBRN weapons, drug manufacturing, malware development, cyberattack techniques',
    color: 'text-yellow-400', glow: 'rgba(234,179,8,0.12)', ring: 'rgba(234,179,8,0.3)',
    defaultAction: 'flag',
    builtinKeywords: [
      'how to make sarin', 'nerve agent synthesis', 'vx nerve agent production',
      'chlorine gas weapon', 'mustard gas production', 'chemical weapon synthesis',
      'ricin extraction', 'how to make ricin', 'botulinum toxin production',
      'how to weaponise anthrax', 'bioweapon creation', 'enhance pathogen transmissibility',
      'gain of function virus', 'weaponised smallpox', 'plague weapon',
      'dirty bomb construction', 'radiological weapon', 'nuclear device instructions',
      'enrich uranium at home', 'plutonium weapon',
      'how to make meth', 'methamphetamine synthesis', 'drug synthesis instructions',
      'fentanyl synthesis', 'how to synthesize heroin', 'dmt extraction guide',
      'lsd synthesis', 'mdma production', 'crack cocaine production',
      'how to cut drugs with fentanyl',
      'write malware', 'ransomware source code', 'keylogger source code',
      'trojan horse code', 'rootkit installation', 'botnet creation',
      'phishing kit download', 'credential harvester', 'reverse shell payload',
      'sql injection attack', 'xss payload', 'cross-site scripting attack',
      'privilege escalation exploit', 'zero-day exploit', 'buffer overflow attack',
      'bypass two-factor authentication', 'credential stuffing attack',
      'brute force attack script', 'pass the hash attack',
      'how to pick a lock', 'lock picking guide', 'bump key instructions',
      'how to hotwire a car', 'bypass car immobiliser',
    ],
    builtinPatterns: [
      '\\b(synthesize|manufacture|make|cook|produce|extract)\\s+(meth|fentanyl|heroin|cocaine|crack|mdma|lsd|ricin|sarin|vx)\\b',
      '\\b(write|create|build|code|develop)\\s+(malware|ransomware|keylogger|trojan|rootkit|botnet|spyware|worm)\\b',
      '\\b(chemical|biological|nuclear|radiological)\\s+(weapon|agent|bomb|device)\\s*(synthesis|production|creation|instructions)\\b',
      '\\b(sql|xss|csrf|xxe|ssrf|rce|lfi|rfi)\\s*(injection|attack|payload|exploit)\\b',
      '\\b(gain.?of.?function|enhance|modify|weaponise)\\s+(pathogen|virus|bacteria|toxin)\\b',
    ],
  },
  {
    id: 'illegal', label: 'Illegal Activity', icon: Gavel,
    description: 'Fraud, trafficking, money laundering, identity theft, or organised crime facilitation',
    color: 'text-purple-400', glow: 'rgba(168,85,247,0.12)', ring: 'rgba(168,85,247,0.3)',
    defaultAction: 'flag',
    builtinKeywords: [
      'money laundering steps', 'how to launder money', 'structuring cash deposits',
      'smurfing money laundering', 'shell company fraud', 'tax evasion scheme',
      'offshore account hiding', 'wire fraud scheme', 'securities fraud scheme',
      'insider trading tips', 'pump and dump scheme', 'ponzi scheme setup',
      'credit card fraud tutorial', 'how to clone a credit card', 'card skimmer instructions',
      'how to steal credit card info', 'identity theft guide', 'synthetic identity fraud',
      'how to open bank account with stolen identity', 'fake id instructions',
      'counterfeit money production', 'document forgery guide', 'how to forge a signature',
      'human trafficking routes', 'how to traffic people', 'smuggling routes',
      'organ trafficking', 'sex trafficking recruitment', 'labour trafficking',
      'drug trafficking route', 'darknet drug market', 'buy drugs on dark web',
      'illegal weapons purchase', 'straw purchase gun', 'buy gun darknet',
      'how to scam people', 'romance scam script', 'grandparent scam',
      'phishing email template', 'business email compromise', 'advance fee fraud',
      'insurance fraud guide', 'workers comp fraud', 'how to commit fraud',
      'hire a hacker', 'hacking for hire', 'access someone email without password',
      'how to hack facebook account', 'spy on partner phone', 'stalkerware install',
    ],
    builtinPatterns: [
      '\\b(launder|hide|conceal|clean)\\s+(money|funds|cash|proceeds)\\b',
      '\\b(steal|clone|skim|harvest)\\s+(credit.?card|debit.?card|bank.?account|identity)\\b',
      '\\b(fake|forged?|counterfeit)\\s+(id|passport|license|document|currency|money|bill)\\b',
      '\\b(buy|purchase|order|get)\\s+(drugs?|weapons?|guns?|firearms?)\\s+(online|darknet|dark web|tor)\\b',
      '\\b(human|sex|labour|organ)\\s+trafficking\\b',
    ],
  },
]

type MockEvent = { id: string; timeAgo: string; type: string; catId: string; action: string; preview: string; matched: string; model: string }
const MOCK_EVENTS: MockEvent[] = [
  { id:'a1b2c3d4', timeAgo:'2m ago',  type:'request',  catId:'violence',   action:'blocked', preview:'Can you explain how to make a bomb at home step by step?', matched:'how to make a bomb',          model:'gpt-4o' },
  { id:'e5f6a7b8', timeAgo:'5m ago',  type:'response', catId:'hate',        action:'blocked', preview:'Groups from that ethnic background are genetically inferior…', matched:'racial inferiority',        model:'claude-sonnet-4-6' },
  { id:'c9d0e1f2', timeAgo:'15m ago', type:'request',  catId:'dangerous',   action:'flagged', preview:'What common household chemicals can I use for drug synthesis?', matched:'drug synthesis instructions', model:'gemini-2.0-flash' },
  { id:'a3b4c5d6', timeAgo:'30m ago', type:'request',  catId:'harassment',  action:'flagged', preview:'Help me write a message: I know where you live and will…', matched:'i know where you live',      model:'gpt-4o-mini' },
  { id:'e7f8a9b0', timeAgo:'1h ago',  type:'response', catId:'self_harm',   action:'blocked', preview:'Here are some methods of self harm that are less noticeable…', matched:'self harm tutorial',       model:'claude-haiku' },
  { id:'c1d2e3f4', timeAgo:'2h ago',  type:'request',  catId:'illegal',     action:'flagged', preview:'Walk me through money laundering steps for a shell company…', matched:'money laundering steps',    model:'gpt-4o' },
]


function KeywordEditor({
  builtinKeywords, removedBuiltins, customKeywords,
  onToggleBuiltin, onAddCustom, onRemoveCustom, builtinPatterns,
}: {
  builtinKeywords: string[]; removedBuiltins: Set<string>; customKeywords: string[]
  onToggleBuiltin: (kw: string) => void; onAddCustom: (kw: string) => void
  onRemoveCustom: (kw: string) => void; builtinPatterns: string[]
}) {
  const [search, setSearch]   = useState('')
  const [newKw, setNewKw]     = useState('')
  const [showPat, setShowPat] = useState(false)
  const q = search.toLowerCase()

  const activeBuiltins  = builtinKeywords.filter(k => !removedBuiltins.has(k) && (!q || k.includes(q)))
  const removedList     = builtinKeywords.filter(k =>  removedBuiltins.has(k) && (!q || k.includes(q)))
  const filteredCustom  = customKeywords.filter(k => !q || k.includes(q))
  const totalActive = builtinKeywords.filter(k => !removedBuiltins.has(k)).length + customKeywords.length

  const addKw = () => {
    const kw = newKw.trim().toLowerCase()
    if (!kw || customKeywords.includes(kw) || builtinKeywords.includes(kw)) return
    onAddCustom(kw); setNewKw('')
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] t3 font-medium uppercase tracking-wide">Keywords — {totalActive} active</span>
        {removedBuiltins.size > 0 && (
          <span className="text-[9px] text-amber-400">{removedBuiltins.size} built-in{removedBuiltins.size > 1 ? 's' : ''} removed</span>
        )}
      </div>
      <div className="relative">
        <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 t4 pointer-events-none"/>
        <input className="glass-input w-full rounded-xl pl-7 pr-3 py-1.5 text-xs"
          placeholder="Search keywords…" value={search} onChange={e => setSearch(e.target.value)}/>
      </div>
      <div className="max-h-44 overflow-y-auto rounded-xl glass divide-y divide-white/[0.04]">
        {activeBuiltins.map(kw => (
          <div key={kw} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.04] transition-colors group">
            <span className="flex-1 text-[11px] font-mono t2 truncate">{kw}</span>
            <span className="text-[8px] t4 flex-shrink-0">built-in</span>
            <button onClick={() => onToggleBuiltin(kw)} className="opacity-0 group-hover:opacity-100 t4 hover:text-red-400 transition-all flex-shrink-0 ml-1">
              <X size={10}/>
            </button>
          </div>
        ))}
        {filteredCustom.map(kw => (
          <div key={kw} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.04] transition-colors group">
            <span className="flex-1 text-[11px] font-mono text-indigo-300 truncate">{kw}</span>
            <span className="text-[8px] text-indigo-400 flex-shrink-0">custom</span>
            <button onClick={() => onRemoveCustom(kw)} className="opacity-0 group-hover:opacity-100 t4 hover:text-red-400 transition-all flex-shrink-0 ml-1">
              <X size={10}/>
            </button>
          </div>
        ))}
        {removedList.map(kw => (
          <div key={kw} className="flex items-center gap-2 px-3 py-1.5 bg-red-500/5 group">
            <span className="flex-1 text-[11px] font-mono t4 truncate line-through">{kw}</span>
            <span className="text-[8px] text-red-400/60 flex-shrink-0">removed</span>
            <button onClick={() => onToggleBuiltin(kw)} className="opacity-0 group-hover:opacity-100 t4 hover:text-emerald-400 transition-all flex-shrink-0 ml-1">
              <RotateCcw size={10}/>
            </button>
          </div>
        ))}
        {activeBuiltins.length === 0 && filteredCustom.length === 0 && removedList.length === 0 && (
          <div className="px-3 py-4 text-center text-[10px] t4">No keywords match</div>
        )}
      </div>
      <div className="flex gap-2">
        <input className="glass-input flex-1 rounded-xl px-3 py-1.5 text-xs font-mono"
          placeholder="Add a keyword or phrase…" value={newKw}
          onChange={e => setNewKw(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKw()}/>
        <button onClick={addKw} disabled={!newKw.trim()}
          className="glass glass-hover rounded-xl px-3 py-1.5 text-xs t2 hover:t1 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1">
          <Plus size={10}/> Add
        </button>
      </div>
      {builtinPatterns.length > 0 && (
        <div>
          <button onClick={() => setShowPat(p => !p)} className="flex items-center gap-1.5 text-[10px] t4 hover:t2 transition-colors">
            {showPat ? <ChevronUp size={9}/> : <ChevronDown size={9}/>}
            {builtinPatterns.length} regex pattern{builtinPatterns.length > 1 ? 's' : ''}
          </button>
          {showPat && (
            <div className="mt-1.5 space-y-1">
              {builtinPatterns.map((p, i) => (
                <div key={i} className="px-3 py-1.5 rounded-lg glass text-[10px] font-mono t3 break-all">{p}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryCard({
  cat, removedBuiltins, customKeywords,
  onToggleBuiltin, onAddKeyword, onRemoveKeyword,
}: {
  cat: BuiltinCategory
  removedBuiltins: Set<string>; customKeywords: string[]
  onToggleBuiltin: (kw: string) => void
  onAddKeyword: (kw: string) => void; onRemoveKeyword: (kw: string) => void
}) {
  const Icon = cat.icon
  const [expanded, setExpanded] = useState(false)
  const activeCount = cat.builtinKeywords.filter(k => !removedBuiltins.has(k)).length + customKeywords.length
  const us = useMemo(
    () => benchKeywordRule(
      [...cat.builtinKeywords.filter(k => !removedBuiltins.has(k)), ...customKeywords],
      cat.builtinPatterns),
    [cat, removedBuiltins, customKeywords])

  return (
    <div className="glass rounded-2xl overflow-hidden transition-all duration-200">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: cat.glow, border: `1px solid ${cat.ring}` }}>
          <Icon size={13} className={cat.color}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold t1">{cat.label}</span>
            <TimingBadge us={us}/>
            <span className="text-[9px] t4">{activeCount} keywords</span>
            {customKeywords.length > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">+{customKeywords.length} custom</span>
            )}
            {removedBuiltins.size > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">-{removedBuiltins.size} removed</span>
            )}
          </div>
          <div className="text-[10px] t4 truncate">{cat.description}</div>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="t3 hover:t1 transition-colors p-1 flex-shrink-0">
          {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
        </button>
      </div>
      {expanded && (
        <div className="border-t bd px-4 py-4 space-y-3">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
            style={{ background:'rgba(99,102,241,0.07)', border:'1px solid rgba(99,102,241,0.15)' }}>
            <Info size={10} className="text-indigo-400 mt-0.5 flex-shrink-0"/>
            <span className="t3">
              <span className="text-indigo-400 font-medium">Case-insensitive substring match.</span>
              {' '}Hover a built-in keyword and click × to remove it.
              {' '}Add this category as a <span className="text-indigo-400">Guardrail</span> node in a Route to enforce it with Block or Flag action.
            </span>
          </div>
          <KeywordEditor
            builtinKeywords={cat.builtinKeywords} removedBuiltins={removedBuiltins}
            customKeywords={customKeywords} onToggleBuiltin={onToggleBuiltin}
            onAddCustom={onAddKeyword} onRemoveCustom={onRemoveKeyword}
            builtinPatterns={cat.builtinPatterns}
          />
        </div>
      )}
    </div>
  )
}

/** Micro-benchmark a matcher: median time per run in microseconds. */
function benchMicro(run: () => void): number {
  const N = 30
  const t0 = performance.now()
  for (let i = 0; i < N; i++) run()
  return ((performance.now() - t0) / N) * 1000
}

const BENCH_SAMPLE = 'The quick brown fox contacted support@example.com about order 4111-1111-1111-1111 and asked to ignore previous instructions while running a quick test of the system today. '.repeat(4)

function benchKeywordRule(keywords: string[], patterns: string[]): number {
  const lower = BENCH_SAMPLE.toLowerCase()
  const regexes = patterns.map(p => { try { return new RegExp(p, 'i') } catch { return null } }).filter(Boolean) as RegExp[]
  return benchMicro(() => {
    keywords.forEach(kw => lower.includes(kw.toLowerCase()))
    regexes.forEach(re => re.test(BENCH_SAMPLE))
  })
}

function TimingBadge({ us }: { us?: number }) {
  if (us === undefined) return null
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20 flex-shrink-0"
      title="Measured matching cost per ~600-char payload">
      ~{us < 1 ? us.toFixed(1) : Math.round(us)}µs
    </span>
  )
}

function LiveTester({ categories, removedBuiltinsMap, customKeywordsMap, customRules }: {
  categories: BuiltinCategory[]
  removedBuiltinsMap: Record<string, Set<string>>; customKeywordsMap: Record<string, string[]>
  customRules: CustomRule[]
}) {
  const [text, setText] = useState('')
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set())

  const allSelectable = [
    ...categories.map(c => ({ id: c.id, label: c.label })),
    ...customRules.map(r => ({ id: `custom-${r.id}`, label: r.label })),
  ]
  const isActive = (id: string) => selectedRules.size === 0 || selectedRules.has(id)
  const toggleRule = (id: string) =>
    setSelectedRules(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const results = useMemo(() => {
    if (!text.trim()) return []
    const lower = text.toLowerCase()
    const hits: { label: string; keyword: string; color: string }[] = []
    categories.filter(cat => isActive(cat.id)).forEach(cat => {
      const removed = removedBuiltinsMap[cat.id] ?? new Set()
      const allKeywords = [...cat.builtinKeywords.filter(k => !removed.has(k)), ...(customKeywordsMap[cat.id] ?? [])]
      allKeywords.forEach(kw => {
        if (lower.includes(kw.toLowerCase()))
          hits.push({ label: cat.label, keyword: kw, color: cat.color })
      })
      cat.builtinPatterns.forEach(pat => {
        try { if (new RegExp(pat, 'i').test(text)) hits.push({ label: cat.label, keyword: `/${pat}/`, color: cat.color }) }
        catch { /* invalid */ }
      })
    })
    customRules.filter(rule => isActive(`custom-${rule.id}`)).forEach(rule => {
      rule.keywords.forEach(kw => {
        if (lower.includes(kw.toLowerCase())) hits.push({ label: rule.label, keyword: kw, color: 'text-indigo-400' })
      })
      if (rule.pattern) {
        try { if (new RegExp(rule.pattern, 'i').test(text)) hits.push({ label: rule.label, keyword: `/${rule.pattern}/`, color: 'text-indigo-400' }) }
        catch { /* invalid */ }
      }
    })
    return hits
  }, [text, categories, removedBuiltinsMap, customKeywordsMap, customRules, selectedRules])

  return (
    <GlassCard title="Live rule tester" subtitle="Paste any text to instantly see which rules would trigger">
      <div className="space-y-3">
        <div>
          <div className="text-[10px] t3 mb-1.5">
            Test against: {selectedRules.size === 0 ? 'all rules' : `${selectedRules.size} selected`}
            {selectedRules.size > 0 && (
              <button onClick={() => setSelectedRules(new Set())} className="ml-2 text-indigo-400 hover:text-indigo-300">clear</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allSelectable.map(r => {
              const on = selectedRules.has(r.id)
              return (
                <button key={r.id} onClick={() => toggleRule(r.id)}
                  className={clsx('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all',
                    on ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                       : 't3 ring-1 ring-[var(--bd)] hover:bg-[var(--glass-hover)]')}>
                  {r.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-3 top-3.5 t3 pointer-events-none"/>
          <textarea rows={3} className="glass-input w-full rounded-xl px-8 py-3 text-sm resize-y"
            placeholder="Paste a prompt or response to test against keyword rules…"
            value={text} onChange={e => setText(e.target.value)}/>
        </div>
        {text.trim() && (
          <div className="space-y-2">
            <div className={clsx('flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium',
              results.length > 0
                ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20')}>
              {results.length > 0
                ? <><ShieldAlert size={14}/> {results.length} rule{results.length > 1 ? 's' : ''} triggered — action depends on route config</>
                : <><ShieldCheck size={14}/> No rules matched</>}
            </div>
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 glass rounded-xl text-xs">
                <span className={clsx('flex-shrink-0 w-32 truncate', r.color)}>{r.label}</span>
                <span className="t4 flex-shrink-0">matched</span>
                <span className="font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded flex-1 truncate">{r.keyword}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  )
}

function EventDetail({ ev, cat }: { ev: MockEvent; cat: BuiltinCategory | undefined }) {
  return (
    <div className="px-5 py-4 bg-white/[0.02] border-b bd text-xs space-y-3">
      <div className="grid grid-cols-4 gap-4">
        {[
          ['Request ID', ev.id], ['Model', ev.model], ['Type', ev.type],
          ['Category', cat?.label ?? ev.catId], ['Matched keyword', ev.matched],
          ['Action taken', ev.action], ['Time', ev.timeAgo],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="t4 text-[10px] mb-0.5">{k}</div>
            <div className="t1 font-medium break-all font-mono text-[10px]">{v}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="t4 text-[10px] mb-1">Content preview</div>
        <div className="glass rounded-lg px-3 py-2 text-[11px] t2 leading-relaxed">{ev.preview}</div>
      </div>
    </div>
  )
}

const LS_GUARDRAILS = 'ai-gateway:guardrails'

export default function GuardrailsClient() {
  const [saved, setSaved]       = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [loaded, setLoaded]     = useState(false)
  const [removedBuiltins, setRemovedBuiltins] = useState<Record<string, Set<string>>>(
    Object.fromEntries(CATEGORIES.map(c => [c.id, new Set<string>()]))
  )
  const [customKeywords, setCustomKeywords] = useState<Record<string, string[]>>(
    Object.fromEntries(CATEGORIES.map(c => [c.id, []]))
  )
  const [customRules, setCustomRules] = useState<CustomRule[]>([])
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [showInfoBanner, setShowInfoBanner] = useState(true)
  const [ruleOpen, setRuleOpen]       = useState(false)
  const [ruleName, setRuleName]       = useState('')
  const [ruleKwText, setRuleKwText]   = useState('')
  const [rulePattern, setRulePattern] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_GUARDRAILS)
      if (raw) {
        const d = JSON.parse(raw)
        if (d.removedBuiltins) setRemovedBuiltins(
          Object.fromEntries(Object.entries(d.removedBuiltins).map(([k, v]) => [k, new Set(v as string[])]))
        )
        if (d.customKeywords) setCustomKeywords(d.customKeywords)
        if (d.customRules) setCustomRules(
          (d.customRules as any[]).map(r => ({ id: r.id, label: r.label, keywords: r.keywords ?? [], pattern: r.pattern ?? '' }))
        )
      }
    } catch {}
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(LS_GUARDRAILS, JSON.stringify({
        removedBuiltins: Object.fromEntries(Object.entries(removedBuiltins).map(([k, v]) => [k, Array.from(v)])),
        customKeywords, customRules,
      }))
    } catch {}
  }, [removedBuiltins, customKeywords, customRules, loaded])

  const totalKeywords = CATEGORIES.reduce((a, c) => a + c.builtinKeywords.filter(k => !removedBuiltins[c.id]?.has(k)).length + (customKeywords[c.id]?.length ?? 0), 0)
    + customRules.reduce((a, r) => a + r.keywords.length, 0)

  const toggleBuiltin = (catId: string, kw: string) =>
    setRemovedBuiltins(prev => {
      const next = new Set(prev[catId])
      next.has(kw) ? next.delete(kw) : next.add(kw)
      return { ...prev, [catId]: next }
    })

  const handleSave = async () => {
    setSaving(true); setSaveError(false)
    const rules: GuardrailApiRule[] = []
    for (const cat of CATEGORIES) {
      const removed = removedBuiltins[cat.id] ?? new Set()
      rules.push({
        id:       cat.id,
        label:    cat.label,
        keywords: [
          ...cat.builtinKeywords.filter(k => !removed.has(k)),
          ...(customKeywords[cat.id] ?? []),
        ],
        patterns: cat.builtinPatterns,
        action:   cat.defaultAction,
        scope:    'both',
        enabled:  true,
      })
    }
    for (const rule of customRules) {
      rules.push({
        id:       rule.id,
        label:    rule.label,
        keywords: rule.keywords,
        patterns: rule.pattern ? [rule.pattern] : [],
        action:   'flag',
        scope:    'both',
        enabled:  true,
      })
    }
    const ok = await updateGuardrailsConfig(rules)
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { setSaveError(true); setTimeout(() => setSaveError(false), 3000) }
  }

  const addCustomRule = () => {
    const keywords = ruleKwText.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    if (!ruleName.trim() || (keywords.length === 0 && !rulePattern.trim())) return
    setCustomRules(rs => [...rs, { id:`cr-${Date.now()}`, label:ruleName.trim(), keywords, pattern:rulePattern.trim() }])
    setRuleName(''); setRuleKwText(''); setRulePattern(''); setRuleOpen(false)
  }

  const catById = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

  const [ruleSearch, setRuleSearch] = useState('')
  const [rulePage, setRulePage] = useState(1)
  const RULE_PAGE_SIZE = 8
  const filteredRules = customRules.filter(r =>
    !ruleSearch.trim() ||
    r.label.toLowerCase().includes(ruleSearch.toLowerCase()) ||
    r.keywords.some(k => k.toLowerCase().includes(ruleSearch.toLowerCase())) ||
    (r.pattern ?? '').toLowerCase().includes(ruleSearch.toLowerCase()))
  const rulePages = Math.max(1, Math.ceil(filteredRules.length / RULE_PAGE_SIZE))
  const pagedRules = filteredRules.slice((rulePage - 1) * RULE_PAGE_SIZE, rulePage * RULE_PAGE_SIZE)
  useEffect(() => { setRulePage(1) }, [ruleSearch])

  // Live stats from request logs (last 7 days).
  const [liveStats, setLiveStats] = useState<{ scanned: number; flagged: number; blocked: number } | null>(null)
  useEffect(() => {
    const now = Date.now()
    fetchLogs({ from: now - 7 * 86_400_000, to: now, page: 1, per_page: 1000, sort_by: 'ts', sort_dir: 'desc' })
      .then(res => {
        const items: any[] = res.items ?? []
        setLiveStats({
          scanned: res.total ?? items.length,
          flagged: items.filter(i => (i.flags ?? '').includes('guardrail:')).length,
          blocked: items.filter(i => (i.error ?? '').toLowerCase().includes('guardrail')).length,
        })
      })
  }, [])

  const totalRules = CATEGORIES.length + customRules.length
  const pct = (n: number) => liveStats && liveStats.scanned > 0 ? `${((n / liveStats.scanned) * 100).toFixed(1)}% of traffic` : '—'
  const statItems = [
    { label:'Total scanned', value: liveStats ? liveStats.scanned.toLocaleString() : '…', sub:'last 7 days', color:'text-indigo-400', glow:'rgba(99,102,241,0.12)', iconName:'shield-alert' as const },
    { label:'Flagged',       value: liveStats ? String(liveStats.flagged) : '…', sub: liveStats ? pct(liveStats.flagged) : 'last 7 days', color:'text-amber-400',  glow:'rgba(245,158,11,0.12)', iconName:'flag' as const },
    { label:'Blocked',       value: liveStats ? String(liveStats.blocked) : '…', sub: liveStats ? pct(liveStats.blocked) : 'last 7 days', color:'text-red-400',    glow:'rgba(239,68,68,0.12)',  iconName:'ban' as const },
    { label:'Rule sets',     value:String(totalRules), sub:`${totalKeywords} keywords`, color:'text-emerald-400', glow:'rgba(16,185,129,0.12)', iconName:'shield-check' as const },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Guardrails</h1>
          <p className="text-sm t3 mt-1">Keyword and regex matching enforced by the gateway on every prompt and response</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 flex-shrink-0 disabled:opacity-60',
            saved       ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
            : saveError ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                        : 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/25')}>
          {saved       ? <><CheckCircle2 size={14}/>Applied to gateway</>
           : saveError ? <><AlertTriangle size={14}/>Gateway offline</>
           : saving    ? <><Save size={14}/>Saving…</>
                       : <><Save size={14}/>Save &amp; apply</>}
        </button>
      </div>


      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statItems.map(s => (
          <div key={s.label} className="glass rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs t3">{s.label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: s.glow }}>
                {s.iconName === 'shield-alert' && <ShieldAlert size={14} className={s.color}/>}
                {s.iconName === 'flag'         && <Flag        size={14} className={s.color}/>}
                {s.iconName === 'ban'          && <Ban         size={14} className={s.color}/>}
                {s.iconName === 'shield-check' && <ShieldCheck size={14} className={s.color}/>}
              </div>
            </div>
            <div className="text-2xl font-bold t1">{s.value}</div>
            <div className="text-[10px] t3">{s.sub}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-3">
          <h2 className="text-base font-semibold t1">Built-in categories</h2>
          <p className="text-xs t3 mt-0.5">Expand to view keyword lists — hover any keyword to remove it, or add your own</p>
        </div>
        <div className="space-y-2">
          {CATEGORIES.map(cat => (
            <CategoryCard key={cat.id} cat={cat}
              removedBuiltins={removedBuiltins[cat.id] ?? new Set()} customKeywords={customKeywords[cat.id] ?? []}
              onToggleBuiltin={kw => toggleBuiltin(cat.id, kw)}
              onAddKeyword={kw => setCustomKeywords(prev => ({ ...prev, [cat.id]: [...(prev[cat.id] ?? []), kw] }))}
              onRemoveKeyword={kw => setCustomKeywords(prev => ({ ...prev, [cat.id]: (prev[cat.id] ?? []).filter(k => k !== kw) }))}
            />
          ))}
        </div>
      </div>

      <GlassCard title="Custom rules" subtitle="Define your own keyword lists and patterns" noPad
        action={
          <button onClick={() => setRuleOpen(o => !o)} className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-xs">
            <Plus size={12}/> New rule
          </button>
        }>
        {ruleOpen && (
          <div className="px-5 py-4 border-b bd space-y-3 bg-white/[0.02]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] t3 block mb-1.5">Rule name</label>
                <input className="glass-input w-full rounded-xl px-3 py-2 text-xs" placeholder="e.g. Competitor mentions"
                  value={ruleName} onChange={e => setRuleName(e.target.value)}/>
              </div>
              <div>
                <label className="text-[10px] t3 block mb-1.5">Regex <span className="t4">(optional)</span></label>
                <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono" placeholder="\b(acme|globex)\b"
                  value={rulePattern} onChange={e => setRulePattern(e.target.value)}/>
              </div>
            </div>
            <div>
              <label className="text-[10px] t3 block mb-1.5">Keywords <span className="t4">comma-separated</span></label>
              <input className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono" placeholder="keyword one, keyword two, keyword three"
                value={ruleKwText} onChange={e => setRuleKwText(e.target.value)}/>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setRuleOpen(false)} className="glass glass-hover rounded-xl px-3 py-1.5 text-xs t2">Cancel</button>
              <button onClick={addCustomRule} disabled={!ruleName.trim() || (!ruleKwText.trim() && !rulePattern.trim())}
                className="bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 rounded-xl px-3 py-1.5 text-xs font-medium hover:bg-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                Add rule
              </button>
            </div>
          </div>
        )}
        {customRules.length > 0 && (
          <div className="px-5 py-2.5 border-b bd">
            <input className="glass-input w-full rounded-xl px-3 py-1.5 text-xs"
              placeholder="Search custom rules by name, keyword or regex…"
              value={ruleSearch} onChange={e => setRuleSearch(e.target.value)}/>
          </div>
        )}
        {customRules.length === 0 && !ruleOpen ? (
          <div className="px-5 py-8 text-center">
            <Zap size={22} className="t4 mx-auto mb-2"/>
            <div className="text-xs t3">No custom rules yet</div>
            <div className="text-[10px] t4 mt-1">Add keyword lists or regex patterns for domain-specific content</div>
          </div>
        ) : pagedRules.map(rule => (
          <div key={rule.id} className="flex items-start gap-3 px-5 py-4 border-b bd last:border-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold t1">{rule.label}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">Custom</span>
                <TimingBadge us={benchKeywordRule(rule.keywords, rule.pattern ? [rule.pattern] : [])}/>
              </div>
              <div className="flex flex-wrap gap-1">
                {rule.keywords.map(kw => <span key={kw} className="text-[10px] font-mono px-2 py-0.5 glass rounded-lg t2">{kw}</span>)}
                {rule.pattern && <span className="text-[10px] font-mono px-2 py-0.5 glass rounded-lg t3">/{rule.pattern}/</span>}
              </div>
            </div>
            <button onClick={() => setCustomRules(rs => rs.filter(r => r.id !== rule.id))} className="t4 hover:text-red-400 transition-colors flex-shrink-0">
              <X size={13}/>
            </button>
          </div>
        ))}
        {customRules.length > 0 && filteredRules.length === 0 && (
          <div className="px-5 py-6 text-center text-xs t4">No rules match “{ruleSearch}”</div>
        )}
        {rulePages > 1 && (
          <div className="flex items-center justify-between px-5 py-2.5 border-t bd text-[10px] t3">
            <span>{filteredRules.length} rule{filteredRules.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button disabled={rulePage <= 1} onClick={() => setRulePage(p => p - 1)}
                className="px-2 py-1 rounded-lg glass glass-hover disabled:opacity-30">Prev</button>
              <span>{rulePage} / {rulePages}</span>
              <button disabled={rulePage >= rulePages} onClick={() => setRulePage(p => p + 1)}
                className="px-2 py-1 rounded-lg glass glass-hover disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
      </GlassCard>

      <LiveTester categories={CATEGORIES}
        removedBuiltinsMap={removedBuiltins} customKeywordsMap={customKeywords} customRules={customRules}/>

    </div>
  )
}
