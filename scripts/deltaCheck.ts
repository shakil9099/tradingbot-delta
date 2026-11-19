// Read-only look at the live Delta account: ETHUSD position, open orders (stop / take-profit) and last price.
// Uses the keys saved from the dashboard (data/bot.db, decrypted with SECRETS_KEY) or .env keys. Sends no orders.
// npx tsx scripts/deltaCheck.ts
import 'dotenv/config';
import { parseEnv } from '../src/config/env.js';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { currentCreds } from '../src/engine/mode.js';
import { DeltaClient } from '../src/exchange/deltaClient.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

const env = parseEnv(process.env);
const repo = new Repo(openDb(`${env.DATA_DIR}/bot.db`));
const { creds, source } = currentCreds(env, repo);
if (!creds) throw new Error(`no usable Delta keys (source: ${source})`);
const d = new DeltaClient({ baseUrl: env.DELTA_BASE_URL, apiKey: creds.apiKey, apiSecret: creds.apiSecret, productId: DEFAULT_PARAMS.PRODUCT_ID, symbol: DEFAULT_PARAMS.SYMBOL });

const [pos, orders, tk] = await Promise.all([d.getPosition(), d.getOpenOrders(), d.getTicker()]);
console.log('keys from:', source);
console.log('last price:', tk.close);
console.log('position:', pos ? { side: pos.side, contracts: pos.size, entry: pos.entryPrice } : 'none');
console.log('open orders:');
for (const o of orders) console.log(' ', { id: o.id, kind: o.kind, side: o.side, size: o.size, stopPrice: o.stopPrice, state: o.state });
if (!orders.length) console.log('  none');
