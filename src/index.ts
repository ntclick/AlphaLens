import express, { Request, Response } from 'express'
import { CHAINS } from './chains.js'
import {
  getTokenOverview,
  getTokenSecurity,
  getTopHolders,
  getTokenCreationTime,
  getRecentTrades,
  getTokenMarkets,
  BirdeyeError
} from './sources/birdeye.js'
import {
  analyzeSecurityFlags,
  detectSmartMoney,
  KNOWN_LABELS
} from './sources/security.js'
import { analyzeWithAI, DeepSeekError } from './analyzer.js'
import { AgentErrorCode, AgentErrorResponse, AgentSuccessResponse } from './types.js'
import { validateAddressFormat, validateInputs, validateRequestEnvelope } from './validation.js'
import { AGENT_METADATA, INPUT_SCHEMA, OUTPUT_EXAMPLE } from './schema.js'
import { resolveContractInput, DexscreenerResolveError, ResolvedContract } from './sources/dexscreener.js'

const PORT = Number(process.env.PORT) || 3000

// ─── Startup env validation ────────────────────────────────────────
function validateEnv() {
  const warnings: string[] = []
  const birdeye = process.env.BIRDEYE_API_KEY
  const deepseek = process.env.DEEPSEEK_API_KEY

  if (!birdeye || birdeye === 'your_birdeye_key' || birdeye === 'demo_key_for_testing') {
    warnings.push('BIRDEYE_API_KEY is missing or set to a placeholder — Birdeye calls will fail')
  }
  if (!deepseek || deepseek === 'sk-...' || deepseek === 'sk-demo_key') {
    warnings.push('DEEPSEEK_API_KEY is missing or set to a placeholder — AI synthesis will fall back to heuristics')
  }

  if (warnings.length) {
    console.warn('\n[AlphaLens] Environment warnings:')
    warnings.forEach((w) => console.warn('  - ' + w))
    console.warn('')
  }
}

const app = express()
app.use(express.json({ limit: '256kb' }))

// ─── Helpers to build canonical GigaWork responses ─────────────────
function errorResponse(
  code: AgentErrorCode,
  message: string,
  retryAllowed: boolean,
  startedAt: number
): AgentErrorResponse {
  return {
    status: 'error',
    schema_version: '1.0',
    error_code: code,
    error_message: message,
    retry_allowed: retryAllowed,
    execution_time_ms: Date.now() - startedAt
  }
}

function successResponse(result: Record<string, any>, startedAt: number): AgentSuccessResponse {
  return {
    status: 'success',
    schema_version: '1.0',
    result,
    execution_time_ms: Date.now() - startedAt
  }
}

// ─── Health / discovery ────────────────────────────────────────────
// GigaWork platform polls GET /health to verify agent is live.
const healthHandler = (_req: Request, res: Response) => {
  res.json({
    agent: AGENT_METADATA.name,
    version: AGENT_METADATA.version,
    status: 'ok',
    supported_chains: Object.keys(CHAINS),
    description: AGENT_METADATA.description,
    pricing: `${AGENT_METADATA.pricing.per_call_usdc} USDC per scan`,
    gigawork: 'https://gigawork.xyz'
  })
}
app.get('/', healthHandler)
app.get('/health', healthHandler)

// ─── Input schema (for GigaWork auto-registration) ─────────────────
app.get('/schema', (_req: Request, res: Response) => {
  res.json({
    agent: AGENT_METADATA,
    input_schema: INPUT_SCHEMA,
    output_example: OUTPUT_EXAMPLE
  })
})

// ─── Main job execution ────────────────────────────────────────────
app.post('/run', async (req: Request, res: Response) => {
  const startedAt = Date.now()

  // 1. Validate request envelope
  const envelope = validateRequestEnvelope(req.body)
  if (!envelope.ok) {
    return res.status(400).json(
      errorResponse(envelope.error.error_code, envelope.error.error_message, false, startedAt)
    )
  }

  const body = req.body as {
    job_id: string
    agent_id?: string
    schema_version?: string
    inputs: any
    metadata?: { caller?: string; timestamp?: string }
  }

  const caller = body.metadata?.caller || 'unknown'
  console.log(`[AlphaLens] Job ${body.job_id} started (caller=${caller})`, body.inputs)

  // 2. Validate inputs
  const inputResult = validateInputs(body.inputs)
  if (!inputResult.ok) {
    console.log(`[AlphaLens] Job ${body.job_id} invalid input: ${inputResult.error.error_message}`)
    return res.status(400).json(
      errorResponse(inputResult.error.error_code, inputResult.error.error_message, false, startedAt)
    )
  }

  // 2b. Resolve Dexscreener URL (if applicable) to a plain token address
  let resolved: ResolvedContract
  try {
    resolved = await resolveContractInput(
      inputResult.value.contractAddress,
      inputResult.value.chain
    )
  } catch (err: any) {
    if (err instanceof DexscreenerResolveError) {
      return res.status(err.retryAllowed ? 503 : 400).json(
        errorResponse(
          err.retryAllowed ? 'EXTERNAL_API_FAILED' : 'INVALID_INPUT',
          err.message,
          err.retryAllowed,
          startedAt
        )
      )
    }
    throw err
  }

  // URL resolution can override the chain (URL path is authoritative).
  const contractAddress = resolved.resolved_address
  const chain = resolved.source === 'url' ? resolved.chain : inputResult.value.chain
  const { depth } = inputResult.value

  // Re-validate format on the resolved address (Dexscreener could return
  // anything; trust-but-verify before we hit Birdeye).
  const fmtCheck = validateAddressFormat(contractAddress, chain)
  if ('ok' in fmtCheck && fmtCheck.ok === false) {
    const err = (fmtCheck as any).error as { error_message: string }
    return res.status(400).json(
      errorResponse('INVALID_INPUT', `Resolved address invalid: ${err.error_message}`, false, startedAt)
    )
  }

  const birdeyeChain = CHAINS[chain].birdeyeChain
  if (resolved.source === 'url') {
    console.log(`[AlphaLens] Resolved URL → ${contractAddress} (${resolved.pair_info?.base_token.symbol}) on ${chain}`)
  }
  console.log(`[AlphaLens] Fetching Birdeye data for ${contractAddress} on ${birdeyeChain}`)

  try {
    const shouldFetchTrades = depth !== 'quick'
    const shouldFetchMarkets = depth === 'deep'

    // 3. Fetch all data concurrently
    const [
      tokenOverviewResult,
      tokenSecurityResult,
      topHoldersResult,
      creationInfoResult,
      recentTradesResult,
      marketDataResult
    ] = await Promise.allSettled([
      getTokenOverview(contractAddress, birdeyeChain),
      getTokenSecurity(contractAddress, birdeyeChain),
      getTopHolders(contractAddress, birdeyeChain, 20),
      getTokenCreationTime(contractAddress, birdeyeChain),
      shouldFetchTrades
        ? getRecentTrades(contractAddress, birdeyeChain, 100)
        : Promise.resolve([]),
      shouldFetchMarkets
        ? getTokenMarkets(contractAddress, birdeyeChain)
        : Promise.resolve(null)
    ])

    // 4. Check critical Birdeye failure — HTTP status determines retry behavior
    // on the GigaWork side: 4xx = break immediately, 5xx = retry with backoff.
    // Body-level retry_allowed is only consulted for 2xx, so mapping here is
    // what actually controls retry loops.
    if (tokenOverviewResult.status === 'rejected') {
      const err = tokenOverviewResult.reason
      if (err instanceof BirdeyeError) {
        // Birdeye 400/404 on token_overview → contract not indexed on this chain.
        // Classify as INVALID_INPUT so platform breaks retry and surfaces a
        // clear "bad input" message to the user.
        if (err.status === 400 || err.status === 404) {
          return res.status(400).json(
            errorResponse(
              'INVALID_INPUT',
              `Contract "${contractAddress}" not indexed by Birdeye on ${chain}. Check address and chain.`,
              false,
              startedAt
            )
          )
        }
        return mapBirdeyeError(res, err, startedAt)
      }
      throw err
    }

    const overview = tokenOverviewResult.value
    const security = tokenSecurityResult.status === 'fulfilled' ? tokenSecurityResult.value : null
    const holders = topHoldersResult.status === 'fulfilled' ? topHoldersResult.value : []
    const creation = creationInfoResult.status === 'fulfilled' ? creationInfoResult.value : null
    const trades = recentTradesResult.status === 'fulfilled' ? recentTradesResult.value : []
    const markets = marketDataResult.status === 'fulfilled' ? marketDataResult.value : null

    if (!overview) {
      return res.status(400).json(
        errorResponse(
          'INVALID_INPUT',
          `Contract "${contractAddress}" not found on ${chain}. Check address and chain.`,
          false,
          startedAt
        )
      )
    }

    // 5. Derive analysis fields
    const ageInDays = creation?.blockTime
      ? Math.floor((Date.now() / 1000 - creation.blockTime) / 86400)
      : null

    console.log('[AlphaLens] Running security analysis...')
    const securityFlags = analyzeSecurityFlags(security, chain, ageInDays)
    const smartMoney = detectSmartMoney(trades, KNOWN_LABELS)

    // 6. AI synthesis (may throw DeepSeekError)
    console.log('[AlphaLens] Running DeepSeek analysis...')
    const aiResult = await analyzeWithAI({
      contractAddress,
      chain,
      tokenOverview: overview,
      securityFlags,
      holderData: holders,
      smartMoney,
      creationInfo: creation,
      ageInDays,
      analysisDepth: depth
    })

    // 7. Format output
    const topHoldersFormatted = holders.slice(0, 10).map((h: any, i: number) => ({
      rank: i + 1,
      address: h.address,
      label: KNOWN_LABELS[h.address] || null,
      pct: parseFloat((h.percentage || 0).toFixed(2)),
      amount_ui: h.ui_amount || null
    }))

    const result = {
      contract_address: contractAddress,
      chain,
      token_name: overview.name || 'Unknown',
      token_symbol: overview.symbol || '?',
      analysis_timestamp: new Date().toISOString(),
      analysis_depth: depth,

      contract_profile: {
        age_days: ageInDays,
        deploy_date: creation?.blockTime
          ? new Date(creation.blockTime * 1000).toISOString().split('T')[0]
          : null,
        is_new_contract: ageInDays !== null && ageInDays < 7,
        deployer_address: creation?.owner || creation?.deployer || null,
        deployer_label: creation?.owner ? KNOWN_LABELS[creation.owner] || null : null,
        contract_type: chain === 'solana' ? 'SPL Token' : 'ERC-20',
        // mint_authority / freeze_authority are Solana-specific; omit for EVM/Sui
        ...(chain === 'solana' ? {
          mint_authority: security?.mintAuthority === null
            ? 'revoked' : security?.mintAuthority ? 'active' : 'unknown',
          freeze_authority: security?.freezeAuthority === null
            ? 'revoked' : security?.freezeAuthority ? 'active' : 'unknown'
        } : {}),
        explorer_url: `${CHAINS[chain].explorer}/token/${contractAddress}`
      },

      security_assessment: {
        overall_score: securityFlags.score,
        risk_level: securityFlags.riskLevel,
        flags: {
          red_flags: securityFlags.redFlags,
          yellow_flags: securityFlags.yellowFlags,
          green_flags: securityFlags.greenFlags
        },
        honeypot_detected: security?.is_honeypot || false,
        ownership_renounced:
          security?.owner_address === '0x0000000000000000000000000000000000000000'
      },

      market_data: {
        price_usd: overview.price || 0,
        price_change_24h_pct: parseFloat((overview.priceChange24hPercent || 0).toFixed(2)),
        price_change_7d_pct: parseFloat((overview.priceChange7dPercent || 0).toFixed(2)),
        volume_24h_usd: Math.round(overview.v24hUSD || 0),
        volume_change_24h_pct: parseFloat((overview.v24hChangePercent || 0).toFixed(2)),
        market_cap_usd: Math.round(overview.mc || 0),
        fully_diluted_valuation: Math.round(overview.fdv || 0),
        liquidity_usd: Math.round(overview.liquidity || 0),
        liquidity_to_mcap_ratio: overview.mc > 0
          ? parseFloat((overview.liquidity / overview.mc).toFixed(4))
          : 0,
        total_supply: overview.supply || null,
        circulating_supply: overview.circulatingSupply || null
      },

      holder_analysis: {
        total_holders: overview.holder || 0,
        top_10_holders_pct: parseFloat(
          topHoldersFormatted.reduce((s: number, h: any) => s + h.pct, 0).toFixed(2)
        ),
        top_10_breakdown: topHoldersFormatted,
        concentration_risk:
          (topHoldersFormatted[0]?.pct || 0) > 50 ? 'high' :
            (topHoldersFormatted[0]?.pct || 0) > 20 ? 'medium' : 'low'
      },

      smart_money_activity: {
        tracking_window: depth === 'quick' ? 'N/A (quick scan)' : '24h',
        ...smartMoney
      },

      liquidity_analysis: markets ? {
        total_pools: markets.totalPools || 0,
        main_dex: markets.mainDex || null,
        liquidity_locked_pct: security?.lpLockedPercent || 0
      } : null,

      risk_summary: {
        overall_risk: securityFlags.riskLevel,
        risk_score: securityFlags.score,
        investment_grade: aiResult.investment_grade,
        key_risks: aiResult.key_risks,
        key_strengths: aiResult.key_strengths
      },

      ai_analysis: aiResult.ai_analysis,
      recommendation: aiResult.recommendation,
      confidence: aiResult.confidence,
      disclaimer: 'Not financial advice. Smart contract analysis has inherent limitations. Always DYOR before investing.',

      // Present when Dexscreener resolved a URL or pair → token
      ...(resolved.source !== 'direct' ? {
        input_resolution: {
          source: resolved.source,
          original_input: resolved.original_input,
          resolved_address: resolved.resolved_address,
          pair_info: resolved.pair_info,
          note: resolved.note
        }
      } : {})
    }

    const response = successResponse(result, startedAt)
    console.log(
      `[AlphaLens] Job ${body.job_id} completed in ${response.execution_time_ms}ms — ${aiResult.recommendation}`
    )
    res.json(response)

  } catch (err: any) {
    console.error(`[AlphaLens] Job ${body.job_id} error:`, err?.message || err)

    if (err instanceof BirdeyeError) {
      return mapBirdeyeError(res, err, startedAt)
    }

    if (err instanceof DeepSeekError) {
      return mapDeepSeekError(res, err, startedAt)
    }

    // Unknown — treat as retryable internal error (5xx so platform retries once)
    const message = err?.message || 'Unknown internal error'
    return res.status(500).json(
      errorResponse('INTERNAL', message, true, startedAt)
    )
  }
})

// ─── Error mappers ────────────────────────────────────────────────
// Critical: HTTP status code drives platform retry behavior.
// Platform's community-agent client in backend/internal/agents/community.go:
//   - 4xx responses  → break retry loop (non-retryable)
//   - 5xx responses  → retry with backoff (retryable)
//   - 2xx responses  → parse body, respect retry_allowed
// So non-retryable errors MUST return 4xx or the platform keeps retrying
// even when our body says retry_allowed:false.
function mapBirdeyeError(res: Response, err: BirdeyeError, startedAt: number) {
  if (!err.retryAllowed) {
    // 400/404 = contract not indexed → user input issue
    if (err.status === 400 || err.status === 404) {
      return res.status(400).json(
        errorResponse('INVALID_INPUT', err.message, false, startedAt)
      )
    }
    // 401/403 = our API key problem → HTTP 400 to stop futile retries,
    // error_code INTERNAL so user sees "agent misconfigured" not "bad input"
    return res.status(400).json(
      errorResponse('INTERNAL', err.message, false, startedAt)
    )
  }
  // Retryable (429, 5xx, network) → 503 so platform retries with backoff
  return res.status(503).json(
    errorResponse('EXTERNAL_API_FAILED', err.message, true, startedAt)
  )
}

function mapDeepSeekError(res: Response, err: DeepSeekError, startedAt: number) {
  if (!err.retryAllowed) {
    // Auth / permanent config error → 400 to break retry loop
    return res.status(400).json(
      errorResponse('INTERNAL', err.message, false, startedAt)
    )
  }
  // Timeout vs transient API failure
  const code: AgentErrorCode = err.isTimeout ? 'TIMEOUT' : 'EXTERNAL_API_FAILED'
  return res.status(503).json(
    errorResponse(code, err.message, true, startedAt)
  )
}

// ─── Start server ──────────────────────────────────────────────────
validateEnv()

app.listen(PORT, () => {
  console.log('\nAlphaLens Agent')
  console.log(`   Version: ${AGENT_METADATA.version}`)
  console.log(`   Port: ${PORT}`)
  console.log(`   Chains: ${Object.keys(CHAINS).join(', ')}`)
  console.log(`   Health: http://localhost:${PORT}/`)
  console.log(`   Schema: http://localhost:${PORT}/schema`)
  console.log(`   Run:    POST http://localhost:${PORT}/run\n`)
})
