import Anthropic from '@anthropic-ai/sdk';
import { CHAT_SCHEMA, CHAT_SYSTEM, SHEET_SYSTEM, chatUserMessage, sheetUserMessage } from '../../prompts/clarify';
import type { ReviewModel } from '../settings';
import type { ChatKind, ChatMessage, HintSize } from '../types';
import { ReviewError } from './types';

/** The sheet needs real reasoning and maybe a search; replies use the chat model from Settings. */
const SHEET_MODEL = 'claude-sonnet-5-5';
const MAX_PAUSES = 3;

export interface SheetInput {
  title: string;
  description: string | null;
  language: string;
}

export interface ChatInput {
  title: string;
  description: string | null;
  sheet: string;
  code: string | null;
  history: ChatMessage[];
  latest: string;
  hintRequested: boolean;
}

export interface ChatReply {
  kind: ChatKind;
  size?: HintSize;
  text: string;
}

function client(apiKey: string) {
  if (!apiKey) throw new ReviewError('Add an Anthropic API key in Settings.', 'no-key');
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
    maxRetries: 2,
  });
}

function mapError(e: unknown): never {
  if (e instanceof ReviewError) throw e;
  if (e instanceof Anthropic.AuthenticationError) throw new ReviewError('Anthropic rejected the API key.', 'auth');
  if (e instanceof Anthropic.RateLimitError)
    throw new ReviewError('Anthropic rate limit hit. Try again shortly.', 'rate-limit');
  if (e instanceof Anthropic.APIConnectionError)
    throw new ReviewError(`Could not reach Anthropic: ${e.message}`, 'network');
  if (e instanceof Anthropic.APIError) throw new ReviewError(`Anthropic error ${e.status}: ${e.message}`, 'provider');
  throw new ReviewError((e as Error).message, 'provider');
}

function finalText(message: Anthropic.Message) {
  if (message.stop_reason === 'refusal') throw new ReviewError('The model declined this request.', 'refusal');
  if (message.stop_reason === 'max_tokens') throw new ReviewError('The reply was cut off; try again.', 'provider');
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Hidden answer key; Sonnet may search the web when it does not know the problem. */
export async function buildSheet(input: SheetInput, apiKey: string): Promise<string> {
  const c = client(apiKey);
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: sheetUserMessage(input.title, input.description, input.language) },
  ];
  try {
    for (let i = 0; ; i++) {
      const message = await c.messages
        .stream({
          model: SHEET_MODEL,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          system: SHEET_SYSTEM.replace('<language>', input.language),
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
          messages,
        })
        .finalMessage();
      // A long search turn can pause; resend it unchanged to let it finish.
      if (message.stop_reason === 'pause_turn' && i < MAX_PAUSES) {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      // Search turns interleave text; the sheet is the text after the last tool result.
      const lastTool = message.content.findLastIndex((b) => b.type !== 'text' && b.type !== 'thinking');
      const text = finalText({ ...message, content: message.content.slice(lastTool + 1) }).trim();
      if (!text) throw new ReviewError('Could not prepare the problem; try again.', 'provider');
      return text;
    }
  } catch (e) {
    mapError(e);
  }
}

export async function chatReply(input: ChatInput, model: ReviewModel, apiKey: string): Promise<ChatReply> {
  const c = client(apiKey);
  let message: Anthropic.Message;
  try {
    message = await c.messages.create({
      model,
      // Medium effort: replies have to trace the candidate's plan before judging it.
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: CHAT_SCHEMA } },
      system: CHAT_SYSTEM,
      messages: [{ role: 'user', content: chatUserMessage(input) }],
    });
  } catch (e) {
    mapError(e);
  }
  let raw: { kind: string; size: string; text: string };
  try {
    raw = JSON.parse(finalText(message));
  } catch (e) {
    if (e instanceof ReviewError) throw e;
    throw new ReviewError('The reply came back malformed; try again.', 'provider');
  }
  // The Hint button always produces a counted hint, whatever the label says.
  const kind = (input.hintRequested ? 'hint' : raw.kind) as ChatKind;
  const size = kind === 'hint' ? ((raw.size === 'none' ? 'nudge' : raw.size) as HintSize) : undefined;
  return { kind, ...(size && { size }), text: raw.text.trim() };
}
