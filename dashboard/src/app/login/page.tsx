'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { getGatewayBase } from '@/lib/config'
import { setSession } from '@/lib/auth'
import clsx from 'clsx'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (!username.trim() || !password) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${getGatewayBase()}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Invalid credentials')
      } else {
        setSession(data.token, data.username)
        router.replace('/')
      }
    } catch (e: any) {
      setError(`Cannot reach gateway — is it running? (${e.message})`)
    } finally {
      setLoading(false)
    }
  }, [username, password, router])

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 flex items-center justify-center mx-auto">
            <img src="/logo.svg" alt="Modo AI Gateway" className="w-14 h-14"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold gradient-text">Modo AI Gateway</h1>
            <p className="text-sm t4 mt-1">Sign in to your dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl px-6 py-7 space-y-5">

          {/* Username */}
          <div>
            <label className="text-[11px] t3 block mb-1.5 font-medium">Username</label>
            <input
              type="text"
              autoComplete="username"
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
              placeholder="admin"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-[11px] t3 block mb-1.5 font-medium">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                className="glass-input w-full rounded-xl px-4 py-2.5 pr-10 text-sm"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 t4 hover:t2 transition-colors">
                {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 ring-1 ring-red-500/20 text-[11px] text-red-300">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={submit}
            disabled={loading || !username.trim() || !password}
            className={clsx(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all',
              loading || !username.trim() || !password
                ? 'bg-indigo-500/10 text-indigo-400/50 cursor-not-allowed'
                : 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/30'
            )}>
            <Lock size={14}/>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        <p className="text-center text-[10px] t4">
          Credentials are set in <span className="font-mono text-indigo-400">gateway.toml</span> → <span className="font-mono">[dashboard_auth]</span>
        </p>
      </div>
    </div>
  )
}
