import { useEffect, useState } from 'react';
import { api, fmtTime, type Settings as S } from '../api';
import { usePolling } from '../usePolling';

/** Waits for the bot to come back after a requested restart, then reloads the page. */
function useRestartWatcher() {
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!restarting) return;
    let alive = true;
    const started = Date.now();
    const tick = async () => {
      await new Promise((r) => setTimeout(r, 2000));
      while (alive) {
        try {
          const r = await fetch('/health', { cache: 'no-store' });
          if (r.status === 200 || r.status === 503) {
            window.location.reload();
            return;
          }
        } catch {
          /* still down */
        }
        if (Date.now() - started > 90_000) {
          alive = false;
          setRestarting(false);
          alert('The bot did not come back within 90 s. Under PM2 it restarts automatically; locally, start it again with npm start.');
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [restarting]);
  return { restarting, setRestarting };
}

function KeysCard({ s, reload, onRestart }: { s: S; reload: () => void; onRestart: () => void }) {
  const [apiKey, setKey] = useState('');
  const [apiSecret, setSecret] = useState('');
  const [password, setPw] = useState('');
  const [perm, setPerm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const c = s.credentials;
  const canEdit = s.secretsKeyConfigured && s.credentialsSource !== 'env';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.saveKeys(apiKey, apiSecret, password, perm);
      setKey('');
      setSecret('');
      setPw('');
      setPerm(false);
      setMsg({ ok: true, text: `Saved and verified with Delta (key …${r.keyLast4}).` });
      if (r.restarting) onRestart();
      else reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const pw = window.prompt('Dashboard password to remove the stored API keys:');
    if (!pw) return;
    try {
      await api.removeKeys(pw);
      setMsg({ ok: true, text: 'Stored keys removed.' });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <section className="card">
      <h2>Delta API keys</h2>
      <dl className="grid2">
        <dt>In use</dt>
        <dd>
          {c.source === 'none' && <span className="muted">none</span>}
          {c.source === 'stored' && c.stored === 'ok' && <>stored (encrypted) · key …{c.keyLast4}</>}
          {c.source === 'stored' && c.stored === 'unreadable' && <span className="neg">stored but unreadable: {c.unreadableReason}</span>}
          {c.source === 'env' && <>from .env · key …{c.keyLast4}</>}
        </dd>
        <dt>Saved</dt>
        <dd>{fmtTime(c.savedAt)}</dd>
        <dt>Last verified</dt>
        <dd>{fmtTime(c.verifiedAt)}</dd>
      </dl>
      {!s.secretsKeyConfigured && (
        <p className="banner warn-bg small">
          Add <code>SECRETS_KEY</code> to the server's .env (<code>openssl rand -hex 32</code>) and restart to store keys from here.
        </p>
      )}
      {s.credentialsSource === 'env' && <p className="banner warn-bg small">CREDENTIALS_SOURCE=env: the bot uses only the keys in .env.</p>}
      {canEdit && (
        <form className="stack" onSubmit={save} autoComplete="off">
          <label>
            API key
            <input type="password" value={apiKey} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} required minLength={8} />
          </label>
          <label>
            API secret
            <input type="password" value={apiSecret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} required minLength={8} />
          </label>
          <label className="check">
            <input type="checkbox" checked={perm} onChange={(e) => setPerm(e.target.checked)} />
            <span>
              This key has <strong>Trading</strong> permission and <strong>no Withdrawal</strong> permission, and is IP-whitelisted to this server.
            </span>
          </label>
          <label>
            Dashboard password
            <input type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="controls">
            <button type="submit" disabled={busy || !s.flat || !perm}>
              {busy ? 'Testing with Delta…' : c.source === 'stored' ? 'Replace keys' : 'Save keys'}
            </button>
            {c.source === 'stored' && (
              <button type="button" className="danger" onClick={remove} disabled={!s.flat || s.requestedMode === 'live'}>
                Remove keys
              </button>
            )}
          </div>
          {!s.flat && <small className="muted">Keys can only be changed with no open position.</small>}
        </form>
      )}
      {msg && <p className={`small ${msg.ok ? 'pos' : 'neg'}`}>{msg.text}</p>}
    </section>
  );
}

function ModeCard({ s, onRestart }: { s: S; onRestart: () => void }) {
  const [open, setOpen] = useState(false);
  const [iso, setIso] = useState(false);
  const [typed, setTyped] = useState('');
  const [password, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = s.mode === 'live';
  const hasKeys = s.credentials.source !== 'none' && !(s.credentials.source === 'stored' && s.credentials.stored !== 'ok');
  const blockers = [
    s.envLock && 'DRY_RUN=true in .env locks paper trading',
    !hasKeys && 'no usable API keys',
    !s.flat && 'a position is open',
    s.halted && 'the bot is halted',
  ].filter(Boolean) as string[];

  const submit = async (mode: 'live' | 'paper') => {
    setBusy(true);
    setErr(null);
    try {
      await api.setMode(mode, password, mode === 'live' ? typed : undefined, mode === 'live' ? iso : undefined);
      onRestart();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Trading mode</h2>
      <p>
        <span className={`mode-badge big ${live ? 'live' : 'paper'}`}>{live ? 'LIVE' : 'PAPER'}</span>
        <span className="muted small"> {live ? 'real orders on Delta Exchange India' : 'virtual orders on live Delta prices'}</span>
      </p>
      {!open && (
        <div className="controls">
          {!live && (
            <button className="danger" disabled={blockers.length > 0} onClick={() => setOpen(true)}>
              Go live…
            </button>
          )}
          {live && (
            <button disabled={!s.flat} onClick={() => setOpen(true)}>
              Back to paper…
            </button>
          )}
        </div>
      )}
      {!live && blockers.length > 0 && <p className="small muted">Go live is unavailable: {blockers.join('; ')}.</p>}
      {live && !s.flat && <p className="small muted">Switching back needs no open position.</p>}

      {open && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(live ? 'paper' : 'live');
          }}
        >
          {!live && (
            <>
              <div className="banner neg-bg small">
                Real money. Each trade risks <strong>{(s.risk * 100).toFixed(0)}%</strong> of the balance ({(s.riskReduced * 100).toFixed(0)}% after a 20% fall from the
                peak). In the backtest the account fell 51% from a peak at one point. Start with a small balance.
              </div>
              <label className="check">
                <input type="checkbox" checked={iso} onChange={(e) => setIso(e.target.checked)} />
                <span>
                  I set <strong>isolated</strong> margin for ETHUSD in the Delta app.
                </span>
              </label>
              <label>
                <span>
                  Type <code>LIVE</code> to confirm
                </span>
                <input
                  name="confirm-live"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="one-time-code"
                  data-lpignore="true"
                  spellCheck={false}
                  placeholder="LIVE"
                />
              </label>
            </>
          )}
          <label>
            Dashboard password
            <input type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="controls">
            <button type="submit" className={live ? '' : 'danger'} disabled={busy || (!live && (!iso || typed !== 'LIVE'))}>
              {busy ? '…' : live ? 'Switch to paper and restart' : 'Go live and restart'}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {err && <p className="small neg">{err}</p>}
        </form>
      )}
    </section>
  );
}

export default function Settings() {
  const st = usePolling(api.settings, 30000);
  const { restarting, setRestarting } = useRestartWatcher();
  if (restarting) return <p className="banner warn-bg">Restarting the bot with the new setting… this page reloads when it is back.</p>;
  const s = st.data;
  if (!s) return <p className="muted">{st.error ?? 'Loading…'}</p>;
  return (
    <div className="row">
      <ModeCard s={s} onRestart={() => setRestarting(true)} />
      <KeysCard s={s} reload={st.reload} onRestart={() => setRestarting(true)} />
    </div>
  );
}
