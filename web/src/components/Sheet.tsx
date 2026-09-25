import { useEffect, useRef, type ReactNode } from 'react';
import { strings } from '../strings';
import { CloseIcon } from './Icons';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet on phones, centred dialog on wider screens. Escape and backdrop taps close it. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // No cleanup: unmounting removes the dialog, and calling close() there would fire
  // onClose during React's development double-mount and shut the sheet at once.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close();
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label={strings.common.close}>
          <CloseIcon />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
