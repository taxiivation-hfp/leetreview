import type { Pause } from './types';

export interface PauseDetectorOptions {
  /** Silence shorter than this is ignored. */
  thresholdMs: number;
  /** RMS level in dBFS under which the signal counts as silence. */
  silenceDb: number;
  /** Sampling interval. */
  tickMs?: number;
}

export interface PauseDetectorState {
  levelDb: number;
  /** How long the mic has been quiet right now (0 when speaking). */
  currentSilenceMs: number;
  pauses: Pause[];
}

/**
 * Watches an AnalyserNode and logs every stretch of silence that lasts at
 * least `thresholdMs`. Pure signal processing; no DOM.
 */
export class PauseDetector {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private timer: number | null = null;
  private startedAt = 0;
  private quietSince: number | null = null;
  private pauses: Pause[] = [];
  private levelDb = -100;
  /** Rolling history of levels (0..1) for a waveform display. */
  readonly levels: number[] = [];
  private listeners = new Set<(s: PauseDetectorState) => void>();

  constructor(
    stream: MediaStream,
    private opts: PauseDetectorOptions,
  ) {
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  start(startedAt = performance.now()) {
    this.startedAt = startedAt;
    this.quietSince = null;
    this.pauses = [];
    this.timer = window.setInterval(() => this.tick(), this.opts.tickMs ?? 100);
  }

  setOptions(patch: Partial<PauseDetectorOptions>) {
    this.opts = { ...this.opts, ...patch };
  }

  subscribe(cb: (s: PauseDetectorState) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getState(): PauseDetectorState {
    const now = performance.now();
    return {
      levelDb: this.levelDb,
      currentSilenceMs: this.quietSince === null ? 0 : now - this.quietSince,
      pauses: this.pauses,
    };
  }

  /** Stops sampling, closes any open pause, and returns the final list. */
  stop(): Pause[] {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.closePause(performance.now());
    void this.ctx.close();
    return this.pauses;
  }

  private tick() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i]! * this.buf[i]!;
    const rms = Math.sqrt(sum / this.buf.length);
    this.levelDb = rms > 0 ? 20 * Math.log10(rms) : -100;

    // Map -70..-10 dB onto 0..1 for display.
    const norm = Math.min(1, Math.max(0, (this.levelDb + 70) / 60));
    this.levels.push(norm);
    if (this.levels.length > 120) this.levels.shift();

    const now = performance.now();
    if (this.levelDb < this.opts.silenceDb) {
      if (this.quietSince === null) this.quietSince = now;
    } else {
      this.closePause(now);
    }
    const state = this.getState();
    for (const cb of this.listeners) cb(state);
  }

  private closePause(now: number) {
    if (this.quietSince === null) return;
    const durationMs = now - this.quietSince;
    if (durationMs >= this.opts.thresholdMs) {
      this.pauses.push({
        startMs: Math.round(this.quietSince - this.startedAt),
        durationMs: Math.round(durationMs),
      });
    }
    this.quietSince = null;
  }
}

export function pauseStats(pauses: Pause[]) {
  const totalMs = pauses.reduce((a, p) => a + p.durationMs, 0);
  const longestMs = pauses.reduce((a, p) => Math.max(a, p.durationMs), 0);
  return { totalMs, longestMs, count: pauses.length };
}
