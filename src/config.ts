// ============================================================
// Darwin - Configuration Management
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { DarwinConfig } from './types.js';

const DARWIN_DIR = join(homedir(), '.darwin');
const CONFIG_FILE = join(DARWIN_DIR, 'darwin.json');

// Base mainnet USDC contract
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

const DEFAULT_CONFIG: DarwinConfig = {
  dataDir: DARWIN_DIR,
  chainId: 8453, // Base mainnet
  rpcUrl: 'https://mainnet.base.org',
  usdcAddress: BASE_USDC_ADDRESS,
  heartbeatIntervalMs: 60_000, // 60s default
  maxSpendPerTx: 20, // 20 USDC
  maxSpendPerDay: 50, // 50 USDC
  aiServicePort: 3402,
  logLevel: 'info',
  telegramBotToken: '',
  telegramOperatorId: '',
};

export function ensureDataDir(): void {
  if (!existsSync(DARWIN_DIR)) {
    mkdirSync(DARWIN_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): DarwinConfig {
  ensureDataDir();

  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  const loaded = JSON.parse(raw) as Partial<DarwinConfig>;
  return { ...DEFAULT_CONFIG, ...loaded };
}

export function saveConfig(config: DarwinConfig): void {
  ensureDataDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getDataDir(): string {
  return DARWIN_DIR;
}

export function getDbPath(): string {
  return join(DARWIN_DIR, 'darwin.db');
}

export function getWalletPath(): string {
  return join(DARWIN_DIR, 'wallet.json');
}

export function getSoulPath(): string {
  return join(DARWIN_DIR, 'SOUL.md');
}

export function getLogDir(): string {
  const dir = join(DARWIN_DIR, 'logs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
