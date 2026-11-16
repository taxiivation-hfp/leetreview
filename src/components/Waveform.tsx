import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Recorder } from '../lib/recorder';

const IDLE = [18, 32, 54, 40, 72, 50, 26, 62, 84, 46, 32, 68, 90, 54, 28, 44, 76, 58, 22, 50, 80, 36, 64, 86, 40, 26];
/** Bar width + gap in px; keep in sync with `.wave i` in panel.css. */
const PITCH = 7;

/**
 * Mic level over the last few seconds, as many bars as fit the width. Newest
 * level sits at the right edge, or the left with `flip`, so two halves either
 * side of a button both flow out from it. Bars update imperatively to avoid
 * re-rendering them every frame.
 */
export function Waveform({ recorder, flip = false }: { recorder: Recorder | null; flip?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const s = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      setCount(Math.max(0, Math.floor((w + 3) / PITCH)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = el.children as HTMLCollectionOf<HTMLElement>;
    const n = bars.length;
    const at = (i: number) => (flip ? n - 1 - i : i);
    if (!recorder) {
      for (let i = 0; i < n; i++) bars[at(i)]!.style.height = `${IDLE[i % IDLE.length]! * 0.6}%`;
      return;
    }
    let raf = 0;
    const draw = () => {
      const levels = recorder.levels;
      for (let i = 0; i < n; i++) {
        const v = levels[levels.length - n + i] ?? 0;
        bars[at(i)]!.style.height = `${Math.round(12 + v * 88)}%`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [recorder, count, flip]);

  return (
    <div className={'wave' + (recorder ? '' : ' idle')} ref={ref}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
