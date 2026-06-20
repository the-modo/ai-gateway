'use client'
import { useState, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, Activity, DollarSign, Cpu, Database, Zap } from 'lucide-react'
import { McpIcon } from '@/components/Sidebar'
import DateRangePicker from '@/components/DateRangePicker'
import { DateRangeContext, type DateRange } from '@/lib/analytics-context'
import { presetRange, type Preset } from '@/lib/api'
import clsx from 'clsx'

const TABS = [
  { href: '/analytics',           label: 'Overview',   icon: BarChart2  },
  { href: '/analytics/requests',  label: 'Requests',   icon: Activity   },
  { href: '/analytics/cost',      label: 'Cost',       icon: DollarSign },
  { href: '/analytics/models',    label: 'Models',     icon: Cpu        },
  { href: '/analytics/providers', label: 'Providers',  icon: Zap        },
  { href: '/analytics/cache',     label: 'Cache',      icon: Database   },
  { href: '/analytics/mcp',       label: 'MCP',        icon: McpIcon    },
]

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const cleanPath = pathname.replace(/\/$/, '') || '/'
  const [range, setRange] = useState<DateRange>(() => ({
    preset: '7d',
    ...presetRange('7d'),
  }))

  const handlePreset = (p: Preset, r: { from: number; to: number }) => {
    setRange({ preset: p, ...r })
  }

  return (
    <DateRangeContext.Provider value={range}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Analytics</h1>
            <p className="text-sm t3 mt-1">Request volume, cost, and performance</p>
          </div>
          <DateRangePicker preset={range.preset} onChange={handlePreset} />
        </div>

        {/* Tab bar */}
        <div className="glass rounded-2xl p-1.5 flex gap-0.5 overflow-x-auto">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = cleanPath === href ||
              (href !== '/analytics' && cleanPath.startsWith(href))
            return (
              <Link key={href} href={href}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-150 flex-1 justify-center',
                  active
                    ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30'
                    : 't3 hover:t2 hover:bg-white/5'
                )}>
                <Icon size={12} />
                {label}
              </Link>
            )
          })}
        </div>

        {children}
      </div>
    </DateRangeContext.Provider>
  )
}
