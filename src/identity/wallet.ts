// ============================================================
// Darwin - Wallet Management
// ============================================================

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { WalletData } from '../types.js';
import { getWalletPath, ensureDataDir } from '../config.js';
import { logger } from '../observability/logger.js';

export function walletExists(): boolean {
  return existsSync(getWalletPath());
}

export function generateWallet(): WalletData {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const data: WalletData = {
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString(),
  };

  return data;
}

export function saveWallet(data: WalletData): void {
  ensureDataDir();
  const path = getWalletPath();
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  // Double-ensure permissions
  chmodSync(path, 0o600);
  logger.info('identity', `Wallet saved to ${path}`);
}

export function loadWallet(): WalletData {
  const path = getWalletPath();
  if (!existsSync(path)) {
    throw new Error(`Wallet not found at ${path}. Run --init first.`);
  }

  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw) as WalletData;

  if (!data.address || !data.privateKey) {
    throw new Error('Invalid wallet file: missing address or privateKey');
  }

  return data;
}

export function getWalletAddress(): string {
  const wallet = loadWallet();
  return wallet.address;
}

/**
 * Get the account object for signing.
 * IMPORTANT: This should only be used internally by chain modules,
 * never exposed to agent tools directly.
 */
export function getSignerAccount() {
  const wallet = loadWallet();
  return privateKeyToAccount(wallet.privateKey as `0x${string}`);
}

export function initWallet(): WalletData {
  if (walletExists()) {
    logger.info('identity', 'Wallet already exists, loading...');
    return loadWallet();
  }

  logger.info('identity', 'Generating new wallet...');
  const wallet = generateWallet();
  saveWallet(wallet);
  logger.info('identity', `New wallet address: ${wallet.address}`);
  return wallet;
}
