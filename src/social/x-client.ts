// ============================================================
// Darwin - X (Twitter) Client
// ============================================================

import { TwitterApi } from 'twitter-api-v2';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../observability/logger.js';

const CREDENTIALS_PATH = join(homedir(), '.darwin', 'x_credentials.json');

interface XCredentials {
  consumerKey: string;
  consumerKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

let cachedClient: TwitterApi | null = null;

function loadCredentials(): XCredentials | null {
  if (!existsSync(CREDENTIALS_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf-8');
    const creds = JSON.parse(raw) as XCredentials;
    if (!creds.consumerKey || !creds.consumerKeySecret || !creds.accessToken || !creds.accessTokenSecret) {
      return null;
    }
    return creds;
  } catch {
    return null;
  }
}

function getClient(): TwitterApi | null {
  if (cachedClient) return cachedClient;
  const creds = loadCredentials();
  if (!creds) return null;
  cachedClient = new TwitterApi({
    appKey: creds.consumerKey,
    appSecret: creds.consumerKeySecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessTokenSecret,
  });
  return cachedClient;
}

export function isXConfigured(): boolean {
  return loadCredentials() !== null;
}

/**
 * Post a tweet. Returns the tweet URL on success.
 */
export async function postTweet(text: string): Promise<string> {
  const client = getClient();
  if (!client) {
    throw new Error(`X credentials not configured. Please fill in ${CREDENTIALS_PATH}`);
  }

  if (text.length > 280) {
    throw new Error(`Tweet too long (${text.length}/280 chars)`);
  }

  logger.info('x-client', 'Posting tweet', { length: text.length });
  const result = await client.v2.tweet(text);
  const tweetId = result.data.id;
  // Get username for URL (best effort)
  let url = `https://x.com/i/status/${tweetId}`;
  try {
    const me = await client.v2.me();
    url = `https://x.com/${me.data.username}/status/${tweetId}`;
  } catch {
    // fallback URL is fine
  }
  logger.info('x-client', 'Tweet posted', { tweetId, url });
  return url;
}
