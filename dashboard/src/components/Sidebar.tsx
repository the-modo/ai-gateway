'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, ScrollText, Server, Settings,
  GitBranch, BarChart2, ShieldAlert, Lock, KeyRound, Play, LogOut,
} from 'lucide-react'
import clsx from 'clsx'
import { getToken, clearSession } from '@/lib/auth'
import { getGatewayBase } from '@/lib/config'

/** Official Model Context Protocol mark (Simple Icons). */
export function McpIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M13.85 0a4.16 4.16 0 0 0-2.95 1.217L1.456 10.66a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l9.442-9.442a2.49 2.49 0 0 1 3.541 0 2.49 2.49 0 0 1 0 3.541L8.59 12.97l-.1.1a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l.1-.098 7.03-7.034a2.49 2.49 0 0 1 3.542 0l.049.05a2.49 2.49 0 0 1 0 3.54l-8.54 8.54a1.96 1.96 0 0 0 0 2.755l1.753 1.753a.835.835 0 0 0 1.18 0 .835.835 0 0 0 0-1.18l-1.753-1.753a.266.266 0 0 1 0-.394l8.54-8.54a4.185 4.185 0 0 0 0-5.9l-.05-.05a4.16 4.16 0 0 0-2.95-1.218c-.2 0-.401.02-.6.048a4.17 4.17 0 0 0-1.17-3.552A4.16 4.16 0 0 0 13.85 0m0 3.333a.84.84 0 0 0-.59.245L6.275 10.56a4.186 4.186 0 0 0 0 5.902 4.186 4.186 0 0 0 5.902 0L19.16 9.48a.835.835 0 0 0 0-1.18.835.835 0 0 0-1.18 0l-6.985 6.984a2.49 2.49 0 0 1-3.54 0 2.49 2.49 0 0 1 0-3.54l6.983-6.985a.835.835 0 0 0 0-1.18.84.84 0 0 0-.59-.245"/>
    </svg>
  )
}

const nav = [
  { href: '/',               label: 'Overview',       icon: LayoutDashboard },
  { href: '/analytics',      label: 'Analytics',      icon: BarChart2 },
  { href: '/logs',           label: 'Logs',           icon: ScrollText },
  { href: '/providers',      label: 'Providers',      icon: Server },
  { href: '/routing',        label: 'Routing',        icon: GitBranch },
  { href: '/mcp',            label: 'MCP Servers',    icon: McpIcon },
  { href: '/guardrails',      label: 'Guardrails',     icon: ShieldAlert },
  { href: '/content-shield',  label: 'Content Shield', icon: Lock },
  { href: '/access',          label: 'Access',         icon: KeyRound },
  { href: '/playground',      label: 'Playground',     icon: Play },
  { href: '/settings',        label: 'Settings',       icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    const token = getToken()
    // Best-effort server-side revoke; always clear the local session.
    try {
      await fetch(`${getGatewayBase()}/dashboard/logout`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    } catch { /* ignore network errors on logout */ }
    clearSession()
    router.replace('/login')
  }

  return (
    <aside className="glass-sidebar fixed left-0 top-0 h-full w-56 flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4 border-b bd">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Modo AI Gateway" className="w-8 h-8 flex-shrink-0" />
          <div className="text-sm font-semibold gradient-text">Modo AI Gateway</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link key={href} href={href} prefetch={false}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                active ? 'nav-active text-white' : 't2 hover:t1 hover:bg-[var(--glass-hover)]'
              )}
            >
              <Icon size={14} className={active ? 'text-white' : ''} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer — logout */}
      <div className="px-3 py-3 border-t bd">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium t2 hover:t1 hover:bg-[var(--glass-hover)] transition-all duration-200"
        >
          <LogOut size={14} />
          Log out
        </button>
      </div>
    </aside>
  )
}
