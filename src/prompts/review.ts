import type { ReviewInput } from '../lib/review/types';
import { pauseStats } from '../lib/pauses';
import { fmtClock, fmtSeconds } from '../lib/format';
import { CRITERIA, LEVELS } from '../lib/rubric';

/** Bump when the prompt, rubric or schema changes so reviews stay comparable. */
export const PROMPT_VERSION = 'v2';

/** The part the user can replace in Settings: who reviews, what to weigh, how to write. */
export const SYSTEM_PROMPT = `You are an experienced interviewer at a top tech company reviewing a recorded mock interview. The candidate solved a LeetCode problem alone while thinking aloud. You receive the problem, a verbatim transcript of their speech (filler words preserved, with [Ns pause] markers where they were silent), pause statistics, and the code left in the editor.

Evaluate the thought process, not just the final code. Silence while thinking is fine; silence while stuck without saying what they are stuck on is not.

The transcript comes from speech recognition. A word that makes no sense but sounds like one that does ("hash nap" for "hashmap") is a transcription error, not the candidate's mistake; read it as the sensible word.

If the problem description or code is missing, review what you have and say so in one clause; do not speculate about missing pieces.

Write for the candidate in the second person. Be specific and direct, not encouraging for its own sake: quote short phrases from the transcript or reference pauses when you make a point.`;

/** Always sent after the (possibly custom) system prompt, so scoring never drifts. */
export const RUBRIC = [
  `Score the interview on this fixed rubric. Each criterion gets 1-4: ${LEVELS.map((l, i) => `${i + 1} ${l}`).join(', ')}. Pick the level whose description best fits the evidence in the transcript and code; score only what they show.`,
  `For every criterion:
- note: one line justifying the score, quoting the transcript (or the code) where you can.
- fix1, fix2, ...: concrete things to practice next time, highest impact first, one per field. A 4 gets none, a 3 gets one, a 2 gets two, a 1 gets three.

summary: 2-4 sentences on the interview as a whole.`,
  ...CRITERIA.map(
    (c) =>
      `## ${c.label} (${c.id})\nLooks at ${c.looksFor}.\n` +
      c.anchors.map((a, i) => `${i + 1} ${LEVELS[i]}: ${a}`).join('\n'),
  ),
].join('\n\n');

/**
 * One anyOf variant per score; each carries exactly 4 - score fixN fields, so
 * the improvement count is enforced by the schema (structured outputs support
 * const and anyOf, not array length limits). claude.ts folds fixN into
 * `improvements` before storing.
 */
const criterionSchema = {
  anyOf: ([4, 3, 2, 1] as const).map((score) => {
    const fixes = Array.from({ length: 4 - score }, (_, i) => `fix${i + 1}`);
    return {
      type: 'object',
      properties: {
        score: { type: 'integer', const: score },
        note: { type: 'string', description: 'One line justifying the score, quoting the transcript.' },
        ...Object.fromEntries(
          fixes.map((f) => [f, { type: 'string', description: 'A concrete improvement to practice.' }]),
        ),
      },
      required: ['score', 'note', ...fixes],
      additionalProperties: false,
    };
  }),
};

export const REVIEW_SCHEMA = {
  type: 'object',
  $defs: { criterion: criterionSchema },
  properties: {
    // Criteria first so the summary is written after the scoring.
    criteria: {
      type: 'object',
      properties: Object.fromEntries(CRITERIA.map((c) => [c.id, { $ref: '#/$defs/criterion' }])),
      required: CRITERIA.map((c) => c.id),
      additionalProperties: false,
    },
    summary: { type: 'string', description: '2-4 sentence overall assessment.' },
  },
  required: ['criteria', 'summary'],
  additionalProperties: false,
};

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
