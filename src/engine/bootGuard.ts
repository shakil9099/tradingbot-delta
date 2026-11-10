import type { Repo } from '../store/repo.js';
import type { Halt } from './halt.js';

/**
 * Crash-loop guard: more than 5 boots within 10 minutes halts with kind crash_loop.
 * A restart the author requested from the dashboard (kv.requested_restart_at within 2 minutes) is not counted.
 */
export function recordBoot(repo: Repo, halt: Halt, now = Math.floor(Date.now() / 1000)): number[] {
  const times = repo.kvJson<number[]>('boot_times', []).filter((t) => now - t <= 600);
  const requested = repo.kvNum('requested_restart_at', 0);
  if (requested) {
    repo.kvSet('requested_restart_at', null);
    if (now - requested <= 120) return times;
  }
  times.push(now);
  repo.kvSet('boot_times', JSON.stringify(times));
  if (times.length > 5) halt.halt(`crash loop: ${times.length} boots in 10 minutes`, 'crash_loop');
  return times;
}
