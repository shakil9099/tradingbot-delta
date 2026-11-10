import type { Status } from '../api';

export default function HaltBanner({ s }: { s: Status }) {
  if (s.halted) {
    return (
      <div className="banner neg-bg">
        <strong>Halted ({s.haltKind ?? 'unknown'}):</strong> {s.haltReason}. No new trades until Resume.
        {s.haltKind === 'mismatch' || s.haltKind === 'fatal_error' ? ' The open position is left to its exchange bracket — check Delta before resuming.' : ''}
      </div>
    );
  }
  if (!s.health.ok) return <div className="banner warn-bg">Health: {s.health.reason}</div>;
  return null;
}
