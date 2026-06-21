import { getGatewayBase } from './config'
const base = () => getGatewayBase()

// ─── Health / Models ──────────────────────────────────────────────────────────

export async function fetchHealth() {
  try {
    const r = await fetch(`${base()}/health`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function fetchModels() {
  try {
    const r = await fetch(`${base()}/v1/models`, { next: { revalidate: 30 } })
    return r.ok ? r.json() : { data: [] }
  } catch { return { data: [] } }
}

// ─── Analytics ────────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export async function fetchAnalyticsSummary(from: number, to: number) {
  try {
    const r = await fetch(`${base()}/analytics/summary${qs({ from, to })}`,
      { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function fetchTimeseries(from: number, to: number, interval: number) {
  try {
    const r = await fetch(`${base()}/analytics/timeseries${qs({ from, to, interval })}`,
      { cache: 'no-store' })
    return r.ok ? r.json() : []
  } catch { return [] }
}

export async function fetchBreakdown(from: number, to: number, group_by: 'model' | 'provider') {
  try {
    const r = await fetch(`${base()}/analytics/breakdown${qs({ from, to, group_by })}`,
      { cache: 'no-store' })
    return r.ok ? r.json() : []
  } catch { return [] }
}

export async function fetchLogs(params: {
  from?: number; to?: number
  model?: string; provider?: string; exclude_provider?: string; status?: number
  search?: string
  sort_by?: string; sort_dir?: string
  page?: number; per_page?: number
}) {
  try {
    const r = await fetch(`${base()}/logs${qs(params as any)}`, { cache: 'no-store' })
    return r.ok ? r.json() : { items: [], total: 0, page: 1, per_page: 50 }
  } catch { return { items: [], total: 0, page: 1, per_page: 50 } }
}

export async function deleteLogs(ids?: string[]) {
  try {
    const opts: RequestInit = { method: 'DELETE', cache: 'no-store' }
    if (ids && ids.length > 0) {
      opts.headers = { 'Content-Type': 'application/json' }
      opts.body = JSON.stringify({ ids })
    }
    const r = await fetch(`${base()}/logs`, opts)
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function fetchStorageConfig() {
  try {
    const r = await fetch(`${base()}/config/storage`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function updateStorageConfig(patch: { log_bodies?: boolean }) {
  try {
    const r = await fetch(`${base()}/config/storage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      cache: 'no-store',
    })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function fetchLogDetail(id: string) {
  try {
    const r = await fetch(`${base()}/logs/${encodeURIComponent(id)}`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function fetchStorageStatus() {
  try {
    const r = await fetch(`${base()}/storage/status`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function fetchCacheConfig() {
  try {
    const r = await fetch(`${base()}/config/cache`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function updateCacheConfig(patch: {
  enabled?: boolean
  semantic?: {
    enabled?: boolean
    threshold?: number
    ttl_seconds?: number
    max_entries?: number
  }
}) {
  try {
    const r = await fetch(`${base()}/config/cache`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      cache: 'no-store',
    })
    return r.ok ? r.json() : null
  } catch { return null }
}

// ─── Guardrails config ────────────────────────────────────────────────────────

export interface GuardrailApiRule {
  id: string
  label: string
  keywords: string[]
  patterns: string[]
  action: string   // "off" | "flag" | "block"
  scope: string    // "request" | "response" | "both"
  enabled: boolean
}

export async function fetchGuardrailsConfig(): Promise<GuardrailApiRule[] | null> {
  try {
    const r = await fetch(`${base()}/config/guardrails`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = await r.json()
    return d.rules ?? null
  } catch { return null }
}

export async function updateGuardrailsConfig(rules: GuardrailApiRule[]): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/guardrails`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
      cache: 'no-store',
    })
    return r.ok
  } catch { return false }
}

// ─── Content Shield config ────────────────────────────────────────────────────

export interface ContentShieldApiRule {
  id: string
  label: string
  pattern: string    // regex string — empty string for built-in patterns
  action: string     // "flag" | "redact" | "block"
  replacement: string
  scope: string      // "request" | "response" | "both"
  enabled: boolean
}

export async function fetchContentShieldConfig(): Promise<ContentShieldApiRule[] | null> {
  try {
    const r = await fetch(`${base()}/config/content-shield`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = await r.json()
    return d.rules ?? null
  } catch { return null }
}

export async function updateContentShieldConfig(rules: ContentShieldApiRule[]): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/content-shield`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
      cache: 'no-store',
    })
    return r.ok
  } catch { return false }
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export async function fetchApiKeys(): Promise<any[]> {
  try {
    const r = await fetch(`${base()}/config/api-keys`, { cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.keys ?? []
  } catch { return [] }
}

export async function createApiKey(key: any): Promise<any | null> {
  try {
    const r = await fetch(`${base()}/config/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(key),
      cache: 'no-store',
    })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function updateApiKey(id: string, patch: any): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/api-keys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      cache: 'no-store',
    })
    return r.ok
  } catch { return false }
}

export async function deleteApiKey(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
    return r.ok
  } catch { return false }
}

// ─── Model pricing ────────────────────────────────────────────────────────────

export interface ModelPricingEntry {
  id: string
  provider: string
  name: string
  input_per_1m: number
  output_per_1m: number
  enabled: boolean
  custom: boolean
}

export async function fetchModelsConfig(): Promise<ModelPricingEntry[]> {
  try {
    const r = await fetch(`${base()}/config/models`, { cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.models ?? []
  } catch { return [] }
}

export async function updateModelsConfig(models: ModelPricingEntry[]): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/models`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models }),
      cache: 'no-store',
    })
    return r.ok
  } catch { return false }
}

// ─── Configured providers ─────────────────────────────────────────────────────

export interface GatewayProviderInfo {
  name: string
  kind: string
  base_url: string | null
  models: string[]
  is_mock: boolean
}

export async function fetchGatewayProviders(): Promise<GatewayProviderInfo[]> {
  try {
    const r = await fetch(`${base()}/config/providers`, { cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.providers ?? []
  } catch { return [] }
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

export interface McpServerEntry {
  id: string
  name: string
  url: string
  auth_header: string
  enabled: boolean
}

export async function fetchMcpConfig(): Promise<McpServerEntry[]> {
  try {
    const r = await fetch(`${base()}/config/mcp`, { cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.servers ?? []
  } catch { return [] }
}

export async function updateMcpConfig(servers: McpServerEntry[]): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/mcp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers }),
      cache: 'no-store',
    })
    return r.ok
  } catch { return false }
}

export interface McpServerStatus {
  id: string
  name: string
  status: 'online' | 'error' | 'disabled'
  error?: string
  tools: { name: string; description?: string }[]
}

export async function fetchMcpTools(): Promise<McpServerStatus[]> {
  try {
    const r = await fetch(`${base()}/mcp/tools`, { cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.servers ?? []
  } catch { return [] }
}

// ─── Updates ──────────────────────────────────────────────────────────────────

export interface UpdateStatus {
  current_version: string
  latest_version: string | null
  update_available: boolean
  notes: string | null
  published_at: string | null
  url: string | null
  error: string | null
}

export async function fetchUpdateStatus(force = false): Promise<UpdateStatus | null> {
  try {
    const r = await fetch(`${base()}/updates/status${force ? '?check=1' : ''}`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export type Preset = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom'

export function presetRange(preset: Preset): { from: number; to: number } {
  const now = Date.now()
  const offsets: Record<string, number> = {
    '1h':  3_600_000,
    '6h':  21_600_000,
    '24h': 86_400_000,
    '7d':  7 * 86_400_000,
    '30d': 30 * 86_400_000,
  }
  if (preset === 'custom') return { from: now - 86_400_000, to: now }
  return { from: now - offsets[preset], to: now }
}

export function bestInterval(from: number, to: number): number {
  const span = to - from
  if (span <= 3_600_000)  return 60_000       // 1m buckets for ≤1h
  if (span <= 86_400_000) return 3_600_000    // 1h buckets for ≤24h
  return 86_400_000                            // 1d buckets otherwise
}

// ─── Routes + provider enable/disable (issue #20) ───────────────────────────
//
// Persist the dashboard's canvas-state for LLM and MCP routes server-side so
// they survive reloads, sync across browsers/devices, and are visible to other
// admins. The route blob itself is opaque to the gateway — it stores + serves
// the JSON verbatim — but the disabled-vendor list IS enforced at chat-route
// time (providers whose kind is in the set are skipped).

export async function fetchRoutes(): Promise<any | null> {
  try {
    const r = await fetch(`${base()}/config/routes`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function saveRoutes(routes: any): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/routes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routes),
    })
    return r.ok
  } catch { return false }
}

export async function fetchMcpRoutes(): Promise<any | null> {
  try {
    const r = await fetch(`${base()}/config/mcp-routes`, { cache: 'no-store' })
    return r.ok ? r.json() : null
  } catch { return null }
}

export async function saveMcpRoutes(routes: any): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/mcp-routes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routes),
    })
    return r.ok
  } catch { return false }
}

export async function fetchDisabledVendors(): Promise<string[]> {
  try {
    const r = await fetch(`${base()}/config/providers/disabled`, { cache: 'no-store' })
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data?.disabled) ? data.disabled : []
  } catch { return [] }
}

export async function saveDisabledVendors(disabled: string[]): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/config/providers/disabled`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled }),
    })
    return r.ok
  } catch { return false }
}
