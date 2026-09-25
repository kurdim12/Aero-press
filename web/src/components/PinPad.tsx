import { useEffect } from 'react';
import { strings } from '../strings';
import { DeleteIcon } from './Icons';

const MAX = 8;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Changes on every failed attempt to replay the shake. */
  shakeKey: number;
  /** Shown between the dots and the keys, e.g. "Wrong PIN. 3 tries left…". */
  error?: string | null;
}

/** Big keypad for wet hands. Also accepts the physical keyboard (digits, Backspace, Enter). */
export function PinPad({ value, onChange, onSubmit, disabled, shakeKey, error }: PinPadProps) {
  const press = (digit: string) => {
    if (disabled || value.length >= MAX) return;
    onChange(value + digit);
  };
  const backspace = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slots = Math.max(4, value.length);
  return (
    <>
      <div
        key={shakeKey}
        className={`pin-dots${shakeKey > 0 ? ' shake' : ''}`}
        role="status"
        aria-live="polite"
        aria-label={strings.signIn.digitsEntered(value.length)}
      >
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={`pin-dot${i < value.length ? ' filled' : ''}`} />
        ))}
      </div>
      <div className="pin-error" role="alert">
        {error}
      </div>
      <div className="keypad">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <span className="key spacer" aria-hidden="true" />
        <button type="button" className="key" onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button
          type="button"
          className="key fn"
          onClick={backspace}
          disabled={disabled || value.length === 0}
          aria-label={strings.signIn.deleteDigit}
        >
          <DeleteIcon style={{ margin: 'auto' }} />
        </button>
      </div>
    </>
  );
}
