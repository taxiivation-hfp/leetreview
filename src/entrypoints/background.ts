import { toMarkedText } from '../lib/alignPauses';
import { appendReview, db, getTranscriptForSession, setTranscript } from '../lib/db';
import type { Request, Response, ReviewData, TranscribeData } from '../lib/messages';
import { claudeReviewer } from '../lib/review/claude';
import { ReviewError } from '../lib/review/types';
import { getSettings } from '../lib/settings';
import { groqTranscriber } from '../lib/transcribe/groq';
import { TranscribeError } from '../lib/transcribe/types';

/**
 * Provider calls run here so API keys never enter the page context and so
 * host_permissions (not the page's CSP) govern the requests.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    handle(msg)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse(fail(e)));
    return true; // keep the channel open for the async reply
  });
});

async function handle(msg: Request): Promise<Response> {
  switch (msg.type) {
    case 'TRANSCRIBE':
      return transcribe(msg.sessionId);
    case 'REVIEW':
      return review(msg.sessionId, msg.problemDescription, msg.code);
    default:
      return { ok: false, error: 'Unknown request' };
  }
}

async function transcribe(sessionId: string): Promise<Response<TranscribeData>> {
  const [session, settings] = await Promise.all([db.sessions.get(sessionId), getSettings()]);
  if (!session) return { ok: false, error: 'Session not found' };
  const audio = await db.audio.get(session.audioBlobId);
  if (!audio) return { ok: false, error: 'Audio missing for this session' };

  const result = await groqTranscriber.transcribe(audio.blob, { apiKey: settings.groqKey });
  const transcript = await setTranscript({ ...result, sessionId, createdAt: Date.now() });
  return { ok: true, data: { transcriptId: transcript.id } };
}

async function review(
  sessionId: string,
  problemDescription: string | null,
  code: string | null,
): Promise<Response<ReviewData>> {
  const [session, settings, transcript] = await Promise.all([
    db.sessions.get(sessionId),
    getSettings(),
    getTranscriptForSession(sessionId),
  ]);
  if (!session) return { ok: false, error: 'Session not found' };
  if (!transcript) return { ok: false, error: 'Transcribe the session first' };

  const result = await claudeReviewer.review(
    {
      problemTitle: session.problemTitle,
      difficulty: session.difficulty,
      problemDescription,
      code,
      markedTranscript: toMarkedText(transcript, session.pauses),
      pauses: session.pauses,
      durationMs: session.durationMs,
      fillerCount: transcript.fillerCount ?? 0,
      outcome: session.outcome,
    },
    { apiKey: settings.anthropicKey, model: settings.reviewModel },
  );

  const saved = await appendReview({
    sessionId,
    provider: result.provider,
    model: result.model,
    createdAt: Date.now(),
    codeSnapshot: code ?? '',
    promptVersion: result.promptVersion,
    output: JSON.stringify(result.output),
  });
  return { ok: true, data: { reviewId: saved.id, output: result.output } };
}

function fail(e: unknown): Response {
  if (e instanceof TranscribeError || e instanceof ReviewError) {
    return { ok: false, error: e.message, code: e.code };
  }
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}
