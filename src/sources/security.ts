import { SecurityFlags, SmartMoneyResult } from '../types.js'

// Known wallet labels — expand as needed
export const KNOWN_LABELS: Record<string, string> = {
  'HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt': 'Binance Hot Wallet',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'FTX Bankruptcy Estate',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Jump Trading',
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvh2e2': 'Alameda Research',
  '0x28C6c06298d514Db089934071355E5743bf21d60': 'Binance 14',
  '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549': 'Binance 15',
  '0xF977814e90dA44bFA03b6295A0616a897441aceC': 'Binance 8',
  '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8': 'Binance Cold Wallet',
  '0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf': 'Kraken',
  '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d': 'Coinbase 2',
}

export function analyzeSecurityFlags(
  securityData: any,
  chain: string,
  ageInDays: number | null
): SecurityFlags {
  const redFlags: string[] = []
  const yellowFlags: string[] = []
  const greenFlags: string[] = []

  // === Contract age checks ===
  if (ageInDays !== null) {
    if (ageInDays < 1) {
      redFlags.push('Contract is < 24 hours old — EXTREME RISK, no track record')
    } else if (ageInDays < 7) {
      redFlags.push(`Contract is only ${ageInDays} days old — very new, high risk`)
    } else if (ageInDays < 30) {
      yellowFlags.push(`Contract is ${ageInDays} days old — relatively new`)
    } else if (ageInDays > 365) {
      greenFlags.push(`Contract survived ${Math.floor(ageInDays / 365)} year(s) without exploit`)
    }
  }

  if (!securityData) {
    yellowFlags.push('Security data unavailable — manual review recommended')
    return { redFlags, yellowFlags, greenFlags, score: 40, riskLevel: 'medium' }
  }

  // === Solana-specific checks ===
  if (chain === 'solana') {
    if (securityData.mintAuthority === null) {
      greenFlags.push('Mint authority revoked — supply is permanently fixed')
    } else {
      redFlags.push('Mint authority ACTIVE — deployer can create unlimited tokens')
    }

    if (securityData.freezeAuthority === null) {
      greenFlags.push('Freeze authority revoked — no wallet can be frozen')
    } else {
      yellowFlags.push('Freeze authority active — deployer can freeze user wallets')
    }
  }

  // === EVM-specific checks ===
  if (chain !== 'solana' && chain !== 'sui') {
    if (securityData.is_honeypot === true) {
      redFlags.push('🚨 HONEYPOT DETECTED — tokens cannot be sold')
    }
    if (securityData.cannot_sell_all === true) {
      redFlags.push('Cannot sell 100% of balance — partial honeypot behavior')
    }
    if (securityData.owner_change_balance === true) {
      redFlags.push('Owner can modify wallet balances — extreme centralization risk')
    }
    if (securityData.selfdestruct === true) {
      redFlags.push('Self-destruct function present — contract can be destroyed')
    }
    if (securityData.hidden_owner === true) {
      redFlags.push('Hidden owner detected — real ownership is obfuscated')
    }
    if (securityData.is_proxy === true) {
      yellowFlags.push('Proxy/upgradeable contract — logic can be changed by owner')
    }
    if (securityData.is_blacklisted === true) {
      yellowFlags.push('Blacklist function exists — deployer can block specific wallets')
    }
    if (securityData.is_pausable === true) {
      yellowFlags.push('Contract is pausable — trading can be stopped by owner')
    }

    // Tax checks
    const buyTax = parseFloat(securityData.buy_tax || 0)
    const sellTax = parseFloat(securityData.sell_tax || 0)
    if (buyTax > 10 || sellTax > 10) {
      redFlags.push(`Extremely high tax: buy=${buyTax}% sell=${sellTax}% — likely scam`)
    } else if (buyTax > 5 || sellTax > 5) {
      yellowFlags.push(`High transfer tax: buy=${buyTax}% sell=${sellTax}%`)
    } else if (buyTax === 0 && sellTax === 0) {
      greenFlags.push('Zero transfer tax')
    }

    // Ownership
    if (
      securityData.owner_address === '0x0000000000000000000000000000000000000000' ||
      securityData.is_open_source === true
    ) {
      greenFlags.push('Ownership renounced — no admin control')
    }

    // Open source
    if (securityData.is_open_source === true) {
      greenFlags.push('Contract is verified and open source')
    } else {
      yellowFlags.push('Contract source code not verified — cannot audit logic')
    }
  }

  // === Holder concentration (any chain) ===
  const creatorPct = parseFloat(securityData.creatorPercentage || 0)
  if (creatorPct > 20) {
    redFlags.push(`Creator holds ${creatorPct.toFixed(1)}% — extreme dump risk`)
  } else if (creatorPct > 5) {
    yellowFlags.push(`Creator holds ${creatorPct.toFixed(1)}% — monitor for large sells`)
  } else if (creatorPct === 0) {
    greenFlags.push('Creator holds 0% — fully distributed')
  }

  const top10Pct = parseFloat(securityData.top10HolderPercent || 0)
  if (top10Pct > 80) {
    redFlags.push(`Top 10 wallets hold ${top10Pct.toFixed(1)}% — extreme whale concentration`)
  } else if (top10Pct > 60) {
    yellowFlags.push(`Top 10 wallets hold ${top10Pct.toFixed(1)}% — moderate concentration`)
  } else {
    greenFlags.push(`Top 10 wallets hold ${top10Pct.toFixed(1)}% — reasonable distribution`)
  }

  // === Liquidity lock ===
  const lpLocked = parseFloat(securityData.lpLockedPercent || 0)
  if (lpLocked > 80) {
    greenFlags.push(`${lpLocked.toFixed(0)}% of liquidity is locked`)
  } else if (lpLocked > 0) {
    yellowFlags.push(`Only ${lpLocked.toFixed(0)}% liquidity locked — partial rug pull risk`)
  } else if (securityData.lpTotalSupply > 0 && lpLocked === 0) {
    redFlags.push('No liquidity locked — rug pull risk')
  }

  // === Score calculation ===
  let score = 60 // base
  score -= redFlags.length * 18
  score -= yellowFlags.length * 7
  score += greenFlags.length * 8
  score = Math.max(0, Math.min(100, score))

  const riskLevel: 'low' | 'medium' | 'high' =
    score >= 65 ? 'low' : score >= 35 ? 'medium' : 'high'

  return { redFlags, yellowFlags, greenFlags, score, riskLevel }
}

export function detectSmartMoney(
  trades: any[],
  knownLabels: Record<string, string>
): SmartMoneyResult {
  const walletActivity: Record<string, {
    address: string
    label?: string
    bought: number
    sold: number
    txCount: number
    lastSeen: string
  }> = {}

  for (const trade of trades) {
    const wallet = trade.owner || trade.wallet || trade.from
    if (!wallet) continue

    if (!walletActivity[wallet]) {
      walletActivity[wallet] = {
        address: wallet,
        label: knownLabels[wallet],
        bought: 0,
        sold: 0,
        txCount: 0,
        lastSeen: trade.blockUnixTime
          ? new Date(trade.blockUnixTime * 1000).toISOString()
          : new Date().toISOString()
      }
    }

    walletActivity[wallet].txCount++
    const volumeUsd = trade.volumeUsd || trade.volume_usd || 0
    if (trade.side === 'buy' || trade.type === 'buy') {
      walletActivity[wallet].bought += volumeUsd
    } else {
      walletActivity[wallet].sold += volumeUsd
    }
  }

  // Smart money = known label OR trades > $10k
  const smartWallets = Object.values(walletActivity).filter(w =>
    w.label || (w.bought + w.sold) > 10000
  )

  const totalBought = smartWallets.reduce((s, w) => s + w.bought, 0)
  const totalSold = smartWallets.reduce((s, w) => s + w.sold, 0)
  const netFlow = totalBought - totalSold

  return {
    smart_wallets_detected: smartWallets.length,
    net_flow: netFlow > 1000 ? 'accumulating' : netFlow < -1000 ? 'distributing' : 'neutral',
    smart_money_bought_usd: Math.round(totalBought),
    smart_money_sold_usd: Math.round(totalSold),
    net_position_change: `${netFlow >= 0 ? '+' : ''}$${Math.abs(netFlow) >= 1000
      ? (netFlow / 1000).toFixed(1) + 'K'
      : Math.round(netFlow).toString()}`,
    notable_wallets: smartWallets
      .sort((a, b) => (b.bought + b.sold) - (a.bought + a.sold))
      .slice(0, 5)
      .map(w => ({
        address: w.address,
        label: w.label || null,
        total_volume_usd: Math.round(w.bought + w.sold),
        net_position: Math.round(w.bought - w.sold),
        action: w.bought > w.sold ? 'accumulating' : 'distributing',
        last_seen: w.lastSeen
      })),
    signal: netFlow > totalBought * 0.15
      ? 'bullish'
      : netFlow < -totalSold * 0.15
        ? 'bearish'
        : 'neutral'
  }
}
