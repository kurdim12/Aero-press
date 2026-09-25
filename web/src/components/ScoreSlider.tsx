import { useId } from 'react';
import { formatNumber } from '../format';
import { strings } from '../strings';

interface ScoreSliderProps {
  label: string;
  /** null until the brewer scores it; an untouched score is saved as empty. */
  value: number | null;
  onChange: (value: number | null) => void;
  error?: string | null;
}

/** A 1–10 score in half steps, with a thumb big enough for wet hands. */
export function ScoreSlider({ label, value, onChange, error }: ScoreSliderProps) {
  const id = useId();
  return (
    <div className={`score${value === null ? ' unset' : ''}`}>
      <div className="score-head">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <span className="score-value condensed num" aria-hidden="true">
          {value === null ? strings.brew.log.unset : formatNumber(value, 1)}
        </span>
        {value !== null && (
          <button type="button" className="score-clear" onClick={() => onChange(null)}>
            {strings.brew.log.clear}
          </button>
        )}
      </div>
      <input
        id={id}
        className="slider"
        type="range"
        min={1}
        max={10}
        step={0.5}
        value={value ?? 5.5}
        aria-valuetext={value === null ? strings.brew.log.unset : formatNumber(value, 1)}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        // A tap on the untouched middle still counts as a score.
        onClick={(e) => {
          if (value === null) onChange(Number(e.currentTarget.value));
        }}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
