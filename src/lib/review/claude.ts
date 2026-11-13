import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_VERSION, REVIEW_SCHEMA, RUBRIC, SYSTEM_PROMPT, buildUserMessage } from '../../prompts/review';
import { CRITERIA } from '../rubric';
import type { ReviewOutput, Score } from '../types';
import { ReviewError, type Reviewer, type ReviewResult } from './types';

/**
 * Anthropic Messages API from the MV3 service worker. The key never leaves
 * chrome.storage.local except on this request.
 */
export const claudeReviewer: Reviewer = {
  id: 'anthropic',

  async review(input, { apiKey, model, systemPrompt, signal }): Promise<ReviewResult> {
    if (!apiKey) throw new ReviewError('Add an Anthropic API key in Settings.', 'no-key');

    const custom = systemPrompt?.trim();
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
      maxRetries: 2,
    });

    let message: Anthropic.Message;
    try {
      message = await client.messages
        .stream(
          {
            model,
            max_tokens: 16000,
            output_config: {
              effort: 'medium',
              format: { type: 'json_schema', schema: REVIEW_SCHEMA },
            },
            // The rubric block is fixed; only the first block is user-editable.
            system: [
              { type: 'text', text: custom || SYSTEM_PROMPT },
              { type: 'text', text: RUBRIC },
            ],
            messages: [{ role: 'user', content: buildUserMessage(input) }],
          },
          { signal },
        )
        .finalMessage();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError)
        throw new ReviewError('Anthropic rejected the API key.', 'auth');
      if (e instanceof Anthropic.RateLimitError)
        throw new ReviewError('Anthropic rate limit hit. Try again shortly.', 'rate-limit');
      if (e instanceof Anthropic.APIConnectionError)
        throw new ReviewError(`Could not reach Anthropic: ${e.message}`, 'network');
      if (e instanceof Anthropic.APIError)
        throw new ReviewError(`Anthropic error ${e.status}: ${e.message}`, 'provider');
      throw new ReviewError((e as Error).message, 'provider');
    }

    if (message.stop_reason === 'refusal') {
      throw new ReviewError('The model declined to review this session.', 'refusal');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ReviewError('The review was cut off; try again.', 'provider');
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let output: ReviewOutput;
    try {
      output = normalize(JSON.parse(text));
    } catch {
      throw new ReviewError('The review came back malformed; try again.', 'provider');
    }

    const promptVersion = custom ? `${PROMPT_VERSION}-custom` : PROMPT_VERSION;
    return { provider: claudeReviewer.id, model, promptVersion, output };
  },
};

/** Folds the schema's fix1..fixN fields into `improvements`; throws on a bad shape. */
function normalize(raw: unknown): ReviewOutput {
  const r = raw as { summary: unknown; criteria: Record<string, Record<string, unknown>> };
  if (typeof r.summary !== 'string' || !r.criteria) throw new Error('shape');
  const criteria = {} as ReviewOutput['criteria'];
  for (const c of CRITERIA) {
    const x = r.criteria[c.id];
    if (!x) throw new Error(c.id);
    const score = x.score;
    if (score !== 1 && score !== 2 && score !== 3 && score !== 4) throw new Error('score');
    const improvements = Object.keys(x)
      .filter((k) => /^fix\d+$/.test(k))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
      .map((k) => String(x[k]).trim())
      .filter(Boolean)
      .slice(0, 4 - score);
    criteria[c.id] = { score: score as Score, note: String(x.note ?? ''), improvements };
  }
  return { summary: r.summary, criteria };
}
