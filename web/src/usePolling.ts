import { useCallback, useEffect, useRef, useState } from 'react';
import { Unauthorized } from './api';

/** Polls fn every intervalMs while the tab is visible. Redirects to /login on 401. */
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 15000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      if (e instanceof Unauthorized) {
        window.location.assign('/login');
        return;
      }
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, intervalMs);
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs, ...deps]);

  return { data, error, reload: load };
}
