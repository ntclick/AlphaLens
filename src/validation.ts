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

// Validate and normalize the inputs for a scan job.
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

  // Format check per chain type
  const chainType = CHAINS[rawChain].type
  if (chainType === 'evm') {
    if (!EVM_ADDRESS.test(rawAddr)) {
      return invalid(`Invalid EVM address format for ${rawChain}. Expected 0x + 40 hex chars.`)
    }
  } else if (chainType === 'svm') {
    if (!SOLANA_ADDRESS.test(rawAddr)) {
      return invalid('Invalid Solana address format. Expected base58 32-44 chars.')
    }
  } else if (chainType === 'sui') {
    if (!SUI_ADDRESS.test(rawAddr)) {
      return invalid('Invalid Sui address format.')
    }
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
      focus: rawFocus
    }
  }
}
