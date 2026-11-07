import { base64ToBlob, type Request, type Response } from '../lib/messages';
import { claudeReviewer } from '../lib/review/claude';
import { ReviewError } from '../lib/review/types';
import { getSettings } from '../lib/settings';
import { groqTranscriber } from '../lib/transcribe/groq';
import { TranscribeError } from '../lib/transcribe/types';

/**
 * Provider calls run here so API keys never enter the page context and so
 * host_permissions (not the page's CORS policy) govern the requests. The
 * worker stores nothing; see lib/messages.ts for why.
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
  const settings = await getSettings();
  switch (msg.type) {
    case 'TRANSCRIBE': {
      const blob = base64ToBlob(msg.audioBase64, msg.mimeType);
      const data = await groqTranscriber.transcribe(blob, { apiKey: settings.groqKey });
      return { ok: true, data };
    }
    case 'REVIEW': {
      const data = await claudeReviewer.review(msg.input, {
        apiKey: settings.anthropicKey,
        model: settings.reviewModel,
      });
      return { ok: true, data };
    }
    default:
      return { ok: false, error: 'Unknown request' };
  }
}

function fail(e: unknown): Response {
  if (e instanceof TranscribeError || e instanceof ReviewError) {
    return { ok: false, error: e.message, code: e.code };
  }
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}
