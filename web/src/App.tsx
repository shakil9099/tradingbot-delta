import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api';
import Logo from './components/Logo';
import { usePolling } from './usePolling';
import Settings from './pages/Settings';
import Decisions from './pages/Decisions';
import Insights from './pages/Insights';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Trades from './pages/Trades';

/** PAPER / LIVE badge and health dot on every page (Amendment B.6). */
function TopStatus() {
  const st = usePolling(api.status, 30000);
  if (!st.data) return null;
  const s = st.data;
  const live = !s.dryRun;
  const state = s.halted ? 'bad' : s.health.ok ? 'ok' : 'warn';
  const text = s.halted ? 'Halted' : s.health.ok ? 'Healthy' : 'Check health';
  return (
    <div className="top-status">
      <span className={`mode-badge ${live ? 'live' : 'paper'}`}>{live ? 'LIVE' : 'PAPER'}</span>
      <span className="health" title={s.health.reason ?? 'All checks passing'}>
        <span className={`dot ${state}`} />
        {text}
      </span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <Logo />
          <div>
            ETH Bot
            <small>Delta Exchange · ETHUSD</small>
          </div>
        </div>
        <TopStatus />
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/trades">Trades</NavLink>
          <NavLink to="/decisions">Decisions</NavLink>
          <NavLink to="/insights">Insights</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="top-right">
          <button
            className="link"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              nav('/login');
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Shell><Overview /></Shell>} />
      <Route path="/trades" element={<Shell><Trades /></Shell>} />
      <Route path="/decisions" element={<Shell><Decisions /></Shell>} />
      <Route path="/insights" element={<Shell><Insights /></Shell>} />
      <Route path="/settings" element={<Shell><Settings /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
