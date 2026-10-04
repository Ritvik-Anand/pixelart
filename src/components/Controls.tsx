import type { ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Range(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  const { label, min, max, step, value, onChange, fmt } = props;
  return (
    <label className="range">
      <span className="range-head">
        <span>{label}</span>
        <output>{fmt ? fmt(value) : value}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  small?: boolean;
}) {
  return (
    <div className={`seg ${props.small ? 'small' : ''}`} role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

export function Color(props: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className={`color ${props.disabled ? 'off' : ''}`}>
      <input type="color" value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)} />
      <span>{props.label}</span>
    </label>
  );
}
