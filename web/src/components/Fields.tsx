import {
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
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

/** After a failed save, bring the first invalid field into view and focus it. */
export function useRevealFirstError(errors: object): void {
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const field = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    field.focus({ preventScroll: true });
  }, [errors]);
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="form-error" role="alert">
      <AlertIcon />
      <span>{children}</span>
    </div>
  );
}

interface ShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Marks a field that differs from the recipe being cloned. */
  changed?: boolean;
  children: ReactNode;
}

/**
 * Label, hint, error and "Changed" marker around any input. The marker sits outside the
 * <label> so the input's name stays just the label; it is announced as a description.
 */
function FieldShell({ id, label, hint, error, changed, children }: ShellProps) {
  return (
    <div className={`field${changed ? ' changed' : ''}`}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {changed && (
          <span className="tag accent field-tag" id={`${id}-changed`}>
            {strings.recipes.form.changed}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && <ErrorText id={`${id}-err`}>{error}</ErrorText>}
    </div>
  );
}

const describedBy = (id: string, hint: unknown, error: unknown, changed?: boolean) =>
  [changed ? `${id}-changed` : '', hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') ||
  undefined;

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  changed?: boolean;
  /** Short unit shown inside the input, e.g. "g". */
  unit?: string;
}

export function TextField({ label, value, onChange, hint, error, changed, unit, className, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} changed={changed}>
      <div className="input-wrap">
        <input
          id={id}
          className={`input${unit ? ' has-unit' : ''}${className ? ` ${className}` : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error, changed)}
          {...rest}
        />
        {unit && (
          <span className="input-unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

/** Decimal keypad on phones; the value stays text until the form saves. */
export function NumberField(props: Omit<TextFieldProps, 'inputMode'>) {
  return <TextField inputMode="decimal" autoComplete="off" {...props} />;
}

/** m:ss entry. Also accepts 1.45 (number pads have no colon) and tidies it on blur. */
export function TimeField({
  onBlurFormat,
  ...props
}: Omit<TextFieldProps, 'inputMode'> & { onBlurFormat?: (value: string) => string }) {
  return (
    <TextField
      inputMode="decimal"
      autoComplete="off"
      {...props}
      onBlur={() => {
        if (onBlurFormat) props.onChange(onBlurFormat(props.value));
      }}
    />
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  changed?: boolean;
}

export function TextAreaField({ label, value, onChange, hint, error, changed, ...rest }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} changed={changed}>
      <textarea
        id={id}
        className="input textarea"
        value={value}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, changed)}
        {...rest}
      />
    </FieldShell>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: ReactNode;
  error?: string | null;
  changed?: boolean;
}

export function SelectField({ label, value, onChange, options, hint, error, changed, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} changed={changed}>
      <select
        id={id}
        className="input select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, changed)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

interface SegmentedFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  error?: string | null;
  changed?: boolean;
}

export function SegmentedField<T extends string>({ label, value, onChange, options, error, changed }: SegmentedFieldProps<T>) {
  const id = useId();
  return (
    <div className={`field${changed ? ' changed' : ''}`}>
      <div className="field-label-row">
        <span className="field-label" id={id}>
          {label}
        </span>
        {changed && (
          <span className="tag accent field-tag" id={`${id}-changed`}>
            {strings.recipes.form.changed}
          </span>
        )}
      </div>
      <div className="segmented" role="group" aria-labelledby={id} aria-describedby={changed ? `${id}-changed` : undefined}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}

/** An on/off switch row. */
export function ToggleField({ label, checked, onChange, hint, disabled }: ToggleFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="toggle-row" htmlFor={id}>
        <span className="field-label">{label}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </label>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
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
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
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
          aria-describedby={describedBy(id, hint, error)}
        />
        <button type="button" className="input-action" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? strings.common.hide : strings.common.show}
        </button>
      </div>
    </FieldShell>
  );
}
