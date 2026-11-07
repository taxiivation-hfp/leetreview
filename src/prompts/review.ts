import type { ReviewInput } from '../lib/review/types';
import { pauseStats } from '../lib/pauses';
import { fmtClock, fmtSeconds } from '../lib/format';

/** Bump when the system prompt or schema changes so reviews stay comparable. */
export const PROMPT_VERSION = 'v1';

export const SYSTEM_PROMPT = `You are an experienced interviewer at a top tech company reviewing a recorded mock interview. The candidate solved a LeetCode problem alone while thinking aloud. You receive the problem, a verbatim transcript of their speech (filler words preserved, with [Ns pause] markers where they were silent), pause statistics, and the code left in the editor.

Evaluate the thought process, not just the final code. Look for:
- Did they restate the problem, ask or answer clarifying questions, and consider edge cases before coding?
- Did they start from a brute force, state its complexity, and then optimize with a clear reason?
- Did they state time and space complexity of the final approach, correctly?
- Communication: long silences (use the pause markers and stats), rambling, backtracking, and filler-word clusters. Silence while thinking is fine; silence while stuck without saying what they are stuck on is not.
- Code quality in the snapshot: correctness, naming, handling of edge cases, and whether it matches what they said.

If the problem description or code is missing, review what you have and say so in one clause; do not speculate about missing pieces.

Write for the candidate in the second person. Be specific: quote short phrases from the transcript or reference timestamps/pauses when you make a point. Be direct and useful, not encouraging for its own sake. Keep the summary to 2-4 sentences, give 2-4 strengths, 2-4 weaknesses, and exactly 3 improvements ordered by impact, each one concrete enough to practice next time.`;

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-4 sentence overall assessment.' },
    strengths: { type: 'array', items: { type: 'string' }, description: '2-4 specific things done well.' },
    weaknesses: { type: 'array', items: { type: 'string' }, description: '2-4 specific problems.' },
    improvements: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly 3 concrete actions for next time, highest impact first.',
    },
  },
  required: ['summary', 'strengths', 'weaknesses', 'improvements'],
  additionalProperties: false,
} as const;

export function buildUserMessage(input: ReviewInput): string {
  const stats = pauseStats(input.pauses);
  const parts: string[] = [];

  parts.push(`# Problem: ${input.problemTitle}${input.difficulty ? ` (${input.difficulty})` : ''}`);
  parts.push(
    input.problemDescription
      ? `## Description\n${input.problemDescription}`
      : '## Description\n(could not be read from the page)',
  );

  parts.push(
    `## Session stats\n- Duration: ${fmtClock(input.durationMs)}\n- Pauses (>= threshold): ${stats.count}, total silence ${fmtSeconds(stats.totalMs)}, longest ${fmtSeconds(stats.longestMs)}\n- Filler words counted (lower bound): ${input.fillerCount}`,
  );

  parts.push(`## Transcript (verbatim, with pause markers)\n${input.markedTranscript || '(empty)'}`);

  parts.push(
    input.code !== null
      ? `## Code in editor at review time\n\`\`\`\n${input.code}\n\`\`\``
      : '## Code in editor at review time\n(could not be read from the editor)',
  );

  return parts.join('\n\n');
}
