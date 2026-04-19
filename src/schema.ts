// GigaWork-compatible input schema for the AlphaLens agent.
// Format matches JSON Schema subset used by backend/internal/agents/validator.go
// and registered in backend/internal/agents/registry.go.
//
// This is exposed at GET /schema so the GigaWork platform (or any operator)
// can fetch the canonical input schema at agent registration time.

import { CHAINS } from './chains.js'

export const AGENT_METADATA = {
  id: 'alphalens-agent',
  name: 'AlphaLens',
  version: '1.0.0',
  description:
    'On-chain security analysis, smart money tracking, and risk scoring for any contract across 8 chains',
  category: 'research',
  capabilities: ['contract-security', 'risk-scoring', 'smart-money-tracking'],
  skill_tags: ['on-chain-analysis', 'rug-detection', 'honeypot-check', 'holder-analysis'],
  pricing: {
    per_call_usdc: 0.2,
    reuse_price_usdc: 0.08,
    trial_available: true,
    failure_policy: 'no_charge'
  },
  ttl_seconds: 21600 // 6h cache
} as const

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    contract_address: {
      type: 'string',
      title: 'Contract Address',
      placeholder: '0x... or So1... token mint',
      default: '0xa43fe16908251ee70ef74718545e4fe6c5ccec9f'
    },
    chain: {
      type: 'string',
      title: 'Chain',
      enum: Object.keys(CHAINS),
      default: 'ethereum'
    },
    analysis_depth: {
      type: 'string',
      title: 'Analysis Depth',
      enum: ['quick', 'standard', 'deep'],
      default: 'standard'
    },
    focus: {
      type: 'string',
      title: 'Focus (optional)',
      enum: ['all', 'security', 'smart_money', 'liquidity'],
      default: 'all'
    }
  },
  required: ['contract_address', 'chain']
} as const

export const OUTPUT_EXAMPLE = {
  contract_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  chain: 'solana',
  token_name: 'USDC',
  token_symbol: 'USDC',
  security_assessment: { overall_score: 92, risk_level: 'low' },
  risk_summary: { investment_grade: 'AAA' }
} as const
