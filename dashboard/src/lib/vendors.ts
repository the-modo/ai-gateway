export interface VendorMeta {
  id: string
  name: string
  badge: string
  icon: string         // path to /icons/{id}.svg
  color: string        // brand primary
  bg: string           // translucent bg for badge
  ring: string         // ring color
  description: string
  envVar: string
  docsUrl: string
  baseUrl?: string
  openAICompat: boolean
}

export const VENDORS: VendorMeta[] = [
  {
    id: 'openai', name: 'OpenAI', badge: 'OA', icon: '/icons/openai.svg',
    color: '#10a37f', bg: 'rgba(16,163,127,0.15)', ring: 'rgba(16,163,127,0.3)',
    description: 'GPT-4o, o1, o3-mini, DALL-E, Whisper',
    envVar: 'OPENAI_API_KEY', docsUrl: 'https://platform.openai.com/api-keys',
    openAICompat: true,
  },
  {
    id: 'anthropic', name: 'Anthropic', badge: 'AN', icon: '/icons/anthropic.svg',
    color: '#c96442', bg: 'rgba(201,100,66,0.15)', ring: 'rgba(201,100,66,0.3)',
    description: 'Claude Opus 4, Sonnet 4, Haiku 4',
    envVar: 'ANTHROPIC_API_KEY', docsUrl: 'https://console.anthropic.com/',
    openAICompat: false,
  },
  {
    id: 'gemini', name: 'Google Gemini', badge: 'GG', icon: '/icons/gemini.svg',
    color: '#4285f4', bg: 'rgba(66,133,244,0.15)', ring: 'rgba(66,133,244,0.3)',
    description: 'Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash',
    envVar: 'GEMINI_API_KEY', docsUrl: 'https://aistudio.google.com/app/apikey',
    openAICompat: false,
  },
  {
    id: 'mistral', name: 'Mistral AI', badge: 'MI', icon: '/icons/mistral.svg',
    color: '#ff7000', bg: 'rgba(255,112,0,0.15)', ring: 'rgba(255,112,0,0.3)',
    description: 'Mistral Large, Medium, Small, Codestral',
    envVar: 'MISTRAL_API_KEY', docsUrl: 'https://console.mistral.ai/',
    baseUrl: 'https://api.mistral.ai',
    openAICompat: true,
  },
  {
    id: 'groq', name: 'Groq', badge: 'GQ', icon: '/icons/groq.svg',
    color: '#f55036', bg: 'rgba(245,80,54,0.15)', ring: 'rgba(245,80,54,0.3)',
    description: 'Ultra-fast inference — Llama, Mixtral, Gemma',
    envVar: 'GROQ_API_KEY', docsUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai',
    openAICompat: true,
  },
  {
    id: 'cohere', name: 'Cohere', badge: 'CO', icon: '/icons/cohere.svg',
    color: '#39594d', bg: 'rgba(57,89,77,0.20)', ring: 'rgba(57,89,77,0.4)',
    description: 'Command R+, Command R, Embed',
    envVar: 'COHERE_API_KEY', docsUrl: 'https://dashboard.cohere.com/api-keys',
    openAICompat: false,
  },
  {
    id: 'together', name: 'Together AI', badge: 'TO', icon: '/icons/together.svg',
    color: '#7c3aed', bg: 'rgba(124,58,237,0.15)', ring: 'rgba(124,58,237,0.3)',
    description: 'Llama 3.1 405B, Qwen, DBRX, and 50+ OSS models',
    envVar: 'TOGETHER_API_KEY', docsUrl: 'https://api.together.ai/settings/api-keys',
    baseUrl: 'https://api.together.xyz',
    openAICompat: true,
  },
  {
    id: 'perplexity', name: 'Perplexity', badge: 'PP', icon: '/icons/perplexity.svg',
    color: '#20b8cd', bg: 'rgba(32,184,205,0.15)', ring: 'rgba(32,184,205,0.3)',
    description: 'Sonar Large, Sonar Small — web-grounded',
    envVar: 'PERPLEXITY_API_KEY', docsUrl: 'https://www.perplexity.ai/settings/api',
    baseUrl: 'https://api.perplexity.ai',
    openAICompat: true,
  },
  {
    id: 'deepseek', name: 'DeepSeek', badge: 'DS', icon: '/icons/deepseek.svg',
    color: '#1e90ff', bg: 'rgba(30,144,255,0.15)', ring: 'rgba(30,144,255,0.3)',
    description: 'DeepSeek Chat, DeepSeek Coder V2',
    envVar: 'DEEPSEEK_API_KEY', docsUrl: 'https://platform.deepseek.com/',
    baseUrl: 'https://api.deepseek.com',
    openAICompat: true,
  },
  {
    id: 'fireworks', name: 'Fireworks AI', badge: 'FW', icon: '/icons/fireworks.svg',
    color: '#ef4444', bg: 'rgba(239,68,68,0.15)', ring: 'rgba(239,68,68,0.3)',
    description: 'Fast open-source model serving',
    envVar: 'FIREWORKS_API_KEY', docsUrl: 'https://fireworks.ai/account/api-keys',
    baseUrl: 'https://api.fireworks.ai/inference',
    openAICompat: true,
  },
  {
    id: 'bedrock', name: 'AWS Bedrock', badge: 'AB', icon: '/icons/aws.svg',
    color: '#ff9900', bg: 'rgba(255,153,0,0.15)', ring: 'rgba(255,153,0,0.3)',
    description: 'Claude, Titan, Llama on AWS infrastructure',
    envVar: 'AWS_ACCESS_KEY_ID', docsUrl: 'https://aws.amazon.com/bedrock/',
    openAICompat: false,
  },
  {
    id: 'azure', name: 'Azure OpenAI', badge: 'AZ', icon: '/icons/azure.svg',
    color: '#0078d4', bg: 'rgba(0,120,212,0.15)', ring: 'rgba(0,120,212,0.3)',
    description: 'OpenAI models on Azure — enterprise compliance',
    envVar: 'AZURE_OPENAI_API_KEY', docsUrl: 'https://portal.azure.com/',
    openAICompat: true,
  },
  {
    id: 'xai', name: 'xAI (Grok)', badge: 'XA', icon: '/icons/xai.svg',
    color: '#a0a0a0', bg: 'rgba(160,160,160,0.12)', ring: 'rgba(160,160,160,0.25)',
    description: 'Grok 2, Grok Beta — real-time knowledge',
    envVar: 'XAI_API_KEY', docsUrl: 'https://console.x.ai/',
    baseUrl: 'https://api.x.ai',
    openAICompat: true,
  },
  {
    id: 'huggingface', name: 'Hugging Face', badge: 'HF', icon: '/icons/huggingface.svg',
    color: '#ff9d00', bg: 'rgba(255,157,0,0.15)', ring: 'rgba(255,157,0,0.3)',
    description: '300k+ models via Inference Endpoints',
    envVar: 'HF_TOKEN', docsUrl: 'https://huggingface.co/settings/tokens',
    baseUrl: 'https://api-inference.huggingface.co',
    openAICompat: false,
  },
  {
    id: 'ollama', name: 'Ollama (Local)', badge: 'OL', icon: '/icons/ollama.svg',
    color: '#2ecc71', bg: 'rgba(46,204,113,0.15)', ring: 'rgba(46,204,113,0.3)',
    description: 'Self-hosted — Llama, Mistral, Phi, Gemma locally',
    envVar: '', docsUrl: 'https://ollama.com/',
    baseUrl: 'http://localhost:11434',
    openAICompat: true,
  },
  {
    id: 'mock', name: 'Test Server', badge: 'TS', icon: '/icons/mock.svg',
    color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', ring: 'rgba(139,92,246,0.3)',
    description: 'Built-in test provider — instant echo responses, no API key required',
    envVar: '', docsUrl: '',
    baseUrl: 'http://localhost:4891',
    openAICompat: true,
  },
]

export const VENDOR_MAP = Object.fromEntries(VENDORS.map(v => [v.id, v]))
