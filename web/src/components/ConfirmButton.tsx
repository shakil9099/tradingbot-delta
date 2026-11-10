import { useEffect, useState } from 'react';

/** Requires a second click within 5 s. */
export default function ConfirmButton({ label, onConfirm, danger }: { label: string; onConfirm: () => Promise<unknown>; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <span className="confirm">
      <button
        className={danger ? 'danger' : ''}
        disabled={busy}
        onClick={async () => {
          if (!armed) return setArmed(true);
          setArmed(false);
          setBusy(true);
          setMsg(null);
          try {
            await onConfirm();
            setMsg('done');
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : armed ? `Confirm ${label.toLowerCase()}?` : label}
      </button>
      {msg && <small className="muted"> {msg}</small>}
    </span>
  );
}
