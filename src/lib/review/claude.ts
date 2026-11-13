import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_VERSION, REVIEW_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from '../../prompts/review';
import type { ReviewOutput } from '../types';
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
            system: custom || SYSTEM_PROMPT,
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
      output = JSON.parse(text) as ReviewOutput;
    } catch {
      throw new ReviewError('The review came back malformed; try again.', 'provider');
    }

    const promptVersion = custom ? `${PROMPT_VERSION}-custom` : PROMPT_VERSION;
    return { provider: claudeReviewer.id, model, promptVersion, output };
  },
};
