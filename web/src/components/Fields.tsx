import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { strings } from '../strings';
import { AlertIcon } from './Icons';

export function ErrorText({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className="field-error" id={id} role="alert">
      <AlertIcon />
      <span>{children}</span>
    </p>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="form-error" role="alert">
      <AlertIcon />
      <span>{children}</span>
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, value, onChange, hint, error, ...rest }: TextFieldProps) {
  const id = useId();
  const described = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        {...rest}
      />
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && <ErrorText id={`${id}-err`}>{error}</ErrorText>}
    </div>
  );
}

interface PinFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  autoFocus?: boolean;
}

/** Numeric PIN input with the phone's number keyboard and a Show/Hide toggle. */
export function PinField({ label, value, onChange, hint, error, autoFocus }: PinFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const described = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-wrap">
        <input
          id={id}
          className="input pin"
          type={visible ? 'text' : 'password'}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="new-password"
          maxLength={8}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
        />
        <button type="button" className="input-action" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? strings.common.hide : strings.common.show}
        </button>
      </div>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && <ErrorText id={`${id}-err`}>{error}</ErrorText>}
    </div>
  );
}
