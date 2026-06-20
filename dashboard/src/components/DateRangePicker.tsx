'use client'
import { useState, useEffect, useRef } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { type Preset, presetRange } from '@/lib/api'

const PRESETS: { label: string; value: Preset }[] = [
  { label: '1h',   value: '1h'  },
  { label: '6h',   value: '6h'  },
  { label: '24h',  value: '24h' },
  { label: '7d',   value: '7d'  },
  { label: '30d',  value: '30d' },
]

// Format a ms timestamp as the value for datetime-local input (YYYY-MM-DDTHH:mm)
function toInputValue(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromInputValue(s: string): number {
  return new Date(s).getTime()
}

interface Props {
  preset: Preset
  onChange: (preset: Preset, range: { from: number; to: number }) => void
}

export default function DateRangePicker({ preset, onChange }: Props) {
  const [showCustom, setShowCustom] = useState(false)
  const now = Date.now()
  const [fromVal, setFromVal] = useState(() => toInputValue(now - 86_400_000))
  const [toVal,   setToVal]   = useState(() => toInputValue(now))
  const ref = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!showCustom) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowCustom(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCustom])

  const selectPreset = (p: Preset) => {
    setShowCustom(false)
    onChange(p, presetRange(p))
  }

  const applyCustom = () => {
    const from = fromInputValue(fromVal)
    const to   = fromInputValue(toVal)
    if (!from || !to || from >= to) return
    setShowCustom(false)
    onChange('custom', { from, to })
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1.5 glass rounded-xl px-2 py-1.5">
      <Calendar size={12} className="t3 flex-shrink-0 ml-1"/>

      {PRESETS.map(({ label, value }) => (
        <button key={value} onClick={() => selectPreset(value)}
          className={clsx(
            'px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150',
            preset === value
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30'
              : 't3 hover:t2 hover:bg-white/5'
          )}>
          {label}
        </button>
      ))}

      {/* Custom button */}
      <button
        onClick={() => setShowCustom(v => !v)}
        className={clsx(
          'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150',
          preset === 'custom'
            ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30'
            : 't3 hover:t2 hover:bg-white/5'
        )}>
        {preset === 'custom' ? 'Custom ✓' : 'Custom'}
        <ChevronDown size={10} className={clsx('transition-transform', showCustom && 'rotate-180')}/>
      </button>

      {/* Popover */}
      {showCustom && (
        <div className="absolute top-full right-0 mt-2 z-50 glass rounded-2xl p-4 shadow-xl ring-1 ring-white/10 w-72">
          <div className="text-[10px] t3 uppercase tracking-wider font-medium mb-3">Custom range</div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] t3 block mb-1">From</label>
              <input
                type="datetime-local"
                value={fromVal}
                onChange={e => setFromVal(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] t3 block mb-1">To</label>
              <input
                type="datetime-local"
                value={toVal}
                onChange={e => setToVal(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <button
              onClick={applyCustom}
              className="w-full py-2 rounded-xl bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 text-xs font-medium hover:bg-indigo-500/30 transition-all">
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
