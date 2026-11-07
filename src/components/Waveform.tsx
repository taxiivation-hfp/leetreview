import { useEffect, useRef } from 'react';
import type { Recorder } from '../lib/recorder';

const BARS = 52;
const IDLE = [10, 18, 30, 22, 40, 28, 14, 34, 46, 26, 18, 38, 50, 30, 16, 24, 42, 32, 12, 28, 44, 20, 36, 48, 22, 14];

/** 52 bars showing the last few seconds of mic level. Imperative updates to avoid re-rendering 52 nodes 10x/s. */
export function Waveform({ recorder }: { recorder: Recorder | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = el.children as HTMLCollectionOf<HTMLElement>;
    if (!recorder) {
      const idle = IDLE.concat(IDLE.slice().reverse().map((h) => Math.max(8, h - 4)));
      for (let i = 0; i < bars.length; i++) bars[i]!.style.height = `${idle[i] ?? 10}px`;
      return;
    }
    let raf = 0;
    const draw = () => {
      const levels = recorder.levels;
      const n = bars.length;
      for (let i = 0; i < n; i++) {
        const v = levels[levels.length - n + i] ?? 0;
        bars[i]!.style.height = `${Math.max(6, Math.round(6 + v * 48))}px`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [recorder]);

  return (
    <div className={'wave' + (recorder ? '' : ' idle')} ref={ref}>
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
