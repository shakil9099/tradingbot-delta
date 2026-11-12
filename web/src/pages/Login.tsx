import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Logo from '../components/Logo';

export default function Login() {
  const nav = useNavigate();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(user, password);
      nav('/');
    } catch (err) {
      const e2 = err as Error & { status?: number; body?: { retryAfter?: number } };
      if (e2.status === 429) {
        setWait(e2.body?.retryAfter ?? 1);
        setError('Too many attempts. Wait before trying again.');
      } else setError('Invalid username or password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-box">
        <div className="login-brand">
          <Logo />
          <h1>ETH Bot</h1>
          <p>Sign in to the trading dashboard</p>
        </div>
        <form onSubmit={submit} className="card">
          <label>
            Username
            <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={wait > 0 || busy}>
            {wait > 0 ? `Wait ${wait}s` : busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-foot">Delta Exchange India · ETHUSD perpetual</p>
      </div>
    </div>
  );
}
