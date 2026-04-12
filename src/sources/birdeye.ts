import axios, { AxiosError } from 'axios'

const BASE_URL = 'https://public-api.birdeye.so'

// Custom error class so the top-level handler can map Birdeye failures
// to the correct GigaWork error_code + retry_allowed flag.
export class BirdeyeError extends Error {
  constructor(
    message: string,
    public readonly retryAllowed: boolean,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'BirdeyeError'
  }
}

function getApiKey(): string {
  const key = process.env.BIRDEYE_API_KEY
  if (!key || key === 'your_birdeye_key' || key === 'demo_key_for_testing') {
    // Return a stub; individual calls will fail gracefully.
    // Startup validation in index.ts already warns the operator.
    return ''
  }
  return key
}

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    accept: 'application/json'
  }
})

// Inject fresh API key on every request so env var changes take effect.
client.interceptors.request.use((config) => {
  config.headers.set('X-API-KEY', getApiKey())
  return config
})

// Normalize axios errors into BirdeyeError with correct retry semantics.
function handle(err: unknown, context: string): never {
  const ax = err as AxiosError
  const status = ax.response?.status

  // Timeout / network error — retryable
  if (ax.code === 'ECONNABORTED' || ax.message?.includes('timeout')) {
    throw new BirdeyeError(`Birdeye timeout (${context})`, true)
  }
  if (!ax.response) {
    throw new BirdeyeError(`Birdeye network error: ${ax.message} (${context})`, true)
  }

  // 429 rate limit — retryable
  if (status === 429) {
    throw new BirdeyeError(`Birdeye rate limited (${context})`, true, 429)
  }

  // 5xx — retryable
  if (status && status >= 500) {
    throw new BirdeyeError(`Birdeye server error ${status} (${context})`, true, status)
  }

  // 401/403 — auth problem, not retryable
  if (status === 401 || status === 403) {
    throw new BirdeyeError(`Birdeye auth failed (${status}) — check BIRDEYE_API_KEY`, false, status)
  }

  // 404 — contract/endpoint not found, not retryable
  if (status === 404) {
    throw new BirdeyeError(`Birdeye 404 (${context})`, false, 404)
  }

  // Other 4xx — likely invalid input, not retryable
  throw new BirdeyeError(`Birdeye ${status || 'error'} (${context}): ${ax.message}`, false, status)
}

// Token overview — price, volume, market cap, liquidity, holders
export async function getTokenOverview(address: string, chain: string) {
  try {
    const resp = await client.get('/defi/token_overview', {
      params: { address },
      headers: { 'x-chain': chain }
    })
    return resp.data.data
  } catch (err) {
    handle(err, 'token_overview')
  }
}

// Token security — mint/freeze authority, top holders, honeypot check
export async function getTokenSecurity(address: string, chain: string) {
  try {
    const resp = await client.get('/defi/token_security', {
      params: { address },
      headers: { 'x-chain': chain }
    })
    return resp.data.data
  } catch (err) {
    handle(err, 'token_security')
  }
}

// Top holders list with percentages
export async function getTopHolders(address: string, chain: string, limit = 20) {
  try {
    const resp = await client.get('/defi/v3/token/holder', {
      params: { address, limit },
      headers: { 'x-chain': chain }
    })
    return resp.data.data?.items || []
  } catch (err) {
    handle(err, 'top_holders')
  }
}

// Token creation info — deploy date, deployer address
export async function getTokenCreationTime(address: string, chain: string) {
  try {
    const resp = await client.get('/defi/token_creation_info', {
      params: { address },
      headers: { 'x-chain': chain }
    })
    return resp.data.data
  } catch (err) {
    handle(err, 'token_creation_info')
  }
}

// Recent trades — for smart money detection
export async function getRecentTrades(address: string, chain: string, limit = 100) {
  try {
    const resp = await client.get('/defi/txs/token', {
      params: { address, limit, tx_type: 'swap' },
      headers: { 'x-chain': chain }
    })
    return resp.data.data?.items || []
  } catch (err) {
    handle(err, 'recent_trades')
  }
}

// Token markets — DEX distribution, liquidity pools
export async function getTokenMarkets(address: string, chain: string) {
  try {
    const resp = await client.get('/defi/v3/token/market-data', {
      params: { address },
      headers: { 'x-chain': chain }
    })
    return resp.data.data
  } catch (err) {
    handle(err, 'token_markets')
  }
}

// OHLCV — price history for volatility analysis
export async function getPriceHistory(address: string, chain: string) {
  try {
    const timeTo = Math.floor(Date.now() / 1000)
    const timeFrom = timeTo - 7 * 24 * 3600 // 7 days
    const resp = await client.get('/defi/ohlcv', {
      params: { address, type: '1H', time_from: timeFrom, time_to: timeTo },
      headers: { 'x-chain': chain }
    })
    return resp.data.data?.items || []
  } catch (err) {
    handle(err, 'price_history')
  }
}
