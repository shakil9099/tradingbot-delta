// Mock API for previewing the dashboard locally (npm run dev:mock). Sample data only: it never talks to
// Delta or the live server, and control buttons only change this mock's in-memory state.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 3999);
const now = () => Math.floor(Date.now() / 1000);
const H = 3600;

let halted = false;
let position = { side: 'buy', sizeContracts: 1, entryPrice: 2074.3 };

const trades = Array.from({ length: 14 }, (_, i) => {
  const id = 14 - i;
  const side = i % 3 === 0 ? 'sell' : 'buy';
  const entry = 2000 + ((i * 37) % 160);
  const win = i % 4 !== 1;
  const move = win ? 18 + ((i * 7) % 40) : -(10 + ((i * 5) % 18));
  const exit = side === 'buy' ? entry + move : entry - move;
  const gross = move * 0.01;
  const fees = 0.05;
  const t0 = now() - (i + 1) * 26 * H;
  return {
    id, client_order_id: `eth-${t0}-o-${side[0]}-1`, status: 'CLOSED', side, size_contracts: 1, strategy: 'hull', dry_run: 0,
    entry_reason: JSON.stringify({ strategy: 'hull', signal: 'flip', candleTime: t0 - H, scores: { hull: 43.2, ut: 205.1 } }),
    entry_time: t0, entry_price: entry, sl_price: null, tp_price: null, risk_dist: 32, stage: win ? 2 : 0, sl_order_id: null, tp_order_id: null,
    close_reason: null, close_client_order_id: null, exit_time: t0 + 9 * H, exit_price: exit,
    exit_reason: win ? (i % 2 ? 'sl_stage_2' : 'reversal') : 'sl_stage_0', gross_pnl: gross, fees, net_pnl: gross - fees, config_hash: '5363ce3e1bf1',
  };
});

let eq = 0;
const equity = [...trades].reverse().map((t) => ({ time: t.exit_time, equity: +(eq += t.net_pnl).toFixed(2) }));
const wins = trades.filter((t) => t.net_pnl > 0);
const losses = trades.filter((t) => t.net_pnl <= 0);
const sum = (a) => a.reduce((s, t) => s + t.net_pnl, 0);
const statsBlock = (list) => ({
  count: list.length, wins: list.filter((t) => t.net_pnl > 0).length,
  winRate: list.length ? list.filter((t) => t.net_pnl > 0).length / list.length : 0, netPnl: +sum(list).toFixed(2),
  avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0,
  profitFactor: losses.length ? sum(wins) / -sum(losses) : null,
});

const decisions = Array.from({ length: 48 }, (_, i) => {
  const t = Math.floor(now() / H) * H - (i + 1) * H;
  const close = 2050 + Math.sin(i / 4) * 30;
  const sig = i === 5 ? 'LONG' : i === 19 ? 'SHORT' : 'NONE';
  return {
    candle_time: t, open: close - 3, high: close + 8, low: close - 9, close, volume: 900000, hull: close - 12, hull_prev2: close - 14, ut_stop: close + 25, atr: 18 + (i % 5),
    sig_hull: sig, sig_ut: 'NONE', score_hull: 43.22, score_ut: 205.06, active: 'hull', pending: null,
    action: i === 5 ? 'ENTER' : i === 2 ? 'TRAIL' : 'NONE', note: i === 5 ? 'hull LONG' : i === 9 ? 'ATR 14.2 < 15: no entries' : i === 2 ? 'stop moved' : 'no signal',
  };
});

const events = [
  { id: 5, time: now() - 2 * H, type: 'strategy_switch', data: JSON.stringify({ from: 'ut', to: 'hull', reason: 'override STRATEGY=hull' }) },
  { id: 4, time: now() - 5 * H, type: 'resume', data: '{}' },
  { id: 3, time: now() - 20 * H, type: 'halt', data: JSON.stringify({ kind: 'fatal_error', reason: 'close (margin_mode) did not reach flat' }) },
  { id: 2, time: now() - 30 * H, type: 'mode_change', data: JSON.stringify({ from: 'paper', to: 'live' }) },
  { id: 1, time: now() - 31 * H, type: 'credentials_saved', data: JSON.stringify({ keyLast4: 'a1b2' }) },
];

const status = () => ({
  position, slPrice: position ? 2066.5 : null, tpPrice: null, stage: position ? 1 : null, unrealizedPnl: position ? 0.18 : null, balance: 176.73,
  halted, haltReason: halted ? 'paused from the dashboard' : null, haltKind: halted ? 'manual' : null, consecutiveSl: 0, active: 'hull', pending: null,
  scores: { hull: 43.22, ut: 205.06 }, lastSwitchReason: 'override STRATEGY=hull', dryRun: false, paramsHash: '5363ce3e1bf1', nextCycleAt: Math.ceil(now() / H) * H + 10,
  risk: { fixedContracts: 0, perTrade: 0.2, reduced: 0.05, reduceBelowPeak: 0.2, peak: 176.73, drawdown: 0, current: 0.2 },
  strategyMode: 'hull', atrGateMax: 0, minAtr: 15, skipWeekendEntries: true, snapshotAt: now(), health: { ok: !halted, reason: halted ? 'halted (manual)' : undefined },
});

const settings = () => ({
  mode: 'live', requestedMode: 'live', envLock: false, secretsKeyConfigured: true, credentialsSource: 'auto',
  credentials: { source: 'stored', stored: 'ok', unreadableReason: null, keyLast4: 'a1b2', savedAt: now() - 31 * H, verifiedAt: now() - 30 * H },
  isolatedConfirmed: true, flat: !position, halted, risk: 0.2, riskReduced: 0.05, fixedContracts: 0,
});

const routes = {
  'GET /health': () => [halted ? 503 : 200, { ok: !halted }],
  'POST /api/login': () => [200, { ok: true }],
  'POST /api/logout': () => [200, { ok: true }],
  'GET /api/status': () => [200, status()],
  'GET /api/stats': () => [200, { total: statsBlock(trades), byStrategy: { hull: statsBlock(trades), ut: statsBlock([]), unknown: statsBlock([]) }, feesPaid: +(trades.length * 0.05).toFixed(2), maxDrawdown: 0.41, equity }],
  'GET /api/insights': () => [200, { insights: [
    { id: 'win_rate_low', severity: 'info', message: 'Win rate over the last 14 trades is 71%; no action needed.', metric: 0.71 },
    { id: 'fees_share', severity: 'warn', message: 'Fees are 9% of gross profit. Fewer, larger moves would reduce this.', metric: 0.09 },
    { id: 'initial_stops', severity: 'alert', message: '3 of the last 14 trades hit the initial stop within 2 hours of entry.', metric: 3 },
  ] }],
  'GET /api/decisions': () => [200, { decisions }],
  'GET /api/events': () => [200, { events }],
  'GET /api/settings': () => [200, settings()],
  // Options bot (NIFTY / BANKNIFTY): an open candle-mode trade, a dry run after a manual close, and trades.
  'GET /api/nifty/status': () => [200, {
    live: true, killed: false, lastTickAt: now() - 2, lastError: null,
    strategy: { rangeMin: 30, trendFilter: true, stopK: 1.5, rr: 3, itm: 2, entryWindow: '09:45–12:00', timeExit: '15:05', exitMode: 'candle', exitPreset: null, maxTradesPerDay: 1, optStopPct: 0.3, optCostAtPct: 0.4, optTpPct: 1.2, haExitMinPct: 0.1 },
    indices: [
      { name: 'NIFTY', enabled: true, lots: 1, lotSize: 65, lossFloor: 5000, spot: 25366.2, paused: false, halted: null, doneToday: true, tradesToday: 1, netToday: 0, netSinceResume: -469.85, lastSignal: '09:50 LONG → buy CE', entering: null,
        position: { symbol: 'NIFTY23NOV2625250CE', side: 1, qty: 65, entryPrice: 274.75, spotIn: 25366.2, stopLevel: 25281.47, targetLevel: 1e9, slTrigger: 219.8, ltp: 288.4, unrealised: 887.25, exiting: null,
          exitView: { mode: 'candle', stage: 'COST', stop: 276.05, emergency: 233.5, costTrigger: 302.23, gate: 289.85, pending: null } },
        dryRuns: [] },
      { name: 'BANKNIFTY', enabled: true, lots: 1, lotSize: 30, lossFloor: 5000, spot: 61937.65, paused: false, halted: null, doneToday: true, tradesToday: 1, netToday: 1241.49, netSinceResume: 4001.07, lastSignal: '09:50 LONG → buy CE', entering: null, position: null,
        dryRuns: [{ tag: 'B261117E89206', symbol: 'BANKNIFTY23NOV2661700CE', entryPrice: 608.5, closedPrice: 652.65, closedNet: 1241.49, ltp: 671.2, ifHeldNow: 1792.4 }] },
    ],
    trades: [
      { tag: 'N261117E89216', index: 'NIFTY', day: '2026-11-17', symbol: 'NIFTY23NOV2625250CE', side: 1, qty: 65, entryPrice: 274.75, exitPrice: 268.75, entryTime: now() - 30 * H, exitTime: now() - 29 * H, reason: 'closed outside the bot', charges: 79.85, net: -469.85,
        whatIf: { tag: 'N261117E89216', exitPrice: 302.1, exitTime: now() - 26 * H, reason: 'target', net: 1695.3, diff: 2165.15 } },
      { tag: 'B261116E02826', index: 'BANKNIFTY', day: '2026-11-16', symbol: 'BANKNIFTY23NOV2661400CE', side: 1, qty: 30, entryPrice: 595.2, exitPrice: 690, entryTime: now() - 50 * H, exitTime: now() - 49 * H, reason: 'closed outside the bot', charges: 84.42, net: 2759.58,
        whatIf: { tag: 'B261116E02826', exitPrice: 640.5, exitTime: now() - 45 * H, reason: 'time exit 15:05', net: 1272.9, diff: -1486.68 } },
      { index: 'NIFTY', day: '2026-11-13', symbol: 'NIFTY17NOV2625100PE', side: -1, qty: 65, entryPrice: 182.3, exitPrice: 168.1, entryTime: now() - 120 * H, exitTime: now() - 119 * H, reason: 'stop', charges: 72.1, net: -995.1, whatIf: null },
    ],
  }],
  'POST /api/nifty/control': () => [200, { ok: true }],
  'POST /api/control/pause': () => ((halted = true), [200, { ok: true }]),
  'POST /api/control/resume': () => ((halted = false), [200, { ok: true }]),
  'POST /api/control/close': () => ((position = null), [200, { ok: true }]),
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let handler = routes[`${req.method} ${url.pathname}`];
  if (!handler && req.method === 'GET' && url.pathname === '/api/trades') {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    handler = () => [200, { total: trades.length, trades: trades.slice(offset, offset + limit) }];
  }
  const m = /^\/api\/trades\/(\d+)$/.exec(url.pathname);
  if (!handler && m) {
    const t = trades.find((x) => x.id === Number(m[1]));
    handler = () => (t ? [200, { trade: t, events: [
      { id: 1, trade_id: t.id, time: t.entry_time + 60, type: 'bracket_attach', data: JSON.stringify({ sl: t.entry_price - 32, tp: null }) },
      { id: 2, trade_id: t.id, time: t.entry_time + 3 * H, type: 'sl_move', data: JSON.stringify({ oldSl: t.entry_price - 32, newSl: t.entry_price + 0.6, stage: 1 }) },
    ] }] : [404, { error: 'not found' }]);
  }
  if (!handler && url.pathname.startsWith('/api/settings')) handler = () => [400, { error: 'mock preview: settings changes are disabled' }];
  const [code, body] = handler ? handler() : [404, { error: 'not found' }];
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(PORT, '127.0.0.1', () => console.log(`mock API on http://127.0.0.1:${PORT} (sample data only)`));
