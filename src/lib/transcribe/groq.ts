import { FILLER_PROMPT } from '../../prompts/transcribe';
import { countFillers } from '../alignPauses';
import { TranscribeError, type Transcriber, type TranscriptResult } from './types';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
/** Groq free tier rejects uploads over 25 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

interface VerboseJson {
  text: string;
  language?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
  segments?: {
    id: number;
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    no_speech_prob?: number;
  }[];
}

/**
 * Groq's OpenAI-compatible transcription endpoint. Plain fetch (no SDK) so
 * it runs in the MV3 service worker without browser-mode flags.
 */
export const groqTranscriber: Transcriber = {
  id: `groq:${MODEL}`,

  async transcribe(blob, { apiKey, signal }): Promise<TranscriptResult> {
    if (!apiKey) throw new TranscribeError('Add a Groq API key in Settings.', 'no-key');
    if (blob.size > MAX_BYTES) {
      throw new TranscribeError(
        `Audio is ${(blob.size / 1_048_576).toFixed(1)} MB; Groq's free tier caps uploads at 25 MB.`,
        'too-large',
      );
    }

    const form = new FormData();
    form.append('file', blob, 'session.webm');
    form.append('model', MODEL);
    form.append('language', 'en');
    form.append('temperature', '0');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('prompt', FILLER_PROMPT);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal,
      });
    } catch (e) {
      throw new TranscribeError(`Could not reach Groq: ${(e as Error).message}`, 'network');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401) throw new TranscribeError('Groq rejected the API key.', 'auth');
      if (res.status === 429)
        throw new TranscribeError('Groq rate limit hit. Try again in a minute.', 'rate-limit');
      throw new TranscribeError(`Groq error ${res.status}: ${body.slice(0, 200)}`, 'provider');
    }

    const json = (await res.json()) as VerboseJson;
    const text = json.text?.trim() ?? '';
    return {
      provider: groqTranscriber.id,
      text,
      words: json.words?.map((w) => ({
        word: w.word.trim(),
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
      })),
      segments: json.segments?.map((s) => ({
        text: s.text.trim(),
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        avgLogprob: s.avg_logprob,
        noSpeechProb: s.no_speech_prob,
      })),
      fillerCount: countFillers(text),
    };
  },
};
