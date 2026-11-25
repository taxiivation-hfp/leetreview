import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { db } from './db';
import type { ChatMessage, LogicSheet, ProblemChat, Review, Session, Transcript } from './types';

/**
 * Backup zip for moving history between machines:
 *   manifest.json   { app, schema, exportedAt, counts }
 *   data.json       sessions, transcripts, reviews, chats, logicSheets, audio index
 *   audio/<id>      raw audio per session
 * Settings and API keys are never exported.
 */
const SCHEMA = 1;

interface DataFile {
  sessions: Session[];
  transcripts: Transcript[];
  reviews: Review[];
  chats: ProblemChat[];
  logicSheets: LogicSheet[];
  audio: { id: string; mimeType: string }[];
}

export interface ImportResult {
  sessions: number;
  reviews: number;
  skipped: number;
}

export async function exportAll(): Promise<Blob> {
  const [sessions, transcripts, reviews, chats, logicSheets, audioRows] = await Promise.all([
    db.sessions.toArray(),
    db.transcripts.toArray(),
    db.reviews.toArray(),
    db.chats.toArray(),
    db.logicSheets.toArray(),
    db.audio.toArray(),
  ]);

  const files: Zippable = {};
  for (const a of audioRows) {
    // Audio is already compressed (opus), so store it without deflating.
    files[`audio/${a.id}`] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }];
  }
  const data: DataFile = {
    sessions,
    transcripts,
    reviews,
    chats,
    logicSheets,
    audio: audioRows.map((a) => ({ id: a.id, mimeType: a.mimeType })),
  };
  files['data.json'] = strToU8(JSON.stringify(data));
  files['manifest.json'] = strToU8(
    JSON.stringify({
      app: 'leetreview',
      schema: SCHEMA,
      exportedAt: Date.now(),
      counts: { sessions: sessions.length, reviews: reviews.length },
    }),
  );
  return new Blob([zipSync(files) as BlobPart], { type: 'application/zip' });
}

/** Additive, idempotent merge: never deletes or overwrites local sessions. */
export async function importBackup(file: File): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('Not a LeetReview backup');
  }
  const manifestRaw = entries['manifest.json'];
  const dataRaw = entries['data.json'];
  if (!manifestRaw || !dataRaw) throw new Error('Not a LeetReview backup');
  let manifest: { app?: string; schema?: number };
  let data: DataFile;
  try {
    manifest = JSON.parse(strFromU8(manifestRaw));
    data = JSON.parse(strFromU8(dataRaw));
  } catch {
    throw new Error('Backup is corrupt');
  }
  if (manifest.app !== 'leetreview') throw new Error('Not a LeetReview backup');
  if (typeof manifest.schema !== 'number' || manifest.schema > SCHEMA) {
    throw new Error('Backup is from a newer version; update the extension');
  }

  const mime = new Map(data.audio.map((a) => [a.id, a.mimeType]));
  const result: ImportResult = { sessions: 0, reviews: 0, skipped: 0 };

  await db.transaction(
    'rw',
    [db.sessions, db.audio, db.transcripts, db.reviews, db.chats, db.logicSheets],
    async () => {
      for (const s of data.sessions) {
        const local = await db.sessions.get(s.id);
        if (local) {
          // Same session on both sides: keep it, but union the review ids.
          const ids = [...new Set([...local.reviewIds, ...s.reviewIds])];
          if (ids.length !== local.reviewIds.length) {
            await db.sessions.update(s.id, { reviewIds: ids });
          }
          result.skipped++;
          continue;
        }
        const bytes = entries[`audio/${s.audioBlobId}`];
        if (bytes && !(await db.audio.get(s.audioBlobId))) {
          const type = mime.get(s.audioBlobId) ?? 'audio/webm';
          await db.audio.add({
            id: s.audioBlobId,
            blob: new Blob([bytes as BlobPart], { type }),
            mimeType: type,
          });
        }
        await db.sessions.add(s);
        result.sessions++;
      }

      for (const t of data.transcripts) {
        const clash =
          (await db.transcripts.get(t.id)) ??
          (await db.transcripts.where('sessionId').equals(t.sessionId).first());
        if (clash) continue;
        await db.transcripts.add(t);
        // A pre-existing session lacking its transcript link gets it back.
        await db.sessions.where('id').equals(t.sessionId).and((s) => !s.transcriptId).modify({
          transcriptId: t.id,
        });
      }

      for (const r of data.reviews) {
        if (await db.reviews.get(r.id)) continue;
        await db.reviews.add(r);
        result.reviews++;
        const s = await db.sessions.get(r.sessionId);
        if (s && !s.reviewIds.includes(r.id)) {
          await db.sessions.update(s.id, { reviewIds: [...s.reviewIds, r.id] });
        }
      }

      for (const c of data.chats) {
        const local = await db.chats.get(c.slug);
        if (!local) {
          await db.chats.add(c);
          continue;
        }
        const key = (m: ChatMessage) => `${m.at}|${m.role}|${m.text}`;
        const seen = new Set(local.messages.map(key));
        const extra = c.messages.filter((m) => !seen.has(key(m)));
        if (extra.length === 0) continue;
        const messages = [...local.messages, ...extra].sort((a, b) => a.at - b.at);
        await db.chats.update(c.slug, { messages });
      }

      for (const l of data.logicSheets) {
        const local = await db.logicSheets.get([l.slug, l.language]);
        if (!local || local.createdAt < l.createdAt) await db.logicSheets.put(l);
      }
    },
  );
  return result;
}
