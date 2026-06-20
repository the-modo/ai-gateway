import clsx from 'clsx'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  label:   string
  value:   string
  delta?:  string
  icon:    React.ReactNode
  accent?: 'blue' | 'cyan' | 'emerald' | 'purple' | 'amber'
}

const accentMap = {
  blue:    { ring: 'ring-indigo-500/20',   icon: 'bg-indigo-500/10 text-indigo-400',   val: 'text-indigo-300'  },
  cyan:    { ring: 'ring-cyan-500/20',     icon: 'bg-cyan-500/10 text-cyan-400',       val: 'text-cyan-300'    },
  emerald: { ring: 'ring-emerald-500/20',  icon: 'bg-emerald-500/10 text-emerald-400', val: 'text-emerald-300' },
  purple:  { ring: 'ring-purple-500/20',   icon: 'bg-purple-500/10 text-purple-400',   val: 'text-purple-300'  },
  amber:   { ring: 'ring-amber-500/20',    icon: 'bg-amber-500/10 text-amber-400',     val: 'text-amber-300'   },
}

export default function StatCard({ label, value, delta, icon, accent = 'blue' }: Props) {
  const c = accentMap[accent]
  const isPos = delta?.startsWith('+')
  const isNeg = delta?.startsWith('-')

  return (
    <div className={clsx(
      'glass glass-hover rounded-2xl p-5 ring-1 transition-all duration-300 cursor-default relative overflow-hidden',
      c.ring
    )}>
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-15 blur-2xl"
        style={{ background: accent === 'blue' ? '#6366f1' : accent === 'cyan' ? '#22d3ee' : accent === 'emerald' ? '#10b981' : accent === 'purple' ? '#a855f7' : '#f59e0b' }} />

      <div className="relative flex items-start justify-between">
        <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', c.icon)}>{icon}</div>
        {delta && (
          <div className={clsx(
            'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
            isPos ? 'bg-emerald-500/10 text-emerald-400' :
            isNeg ? 'bg-red-500/10 text-red-400' : 'bg-[var(--glass-bg)] t3'
          )}>
            {isPos ? <TrendingUp size={10}/> : isNeg ? <TrendingDown size={10}/> : null}
            {delta}
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className={clsx('text-2xl font-bold tracking-tight', c.val)}>{value}</div>
        <div className="text-xs t3 mt-0.5">{label}</div>
      </div>
    </div>
  )
}
