/**
 * Dexscreener resolver — turns any user input (Dexscreener URL, pair address,
 * or plain token address) into a canonical { chain, tokenAddress }.
 *
 * Fixes a common UX trap: users copy Dexscreener URLs thinking they contain
 * the token contract, but the URL path actually encodes a PAIR address (LP
 * pool), not the token. Scanning that pair directly returns LP-token data
 * (UNI-V2, Raydium-LP, etc.) instead of the token the user wanted.
 *
 * Dexscreener API is free, no key, no meaningful rate limit for this volume.
 * Docs: https://docs.dexscreener.com/api/reference
 */

import axios from 'axios'

const client = axios.create({
  baseURL: 'https://api.dexscreener.com',
  timeout: 8000,
  headers: { accept: 'application/json' }
})

// Dexscreener chain IDs match ours 1:1 for our 8 supported chains
const SUPPORTED_DS_CHAINS = new Set([
  'solana', 'ethereum', 'base', 'arbitrum', 'bsc', 'polygon', 'avalanche', 'sui'
])

export interface ResolvedContract {
  original_input: string
  resolved_address: string
  chain: string
  source: 'url' | 'pair' | 'direct'
  pair_info?: {
    pair_address: string
    base_token: { address: string; name: string; symbol: string }
    quote_token: { address: string; name: string; symbol: string }
    dex_id: string
  }
  note?: string
}

export class DexscreenerResolveError extends Error {
  constructor(message: string, public readonly retryAllowed: boolean = false) {
    super(message)
    this.name = 'DexscreenerResolveError'
  }
}

// Parse a Dexscreener URL like https://dexscreener.com/solana/ABC123
export function parseDexscreenerUrl(input: string): { chain: string; pair: string } | null {
  if (!input.startsWith('http')) return null
  try {
    const url = new URL(input)
    if (!url.hostname.includes('dexscreener.com')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const chain = parts[0].toLowerCase()
    const pair = parts[1]
    if (!SUPPORTED_DS_CHAINS.has(chain)) return null
    return { chain, pair }
  } catch {
    return null
  }
}

// Call Dexscreener API to resolve a pair address to base token
async function fetchPairInfo(chain: string, pairAddress: string) {
  try {
    const resp = await client.get(`/latest/dex/pairs/${chain}/${pairAddress}`)
    const pair = resp.data?.pair || resp.data?.pairs?.[0]
    if (!pair?.baseToken?.address) return null
    return pair
  } catch (err: any) {
    const status = err?.response?.status
    if (status === 404) return null
    if (status === 429 || (status && status >= 500)) {
      throw new DexscreenerResolveError(`Dexscreener ${status} — transient`, true)
    }
    throw new DexscreenerResolveError(`Dexscreener error: ${err?.message || 'unknown'}`, false)
  }
}

/**
 * Main entry point. Given any input:
 *  - Dexscreener URL   → extract chain+pair, resolve to baseToken
 *  - Pair address      → (handled via URL flow only for now)
 *  - Plain token addr  → return as-is (no API call, no cost)
 */
export async function resolveContractInput(
  input: string,
  userChain?: string
): Promise<ResolvedContract> {
  const trimmed = input.trim()

  const urlParts = parseDexscreenerUrl(trimmed)
  if (urlParts) {
    const pair = await fetchPairInfo(urlParts.chain, urlParts.pair)
    if (!pair) {
      throw new DexscreenerResolveError(
        `Dexscreener URL did not resolve to a valid pair. Check the URL or paste the token address directly.`,
        false
      )
    }
    const chainFromUrl = urlParts.chain
    const note =
      userChain && userChain !== chainFromUrl
        ? `Chain from URL (${chainFromUrl}) overrides user input (${userChain}).`
        : undefined
    return {
      original_input: trimmed,
      resolved_address: pair.baseToken.address,
      chain: chainFromUrl,
      source: 'url',
      pair_info: {
        pair_address: pair.pairAddress,
        base_token: {
          address: pair.baseToken.address,
          name: pair.baseToken.name,
          symbol: pair.baseToken.symbol
        },
        quote_token: {
          address: pair.quoteToken.address,
          name: pair.quoteToken.name,
          symbol: pair.quoteToken.symbol
        },
        dex_id: pair.dexId
      },
      note
    }
  }

  // Plain address — pass through
  return {
    original_input: trimmed,
    resolved_address: trimmed,
    chain: userChain || 'unknown',
    source: 'direct'
  }
}
