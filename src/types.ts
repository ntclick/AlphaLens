// Canonical request/response shape — must match
// backend/internal/agents/contract.go (AgentRequest / AgentResponse).

export interface AgentRequest {
  job_id: string
  agent_id?: string
  schema_version?: string
  inputs: {
    contract_address?: string
    chain?: string
    analysis_depth?: string
    focus?: string
    [k: string]: any
  }
  metadata?: {
    caller?: string
    timestamp?: string
  }
}

export type AgentErrorCode =
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'EXTERNAL_API_FAILED'
  | 'INTERNAL'

export interface AgentSuccessResponse {
  status: 'success'
  schema_version: '1.0'
  result: Record<string, any>
  execution_time_ms: number
}

export interface AgentErrorResponse {
  status: 'error'
  schema_version: '1.0'
  error_code: AgentErrorCode
  error_message: string
  retry_allowed: boolean
  execution_time_ms?: number
}

export type AgentResponse = AgentSuccessResponse | AgentErrorResponse

export interface ChainConfig {
  id: string
  name: string
  birdeyeChain: string
  type: 'evm' | 'svm' | 'sui'
  chainId?: number
  rpc: string
  explorer: string
}

export interface SecurityFlags {
  redFlags: string[]
  yellowFlags: string[]
  greenFlags: string[]
  score: number
  riskLevel: 'low' | 'medium' | 'high'
}

export interface SmartMoneyResult {
  smart_wallets_detected: number
  net_flow: 'accumulating' | 'distributing' | 'neutral'
  smart_money_bought_usd: number
  smart_money_sold_usd: number
  net_position_change: string
  notable_wallets: any[]
  signal: 'bullish' | 'bearish' | 'neutral'
}
