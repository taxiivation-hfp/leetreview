import Dexie, { type EntityTable } from 'dexie';
import { nanoid } from 'nanoid';
import type {
  Audio,
  Pause,
  ProblemInfo,
  ProblemMeta,
  RecordingChunk,
  RecordingMeta,
  Review,
  Session,
  Transcript,
} from './types';

/**
 * All data lives in the browser's IndexedDB. Dexie is only a typed wrapper;
 * nothing here talks to a server.
 */
class LeetReviewDB extends Dexie {
  sessions!: EntityTable<Session, 'id'>;
  audio!: EntityTable<Audio, 'id'>;
  transcripts!: EntityTable<Transcript, 'id'>;
  reviews!: EntityTable<Review, 'id'>;
  recordingChunks!: EntityTable<RecordingChunk, 'seq'>;

  constructor() {
    super('leetreview');
    this.version(1).stores({
      sessions: 'id, problemSlug, startedAt',
      audio: 'id',
      transcripts: 'id, sessionId',
      reviews: 'id, sessionId, createdAt',
      recordingChunks: '++seq, recordingId',
    });
  }
}

export const db = new LeetReviewDB();

// ---------- sessions ----------

export function listSessionsForProblem(slug: string) {
  return db.sessions.where('problemSlug').equals(slug).reverse().sortBy('startedAt');
}

export async function createSession(input: {
  problem: ProblemInfo;
  startedAt: number;
  durationMs: number;
  pauses: Pause[];
  blob: Blob;
  mimeType: string;
}): Promise<Session> {
  const session: Session = {
    id: nanoid(),
    problemSlug: input.problem.slug,
    problemTitle: input.problem.title,
    difficulty: input.problem.difficulty,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    audioBlobId: nanoid(),
    pauses: input.pauses,
    reviewIds: [],
  };
  await db.transaction('rw', db.sessions, db.audio, async () => {
    await db.audio.add({ id: session.audioBlobId, blob: input.blob, mimeType: input.mimeType });
    await db.sessions.add(session);
  });
  return session;
}

/** Removes the session plus its audio, transcript and every review. */
export async function deleteSessionCascade(sessionId: string) {
  await db.transaction('rw', db.sessions, db.audio, db.transcripts, db.reviews, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) return;
    await db.audio.delete(s.audioBlobId);
    await db.transcripts.where('sessionId').equals(sessionId).delete();
    await db.reviews.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

let backfilling: Promise<void> | null = null;

/**
 * Adds topic tags (and a missing difficulty) to sessions saved without them,
 * one lookup per problem. Covers sessions from before tags were stored and
 * crash-recovered ones. Concurrent calls share one run.
 */
export function backfillProblemMeta(fetchMeta: (slug: string) => Promise<ProblemMeta | null>) {
  backfilling ??= (async () => {
    const missing = await db.sessions.filter((s) => s.topics === undefined).toArray();
    for (const slug of new Set(missing.map((s) => s.problemSlug))) {
      const meta = await fetchMeta(slug).catch(() => null);
      if (!meta) continue;
      await db.sessions
        .where('problemSlug')
        .equals(slug)
        .modify((s) => {
          s.topics = meta.topics;
          if (s.difficulty === null) s.difficulty = meta.difficulty;
        });
    }
  })().finally(() => {
    backfilling = null;
  });
  return backfilling;
}

// ---------- transcripts ----------

/** Overwrites any existing transcript for the session (caller confirms first). */
export async function setTranscript(t: Omit<Transcript, 'id'>): Promise<Transcript> {
  const transcript: Transcript = { id: nanoid(), ...t };
  await db.transaction('rw', db.sessions, db.transcripts, async () => {
    await db.transcripts.where('sessionId').equals(t.sessionId).delete();
    await db.transcripts.add(transcript);
    await db.sessions.update(t.sessionId, { transcriptId: transcript.id });
  });
  return transcript;
}

/** In-place correction of an existing transcript (hand edits). */
export function updateTranscript(
  id: string,
  patch: Pick<Transcript, 'text' | 'words' | 'fillerCount' | 'editedAt'>,
) {
  return db.transcripts.update(id, patch);
}

export function getTranscriptForSession(sessionId: string) {
  return db.transcripts.where('sessionId').equals(sessionId).first();
}

// ---------- reviews ----------

/** Appends to the review history; old reviews are never removed. */
export async function appendReview(r: Omit<Review, 'id'>): Promise<Review> {
  const review: Review = { id: nanoid(), ...r };
  await db.transaction('rw', db.sessions, db.reviews, async () => {
    await db.reviews.add(review);
    const s = await db.sessions.get(r.sessionId);
    if (s) await db.sessions.update(r.sessionId, { reviewIds: [...s.reviewIds, review.id] });
  });
  return review;
}

export function listReviewsForSession(sessionId: string) {
  return db.reviews.where('sessionId').equals(sessionId).reverse().sortBy('createdAt');
}

// ---------- chunked recording / crash recovery ----------

export function appendRecordingChunk(recordingId: string, blob: Blob, meta: RecordingMeta) {
  return db.recordingChunks.add({ recordingId, blob, meta });
}

export function discardRecording(recordingId: string) {
  return db.recordingChunks.where('recordingId').equals(recordingId).delete();
}

/** Recording ids that still have chunks on disk, i.e. the tab died mid-recording. */
export async function findOrphanRecordings(): Promise<
  { recordingId: string; meta: RecordingMeta }[]
> {
  const chunks = await db.recordingChunks.orderBy('seq').toArray();
  const byId = new Map<string, RecordingMeta>();
  for (const c of chunks) byId.set(c.recordingId, c.meta); // last chunk wins: latest meta
  return [...byId].map(([recordingId, meta]) => ({ recordingId, meta }));
}

/** Concatenates saved chunks into one Audio blob and creates a session from it. */
export async function finalizeRecording(recordingId: string) {
  const chunks = await db.recordingChunks.where('recordingId').equals(recordingId).sortBy('seq');
  if (chunks.length === 0) return null;
  const meta = chunks[chunks.length - 1]!.meta;
  const blob = new Blob(
    chunks.map((c) => c.blob),
    { type: meta.mimeType },
  );
  const session = await createSession({
    problem: { slug: meta.problemSlug, title: meta.problemTitle, difficulty: meta.difficulty },
    startedAt: meta.startedAt,
    durationMs: meta.elapsedMs,
    pauses: meta.pauses,
    blob,
    mimeType: meta.mimeType,
  });
  await discardRecording(recordingId);
  return session;
}
