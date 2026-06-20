export function generateRequestData() {
  const now = Date.now()
  return Array.from({ length: 24 }, (_, i) => ({
    time: new Date(now - (23 - i) * 3600000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
    requests: Math.floor(Math.random() * 800 + 200),
    cached:   Math.floor(Math.random() * 200 + 50),
    errors:   Math.floor(Math.random() * 30),
  }))
}

export function generateLatencyData() {
  return [
    { name: 'OpenAI',    p50: 320,  p95: 890,  p99: 1800 },
    { name: 'Anthropic', p50: 410,  p95: 1100, p99: 2200 },
    { name: 'Gemini',    p50: 280,  p95: 760,  p99: 1500 },
  ]
}

export function generateLogs() {
  const models    = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'gemini-2.0-flash']
  const providers = ['openai-primary', 'anthropic-primary', 'gemini-primary']
  const statuses  = ['200', '200', '200', '200', '429', '502']
  return Array.from({ length: 50 }, (_, i) => {
    const model    = models[Math.floor(Math.random() * models.length)]
    const provider = providers[Math.floor(Math.random() * providers.length)]
    const status   = statuses[Math.floor(Math.random() * statuses.length)]
    const latency  = Math.floor(Math.random() * 3000 + 100)
    const cached   = Math.random() > 0.7
    return {
      id:        `req_${(Date.now() - i * 1200).toString(36)}`,
      timestamp: new Date(Date.now() - i * 1200 * 1000).toISOString(),
      model,
      provider,
      status,
      latency,
      cached,
      promptTokens:     Math.floor(Math.random() * 500 + 50),
      completionTokens: Math.floor(Math.random() * 1000 + 100),
      cost:             parseFloat((Math.random() * 0.05).toFixed(4)),
    }
  })
}

export function generateProviders() {
  return [
    {
      name: 'openai-primary', kind: 'OpenAI', status: 'online',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
      p50: 320, p95: 890, successRate: 99.2, rpm: 342, totalRequests: 142_850,
    },
    {
      name: 'anthropic-primary', kind: 'Anthropic', status: 'online',
      models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      p50: 410, p95: 1100, successRate: 99.6, rpm: 218, totalRequests: 98_340,
    },
    {
      name: 'gemini-primary', kind: 'Gemini', status: 'online',
      models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
      p50: 280, p95: 760, successRate: 98.9, rpm: 156, totalRequests: 67_210,
    },
  ]
}

export const STATS = {
  requestsToday:   '24,381',
  requestsDelta:   '+12.4%',
  p50Latency:      '2.1µs',
  latencyDelta:    '-8ms',
  cacheHitRate:    '34.2%',
  cacheDelta:      '+2.1%',
  costToday:       '$4.82',
  costDelta:       '-$0.34',
  uptime:          '99.98%',
  activeProviders: 3,
}
