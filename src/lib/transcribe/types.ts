import type { Transcript } from '../types';

export type TranscriptResult = Omit<Transcript, 'id' | 'sessionId' | 'createdAt'>;

export interface Transcriber {
  /** e.g. "groq:whisper-large-v3" */
  readonly id: string;
  transcribe(blob: Blob, opts: { apiKey: string; signal?: AbortSignal }): Promise<TranscriptResult>;
}

export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly code: 'no-key' | 'too-large' | 'auth' | 'rate-limit' | 'network' | 'provider',
  ) {
    super(message);
  }
}
