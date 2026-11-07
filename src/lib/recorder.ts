import { nanoid } from 'nanoid';
import { appendRecordingChunk, discardRecording } from './db';
import { PauseDetector, type PauseDetectorState } from './pauses';
import type { Pause, ProblemInfo, RecordingMeta } from './types';

const MIME = 'audio/webm;codecs=opus';
/** 32 kbps keeps a 45-minute session near 10 MB, under Groq's 25 MB cap. */
const BITRATE = 32_000;
/** Chunk interval for crash-safe saving. */
const TIMESLICE_MS = 5_000;

export interface RecorderOptions {
  problem: ProblemInfo;
  micDeviceId?: string;
  pauseThresholdMs: number;
  silenceDb: number;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  startedAt: number;
  durationMs: number;
  pauses: Pause[];
}

/**
 * Mic-only MediaRecorder with chunked IndexedDB saving and silence detection.
 * One instance per recording.
 */
export class Recorder {
  readonly recordingId = nanoid();
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private detector: PauseDetector | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0; // epoch ms
  private startedPerf = 0; // performance.now()
  private seqWrites: Promise<unknown> = Promise.resolve();

  constructor(private opts: RecorderOptions) {}

  get stateStream() {
    return this.detector;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: this.opts.micDeviceId ? { deviceId: { exact: this.opts.micDeviceId } } : true,
    });
    const mimeType = MediaRecorder.isTypeSupported(MIME) ? MIME : 'audio/webm';
    this.rec = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: BITRATE });
    this.detector = new PauseDetector(this.stream, {
      thresholdMs: this.opts.pauseThresholdMs,
      silenceDb: this.opts.silenceDb,
    });

    this.rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      this.chunks.push(e.data);
      const meta = this.meta(mimeType);
      // Serialise writes so chunk seq order matches arrival order.
      this.seqWrites = this.seqWrites.then(() =>
        appendRecordingChunk(this.recordingId, e.data, meta).catch(() => undefined),
      );
    };

    this.startedAt = Date.now();
    this.startedPerf = performance.now();
    this.detector.start(this.startedPerf);
    this.rec.start(TIMESLICE_MS);
  }

  elapsedMs(): number {
    return this.startedPerf ? performance.now() - this.startedPerf : 0;
  }

  subscribe(cb: (s: PauseDetectorState) => void) {
    return this.detector?.subscribe(cb) ?? (() => {});
  }

  get levels() {
    return this.detector?.levels ?? [];
  }

  async stop(): Promise<RecordingResult> {
    const rec = this.rec;
    if (!rec || !this.detector) throw new Error('Recorder not started');
    const pauses = this.detector.stop();
    const durationMs = Math.round(this.elapsedMs());

    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.seqWrites;

    const mimeType = rec.mimeType || MIME;
    const blob = new Blob(this.chunks, { type: mimeType });
    // The session now owns the audio; drop the crash-recovery chunks.
    await discardRecording(this.recordingId).catch(() => undefined);
    return { blob, mimeType, startedAt: this.startedAt, durationMs, pauses };
  }

  /** Abort without saving anything. */
  async cancel() {
    this.detector?.stop();
    this.rec?.state !== 'inactive' && this.rec?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.seqWrites;
    await discardRecording(this.recordingId).catch(() => undefined);
  }

  private meta(mimeType: string): RecordingMeta {
    return {
      problemSlug: this.opts.problem.slug,
      problemTitle: this.opts.problem.title,
      difficulty: this.opts.problem.difficulty,
      startedAt: this.startedAt,
      mimeType,
      pauses: this.detector?.getState().pauses ?? [],
      elapsedMs: Math.round(this.elapsedMs()),
    };
  }
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}
