import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chosenLanguage, words } from './words';
import Icon from './Icon';
const t = words(chosenLanguage());

/** Native modality supplies focus containment, background inertness and Escape.
 * Drafts survive accidental backdrop clicks; the same close path handles every exit. */
export default function Dialog({ title, children, close, dirty = false, busy = false, wide = false }: {
  title: string; children: ReactNode; close: () => void; dirty?: boolean; busy?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pointerOutside = useRef(false);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([disabled]), textarea')?.focus();
    return () => { ref.current?.close(); if (before?.isConnected) before.focus(); };
  }, []);
  const requestClose = () => { if (busy) return; if (dirty) setDiscard(true); else close(); };
  return <dialog ref={ref} className="sheet" aria-label={title}
    onCancel={(e) => { e.preventDefault(); requestClose(); }}
    onPointerDown={(e) => { pointerOutside.current = e.target === e.currentTarget; }}
    onClick={(e) => { if (e.target === e.currentTarget && pointerOutside.current) requestClose(); }}>
    <div className={wide ? 'sheet-panel sheet-wide' : 'sheet-panel'}>
      <header className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={t('card.close')} onClick={requestClose} disabled={busy}><Icon name="close" /></button>
      </header>
      {discard ? <div className="discard-prompt" role="alert">
        <p>{t('ui.unsaved')}</p>
        <div className="row">
          <button type="button" onClick={() => setDiscard(false)}>{t('ui.keepEditing')}</button>
          <button type="button" onClick={close}>{t('card.discard')}</button>
        </div>
      </div> : null}
      <div className="sheet-content" aria-busy={busy}>{children}</div>
    </div>
  </dialog>;
}
