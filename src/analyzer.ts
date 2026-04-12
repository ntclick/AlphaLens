import OpenAI from 'openai'
import { SecurityFlags, SmartMoneyResult } from './types.js'

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly retryAllowed: boolean,
    public readonly isTimeout: boolean = false
  ) {
    super(message)
    this.name = 'DeepSeekError'
  }
}

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
  timeout: 30_000, // 30s cap per call
  maxRetries: 0 // we handle retry/classification ourselves
})

export async function analyzeWithAI(params: {
  contractAddress: string
  chain: string
  tokenOverview: any
  securityFlags: SecurityFlags
  holderData: any[]
  smartMoney: SmartMoneyResult
  creationInfo: any
  ageInDays: number | null
  analysisDepth: string
}): Promise<{
  ai_analysis: string
  recommendation: string
  key_risks: string[]
  key_strengths: string[]
  investment_grade: string
  confidence: number
}> {
  const {
    contractAddress, chain, tokenOverview,
    securityFlags, holderData, smartMoney,
    ageInDays, analysisDepth
  } = params

  const topHolders = holderData.slice(0, 5).map((h: any, i: number) => ({
    rank: i + 1,
    pct: h.percentage || 0,
    label: h.label || 'unknown'
  }))

  const prompt = `You are AlphaLens — a senior on-chain intelligence analyst combining smart contract security expertise with crypto market analysis. You have reviewed thousands of contracts and can instantly identify rug pulls, honeypots, and smart money accumulation patterns.

CONTRACT BEING ANALYZED:
Address: ${contractAddress}
Chain: ${chain.toUpperCase()}
Token: ${tokenOverview?.name || 'Unknown'} (${tokenOverview?.symbol || '?'})
Age: ${ageInDays !== null ? ageInDays + ' days old' : 'age unknown'}

SECURITY ASSESSMENT:
Risk Score: ${securityFlags.score}/100
Risk Level: ${securityFlags.riskLevel.toUpperCase()}
Red Flags (${securityFlags.redFlags.length}): ${JSON.stringify(securityFlags.redFlags)}
Yellow Flags (${securityFlags.yellowFlags.length}): ${JSON.stringify(securityFlags.yellowFlags)}
Green Flags (${securityFlags.greenFlags.length}): ${JSON.stringify(securityFlags.greenFlags)}

MARKET DATA:
Price: $${tokenOverview?.price || 0}
24h Change: ${tokenOverview?.priceChange24hPercent?.toFixed(2) || 0}%
Market Cap: $${(tokenOverview?.mc || 0).toLocaleString()}
24h Volume: $${(tokenOverview?.v24hUSD || 0).toLocaleString()}
Liquidity: $${(tokenOverview?.liquidity || 0).toLocaleString()}
Holders: ${(tokenOverview?.holder || 0).toLocaleString()}

SMART MONEY SIGNAL:
Signal: ${smartMoney.signal.toUpperCase()}
Net Flow: ${smartMoney.net_position_change}
Smart wallets active: ${smartMoney.smart_wallets_detected}
Bought: $${smartMoney.smart_money_bought_usd.toLocaleString()}
Sold: $${smartMoney.smart_money_sold_usd.toLocaleString()}

TOP HOLDERS:
${JSON.stringify(topHolders)}

ANALYSIS DEPTH: ${analysisDepth}

Return JSON only — no markdown, no explanation outside JSON:
{
  "ai_analysis": "3-4 sentences. Lead with most critical finding. Be specific with numbers. Mention smart money signal if significant.",
  "recommendation": "Start with SAFE / CAUTION / HIGH RISK / AVOID. One sentence verdict with primary reason.",
  "key_risks": ["max 3 specific risks, reference actual data"],
  "key_strengths": ["max 3 specific strengths, reference actual data"],
  "investment_grade": "AAA|AA|A|BBB|BB|B|CCC|D",
  "confidence": 0.0-1.0
}

Grading scale:
AAA/AA/A = institutional grade, safe
BBB = acceptable risk
BB/B = speculative
CCC = high risk / likely scam
D = confirmed scam / honeypot

Rules:
- If honeypot detected -> D grade, AVOID
- If age < 7 days -> max BBB grade
- If no liquidity locked + new contract -> CCC or D
- Smart money accumulating on solid contract -> boost grade
- Be direct. Never vague.`

  let response
  try {
    response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  } catch (err: any) {
    const status = err?.status || err?.response?.status
    const isTimeout =
      err?.code === 'ETIMEDOUT' ||
      err?.name === 'APIConnectionTimeoutError' ||
      err?.message?.toLowerCase?.().includes('timeout')

    if (isTimeout) {
      throw new DeepSeekError('DeepSeek request timed out', true, true)
    }
    if (status === 429 || (status && status >= 500)) {
      throw new DeepSeekError(`DeepSeek ${status} — transient failure`, true)
    }
    if (status === 401 || status === 403) {
      throw new DeepSeekError('DeepSeek auth failed — check DEEPSEEK_API_KEY', false)
    }
    throw new DeepSeekError(`DeepSeek error: ${err?.message || 'unknown'}`, false)
  }

  const content = response.choices[0]?.message?.content || '{}'
  try {
    const parsed = JSON.parse(content)
    return {
      ai_analysis: parsed.ai_analysis ?? 'Analysis unavailable.',
      recommendation: parsed.recommendation ?? 'CAUTION — Manual review recommended.',
      key_risks: Array.isArray(parsed.key_risks) ? parsed.key_risks : [],
      key_strengths: Array.isArray(parsed.key_strengths) ? parsed.key_strengths : [],
      investment_grade: parsed.investment_grade ?? 'BB',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.4
    }
  } catch {
    // Parsing failures are non-retryable (model returned malformed JSON) —
    // fall back to a deterministic summary derived from securityFlags so the
    // job still returns something useful rather than failing.
    return {
      ai_analysis: `Deterministic fallback: risk score ${securityFlags.score}/100 (${securityFlags.riskLevel}). AI synthesis unavailable.`,
      recommendation: securityFlags.riskLevel === 'high'
        ? 'HIGH RISK — Multiple red flags detected.'
        : securityFlags.riskLevel === 'medium'
          ? 'CAUTION — Mixed signals, manual review advised.'
          : 'Likely SAFE based on heuristic checks.',
      key_risks: securityFlags.redFlags.slice(0, 3),
      key_strengths: securityFlags.greenFlags.slice(0, 3),
      investment_grade: securityFlags.score >= 80 ? 'A'
        : securityFlags.score >= 65 ? 'BBB'
          : securityFlags.score >= 40 ? 'BB'
            : securityFlags.score >= 20 ? 'CCC' : 'D',
      confidence: 0.5
    }
  }
}
