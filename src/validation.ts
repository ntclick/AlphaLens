import { CHAINS } from './chains.js'
import { AgentRequest } from './types.js'

export type ValidationError = {
  error_code: 'INVALID_INPUT'
  error_message: string
  retry_allowed: false
}

export type ValidationResult =
  | { ok: true; value: ValidatedInputs }
  | { ok: false; error: ValidationError }

export interface ValidatedInputs {
  contractAddress: string
  chain: string
  depth: 'quick' | 'standard' | 'deep'
  focus: string
  isUrl: boolean // true if contractAddress is a Dexscreener URL (to be resolved)
}

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SUI_ADDRESS = /^0x[a-fA-F0-9]{1,64}(::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+)?$/

function invalid(message: string): ValidationResult {
  return {
    ok: false,
    error: {
      error_code: 'INVALID_INPUT',
      error_message: message,
      retry_allowed: false
    }
  }
}

// Validate the AgentRequest envelope itself.
export function validateRequestEnvelope(body: any): { ok: true } | { ok: false; error: ValidationError } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: invalidError('Request body must be a JSON object') }
  }
  if (typeof body.job_id !== 'string' || body.job_id.length === 0) {
    return { ok: false, error: invalidError('job_id is required (string)') }
  }
  if (body.inputs == null || typeof body.inputs !== 'object') {
    return { ok: false, error: invalidError('inputs object is required') }
  }
  // schema_version and agent_id are informational; warn but don't reject.
  return { ok: true }
}

function invalidError(message: string): ValidationError {
  return { error_code: 'INVALID_INPUT', error_message: message, retry_allowed: false }
}

// Validate the per-chain address format. Pulled out so we can re-run it on
// the resolved address after Dexscreener resolution.
export function validateAddressFormat(
  address: string,
  chain: string
): ValidationResult | { ok: true } {
  const cfg = CHAINS[chain]
  if (!cfg) return invalid(`Unsupported chain: "${chain}"`)
  const chainType = cfg.type
  if (chainType === 'evm' && !EVM_ADDRESS.test(address)) {
    return invalid(`Invalid EVM address format for ${chain}. Expected 0x + 40 hex chars.`)
  }
  if (chainType === 'svm' && !SOLANA_ADDRESS.test(address)) {
    return invalid('Invalid Solana address format. Expected base58 32-44 chars (case-sensitive).')
  }
  if (chainType === 'sui' && !SUI_ADDRESS.test(address)) {
    return invalid('Invalid Sui address format.')
  }
  return { ok: true }
}

// Validate and normalize the inputs for a scan job.
// URLs skip address-format checks — they are validated after Dexscreener
// resolves them to a plain token address.
export function validateInputs(inputs: AgentRequest['inputs']): ValidationResult {
  const rawAddr = typeof inputs?.contract_address === 'string' ? inputs.contract_address.trim() : ''
  const rawChain = typeof inputs?.chain === 'string' ? inputs.chain.trim().toLowerCase() : 'solana'
  const rawDepth = typeof inputs?.analysis_depth === 'string' ? inputs.analysis_depth.trim().toLowerCase() : 'standard'
  const rawFocus = typeof inputs?.focus === 'string' ? inputs.focus.trim().toLowerCase() : 'all'

  if (!rawAddr) {
    return invalid('contract_address is required')
  }

  if (!CHAINS[rawChain]) {
    return invalid(`Unsupported chain: "${rawChain}". Supported: ${Object.keys(CHAINS).join(', ')}`)
  }

  const isUrl = rawAddr.startsWith('http://') || rawAddr.startsWith('https://')

  // Plain addresses are format-checked immediately. URLs defer format checks
  // until after Dexscreener resolution returns a token address.
  if (!isUrl) {
    const fmt = validateAddressFormat(rawAddr, rawChain)
    if ('ok' in fmt && fmt.ok === false) return fmt as ValidationResult
  }

  if (rawDepth !== 'quick' && rawDepth !== 'standard' && rawDepth !== 'deep') {
    return invalid('analysis_depth must be one of: quick, standard, deep')
  }

  return {
    ok: true,
    value: {
      contractAddress: rawAddr,
      chain: rawChain,
      depth: rawDepth,
      focus: rawFocus,
      isUrl
    }
  }
}
