const TOKEN_KEY = 'gw-dashboard-token'
const USER_KEY  = 'gw-dashboard-user'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setSession(token: string, username: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, username)
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getUsername(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(USER_KEY) ?? ''
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
