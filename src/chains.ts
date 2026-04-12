import { ChainConfig } from './types.js'

export const CHAINS: Record<string, ChainConfig> = {
  solana: {
    id: 'solana',
    name: 'Solana',
    birdeyeChain: 'solana',
    type: 'svm',
    rpc: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io'
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    birdeyeChain: 'ethereum',
    type: 'evm',
    chainId: 1,
    rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io'
  },
  base: {
    id: 'base',
    name: 'Base',
    birdeyeChain: 'base',
    type: 'evm',
    chainId: 8453,
    rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    explorer: 'https://basescan.org'
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    birdeyeChain: 'arbitrum',
    type: 'evm',
    chainId: 42161,
    rpc: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io'
  },
  bsc: {
    id: 'bsc',
    name: 'BSC',
    birdeyeChain: 'bsc',
    type: 'evm',
    chainId: 56,
    rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    explorer: 'https://bscscan.com'
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    birdeyeChain: 'polygon',
    type: 'evm',
    chainId: 137,
    rpc: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com'
  },
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche',
    birdeyeChain: 'avalanche',
    type: 'evm',
    chainId: 43114,
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    explorer: 'https://snowtrace.io'
  },
  sui: {
    id: 'sui',
    name: 'Sui',
    birdeyeChain: 'sui',
    type: 'sui',
    rpc: 'https://fullnode.mainnet.sui.io',
    explorer: 'https://suiscan.xyz'
  }
}
