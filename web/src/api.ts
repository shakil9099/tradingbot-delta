import type { DecisionRow, Insight, StatsResponse, StatusResponse, SystemEvent, TradeEvent, TradeRow } from '@shared/types';

export class Unauthorized extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.method && init.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'fetch';
  }
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  if (res.status === 401) throw new Unauthorized();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `HTTP ${res.status}`), { status: res.status, body });
  return body as T;
}

export type Status = StatusResponse & {
  strategyMode: string;
  atrGateMax: number;
  skipWeekendEntries: boolean;
  minAtr: number;
  snapshotAt: number;
  health: { ok: boolean; reason?: string };
};

export interface Settings {
  mode: 'paper' | 'live';
  requestedMode: 'paper' | 'live';
  envLock: boolean;
  secretsKeyConfigured: boolean;
  credentialsSource: 'auto' | 'env';
  credentials: {
    source: 'stored' | 'env' | 'none';
    stored: 'none' | 'ok' | 'unreadable';
    unreadableReason: string | null;
    keyLast4: string | null;
    savedAt: number | null;
    verifiedAt: number | null;
  };
  isolatedConfirmed: boolean;
  flat: boolean;
  halted: boolean;
  risk: number;
  riskReduced: number;
}

export const api = {
  login: (user: string, password: string) => call<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ user, password }) }),
  logout: () => call('/api/logout', { method: 'POST' }),
  status: () => call<Status>('/api/status'),
  trades: (limit = 50, offset = 0) => call<{ total: number; trades: TradeRow[] }>(`/api/trades?limit=${limit}&offset=${offset}`),
  trade: (id: number) => call<{ trade: TradeRow; events: TradeEvent[] }>(`/api/trades/${id}`),
  decisions: (limit = 200) => call<{ decisions: DecisionRow[] }>(`/api/decisions?limit=${limit}`),
  events: (limit = 100) => call<{ events: SystemEvent[] }>(`/api/events?limit=${limit}`),
  stats: () => call<StatsResponse>('/api/stats'),
  insights: () => call<{ insights: Insight[] }>('/api/insights'),
  close: () => call('/api/control/close', { method: 'POST' }),
  pause: () => call('/api/control/pause', { method: 'POST' }),
  resume: () => call('/api/control/resume', { method: 'POST' }),
  settings: () => call<Settings>('/api/settings'),
  saveKeys: (apiKey: string, apiSecret: string, password: string, tradingPermission: boolean) =>
    call<{ keyLast4: string; verifiedAt: number; restarting?: boolean }>('/api/settings/credentials', {
      method: 'POST',
      body: JSON.stringify({ apiKey, apiSecret, password, tradingPermission }),
    }),
  removeKeys: (password: string) => call('/api/settings/credentials', { method: 'DELETE', body: JSON.stringify({ password }) }),
  setMode: (mode: 'paper' | 'live', password: string, confirm?: string, isolatedConfirmed?: boolean) =>
    call<{ mode: string; restarting: boolean }>('/api/settings/mode', { method: 'POST', body: JSON.stringify({ mode, password, confirm, isolatedConfirmed }) }),
};

export const fmtTime = (t: number | null | undefined) =>
  t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
export const fmtUsd = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(d)}`);
export const fmtNum = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : n.toFixed(d));
export const pnlClass = (n: number | null | undefined) => (n === null || n === undefined ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
