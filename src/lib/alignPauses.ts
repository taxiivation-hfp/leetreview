import type { Pause, Transcript, TranscriptWord } from './types';

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

// ---------- editing ----------

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The word stream the transcript card shows, as plain editable text. */
export function editableText(t: Transcript): string {
  const words =
    t.words && t.words.length > 0 ? t.words.map((w) => w.word) : t.text.split(/\s+/).filter(Boolean);
  return words.join(' ').replace(/\s+([.,!?;:])/g, '$1');
}

/** True when the edit differs from what the card shows, ignoring whitespace. */
export function isEdited(t: Transcript, edited: string): boolean {
  return collapse(edited) !== collapse(editableText(t));
}

/**
 * Carries word timestamps over to an edited transcript so pause markers stay
 * where they were. Matched words keep their timing; a replaced run maps
 * proportionally onto the words it replaced; a pure insertion borrows the
 * previous word's timing, keeping it on the same side of any pause.
 */
export function realignWords(old: TranscriptWord[], edited: string): TranscriptWord[] {
  const next = edited.split(/\s+/).filter(Boolean);
  if (old.length === 0) return next.map((word) => ({ word, startMs: 0, endMs: 0 }));

  const pairs = matchWords(old.map((w) => normWord(w.word)), next.map(normWord));
  const out: TranscriptWord[] = [];
  const at = (k: number, src: TranscriptWord) => {
    out[k] = { word: next[k]!, startMs: src.startMs, endMs: src.endMs };
  };

  let pi = 0;
  let pj = 0;
  for (const [mi, mj] of [...pairs, [old.length, next.length] as const]) {
    for (let k = pj; k < mj; k++) {
      const src =
        mi > pi
          ? old[pi + Math.floor(((k - pj) * (mi - pi)) / (mj - pj))]!
          : old[pi - 1] ?? old[pi]!;
      at(k, src);
    }
    if (mj < next.length) at(mj, old[mi]!);
    pi = mi + 1;
    pj = mj + 1;
  }
  return out;
}

/** Index pairs of equal words, increasing in both. Trims the common ends, then diffs the middle. */
function matchWords(a: string[], b: string[]): [number, number][] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;

  const pairs: [number, number][] = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  const mid = myers(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)) ?? [];
  for (const [i, j] of mid) pairs.push([i + pre, j + pre]);
  for (let t = 0; t < suf; t++) pairs.push([a.length - suf + t, b.length - suf + t]);
  return pairs;
}

/**
 * Myers' O((N+M)D) diff returning matched index pairs. Gives up past maxD
 * edits (a near-total rewrite); the caller then maps timings proportionally.
 */
function myers(a: string[], b: string[], maxD = 1000): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= Math.min(max, maxD); d++) {
    // Snapshot k in [-d-1, d+1]; that is all the backtrack reads for step d.
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): [number, number][] {
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d]!;
    const get = (k: number) => snap[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      pairs.push([x - 1, y - 1]);
      x--;
      y--;
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  return pairs.reverse();
}
