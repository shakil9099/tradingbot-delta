import { alert } from '../log.js';
import type { HaltKind } from '../shared/types.js';
import type { Repo } from '../store/repo.js';

export interface HaltState {
  halted: boolean;
  reason: string | null;
  kind: HaltKind | null;
}

export class Halt {
  constructor(private readonly repo: Repo) {}

  halt(reason: string, kind: HaltKind): void {
    const already = this.state();
    this.repo.kvSet('halted', 1);
    this.repo.kvSet('halt_reason', reason);
    this.repo.kvSet('halt_kind', kind);
    this.repo.addSystemEvent('halt', { reason, kind });
    if (!already.halted || already.reason !== reason) alert(`HALTED (${kind}): ${reason}`);
  }

  resume(): void {
    const s = this.state();
    if (s.kind === 'breaker') this.repo.kvSet('consecutive_sl', 0);
    this.repo.kvSet('halted', 0);
    this.repo.kvSet('halt_reason', null);
    this.repo.kvSet('halt_kind', null);
    this.repo.addSystemEvent('resume', { previous: s });
    alert('Resumed');
  }

  state(): HaltState {
    return {
      halted: this.repo.kvNum('halted', 0) === 1,
      reason: this.repo.kvGet('halt_reason'),
      kind: (this.repo.kvGet('halt_kind') as HaltKind | null) ?? null,
    };
  }
}
