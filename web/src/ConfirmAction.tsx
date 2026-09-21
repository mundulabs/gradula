import { useState } from 'preact/compat';
import { chosenLanguage, words } from './words';
const t = words(chosenLanguage());
export default function ConfirmAction({ label, action }: { label: string; action: () => Promise<unknown> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!armed) return <button type="button" onClick={() => setArmed(true)}>{label}</button>;
  return <span className="confirm-action">
    <span>{label}?</span>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { await action(); setArmed(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>{t('ui.confirm')}</button>
    <button type="button" disabled={busy} onClick={() => setArmed(false)}>{t('card.cancel')}</button>
    {error ? <span role="alert">{error}</span> : null}
  </span>;
}
