import type { Outcome } from '../lib/types';

const OPTIONS: { v: Outcome; label: string }[] = [
  { v: 'solved', label: 'Solved' },
  { v: 'partial', label: 'Partial' },
  { v: 'stuck', label: 'Stuck' },
];

export function OutcomePills({
  value,
  onChange,
}: {
  value: Outcome | null;
  onChange: (o: Outcome | null) => void;
}) {
  return (
    <div className="pills">
      {OPTIONS.map((o) => (
        <button
          key={o.v}
          className={'pill' + (value === o.v ? ' on' : '')}
          onClick={() => onChange(value === o.v ? null : o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
