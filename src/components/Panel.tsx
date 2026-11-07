import { useEffect, useRef, useState } from 'react';
import type { ProblemInfo, Session } from '../lib/types';
import { useSettings } from '../lib/useSettings';
import { RecordView } from './RecordView';
import { SessionDetail } from './SessionDetail';
import { SessionsView } from './SessionsView';
import { SettingsView } from './SettingsView';

type Chip = 'record' | 'sessions' | 'settings';
const NARROW_PX = 600;

export function Panel({ problem }: { problem: ProblemInfo }) {
  const settings = useSettings();
  const [chip, setChip] = useState<Chip>('record');
  const [open, setOpen] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Leaving a problem closes any open session detail (it belongs to the old slug).
  useEffect(() => setOpen(null), [problem.slug]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow((e?.contentRect.width ?? 9999) < NARROW_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chips: { id: Chip; label: string }[] = [
    { id: 'record', label: 'Record' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="pane" ref={ref}>
      <div className="chips">
        {chips.map((c) => (
          <button
            key={c.id}
            className={'ch' + (chip === c.id ? ' on' : '')}
            onClick={() => {
              setChip(c.id);
              if (c.id !== 'sessions') setOpen(null);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {chip === 'record' && <RecordView problem={problem} settings={settings} />}
      {chip === 'sessions' &&
        (open ? (
          <SessionDetail sessionId={open} narrow={narrow} onBack={() => setOpen(null)} />
        ) : (
          <SessionsView problem={problem} onOpen={(s: Session) => setOpen(s.id)} />
        ))}
      {chip === 'settings' && <SettingsView settings={settings} />}
    </div>
  );
}
