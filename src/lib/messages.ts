import type { ReviewInput, ReviewResult } from './review/types';
import type { TranscriptResult } from './transcribe/types';

/**
 * Content -> background requests. The background is a pure proxy to the
 * providers: it holds the API keys but no data. IndexedDB belongs to the
 * page origin from a content script and to the extension origin from the
 * service worker, so the two cannot share a database; all storage stays in
 * the content script and audio travels as base64 (well under Chrome's 64 MB
 * message cap at the 25 MB upload limit).
 */
export type Request =
  | { type: 'TRANSCRIBE'; audioBase64: string; mimeType: string }
  | { type: 'REVIEW'; input: ReviewInput };

export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export type TranscribeData = TranscriptResult;
export type ReviewData = ReviewResult;

export function sendRequest<T>(req: Request): Promise<Response<T>> {
  return browser.runtime.sendMessage(req) as Promise<Response<T>>;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

export function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mimeType });
}
