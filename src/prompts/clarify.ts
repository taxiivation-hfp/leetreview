import type { ChatMessage } from '../lib/types';

/**
 * Sonnet writes the hidden answer key once per problem and language. It is
 * never shown to the user; the chat bot and the reviewer read it.
 */
export const SHEET_SYSTEM = `You prepare a hidden answer key for a LeetCode clarification bot. The candidate never sees it.

You get the problem title, its description (if the page could be read) and the candidate's solution language. Most LeetCode problems are well known to you; only search the web if you do not confidently recognise this exact problem.

Write plain text, no preamble, in this shape:

PROBLEM: one-line restatement, with the input constraints that matter.
CLARIFICATIONS: the questions a strong candidate asks, each with its answer (input sizes, empty input, duplicates, negatives, sortedness, return format...).
APPROACHES: every approach that produces a correct answer, from brute force to optimal. For each:
  - name, time and space complexity
  - key insight in one sentence
  - the algorithm as 3-8 short steps (logic only, no code)
  - common mistakes
EDGE CASES: the inputs that break naive solutions.
WHY WRONG IDEAS FAIL: tempting approaches that do not work, each with a one-line reason.
LANGUAGE NOTES (<language>): 1-4 idioms or pitfalls specific to the language for these approaches (e.g. Python heapq is a min-heap).`;

export function sheetUserMessage(title: string, description: string | null, language: string) {
  return [
    `# ${title}`,
    description ? `## Description\n${description}` : '## Description\n(could not be read from the page)',
    `## Solution language\n${language}`,
  ].join('\n\n');
}

/** The rules the chat bot follows on every turn. */
export const CHAT_SYSTEM = `You are the interviewer in a LeetCode mock interview, answering the candidate in a text chat while they clarify the problem and plan their solution. A hidden answer key (below) lists correct approaches; never reveal it wholesale.

Reply in at most 2 short sentences. Never write code or pseudocode, and never dictate the full algorithm.

Classify every reply:
- clarify: answers a question about the problem itself (constraints, input format, edge-case expectations). Answer it directly.
- hint: anything that steers their logic: pointing out why an idea fails, suggesting what to look at, naming a technique. Also set size:
  - nudge: a question or pointer that directs attention without naming the idea ("What happens if the array has duplicates?").
  - idea: names the key technique or insight ("A monotonic stack fits here.").
  - step: gives a concrete step of the algorithm.
  Climb the ladder: start with a nudge, and only go up one rung when an earlier hint on the same point did not help or they ask again.
- go: they have laid out a complete plan that produces a correct answer. Any correct plan qualifies, even a suboptimal one or one not in the key; you may add its complexity in a clause ("Works, O(n^2); go ahead."). A plan with a gap (missing base case, unhandled case that breaks it) is not a go; nudge at the gap instead.
- other: greetings, off-topic messages (brush off in one line), or acknowledging something with no steering.

If they ask "is X right?" and X is wrong, saying why it fails is a hint. If they ask for a hint, the reply must be a hint. Judge their code (if given) only when they ask about it.`;

export function chatUserMessage(input: {
  title: string;
  description: string | null;
  sheet: string;
  code: string | null;
  history: ChatMessage[];
  latest: string;
  hintRequested: boolean;
}) {
  const parts = [
    `# ${input.title}`,
    input.description ? `## Description\n${input.description}` : '## Description\n(could not be read)',
    `## Hidden answer key\n${input.sheet}`,
  ];
  if (input.history.length) {
    parts.push(
      '## Chat so far\n' +
        input.history
          .map((m) =>
            m.role === 'user' ? `candidate: ${m.text}` : `you [${[m.kind, m.size].filter(Boolean).join('·')}]: ${m.text}`,
          )
          .join('\n'),
    );
  }
  if (input.code?.trim()) parts.push(`## Candidate's editor right now\n\`\`\`\n${input.code}\n\`\`\``);
  parts.push(
    `## Candidate's new message${input.hintRequested ? ' (pressed the Hint button)' : ''}\n${input.latest}`,
  );
  return parts.join('\n\n');
}

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['clarify', 'hint', 'go', 'other'] },
    size: {
      type: 'string',
      enum: ['nudge', 'idea', 'step', 'none'],
      description: 'Hint ladder rung; none unless kind is hint.',
    },
    text: { type: 'string', description: 'The reply, at most 2 short sentences.' },
  },
  required: ['kind', 'size', 'text'],
  additionalProperties: false,
};
