import type { CriterionId, ReviewOutput, ReviewOutputV1, Score } from './types';

/**
 * The fixed marking rubric. The prompt, the review pane and History all read
 * from here, so scores stay comparable even when the user edits the prompt.
 */
export const LEVELS = ['Strong no', 'Lean no', 'Lean hire', 'Strong hire'] as const;

/** Status colours per level (critical, serious, warning, good); always shown with a label. */
export const LEVEL_COLORS = ['#d03b3b', '#ec835a', '#fab219', '#0ca30c'] as const;

export interface Criterion {
  id: CriterionId;
  label: string;
  looksFor: string;
  /** What a 1, 2, 3 and 4 look like. */
  anchors: readonly [string, string, string, string];
  /** Categorical series colour (dark slots 1-6, validated on the panel surfaces). */
  color: string;
}

export const CRITERIA: readonly Criterion[] = [
  {
    id: 'understanding',
    label: 'Understanding',
    looksFor: 'restating the problem, clarifying questions, and edge cases before designing',
    anchors: [
      'Starts coding without restating the problem, or misreads it.',
      'Restates the problem but misses key constraints or edge cases.',
      'Restates the problem and names the main edge cases before designing.',
      'Also raises clarifying questions and checks their understanding on an example before designing.',
    ],
    color: '#3987e5',
  },
  {
    id: 'approach',
    label: 'Approach',
    looksFor: 'getting from a brute force to the optimal approach with stated reasons',
    anchors: [
      'No working approach, or guesses without reasoning.',
      'Reaches a working but suboptimal approach, or the optimal one without explaining why.',
      'Starts from a brute force, then reaches the optimal approach with a stated reason.',
      'Weighs alternatives, justifies the data structures, and gets to the optimal approach efficiently.',
    ],
    color: '#d95926',
  },
  {
    id: 'complexity',
    label: 'Complexity',
    looksFor: 'stating time and space complexity, correctly',
    anchors: [
      'Never states time or space complexity.',
      'States complexity incorrectly, or only time.',
      'States time and space correctly for the final approach.',
      'Also states it for the brute force and explains what drives the cost.',
    ],
    color: '#199e70',
  },
  {
    id: 'code',
    label: 'Code',
    looksFor: 'correctness, readability, edge cases, and whether the code matches what they said',
    anchors: [
      'The code does not work or is far from a solution.',
      'Mostly works but has bugs or misses edge cases.',
      'Correct and readable, with minor issues.',
      'Correct, clean and idiomatic; edge cases handled; matches what they said.',
    ],
    color: '#c98500',
  },
  {
    id: 'testing',
    label: 'Testing',
    looksFor: 'tracing examples and edge cases through the written code',
    anchors: [
      'No testing or verification.',
      'Mentions testing but never traces a case through the code.',
      'Dry-runs at least one example through the code.',
      'Traces normal and edge cases through the code, and finds and fixes their own bugs.',
    ],
    color: '#d55181',
  },
  {
    id: 'communication',
    label: 'Communication',
    looksFor: 'continuous, followable think-aloud; pauses and filler clusters',
    anchors: [
      'Long unexplained silences, or reasoning that cannot be followed.',
      'Frequent stalls or filler clusters; the reasoning is hard to follow.',
      'Mostly continuous and clear, with a few stalls.',
      'Continuous, structured narration that announces its silences ("let me think about X").',
    ],
    color: '#008300',
  },
];

/** Equal-weight mean of the criterion scores, 1.0-4.0. */
export function overall(criteria: ReviewOutput['criteria']): number {
  return CRITERIA.reduce((sum, c) => sum + criteria[c.id].score, 0) / CRITERIA.length;
}

/** Nearest level to an average score. */
export function levelOf(avg: number): Score {
  return avg >= 3.5 ? 4 : avg >= 2.5 ? 3 : avg >= 1.5 ? 2 : 1;
}

export const verdict = (avg: number) => LEVELS[levelOf(avg) - 1];
export const levelColor = (avg: number) => LEVEL_COLORS[levelOf(avg) - 1];

export type ParsedReview =
  | { v: 2; out: ReviewOutput; score: number }
  | { v: 1; out: ReviewOutputV1 }
  | null;

/** Reads a stored Review.output in either the rubric (v2) or legacy (v1) shape. */
export function parseReview(output: string): ParsedReview {
  let o: unknown;
  try {
    o = JSON.parse(output);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const r = o as Partial<ReviewOutput & ReviewOutputV1>;
  if (r.criteria && typeof r.summary === 'string') {
    const ok = CRITERIA.every((c) => {
      const s = r.criteria![c.id]?.score;
      return s === 1 || s === 2 || s === 3 || s === 4;
    });
    if (!ok) return null;
    const out = r as ReviewOutput;
    return { v: 2, out, score: overall(out.criteria) };
  }
  if (typeof r.summary === 'string' && Array.isArray(r.strengths)) {
    return { v: 1, out: r as ReviewOutputV1 };
  }
  return null;
}
