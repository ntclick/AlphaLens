# AlphaLens

On-chain security analysis, smart money tracking, and risk scoring
for any contract across 8 chains.

## Supported Chains
Solana, Ethereum, Base, Arbitrum, BSC, Polygon, Avalanche, Sui

## Powered By
- Birdeye API (on-chain data)
- DeepSeek (AI analysis)

## Run locally

```bash
cp .env.example .env
# Fill in BIRDEYE_API_KEY and DEEPSEEK_API_KEY
npm install
npm run dev
```

Server starts on `PORT` (default 3000). If API keys are missing or use placeholder
values, the server prints warnings on startup and calls will fail gracefully.

## Endpoints

### `GET /`
Health check. Returns agent name, version, supported chains, pricing.

### `GET /schema`
Returns the GigaWork-compatible input schema and agent metadata. Used for
auto-registration on the platform. Schema follows the JSON Schema subset used
by `backend/internal/agents/validator.go`.

### `POST /run`
Main job execution endpoint. Accepts the canonical GigaWork `AgentRequest`:

```json
{
  "job_id": "test-001",
  "agent_id": "alphalens-agent",
  "schema_version": "1.0",
  "inputs": {
    "contract_address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "chain": "solana",
    "analysis_depth": "standard"
  },
  "metadata": { "caller": "gigawork-platform", "timestamp": "2026-04-12T10:00:00Z" }
}
```

Responses follow the canonical `AgentResponse` format.

**Success:**
```json
{
  "status": "success",
  "schema_version": "1.0",
  "result": { ... },
  "execution_time_ms": 1234
}
```

**Error:**
```json
{
  "status": "error",
  "schema_version": "1.0",
  "error_code": "INVALID_INPUT | TIMEOUT | EXTERNAL_API_FAILED | INTERNAL",
  "error_message": "...",
  "retry_allowed": true,
  "execution_time_ms": 12
}
```

## Input validation

- `contract_address` — required. Format-checked per chain:
  - EVM chains: `0x` + 40 hex chars
  - Solana: base58, 32-44 chars
  - Sui: `0x` + up to 64 hex chars, optional `::module::name`
- `chain` — required. Must be one of: solana, ethereum, base, arbitrum, bsc, polygon, avalanche, sui.
- `analysis_depth` — optional. One of: `quick`, `standard`, `deep` (default: `standard`).
- `focus` — optional. One of: `all`, `security`, `smart_money`, `liquidity` (default: `all`).

## Error classification

| Scenario | `error_code` | `retry_allowed` |
|---|---|---|
| Missing / invalid inputs | `INVALID_INPUT` | `false` |
| Contract not found on chain | `INVALID_INPUT` | `false` |
| Birdeye rate limit (429) | `EXTERNAL_API_FAILED` | `true` |
| Birdeye 5xx / network error | `EXTERNAL_API_FAILED` | `true` |
| Birdeye auth (401/403) | `EXTERNAL_API_FAILED` | `false` |
| DeepSeek timeout | `TIMEOUT` | `true` |
| DeepSeek 5xx / 429 | `EXTERNAL_API_FAILED` | `true` |
| DeepSeek auth | `EXTERNAL_API_FAILED` | `false` |
| DeepSeek parse failure | (success with heuristic fallback) | — |
| Other unexpected error | `INTERNAL` | `true` |

## Test

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-001",
    "agent_id": "alphalens-agent",
    "schema_version": "1.0",
    "inputs": {
      "contract_address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "chain": "solana",
      "analysis_depth": "standard"
    },
    "metadata": { "caller": "test", "timestamp": "2026-04-12T10:00:00Z" }
  }'
```

## GigaWork Registration
- Endpoint: `POST /run`
- Schema: `GET /schema`
- Price: 0.20 USDC per scan
- Register at: gigawork.netlify.app/agents/register
