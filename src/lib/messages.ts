import type { ReviewOutput } from './types';

/** Content -> background requests. Keys are read by the background only. */
export type Request =
  | { type: 'TRANSCRIBE'; sessionId: string }
  | {
      type: 'REVIEW';
      sessionId: string;
      problemDescription: string | null;
      code: string | null;
    };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export interface TranscribeData {
  transcriptId: string;
}
export interface ReviewData {
  reviewId: string;
  output: ReviewOutput;
}

export function sendRequest<T>(req: Request): Promise<Response<T>> {
  return browser.runtime.sendMessage(req) as Promise<Response<T>>;
}
