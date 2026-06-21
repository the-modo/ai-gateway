// Installs a one-time fetch wrapper that attaches the dashboard session token
// (Authorization: Bearer …) to every gateway request, and redirects to /login
// when the gateway reports the session is invalid/expired (401).
//
// Centralising this here means every existing `fetch(...)` call across the app
// (api.ts, RoutingCanvas, settings, mcp, playground, …) is covered without
// touching each call site.
import { getGatewayBase } from './config'
import { getToken, clearSession } from './auth'

declare global {
  interface Window { __gwFetchPatched?: boolean }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url ?? ''
}

export function installFetchInterceptor(): void {
  if (typeof window === 'undefined' || window.__gwFetchPatched) return
  window.__gwFetchPatched = true

  const base = getGatewayBase()
  const original = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input)
    const isGateway = url.startsWith(base)
    const isLogin = url.includes('/dashboard/login')
    const token = getToken()

    if (isGateway && token && !isLogin) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
      init = { ...init, headers }
    }

    const res = await original(input, init)

    // Session expired / invalid → drop it and bounce to login (but never loop on
    // the login request itself).
    if (res.status === 401 && isGateway && !isLogin) {
      clearSession()
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return res
  }
}
