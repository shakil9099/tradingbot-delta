import { riskFor } from '../core/sizing.js';
import { peakKey } from '../exchange/executor.js';
import { Router, type Request, type Response } from 'express';
import { paramsHash } from '../config/params.js';
import { computeInsights } from '../core/insights.js';
import { computeStats } from '../core/stats.js';
import type { Engine } from '../engine/engine.js';
import { log } from '../log.js';
import type { StatusResponse, StrategyId } from '../shared/types.js';
import type { Auth } from './auth.js';

export interface RouteDeps {
  engine: Engine;
  auth: Auth;
  consecutiveFailures: () => number;
  nextCycleAt: () => number | null;
}

/** /health 503 conditions (no secrets in the body). */
export function healthStatus(d: Pick<RouteDeps, 'engine' | 'consecutiveFailures'>): { ok: boolean; reason?: string } {
  const { repo, halt } = d.engine.c;
  const now = d.engine.c.now();
  const hs = halt.state();
  if (hs.halted) return { ok: false, reason: `halted (${hs.kind})` };
  const snap = d.engine.snapshot();
  if (snap.position && !snap.bracketOk) return { ok: false, reason: 'position without confirmed bracket' };
  const last = repo.kvNum('last_cycle_at', 0);
  if (!last || now - last > 65 * 60) return { ok: false, reason: 'stale cycle' };
  if (d.consecutiveFailures() >= 3) return { ok: false, reason: 'exchange calls failing' };
  return { ok: true };
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    log.error({ err }, 'api error');
    res.status(500).json({ error: (err as Error).message });
  }
};

export function buildRouter(d: RouteDeps): Router {
  const r = Router();
  const { engine, auth } = d;
  const { repo, params, halt } = engine.c;

  r.get('/health', (_req, res) => {
    const h = healthStatus(d);
    res.status(h.ok ? 200 : 503).json(h);
  });

  r.post('/api/login', wrap(auth.login));
  r.post('/api/logout', auth.logout);

  r.use('/api', auth.requireAuth, auth.requireCsrfHeader);

  r.get(
    '/api/status',
    wrap((_req, res) => {
      const snap = engine.snapshot();
      const hs = halt.state();
      const lastSwitch = repo.listSystemEvents('strategy_switch', 1)[0];
      const sims = repo.listSimTrades();
      const score = (s: StrategyId) =>
        sims
          .filter((x) => x.strategy === s)
          .sort((a, b) => a.exitTime - b.exitTime)
          .slice(-params.SEL_N)
          .reduce((acc, x) => acc + x.netPnl, 0);
      const body: StatusResponse = {
        position: snap.position,
        slPrice: snap.slPrice,
        tpPrice: snap.tpPrice,
        stage: snap.stage,
        unrealizedPnl: snap.unrealizedPnl,
        balance: snap.balance,
        halted: hs.halted,
        haltReason: hs.reason,
        haltKind: hs.kind,
        consecutiveSl: repo.kvNum('consecutive_sl', 0),
        active: (repo.kvGet('active_strategy') as StrategyId | null) ?? 'hull',
        pending: (repo.kvGet('pending_switch') as StrategyId | null) || null,
        scores: { hull: +score('hull').toFixed(2), ut: +score('ut').toFixed(2) },
        lastSwitchReason: lastSwitch ? (JSON.parse(lastSwitch.data).reason as string) : null,
        dryRun: params.DRY_RUN,
        paramsHash: paramsHash(params),
        nextCycleAt: d.nextCycleAt(),
        risk: (() => {
          const pk = repo.kvGet(peakKey(params.DRY_RUN));
          const bal = snap.balance;
          const r = bal === null ? null : riskFor(bal, pk === null ? null : Number(pk), params);
          return { perTrade: params.RISK_PER_TRADE, reduced: params.RISK_REDUCED, reduceBelowPeak: params.RISK_REDUCE_DD, peak: pk === null ? null : Number(pk), drawdown: r ? +r.drawdown.toFixed(4) : null, current: r ? r.risk : null };
        })(),
      };
      res.json({ ...body, strategyMode: params.STRATEGY, atrGateMax: params.ATR_GATE_MAX, minAtr: params.MIN_ATR, skipWeekendEntries: params.SKIP_WEEKEND_ENTRIES, snapshotAt: snap.at, health: healthStatus(d) });
    }),
  );

  r.get(
    '/api/trades',
    wrap((req, res) => {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 50)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));
      res.json({ total: repo.countTrades(), trades: repo.listTrades(limit, offset) });
    }),
  );
  r.get(
    '/api/trades/:id',
    wrap((req, res) => {
      const t = repo.getTrade(Number(req.params.id));
      if (!t) return void res.status(404).json({ error: 'not found' });
      res.json({ trade: t, events: repo.listTradeEvents(t.id) });
    }),
  );
  r.get(
    '/api/decisions',
    wrap((req, res) => res.json({ decisions: repo.listDecisions(Math.min(1000, Math.max(1, Number(req.query.limit ?? 100)))) })),
  );
  r.get('/api/events', wrap((req, res) => res.json({ events: repo.listSystemEvents(undefined, Math.min(500, Number(req.query.limit ?? 100))) })));
  r.get('/api/stats', wrap((_req, res) => res.json(computeStats(repo.allTrades()))));
  r.get(
    '/api/insights',
    wrap((_req, res) =>
      res.json({ insights: computeInsights(repo.allTrades(), repo.listTradeEvents(), repo.listSystemEvents(undefined, 1000), repo.listSimTrades(), params) }),
    ),
  );

  r.post(
    '/api/control/close',
    wrap(async (_req, res) => {
      const done = await engine.manualClose();
      if (!done) return void res.status(409).json({ error: 'no open position' });
      res.json({ ok: true });
    }),
  );
  r.post(
    '/api/control/enter',
    wrap(async (req, res) => {
      const side = (req.body as { side?: unknown } | undefined)?.side;
      if (side !== 'buy' && side !== 'sell') return void res.status(400).json({ error: 'side must be "buy" or "sell"' });
      const r = await engine.manualEnter(side);
      res.status(r.result === 'opened' ? 200 : 409).json(r);
    }),
  );
  r.post(
    '/api/control/pause',
    wrap(async (_req, res) => {
      await engine.pause();
      res.json({ ok: true });
    }),
  );
  r.post(
    '/api/control/reset-peak',
    wrap(async (_req, res) => {
      await engine.resetPeak();
      res.json({ ok: true });
    }),
  );
  r.post(
    '/api/control/resume',
    wrap(async (_req, res) => {
      await engine.resume();
      res.json({ ok: true });
    }),
  );
  return r;
}
