export function getGatewayBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:4891'
  if (process.env.NEXT_PUBLIC_GATEWAY_URL) return process.env.NEXT_PUBLIC_GATEWAY_URL
  return `http://${window.location.hostname}:4891`
}
