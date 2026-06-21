export function getGatewayBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:4891'
  if (process.env.NEXT_PUBLIC_GATEWAY_URL) return process.env.NEXT_PUBLIC_GATEWAY_URL

  // When served over HTTPS the gateway must be reached at the same origin
  // (otherwise the browser blocks mixed-content fetches). A reverse proxy
  // in front of the dashboard is expected to forward gateway API paths
  // (/v1/, /analytics/, /logs/, /config/, /perf/, /storage/, /health,
  //  /metrics, /updates/, /marketing/, /mcp, /mcp-test, /dashboard/) to the
  // gateway port.
  if (window.location.protocol === 'https:') return ''

  // Plain HTTP dev / self-hosted: hit the gateway on its native port.
  return `http://${window.location.hostname}:4891`
}
