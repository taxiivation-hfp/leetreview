export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Pause {
  startMs: number;
  durationMs: number;
}

export interface Session {
  id: string;
  problemSlug: string;
  problemTitle: string;
  difficulty: Difficulty | null;
  startedAt: number;
  durationMs: number;
  audioBlobId: string;
  pauses: Pause[];
  transcriptId?: string;
  reviewIds: string[];
}

export interface Audio {
  id: string;
  blob: Blob;
  mimeType: string;
}

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
  avgLogprob?: number;
  noSpeechProb?: number;
}

export interface Transcript {
  id: string;
  sessionId: string;
  provider: string; // e.g. "groq:whisper-large-v3"
  createdAt: number;
  text: string; // raw, fillers preserved
  words?: TranscriptWord[];
  segments?: TranscriptSegment[];
  fillerCount?: number;
  /** Set when the user corrected the text by hand. */
  editedAt?: number;
}

export type CriterionId =
  | 'understanding'
  | 'approach'
  | 'complexity'
  | 'code'
  | 'testing'
  | 'communication';

/** 1 Strong no · 2 Lean no · 3 Lean hire · 4 Strong hire */
export type Score = 1 | 2 | 3 | 4;

export interface CriterionResult {
  score: Score;
  /** One line justifying the score, quoting the transcript. */
  note: string;
  /** 4 - score items, highest impact first. */
  improvements: string[];
}

/** Shape of the JSON stored in Review.output (promptVersion v2 and later). */
export interface ReviewOutput {
  summary: string;
  criteria: Record<CriterionId, CriterionResult>;
}

/** promptVersion v1 shape; old reviews still render with it. */
export interface ReviewOutputV1 {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}

export interface Review {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  createdAt: number;
  codeSnapshot: string;
  promptVersion: string;
  output: string; // JSON-encoded ReviewOutput
}

/** One MediaRecorder chunk persisted during recording for crash recovery. */
export interface RecordingChunk {
  seq?: number;
  recordingId: string;
  blob: Blob;
  meta: RecordingMeta;
}

export interface RecordingMeta {
  problemSlug: string;
  problemTitle: string;
  difficulty: Difficulty | null;
  startedAt: number;
  mimeType: string;
  pauses: Pause[];
  elapsedMs: number;
}

export interface ProblemInfo {
  slug: string;
  title: string;
  difficulty: Difficulty | null;
}
