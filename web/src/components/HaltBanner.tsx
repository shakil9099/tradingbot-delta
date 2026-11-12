import type { Status } from '../api';

const Icon = () => (
  <svg className="icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M10 2.5a1 1 0 0 1 .87.5l7 12.25A1 1 0 0 1 17 16.75H3a1 1 0 0 1-.87-1.5l7-12.25a1 1 0 0 1 .87-.5Zm0 4.25a.9.9 0 0 0-.9.9v3.7a.9.9 0 1 0 1.8 0v-3.7a.9.9 0 0 0-.9-.9Zm0 7.9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
  </svg>
);

export default function HaltBanner({ s }: { s: Status }) {
  if (s.halted) {
    return (
      <div className="banner neg-bg" role="alert">
        <Icon />
        <div>
          <strong>Halted ({s.haltKind ?? 'unknown'}):</strong> {s.haltReason}. No new trades until Resume.
          {s.haltKind === 'mismatch' || s.haltKind === 'fatal_error' ? ' The open position is left to its exchange bracket. Check Delta before resuming.' : ''}
        </div>
      </div>
    );
  }
  if (!s.health.ok)
    return (
      <div className="banner warn-bg" role="status">
        <Icon />
        <div>Health: {s.health.reason}</div>
      </div>
    );
  return null;
}
