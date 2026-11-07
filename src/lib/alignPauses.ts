import type { Pause, Transcript } from './types';

export type TranscriptToken =
  | { kind: 'word'; text: string; filler: boolean }
  | { kind: 'pause'; durationMs: number };

/**
 * Filler lexicon. Counting is a lower bound; nothing is ever stripped.
 * "like" and "you know" are counted as fillers wherever they appear, which
 * over-counts slightly but matches what the user wants to see.
 */
const FILLER_RE = /^(um+|uh+|uhm+|umm+|hmm+|hm+|mm+|er+|erm+|ah+|like)$/i;
const PHRASE_FILLERS = [/\byou know\b/gi, /\bi mean\b/gi, /\bsort of\b/gi, /\bkind of\b/gi];

export function countFillers(text: string): number {
  let n = 0;
  for (const w of text.split(/\s+/)) {
    if (FILLER_RE.test(w.replace(/[.,!?;:…]+$/g, ''))) n++;
  }
  for (const re of PHRASE_FILLERS) n += (text.match(re) ?? []).length;
  return n;
}

function isFillerWord(raw: string): boolean {
  return FILLER_RE.test(raw.trim().replace(/[.,!?;:…]+$/g, ''));
}

/**
 * Interleaves pauses into the transcript using word timestamps. A pause is
 * placed before the first word that starts after the pause began. Pauses
 * with no following word are appended at the end. Without word timestamps
 * the text is returned as plain words and pauses go at the end.
 */
export function tokenize(transcript: Transcript, pauses: Pause[]): TranscriptToken[] {
  const out: TranscriptToken[] = [];
  const sorted = [...pauses].sort((a, b) => a.startMs - b.startMs);
  let pi = 0;

  if (transcript.words && transcript.words.length > 0) {
    for (const w of transcript.words) {
      while (pi < sorted.length && sorted[pi]!.startMs <= w.startMs) {
        out.push({ kind: 'pause', durationMs: sorted[pi]!.durationMs });
        pi++;
      }
      out.push({ kind: 'word', text: w.word, filler: isFillerWord(w.word) });
    }
  } else {
    for (const w of transcript.text.split(/\s+/).filter(Boolean)) {
      out.push({ kind: 'word', text: w, filler: isFillerWord(w) });
    }
  }
  for (; pi < sorted.length; pi++) out.push({ kind: 'pause', durationMs: sorted[pi]!.durationMs });
  return out;
}

/** Plain-text form with `[7s pause]` markers, used for the review prompt. */
export function toMarkedText(transcript: Transcript, pauses: Pause[]): string {
  return tokenize(transcript, pauses)
    .map((t) => (t.kind === 'pause' ? `[${Math.round(t.durationMs / 1000)}s pause]` : t.text))
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1');
}
