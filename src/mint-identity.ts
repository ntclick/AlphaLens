/**
 * mint-identity.ts — One-off script to register AlphaLens on-chain.
 *
 * 1. Checks USDC balance (Arc Testnet gas = USDC)
 * 2. Mints ERC-8004 Identity NFT on IdentityRegistry
 * 3. Reads back the Token ID from Transfer event
 * 4. Prints next steps (register on GigaWork platform)
 *
 * Usage:  npm run mint
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseAbiItem
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

// ─── Constants ────────────────────────────────────────────────────
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const

// Arc Testnet ERC-20 USDC (6 decimals) — used for job payments.
// Native USDC (18 decimals) is the gas token.
const USDC_CONTRACT = '0x3600000000000000000000000000000000000000' as const

const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const

const identityAbi = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'metadataURI', type: 'string' }],
    outputs: []
  }
] as const

// ─── Metadata (ERC-8004 compliant) ───────────────────────────────
const metadataObj = {
  name: 'AlphaLens',
  description:
    'On-chain security analysis, smart money tracking, and risk scoring for any contract across 8 chains.',
  image: 'ipfs://QmAlphaLensAgentImagePlaceholder',
  agent_type: 'research',
  capabilities: [
    'contract-security',
    'risk-scoring',
    'smart-money-tracking',
    'honeypot-detection',
    'holder-analysis'
  ],
  version: '1.0.0',
  pricingModel: {
    type: 'per_use',
    rate: 200000 // 0.20 USDC (6 decimals)
  }
}

const METADATA_URI = `data:application/json;base64,${Buffer.from(
  JSON.stringify(metadataObj)
).toString('base64')}`

// ─── Helpers ─────────────────────────────────────────────────────
async function waitForReceipt(
  client: ReturnType<typeof createPublicClient>,
  hash: `0x${string}`,
  label: string
) {
  console.log(`  Waiting for ${label}: ${hash}`)
  const receipt = await client.waitForTransactionReceipt({ hash })
  console.log(`  ${label} confirmed in block ${receipt.blockNumber}`)
  return receipt
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  // ── Validate env ──────────────────────────────────────────────
  const pk = process.env.OWNER_PRIVATE_KEY
  if (!pk || pk.length < 60 || pk === '0xYOUR_PRIVATE_KEY_HERE') {
    console.error('\n  Missing or invalid OWNER_PRIVATE_KEY in .env')
    console.error('  Copy .env.example -> .env and fill in your MetaMask private key.\n')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk as `0x${string}`)

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http()
  })
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http()
  })

  console.log('\n== Step 1: Check Wallet ==')
  console.log(`  Owner address: ${account.address}`)
  console.log(`  Chain: Arc Testnet (${arcTestnet.id})`)

  // ── Check native USDC balance (gas) ───────────────────────────
  const nativeBalance = await publicClient.getBalance({ address: account.address })
  const nativeFormatted = formatUnits(nativeBalance, 18) // native USDC = 18 decimals
  console.log(`  Native USDC (gas): ${parseFloat(nativeFormatted).toFixed(4)} USDC`)

  if (nativeBalance === 0n) {
    console.error('\n  No native USDC for gas!')
    console.error('  Get testnet USDC: https://faucet.circle.com')
    console.error('  Select "Arc Testnet" and enter your wallet address:')
    console.error(`    ${account.address}`)
    process.exit(1)
  }

  // ── Check ERC-20 USDC balance ─────────────────────────────────
  const usdcBalance = await publicClient.readContract({
    address: USDC_CONTRACT,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address]
  })

  const usdcFormatted = formatUnits(usdcBalance, 6)
  console.log(`  ERC-20 USDC: ${usdcFormatted} USDC`)

  if (usdcBalance === 0n) {
    console.error('\n  No ERC-20 USDC in wallet — get testnet USDC first:')
    console.error('    https://faucet.circle.com')
    console.error(`    Wallet address: ${account.address}`)
    process.exit(1)
  }

  if (parseFloat(usdcFormatted) < 0.1) {
    console.warn('\n  Low USDC balance — may not cover fees')
    console.warn('    Get more at: https://faucet.circle.com')
  }

  // ── Mint ERC-8004 Identity NFT ────────────────────────────────
  console.log('\n== Step 2: Mint ERC-8004 Identity NFT ==')
  console.log(`  Registry: ${IDENTITY_REGISTRY}`)
  console.log(`  Metadata: ${metadataObj.name} v${metadataObj.version}`)

  const registerTx = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'register',
    args: [METADATA_URI],
    account
  })
  const receipt = await waitForReceipt(publicClient, registerTx, 'Registration')

  // ── Retrieve Token ID from Transfer event ─────────────────────
  console.log('\n== Step 3: Retrieve Agent Token ID ==')
  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem(
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
    ),
    args: { to: account.address },
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber
  })

  if (transferLogs.length === 0) {
    console.error('  Registration tx succeeded but no Transfer event found!')
    console.error(`  Check on ArcScan: https://testnet.arcscan.app/tx/${registerTx}`)
    process.exit(1)
  }

  const tokenId = transferLogs[transferLogs.length - 1].args.tokenId!
  console.log(`  ERC-8004 Token ID: ${tokenId}`)
  console.log(`  ArcScan: https://testnet.arcscan.app/tx/${registerTx}`)

  // ── Next steps ────────────────────────────────────────────────
  const renderUrl = process.env.RENDER_URL || 'https://alphalens-agent.onrender.com'

  console.log('\n== DONE ==')
  console.log(`  Agent "${metadataObj.name}" minted as Token #${tokenId}`)
  console.log(`  Owner: ${account.address}`)

  console.log('\n  NEXT STEPS:')
  console.log('  1. Deploy to Render (if not already)')
  console.log(`  2. Register on GigaWork:`)
  console.log(`     https://gigawork.xyz/agents/register`)
  console.log(`     - Address: ${account.address}`)
  console.log(`     - ERC-8004 Token ID: ${tokenId}`)
  console.log(`     - Endpoint URL: ${renderUrl}/run`)
  console.log(`     - Price: 0.20 USDC`)
  console.log(`     - Category: research`)
  console.log('')
}

main().catch((err) => {
  console.error('\nMint failed:', err.message || err)
  process.exit(1)
})
