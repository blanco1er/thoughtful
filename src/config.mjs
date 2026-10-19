// Runtime configuration. Names of environment variables only; no value is ever logged.
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const defaultDataDir = process.platform === 'darwin'
  ? path.join(home, 'Library', 'Application Support', 'Thoughtful')
  : path.join(home, '.thoughtful');

export const config = {
  // Private notebook lives OUTSIDE the repository, readable by the owner only (0700 / 0600).
  dataDir: process.env.THOUGHTFUL_DATA_DIR || defaultDataDir,
  port: Number(process.env.THOUGHTFUL_PORT) || 4317,
  host: process.env.THOUGHTFUL_HOST || '127.0.0.1',
  // Bedrock (AWS profile comes from AWS_PROFILE, region from AWS_REGION)
  region: process.env.AWS_REGION || 'us-east-1',
  model: process.env.THOUGHTFUL_MODEL || 'us.amazon.nova-2-lite-v1:0',
  fallbackModel: process.env.THOUGHTFUL_FALLBACK_MODEL || 'global.amazon.nova-2-lite-v1:0',
  // Spending caps, enforced in code before every model call.
  spendCapDayUsd: Number(process.env.THOUGHTFUL_SPEND_CAP_DAY_USD) || 1.0,
  spendCapTotalUsd: Number(process.env.THOUGHTFUL_SPEND_CAP_TOTAL_USD) || 5.0,
  // Extraction provider: "bedrock" (real) or "rules" (offline, deterministic; used by the sample household and tests)
  extractor: process.env.THOUGHTFUL_EXTRACTOR || 'auto',
  syncEveryMs: Number(process.env.THOUGHTFUL_SYNC_EVERY_MS) || 5 * 60_000,
  // Third-party lookups, per day caps
  giftSearchesPerDay: Number(process.env.THOUGHTFUL_GIFT_SEARCHES_PER_DAY) || 20,
  placeSearchesPerDay: Number(process.env.THOUGHTFUL_PLACE_SEARCHES_PER_DAY) || 10,
  // A gift, not a purchase: products outside this price range are not proposed (USD).
  giftPriceMin: Number(process.env.THOUGHTFUL_GIFT_PRICE_MIN) || 15,
  giftPriceMax: Number(process.env.THOUGHTFUL_GIFT_PRICE_MAX) || 250,
};

// Approximate on-demand prices (USD per 1M tokens), rounded UP on purpose: they only feed the spending cap,
// so the cap trips before the real bill reaches it. Check the AWS Bedrock pricing page before relying on them.
export const PRICES = {
  'amazon.nova-2-lite': { in: 0.33, out: 2.75 },
  'amazon.nova-lite': { in: 0.06, out: 0.24 },
  'anthropic.claude-haiku-4-5': { in: 1.0, out: 5.0 },
};
export function priceFor(modelId = '') {
  const k = Object.keys(PRICES).find((p) => modelId.includes(p));
  return PRICES[k] || { in: 3, out: 15 }; // unknown model: assume expensive
}
