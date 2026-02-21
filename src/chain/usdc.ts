// ============================================================
// Darwin - USDC Operations on Base
// ============================================================

import {
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  parseUnits,
  type Address,
} from 'viem';
import { base } from 'viem/chains';
import { getPublicClient } from './client.js';
import { loadConfig } from '../config.js';
import { getSignerAccount, getWalletAddress } from '../identity/wallet.js';
import { logger } from '../observability/logger.js';

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

/**
 * Get the USDC balance for an address (human-readable, e.g. 10.5 = $10.50).
 * Defaults to Darwin's own wallet address.
 */
export async function getUsdcBalance(address?: string): Promise<number> {
  const config = loadConfig();
  const client = getPublicClient();
  const target = (address ?? getWalletAddress()) as Address;

  const balance = await client.readContract({
    address: config.usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [target],
  });

  const humanReadable = Number(formatUnits(balance, 6));
  logger.debug('chain', `USDC balance for ${target}: ${humanReadable}`);
  return humanReadable;
}

// Aave V3 aUSDC token on Base mainnet
const AUSDC_BASE = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB' as const;

/**
 * Get the Aave V3 aUSDC balance for an address (human-readable).
 * Represents USDC deposited in Aave V3 earning yield.
 * Defaults to Darwin's own wallet address.
 */
export async function getAaveUsdcBalance(address?: string): Promise<number> {
  const client = getPublicClient();
  const target = (address ?? getWalletAddress()) as Address;
  try {
    const balance = await client.readContract({
      address: AUSDC_BASE,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [target],
    });
    const humanReadable = Number(formatUnits(balance, 6));
    logger.debug('chain', `aUSDC (Aave V3) balance for ${target}: ${humanReadable}`);
    return humanReadable;
  } catch (e) {
    logger.warn('chain', 'Failed to fetch aUSDC balance', { error: String(e) });
    return 0;
  }
}

/**
 * Get total effective USDC value (wallet USDC + Aave V3 aUSDC).
 * Use for survival tier calculations to avoid false 'dead' states.
 */
export async function getTotalUsdcValue(address?: string): Promise<number> {
  const [wallet, aave] = await Promise.all([
    getUsdcBalance(address),
    getAaveUsdcBalance(address),
  ]);
  return wallet + aave;
}

/**
 * Get the ETH balance for an address (in ether).
 * Defaults to Darwin's own wallet address.
 */
export async function getEthBalance(address?: string): Promise<number> {
  const client = getPublicClient();
  const target = (address ?? getWalletAddress()) as Address;

  const balance = await client.getBalance({ address: target });
  const humanReadable = Number(formatUnits(balance, 18));
  logger.debug('chain', `ETH balance for ${target}: ${humanReadable}`);
  return humanReadable;
}

/**
 * Transfer USDC to a recipient address.
 * Amount is in human-readable form (e.g. 5.0 = $5.00 USDC).
 * Returns the transaction hash.
 */
export async function transferUsdc(to: string, amount: number): Promise<string> {
  const config = loadConfig();
  const account = getSignerAccount();

  logger.info('chain', `Initiating USDC transfer: ${amount} USDC to ${to}`);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.rpcUrl),
  });

  const onChainAmount = parseUnits(amount.toString(), 6);

  const txHash = await walletClient.writeContract({
    address: config.usdcAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to as Address, onChainAmount],
  });

  logger.info('chain', `USDC transfer submitted`, { txHash, to, amount });
  return txHash;
}
