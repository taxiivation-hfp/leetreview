import type { ReviewModel } from '../settings';
import type { Pause, ReviewOutput } from '../types';

export interface ReviewInput {
  problemTitle: string;
  difficulty: string | null;
  /** May be null when the page adapter could not read it. */
  problemDescription: string | null;
  /** May be null when the editor could not be read. */
  code: string | null;
  /** Transcript text with inline `[7s pause]` markers. */
  markedTranscript: string;
  pauses: Pause[];
  durationMs: number;
  fillerCount: number;
  outcome: string | null;
}

export interface ReviewResult {
  provider: string;
  model: string;
  promptVersion: string;
  output: ReviewOutput;
}

export interface Reviewer {
  readonly id: string;
  review(
    input: ReviewInput,
    opts: { apiKey: string; model: ReviewModel; signal?: AbortSignal },
  ): Promise<ReviewResult>;
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly code: 'no-key' | 'auth' | 'rate-limit' | 'network' | 'refusal' | 'provider',
  ) {
    super(message);
  }
}
