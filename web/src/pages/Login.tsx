import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Login() {
  const nav = useNavigate();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.login(user, password);
      nav('/');
    } catch (err) {
      const e2 = err as Error & { status?: number; body?: { retryAfter?: number } };
      if (e2.status === 429) {
        setWait(e2.body?.retryAfter ?? 1);
        setError('Too many attempts — wait before trying again.');
      } else setError('Invalid username or password.');
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h1>ETH Bot</h1>
        <label>
          Username
          <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={wait > 0}>
          {wait > 0 ? `Wait ${wait}s` : 'Log in'}
        </button>
        {error && <p className="neg">{error}</p>}
      </form>
    </div>
  );
}
