// ============================================================
// Darwin - Base Mainnet Public Client
// ============================================================

import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { loadConfig } from '../config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

export function getPublicClient() {
  if (!client) {
    const config = loadConfig();
    client = createPublicClient({
      chain: base,
      transport: http(config.rpcUrl),
    });
  }
  return client as ReturnType<typeof createPublicClient<ReturnType<typeof http>, typeof base>>;
}
